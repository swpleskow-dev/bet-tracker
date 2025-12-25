import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";


// Server-side Supabase client (service role recommended)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

type ParsedGame = {
  game_date?: string; // YYYY-MM-DD
  home_team?: string;
  away_team?: string;
};

type ParsedLeg = {
  bet_type: "moneyline" | "spread" | "total" | "player_prop";
  selection?: string; // team name, "over"/"under", etc.
  line?: number | null;
  odds?: number | null;
  // props:
  prop_player?: string | null;
  prop_market?: string | null;
  prop_side?: string | null; // over/under/yes/no
  prop_line?: number | null;
  // game identification for the leg
  game?: ParsedGame;
};

type ParsedSlip = {
  sport: "NFL";
  bet_type: "moneyline" | "spread" | "total" | "player_prop" | "parlay";
  stake: number | null;
  odds: number | null;

  // single bet / single prop:
  selection?: string | null;
  line?: number | null;

  // prop fields (single prop):
  prop_player?: string | null;
  prop_market?: string | null;
  prop_side?: string | null;
  prop_line?: number | null;

  // game identification (single)
  game?: ParsedGame;

  // parlay legs
  legs?: ParsedLeg[];

  // optional metadata
  sportsbook?: string | null;
  confidence?: number | null; // 0..1
};

// --- Helpers ---
function guessMime(name: string) {
  const n = name.toLowerCase();
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

async function findGameIdFromGame(g?: ParsedGame): Promise<string | null> {
  if (!g) return null;
  const date = (g.game_date ?? "").slice(0, 10);
  const home = (g.home_team ?? "").trim();
  const away = (g.away_team ?? "").trim();
  if (!date || !home || !away) return null;

  // Try exact-ish match first
  const { data, error } = await supabase
    .from("games")
    .select("game_id, game_date, home_team, away_team")
    .eq("game_date", date)
    .or(`home_team.ilike.%${home}%,away_team.ilike.%${home}%`)
    .limit(50);

  if (error || !data) return null;

  // Prefer row where both teams match somewhere
  const upperHome = home.toUpperCase();
  const upperAway = away.toUpperCase();

  const best =
    data.find((row: any) => {
      const ht = String(row.home_team ?? "").toUpperCase();
      const at = String(row.away_team ?? "").toUpperCase();
      return (ht.includes(upperHome) && at.includes(upperAway)) || (ht.includes(upperAway) && at.includes(upperHome));
    }) ?? null;

  return best ? String(best.game_id) : null;
}

export async function POST(req: Request) {
  try {
    if (!OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "Missing OPENAI_API_KEY on server." },
        { status: 500 }
      );
    }

    const form = await req.formData();
    const file = form.get("image") as File | null;
    if (!file) return NextResponse.json({ error: "No image uploaded." }, { status: 400 });

    const buf = Buffer.from(await file.arrayBuffer());
    const mime = file.type || guessMime(file.name);
    const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;

    const betSlipSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    sport: { type: "string", enum: ["NFL"] },
    bet_type: { type: "string", enum: ["moneyline", "spread", "total", "player_prop", "parlay"] },
    stake: { type: ["number", "null"] },
    odds: { type: ["number", "null"] },
    selection: { type: ["string", "null"] },
    line: { type: ["number", "null"] },

    prop_player: { type: ["string", "null"] },
    prop_market: { type: ["string", "null"] },
    prop_side: { type: ["string", "null"] },
    prop_line: { type: ["number", "null"] },

    game: {
      type: ["object", "null"],
      additionalProperties: false,
      properties: {
        game_date: { type: ["string", "null"] },
        home_team: { type: ["string", "null"] },
        away_team: { type: ["string", "null"] },
      },
      required: [],
    },

    legs: {
      type: ["array", "null"],
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          bet_type: { type: "string", enum: ["moneyline", "spread", "total", "player_prop"] },
          selection: { type: ["string", "null"] },
          line: { type: ["number", "null"] },
          odds: { type: ["number", "null"] },

          prop_player: { type: ["string", "null"] },
          prop_market: { type: ["string", "null"] },
          prop_side: { type: ["string", "null"] },
          prop_line: { type: ["number", "null"] },

          game: {
            type: ["object", "null"],
            additionalProperties: false,
            properties: {
              game_date: { type: ["string", "null"] },
              home_team: { type: ["string", "null"] },
              away_team: { type: ["string", "null"] },
            },
            required: [],
          },
        },
        required: ["bet_type"],
      },
    },

    sportsbook: { type: ["string", "null"] },
    confidence: { type: ["number", "null"] },
  },
  required: ["sport", "bet_type", "stake", "odds"],
};


    const prompt = `
You are extracting a sports bet slip screenshot into JSON.
- The sport is NFL.
- Determine whether this is: moneyline, spread, total, player_prop, or parlay.
- Extract stake (amount risked) and odds (American odds, e.g. -110 or +250).
- For singles: extract selection + line as applicable.
- For player props: extract player name, market (e.g. Passing Yards), side (over/under), prop_line.
- For parlays: return legs[], each with its own bet_type, selection/line/odds, and if a prop leg include prop_* fields.
- For each bet (single or leg), include game: {game_date, away_team, home_team} when visible. Use YYYY-MM-DD if possible.
Return only valid JSON matching the schema.
`;

    // OpenAI Responses API supports image inputs :contentReference[oaicite:1]{index=1}
    // Structured outputs with json_schema :contentReference[oaicite:2]{index=2}
    const openaiRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: prompt },
              { type: "input_image", image_url: dataUrl },
            ],
          },
        ],
        text: {
  format: {
    type: "json_schema",
    name: "bet_slip",
    strict: true,
    schema: schema.schema, // <-- the actual JSON Schema object
  },
},

        },
      }),
    });

    if (!openaiRes.ok) {
  const contentType = openaiRes.headers.get("content-type") || "";
  const requestId =
    openaiRes.headers.get("x-request-id") ||
    openaiRes.headers.get("openai-request-id") ||
    null;

  const body = contentType.includes("application/json")
    ? await openaiRes.json().catch(() => null)
    : await openaiRes.text().catch(() => null);

  console.error("OPENAI ERROR", {
    status: openaiRes.status,
    requestId,
    body,
  });

  return NextResponse.json(
    {
      error: "OpenAI request failed",
      status: openaiRes.status,
      requestId,
      body,
    },
    { status: 500 }
  );
}


    const out = await openaiRes.json();

    // Responses API returns text in output[].content[].text; this is the JSON string
    const jsonText =
      out?.output?.[0]?.content?.find((c: any) => c?.type === "output_text")?.text ??
      out?.output_text ??
      null;

    if (!jsonText) {
      return NextResponse.json({ error: "No JSON returned from model." }, { status: 500 });
    }

    let parsed: ParsedSlip;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      return NextResponse.json({ error: "Model returned non-JSON." }, { status: 500 });
    }

    // Map to your internal game_id(s)
    if (parsed.bet_type !== "parlay") {
      const game_id = await findGameIdFromGame(parsed.game);
      return NextResponse.json({ parsed, game_id });
    }

    const legs = parsed.legs ?? [];
    const mapped = await Promise.all(
      legs.map(async (leg) => ({
        ...leg,
        game_id: await findGameIdFromGame(leg.game),
      }))
    );

    return NextResponse.json({ parsed: { ...parsed, legs: mapped } });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "unknown" },
      { status: 500 }
    );
  }
}

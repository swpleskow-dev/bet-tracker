// app/api/bets/parse-slip/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Ensure Node runtime (Edge can be limited for File/Buffer)
export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

async function fileToDataUrl(file: File) {
  const ab = await file.arrayBuffer();
  const buf = Buffer.from(ab);
  const mime = file.type || "image/png";
  const b64 = buf.toString("base64");
  return `data:${mime};base64,${b64}`;
}

function norm(s: any) {
  return String(s ?? "").trim();
}

/**
 * Match a game row by parsed game info (home/away/date) using a fuzzy ilike search.
 * Returns best match game_id or null.
 */
async function matchGameIdFromParsedGame(game: any) {
  const home = norm(game?.home_team).toUpperCase();
  const away = norm(game?.away_team).toUpperCase();
  const date = norm(game?.game_date).slice(0, 10);

  if (!home || !away) return null;

  const from = date
    ? date
    : ymd(new Date(Date.now() - 365 * 24 * 60 * 60 * 1000));
  const to = date
    ? date
    : ymd(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000));

  const { data, error } = await supabase
    .from("games")
    .select("game_id, game_date, home_team, away_team")
    .gte("game_date", from)
    .lte("game_date", to)
    .or(
      `and(home_team.ilike.%${home}%,away_team.ilike.%${away}%),and(home_team.ilike.%${away}%,away_team.ilike.%${home}%)`
    )
    .order("game_date", { ascending: false })
    .limit(25);

  if (error) return null;
  if (!data || data.length === 0) return null;

  const scored = data.map((g: any) => {
    const h = String(g.home_team ?? "").toUpperCase();
    const a = String(g.away_team ?? "").toUpperCase();

    let score = 0;

    // direct orientation
    if (h === home) score += 6;
    if (a === away) score += 6;
    if (h.includes(home)) score += 3;
    if (a.includes(away)) score += 3;

    // swapped orientation
    if (h === away) score += 6;
    if (a === home) score += 6;
    if (h.includes(away)) score += 3;
    if (a.includes(home)) score += 3;

    // exact date match helps
    if (date && String(g.game_date) === date) score += 8;

    return { g, score };
  });

  scored.sort((x: any, y: any) => y.score - x.score);
  return scored[0]?.g?.game_id ?? null;
}

/**
 * IMPORTANT: OpenAI strict JSON schema requires:
 * - Every object schema must have `required`
 * - `required` must include EVERY key in `properties`
 * Optionality is represented by allowing `null` in the type, not by omitting the key.
 */
const betSlipSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    sport: { type: "string", enum: ["NFL"] },

    bet_type: {
      type: "string",
      enum: ["moneyline", "spread", "total", "player_prop", "parlay"],
    },

    stake: { type: ["number", "null"] },
    odds: { type: ["number", "null"] },

    // singles (moneyline/spread/total)
    selection: { type: ["string", "null"] },
    line: { type: ["number", "null"] },

    // props
    prop_player: { type: ["string", "null"] },
    prop_market: { type: ["string", "null"] },
    prop_side: { type: ["string", "null"] }, // "over" | "under"
    prop_line: { type: ["number", "null"] },

    // game info for matching
    game: {
      type: ["object", "null"],
      additionalProperties: false,
      properties: {
        game_date: { type: ["string", "null"] }, // ideally YYYY-MM-DD
        home_team: { type: ["string", "null"] },
        away_team: { type: ["string", "null"] },
      },
      required: ["game_date", "home_team", "away_team"],
    },

    // parlay legs
    legs: {
      type: ["array", "null"],
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          bet_type: {
            type: "string",
            enum: ["moneyline", "spread", "total", "player_prop"],
          },

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
            required: ["game_date", "home_team", "away_team"],
          },
        },
        required: [
          "bet_type",
          "selection",
          "line",
          "odds",
          "prop_player",
          "prop_market",
          "prop_side",
          "prop_line",
          "game",
        ],
      },
    },

    sportsbook: { type: ["string", "null"] },
    confidence: { type: ["number", "null"] },
  },

  // REQUIRED must include every top-level property key
  required: [
    "sport",
    "bet_type",
    "stake",
    "odds",
    "selection",
    "line",
    "prop_player",
    "prop_market",
    "prop_side",
    "prop_line",
    "game",
    "legs",
    "sportsbook",
    "confidence",
  ],
} as const;

export async function POST(req: Request) {
  try {
    if (!OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "Server misconfigured: OPENAI_API_KEY is missing." },
        { status: 500 }
      );
    }

    const fd = await req.formData();
    const image = fd.get("image");

    if (!image || !(image instanceof File)) {
      return NextResponse.json(
        { error: "Missing image file (field name: image)." },
        { status: 400 }
      );
    }

    const dataUrl = await fileToDataUrl(image);

    const prompt = `
You are parsing a sportsbook bet slip screenshot into structured data for an NFL bet tracker.

Rules:
- Output MUST match the provided JSON schema exactly.
- DO NOT omit fields: if a field isn't visible, set it to null.
- bet_type must be one of: moneyline | spread | total | player_prop | parlay

Singles:
- total: selection is "over" or "under", line is the total number.
- spread: selection is the team name, line is the spread number (e.g. -3.5).
- moneyline: selection is the team name, line must be null.

Player props:
- bet_type = "player_prop"
- fill prop_player, prop_market, prop_side ("over"/"under"), prop_line
- selection and line can be null (still must exist)

Parlay:
- bet_type = "parlay"
- fill legs[] with each leg. Put overall stake/odds for the parlay if visible.
- For leg bet_type="player_prop" fill prop_* fields.

Game matching:
- If visible, populate game.home_team, game.away_team, game.game_date (YYYY-MM-DD if possible).
- For each parlay leg, try to populate leg.game similarly.

Remember: all fields must appear; use null if unknown.
    `.trim();

    const openaiRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
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
            schema: betSlipSchema,
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

    const responseJson = await openaiRes.json();

    // Try common response shapes for Responses API
    const outputText: string | null =
      responseJson?.output_text ??
      responseJson?.output?.[0]?.content?.find((c: any) => c?.type === "output_text")
        ?.text ??
      responseJson?.output?.[0]?.content?.[0]?.text ??
      null;

    if (!outputText || typeof outputText !== "string") {
      return NextResponse.json(
        {
          error: "OpenAI response did not include output_text.",
          debug: { keys: Object.keys(responseJson ?? {}) },
        },
        { status: 500 }
      );
    }

    let parsed: any;
    try {
      parsed = JSON.parse(outputText);
    } catch {
      return NextResponse.json(
        { error: "Model output was not valid JSON.", raw: outputText },
        { status: 500 }
      );
    }

    // Match top-level game_id for single bet / prop if possible
    const topGameId = await matchGameIdFromParsedGame(parsed?.game);

    // For parlay legs: attempt to match each leg to a game_id
    if (Array.isArray(parsed?.legs)) {
      const legsWithIds = [];
      for (const leg of parsed.legs) {
        const legGameId = await matchGameIdFromParsedGame(leg?.game);
        legsWithIds.push({ ...leg, game_id: legGameId });
      }
      parsed.legs = legsWithIds;
    }

    return NextResponse.json({
      parsed,
      game_id: topGameId,
    });
  } catch (e: any) {
    console.error("parse-slip route error", e);
    return NextResponse.json(
      { error: e?.message ?? "unknown" },
      { status: 500 }
    );
  }
}

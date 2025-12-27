// app/api/bets/parse-slip/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

function isISODate(s: string | null) {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
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

function uniq(arr: string[]) {
  return Array.from(new Set(arr.filter(Boolean)));
}

function escForOr(v: string) {
  return v.replace(/[%,"\\]/g, "");
}

function teamVariants(raw: string) {
  const s = norm(raw).toUpperCase().replace(/\s+/g, " ").trim();
  if (!s) return [];

  const parts = s.split(" ").filter(Boolean);
  const first = parts[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1] : "";
  const noSpace = s.replace(/\s+/g, "");

  const prefix3 = s.slice(0, 3);
  const prefix4 = s.slice(0, 4);

  return uniq([
    s,
    first,
    last,
    prefix3,
    prefix4,
    noSpace,
    noSpace.slice(0, 3),
    noSpace.slice(0, 4),
  ]).map(escForOr);
}

async function queryGames({
  from,
  to,
  homeVars,
  awayVars,
}: {
  from: string;
  to: string;
  homeVars: string[];
  awayVars: string[];
}) {
  const homePick = homeVars.slice(0, 3);
  const awayPick = awayVars.slice(0, 3);

  const orClauses: string[] = [];
  for (const h of homePick) {
    for (const a of awayPick) {
      orClauses.push(`and(home_team.ilike.%${h}%,away_team.ilike.%${a}%)`);
      orClauses.push(`and(home_team.ilike.%${a}%,away_team.ilike.%${h}%)`);
    }
  }

  const { data, error } = await supabase
    .from("games")
    .select("game_id, game_date, home_team, away_team")
    .gte("game_date", from)
    .lte("game_date", to)
    .or(orClauses.join(","))
    .order("game_date", { ascending: false })
    .limit(50);

  return { data: (data ?? []) as any[], error };
}

function scoreCandidates(data: any[], homeVars: string[], awayVars: string[], date: string | null) {
  const scored = data.map((g) => {
    const h = String(g.home_team ?? "").toUpperCase();
    const a = String(g.away_team ?? "").toUpperCase();
    let score = 0;

    for (const hv of homeVars) {
      if (hv && h === hv) score += 10;
      if (hv && h.includes(hv)) score += 4;
    }
    for (const av of awayVars) {
      if (av && a === av) score += 10;
      if (av && a.includes(av)) score += 4;
    }

    for (const hv of homeVars) {
      if (hv && a === hv) score += 7;
      if (hv && a.includes(hv)) score += 3;
    }
    for (const av of awayVars) {
      if (av && h === av) score += 7;
      if (av && h.includes(av)) score += 3;
    }

    if (date && String(g.game_date).slice(0, 10) === date) score += 12;

    return { g, score };
  });

  scored.sort((x, y) => y.score - x.score);
  return scored;
}

/**
 * Safe matcher:
 * - Uses team match always
 * - Uses date only if it is ISO YYYY-MM-DD
 */
async function matchGameIdFromParsedGame(game: any): Promise<string | null> {
  const homeRaw = norm(game?.home_team);
  const awayRaw = norm(game?.away_team);

  const dateRaw = norm(game?.game_date) || null;
  const date = isISODate(dateRaw) ? dateRaw : null;

  if (!homeRaw || !awayRaw) return null;

  const homeVars = teamVariants(homeRaw);
  const awayVars = teamVariants(awayRaw);

  // Pass 1: tight date window if date is valid
  if (date) {
    const from = date;
    const to = date;

    const r1 = await queryGames({ from, to, homeVars, awayVars });
    if (!r1.error && r1.data.length > 0) {
      const scored = scoreCandidates(r1.data, homeVars, awayVars, date);
      return scored[0]?.g?.game_id ?? null;
    }
  }

  // Pass 2: wide window
  const wideFrom = ymd(new Date(Date.now() - 365 * 24 * 60 * 60 * 1000));
  const wideTo = ymd(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000));

  const r2 = await queryGames({ from: wideFrom, to: wideTo, homeVars, awayVars });
  if (!r2.error && r2.data.length > 0) {
    const scored = scoreCandidates(r2.data, homeVars, awayVars, date);
    return scored[0]?.g?.game_id ?? null;
  }

  return null;
}

/**
 * STRICT JSON schema rules:
 * - Every object has `required`
 * - required includes ALL keys in properties
 */
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
      required: ["game_date", "home_team", "away_team"],
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
      return NextResponse.json({ error: "Server misconfigured: OPENAI_API_KEY is missing." }, { status: 500 });
    }

    const fd = await req.formData();
    const image = fd.get("image");

    if (!image || !(image instanceof File)) {
      return NextResponse.json({ error: "Missing image file (field name: image)." }, { status: 400 });
    }

    const dataUrl = await fileToDataUrl(image);

    const prompt = `
Parse this sportsbook bet slip screenshot into structured JSON for an NFL bet tracker.

Rules:
- Output MUST match the provided JSON schema exactly.
- DO NOT omit fields: if unknown/not visible, set to null.
- bet_type must be one of: moneyline | spread | total | player_prop | parlay

IMPORTANT:
- For totals: selection MUST be "over" or "under" (not "TOTAL").
- For spreads/moneyline: selection should be the team name shown.
- For parlay: include legs[]. If the slip doesn’t clearly show matchup per leg, set leg.game fields to null.

Dates:
- game_date must be YYYY-MM-DD if you can. If not, set it to null.
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

      return NextResponse.json(
        { error: "OpenAI request failed", status: openaiRes.status, requestId, body },
        { status: 500 }
      );
    }

    const responseJson = await openaiRes.json();

    const outputText: string | null =
      responseJson?.output_text ??
      responseJson?.output?.[0]?.content?.find((c: any) => c?.type === "output_text")?.text ??
      responseJson?.output?.[0]?.content?.[0]?.text ??
      null;

    if (!outputText || typeof outputText !== "string") {
      return NextResponse.json({ error: "OpenAI response did not include output_text." }, { status: 500 });
    }

    let parsed: any;
    try {
      parsed = JSON.parse(outputText);
    } catch {
      return NextResponse.json({ error: "Model output was not valid JSON.", raw: outputText }, { status: 500 });
    }

    // Match top-level game (for singles/props). For parlays, legs can be unmatched.
    const topGameId = await matchGameIdFromParsedGame(parsed?.game);

    // For legs: DO NOT force/override game_id if we can't match.
    if (Array.isArray(parsed?.legs)) {
      const legsWithIds = [];
      for (const leg of parsed.legs) {
        const legGameId = await matchGameIdFromParsedGame(leg?.game);
        legsWithIds.push({ ...leg, game_id: legGameId ?? null });
      }
      parsed.legs = legsWithIds;
    }

    return NextResponse.json({
      parsed,
      game_id: topGameId ?? null,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "unknown" }, { status: 500 });
  }
}

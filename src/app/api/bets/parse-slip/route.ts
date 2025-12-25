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

/**
 * Build fuzzy tokens from a team label like:
 * "DEN BRONCOS" -> ["DEN BRONCOS","DEN","BRONCOS","DENB","BRO"]
 * "KC CHIEFS" -> ["KC CHIEFS","KC","CHIEFS","KCC","CHI"]
 */
function teamVariants(raw: string) {
  const s = norm(raw).toUpperCase().replace(/\s+/g, " ").trim();
  if (!s) return [];

  const parts = s.split(" ").filter(Boolean);

  const first = parts[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1] : "";

  // a few extra “weak” variants that often help
  const noSpace = s.replace(/\s+/g, "");
  const prefix3 = s.slice(0, 3);
  const prefix4 = s.slice(0, 4);

  return uniq([
    s,
    first,
    last,
    prefix3,
    prefix4,
    noSpace.length >= 3 ? noSpace.slice(0, 3) : "",
    noSpace.length >= 4 ? noSpace.slice(0, 4) : "",
  ]);
}

/**
 * Escape values for Supabase filter strings (very simple, avoids breaking the query)
 */
function escForOr(v: string) {
  return v.replace(/[%,"\\]/g, "");
}

/**
 * Match a game row by parsed game info (home/away/date) using fuzzy ilike search.
 * Returns best match game_id or null.
 */
async function matchGameIdFromParsedGame(game: any) {
  const homeRaw = norm(game?.home_team);
  const awayRaw = norm(game?.away_team);
  const date = norm(game?.game_date).slice(0, 10);

  if (!homeRaw || !awayRaw) return null;

  const homeVars = teamVariants(homeRaw).map(escForOr);
  const awayVars = teamVariants(awayRaw).map(escForOr);

  // If date missing, search a reasonable window
  const from = date
    ? date
    : ymd(new Date(Date.now() - 365 * 24 * 60 * 60 * 1000));
  const to = date
    ? date
    : ymd(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000));

  // Build OR filter that works for swapped home/away too.
  // We use a couple variants to be robust to abbreviations vs full names.
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
    .limit(25);

  if (error) return null;
  if (!data || data.length === 0) return null;

  // Score candidates: exact + contains + date match.
  const scored = data.map((g: any) => {
    const h = String(g.home_team ?? "").toUpperCase();
    const a = String(g.away_team ?? "").toUpperCase();

    let score = 0;

    // reward exact match on any variant
    for (const hv of homeVars) {
      if (hv && h === hv) score += 10;
      if (hv && h.includes(hv)) score += 4;
    }
    for (const av of awayVars) {
      if (av && a === av) score += 10;
      if (av && a.includes(av)) score += 4;
    }

    // also reward swapped matches (some sources flip)
    for (const hv of homeVars) {
      if (hv && a === hv) score += 7;
      if (hv && a.includes(hv)) score += 3;
    }
    for (const av of awayVars) {
      if (av && h === av) score += 7;
      if (av && h.includes(av)) score += 3;
    }

    if (date && String(g.game_date) === date) score += 12;

    return { g, score };
  });

  scored.sort((x: any, y: any) => y.score - x.score);
  return scored[0]?.g?.game_id ?? null;
}

/**
 * OpenAI strict JSON schema requires:
 * - objects must have `required`
 * - required must include EVERY key in properties
 * Optionality is represented by allowing null.
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
Parse this sportsbook bet slip screenshot into structured JSON for an NFL bet tracker.

Strict rules:
- Output MUST match the provided JSON schema exactly.
- DO NOT omit any fields. If unknown/not visible, set the field to null.
- bet_type must be one of: moneyline | spread | total | player_prop | parlay

Singles:
- total: selection="over"/"under", line=total number.
- spread: selection=team name, line=spread (e.g. -3.5).
- moneyline: selection=team name, line=null.

Player props:
- bet_type="player_prop"
- fill prop_player, prop_market, prop_side ("over"/"under"), prop_line
- selection and line still must exist (use null if not applicable)

Parlay:
- bet_type="parlay"
- fill legs[]; include each leg’s bet_type/selection/line/odds and any prop_* if a prop leg.
- IMPORTANT: try hard to populate leg.game (home_team/away_team/game_date) for each leg if the slip shows it.
- If the slip only shows the matchup once, use the top-level game object and reuse it for leg.game.

Teams/dates:
- Use team abbreviations if that’s what you see on the slip (e.g. "DEN", "KC").
- game_date should be YYYY-MM-DD if possible.
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

    // Match top-level game_id (helps singles/props and also helps parlay fallback)
    const topGameId = await matchGameIdFromParsedGame(parsed?.game);

    // For parlay legs: if a leg.game is missing/null, fall back to the top-level parsed.game
    if (Array.isArray(parsed?.legs)) {
      const legsWithIds = [];
      for (const leg of parsed.legs) {
        const legGameObj = leg?.game ?? parsed?.game ?? null;
        const legGameId = await matchGameIdFromParsedGame(legGameObj);
        legsWithIds.push({ ...leg, game: legGameObj, game_id: legGameId });
      }
      parsed.legs = legsWithIds;
    }

    return NextResponse.json({
      parsed,
      game_id: topGameId,
    });
  } catch (e: any) {
    console.error("parse-slip route error", e);
    return NextResponse.json({ error: e?.message ?? "unknown" }, { status: 500 });
  }
}

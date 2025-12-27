import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function teamKey(s?: string | null) {
  const x = (s ?? "").toUpperCase().trim();
  if (!x) return "";
  const first = x.split(/\s+/)[0] ?? "";
  return first.replace(/[^A-Z]/g, "");
}

function normalizeYMD(s?: string | null) {
  const t = (s ?? "").trim();
  if (!t) return null;

  // already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;

  // support things like "Dec-28-2025" or "Dec 28 2025"
  const cleaned = t.replace(/,/g, " ").replace(/\s+/g, " ").trim();
  const d = new Date(cleaned);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

async function findGameId(game: any): Promise<string | null> {
  const game_date = normalizeYMD(game?.game_date);
  const home = teamKey(game?.home_team);
  const away = teamKey(game?.away_team);

  if (!game_date || !home || !away) return null;

  // Look for same date where either home/away match by key
  const { data, error } = await supabase
    .from("games")
    .select("game_id, game_date, home_team, away_team")
    .eq("game_date", game_date)
    .limit(50);

  if (error) return null;

  const rows = data ?? [];
  const exact = rows.find((r: any) => teamKey(r.home_team) === home && teamKey(r.away_team) === away);
  if (exact) return exact.game_id;

  // try swapped (sometimes screenshot lists @ differently)
  const swapped = rows.find((r: any) => teamKey(r.home_team) === away && teamKey(r.away_team) === home);
  if (swapped) return swapped.game_id;

  // fallback: match if either side matches (best-effort)
  const partial = rows.find((r: any) => {
    const hk = teamKey(r.home_team);
    const ak = teamKey(r.away_team);
    return (hk === home || ak === home) && (hk === away || ak === away);
  });

  return partial?.game_id ?? null;
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const base64 = Buffer.from(bytes).toString("base64");
    const dataUrl = `data:${file.type};base64,${base64}`;

    const prompt = `
You are parsing an NFL sportsbook screenshot.

The screenshot may be one of:
1) A single straight bet slip
2) A parlay slip (one bet with multiple legs)
3) A bet history LIST showing multiple separate straight bets (often repeated rows with label "STRAIGHT BET")

Rules:
- If the screenshot shows MULTIPLE separate rows each labeled "STRAIGHT BET" (or clearly separate tickets),
  DO NOT treat it as a parlay.
  Return kind="batch" with a list of bets.
- Only return kind="parlay" if it is clearly ONE parlay bet slip with legs combined into one wager.

For each bet/leg return:
- sport: "NFL"
- bet_type: moneyline | spread | total | player_prop
- game: { game_date, home_team, away_team } (date like 2025-12-28)
- selection: team or "over"/"under"
- line: number or null
- stake: dollars risk or null
- odds: American odds integer or null

If unknown, return null. Return ONLY valid JSON.
`;

    const resp = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: dataUrl },
          ],
        },
      ],
    });

    const raw = resp.output_text?.trim() || "";
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "Model did not return valid JSON", raw }, { status: 500 });
    }

    if (!parsed || parsed.sport !== "NFL" || !parsed.kind) {
      return NextResponse.json({ error: "Unexpected parse format", raw: parsed }, { status: 500 });
    }

    // ✅ Attach game_id server-side
    if (parsed.kind === "single") {
      const gid = await findGameId(parsed.bet?.game);
      parsed.bet.game_id = gid;
    }

    if (parsed.kind === "batch") {
      for (const b of parsed.bets ?? []) {
        const gid = await findGameId(b?.game);
        b.game_id = gid;
      }
    }

    if (parsed.kind === "parlay") {
      for (const leg of parsed.legs ?? []) {
        const gid = await findGameId(leg?.game);
        leg.game_id = gid;
      }
    }

    return NextResponse.json({ parsed });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "unknown" }, { status: 500 });
  }
}

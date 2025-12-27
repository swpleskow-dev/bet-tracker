import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

type ParsedSingle = {
  sport: "NFL";
  bet_type: "moneyline" | "spread" | "total" | "player_prop";
  game: { game_date: string; home_team: string; away_team: string } | null;
  selection: string | null;
  line: number | null;
  stake: number | null;
  odds: number | null;
};

type ParsedParlayLeg = {
  bet_type: "moneyline" | "spread" | "total";
  selection: string | null;
  line: number | null;
  odds: number | null;
  game: { game_date: string; home_team: string; away_team: string } | null;
};

type Parsed =
  | {
      sport: "NFL";
      kind: "single";
      bet: ParsedSingle;
    }
  | {
      sport: "NFL";
      kind: "parlay";
      stake: number | null;
      odds: number | null;
      legs: ParsedParlayLeg[];
    }
  | {
      sport: "NFL";
      kind: "batch"; // ✅ multiple straight bets
      bets: ParsedSingle[];
    };

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

    // ✅ IMPORTANT: We explicitly tell the model that screenshots can be:
    // - a single bet
    // - a parlay slip
    // - a bet history list with MULTIPLE straight bets (batch)
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
- For each bet/leg:
  - sport: NFL
  - bet_type: moneyline | spread | total | player_prop
  - game: include game_date (YYYY-MM-DD if possible; if only Dec-28-2025 is shown use 2025-12-28),
          home_team and away_team abbreviations or names as shown.
  - selection: team abbreviation/name or "over"/"under"
  - line: spread/total number if present
  - stake: dollars risk (if present)
  - odds: American odds if present (e.g. -112 or +300)
If you can't find a field, set it to null.
Return ONLY valid JSON.
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
      // no response_format schema here (avoids the JSON schema errors you saw)
    });

    const text = resp.output_text?.trim() || "";
    let parsed: Parsed | null = null;

    try {
      parsed = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { error: "Model did not return valid JSON", raw: text },
        { status: 500 }
      );
    }

    // minimal shape guard
    if (!parsed || parsed.sport !== "NFL" || !("kind" in parsed)) {
      return NextResponse.json({ error: "Unexpected parse format", raw: parsed }, { status: 500 });
    }

    return NextResponse.json({ parsed });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "unknown" }, { status: 500 });
  }
}

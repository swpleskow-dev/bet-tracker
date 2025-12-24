import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // server only
);

function yyyymmdd(dateISO: string) {
  // input: YYYY-MM-DD -> output: YYYYMMDD
  return dateISO.replaceAll("-", "");
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date"); // YYYY-MM-DD
  const refresh = searchParams.get("refresh") === "1";

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  if (!refresh) {
    const { data: cached } = await supabase
      .from("games")
      .select("*")
      .eq("sport", "NFL")
      .eq("game_date", date);

    if (cached && cached.length > 0) {
      return NextResponse.json({ source: "cache", games: cached });
    }
  }

  // ESPN scoreboard by date (YYYYMMDD)
  const espnDate = yyyymmdd(date);
  const url = `https://site.api.espn.com/apis/v2/sports/football/nfl/scoreboard?dates=${espnDate}`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) {
    return NextResponse.json({ error: `ESPN fetch failed: ${r.status}` }, { status: 502 });
  }

  const json = await r.json();
  const events = json?.events ?? [];

  const rows = events.map((ev: any) => {
    const comp = ev?.competitions?.[0];
    const comps = comp?.competitors ?? [];
    const home = comps.find((c: any) => c.homeAway === "home");
    const away = comps.find((c: any) => c.homeAway === "away");

    const statusType = comp?.status?.type;
    const isFinal = !!statusType?.completed;

    return {
      game_id: String(ev.id),
      sport: "NFL",
      game_date: date,
      home_team: home?.team?.abbreviation ?? home?.team?.shortDisplayName ?? "HOME",
      away_team: away?.team?.abbreviation ?? away?.team?.shortDisplayName ?? "AWAY",
      home_score: Number(home?.score ?? 0),
      away_score: Number(away?.score ?? 0),
      period: comp?.status?.period ?? null,
      clock: comp?.status?.displayClock ?? null,
      is_final: isFinal,
      updated_at: new Date().toISOString(),
    };
  });

  if (rows.length > 0) {
    const { error } = await supabase
      .from("games")
      .upsert(rows, { onConflict: "game_id" });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  const { data: saved } = await supabase
    .from("games")
    .select("*")
    .eq("sport", "NFL")
    .eq("game_date", date);

  return NextResponse.json({ source: "espn", games: saved ?? [] });
}

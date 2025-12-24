import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();

  if (q.length < 2) {
    return NextResponse.json({ games: [] });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY! // server-only
  );

  // Search across ALL games we already have stored
  const { data, error } = await supabase
    .from("games")
    .select(
      "game_id, date, home_team, away_team, home_score, away_score, is_final, period, clock"
    )
    .or(`home_team.ilike.%${q}%,away_team.ilike.%${q}%`)
    .order("date", { ascending: false })
    .limit(25);

  if (error) {
    return NextResponse.json({ error: error.message, games: [] }, { status: 500 });
  }

  return NextResponse.json({ games: data ?? [] });
}

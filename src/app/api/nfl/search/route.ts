import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const qRaw = (searchParams.get("q") ?? "").trim();
    const q = qRaw.toUpperCase();

    // default window: last 365 days -> next 365 days (so you can search past/future)
    const from = (searchParams.get("from") ?? ymd(new Date(Date.now() - 365 * 24 * 60 * 60 * 1000))).slice(0, 10);
    const to   = (searchParams.get("to")   ?? ymd(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000))).slice(0, 10);

    if (!q) return NextResponse.json({ games: [] });

    const { data, error } = await supabase
      .from("games")
      .select("game_id, game_date, home_team, away_team, home_score, away_score, is_final, period, clock")
      .gte("game_date", from)
      .lte("game_date", to)
      .or(`home_team.ilike.%${q}%,away_team.ilike.%${q}%`)
      .order("game_date", { ascending: false })
      .limit(25);

    if (error) {
      return NextResponse.json({ games: [], error: error.message }, { status: 500 });
    }

    return NextResponse.json({ games: data ?? [] });
  } catch (e: any) {
    return NextResponse.json({ games: [], error: e?.message ?? "unknown" }, { status: 500 });
  }
}

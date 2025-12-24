import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const gameId = (searchParams.get("game_id") ?? "").trim();
    if (!gameId) return NextResponse.json({ players: [] });

    // 1) Look up the game to get the two teams
    const { data: game, error: gameErr } = await supabase
      .from("games")
      .select("home_team, away_team")
      .eq("game_id", gameId)
      .maybeSingle();

    if (gameErr) {
      return NextResponse.json(
        { players: [], error: gameErr.message },
        { status: 500 }
      );
    }
    if (!game) return NextResponse.json({ players: [] });

    const teams = [game.home_team, game.away_team].filter(Boolean);

    // 2) Fetch players for those teams
    const { data: rows, error: playersErr } = await supabase
      .from("players")
      .select("player_name, team, active")
      .eq("sport", "NFL")
      .in("team", teams)
      .eq("active", true)
      .order("player_name", { ascending: true })
      .limit(500);

    if (playersErr) {
      return NextResponse.json(
        { players: [], error: playersErr.message },
        { status: 500 }
      );
    }

    // Return names only (simple dropdown)
    const players = Array.from(
      new Set((rows ?? []).map((r: any) => String(r.player_name).trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));

    return NextResponse.json({ players });
  } catch (e: any) {
    return NextResponse.json(
      { players: [], error: e?.message ?? "unknown" },
      { status: 500 }
    );
  }
}

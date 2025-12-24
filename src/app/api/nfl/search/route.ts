// src/app/api/nfl/search/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs"; // important: supabase-js uses node APIs

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // server-only env var (set in Vercel + local)
);

function normalizeQ(q: string) {
  return q.trim().toLowerCase();
}

// Optional: common NFL abbreviations -> team names.
// Helps when user types "DAL", "SF", etc and your DB stores full names.
const TEAM_ALIASES: Record<string, string[]> = {
  dal: ["dal", "dallas", "cowboys"],
  sf: ["sf", "san francisco", "49ers", "niners"],
  kc: ["kc", "kansas city", "chiefs"],
  phi: ["phi", "philadelphia", "eagles"],
  nyg: ["nyg", "giants", "new york giants"],
  nyj: ["nyj", "jets", "new york jets"],
  la: ["la", "los angeles"],
  lar: ["lar", "rams", "los angeles rams"],
  lac: ["lac", "chargers", "los angeles chargers"],
  // add more if you want, but not required
};

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const qRaw = searchParams.get("q") ?? "";
    const q = normalizeQ(qRaw);

    if (q.length < 2) {
      return NextResponse.json({ games: [] });
    }

    // Expand abbreviations/aliases
    const aliasTerms = TEAM_ALIASES[q] ?? [];
    const terms = Array.from(new Set([q, ...aliasTerms])).slice(0, 6); // cap terms

    // Build an OR filter like:
    // away_team.ilike.%dal%,home_team.ilike.%dal%,away_team.ilike.%cowboys%,...
    const orParts: string[] = [];
    for (const t of terms) {
      const like = `%${t}%`;
      orParts.push(`home_team.ilike.${like}`);
      orParts.push(`away_team.ilike.${like}`);

      // If you have abbr columns in your table, uncomment:
      // orParts.push(`home_abbr.ilike.${like}`);
      // orParts.push(`away_abbr.ilike.${like}`);
    }

    const orFilter = orParts.join(",");

    const { data, error } = await supabaseAdmin
      .from("games")
      .select(
        "game_id,date,home_team,away_team,home_score,away_score,is_final,period,clock"
      )
      .or(orFilter)
      .order("date", { ascending: true })
      .limit(30);

    if (error) {
      return NextResponse.json({ games: [], error: error.message }, { status: 500 });
    }

    return NextResponse.json({ games: data ?? [] });
  } catch (e: any) {
    return NextResponse.json(
      { games: [], error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}

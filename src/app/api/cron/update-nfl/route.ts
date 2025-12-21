import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type EspnScoreboard = {
  events?: Array<{
    id: string;
    date?: string;
    status?: {
      type?: {
        completed?: boolean;
        description?: string; // e.g. "Final", "2nd Quarter"
        state?: string; // "pre" | "in" | "post"
      };
      period?: number;
      displayClock?: string; // "12:34"
    };
    competitions?: Array<{
      competitors?: Array<{
        homeAway?: "home" | "away";
        team?: { abbreviation?: string; displayName?: string };
        score?: string; // numeric string
      }>;
    }>;
  }>;
};

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * ESPN NFL scoreboard (public). This returns events for the date range requested.
 * We use dates=YYYYMMDD-YYYYMMDD. One day is fine for MVP.
 */
function scoreboardUrlForDate(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyymmdd = `${yyyy}${mm}${dd}`;
  return `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${yyyymmdd}-${yyyymmdd}`;
}

function asInt(score?: string) {
  const n = Number(score ?? "0");
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

export async function POST(req: Request) {
  // Protect endpoint (recommended)
  const auth = req.headers.get("authorization");
if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
  return new Response("Unauthorized", { status: 401 });
  }

  const today = new Date();
  const url = scoreboardUrlForDate(today);

  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) {
    return NextResponse.json(
      { error: `ESPN fetch failed: ${resp.status}` },
      { status: 502 }
    );
  }

  const data = (await resp.json()) as EspnScoreboard;
  const events = data.events ?? [];

  const rows = events
    .map((ev) => {
      const comp = ev.competitions?.[0];
      const competitors = comp?.competitors ?? [];

      const home = competitors.find((c) => c.homeAway === "home");
      const away = competitors.find((c) => c.homeAway === "away");

      const homeTeam = home?.team?.abbreviation ?? home?.team?.displayName ?? "HOME";
      const awayTeam = away?.team?.abbreviation ?? away?.team?.displayName ?? "AWAY";

      const isFinal = Boolean(ev.status?.type?.completed) || ev.status?.type?.state === "post";

      return {
        game_id: ev.id,
        sport: "NFL",
        home_team: homeTeam,
        away_team: awayTeam,
        home_score: asInt(home?.score),
        away_score: asInt(away?.score),
        period: ev.status?.period ?? null,
        clock: ev.status?.displayClock ?? null,
        is_final: isFinal,
        updated_at: new Date().toISOString(),
      };
    })
    // basic guard in case ESPN returns odd items
    .filter((r) => r.game_id && r.home_team && r.away_team);

  const supabase = supabaseAdmin();

  // Upsert games into your existing `games` table
  const { error } = await supabase.from("games").upsert(rows, {
    onConflict: "game_id",
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    source: "ESPN NFL scoreboard",
    updated: rows.length,
  });
}

export async function GET(req: Request) {
  return POST(req);
}


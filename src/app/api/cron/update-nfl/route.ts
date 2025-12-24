import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type EspnScoreboard = {
  events?: Array<{
    id: string;
    date?: string; // ISO datetime
    status?: {
      type?: {
        completed?: boolean;
        state?: string; // "pre" | "in" | "post"
      };
      period?: number;
      displayClock?: string;
    };
    competitions?: Array<{
      competitors?: Array<{
        homeAway?: "home" | "away";
        team?: { abbreviation?: string; displayName?: string };
        score?: string;
      }>;
    }>;
  }>;
};

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

function yyyymmdd(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function toGameDateISO(evDate?: string, fallback: Date = new Date()) {
  // store as YYYY-MM-DD (matches your search endpoint)
  const d = evDate ? new Date(evDate) : fallback;
  if (Number.isNaN(d.getTime())) return fallback.toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function scoreboardUrlForDate(d: Date) {
  const day = yyyymmdd(d);
  return `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${day}-${day}`;
}

function asInt(score?: string) {
  const n = Number(score ?? "0");
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export async function POST(req: Request) {
  // Protect endpoint
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(req.url);

  // defaults: past 7 days + next 120 days
  const pastDays = Number(searchParams.get("pastDays") ?? "7");
  const futureDays = Number(searchParams.get("futureDays") ?? "120");

  const today = new Date();
  const start = addDays(today, -Math.max(0, pastDays));
  const end = addDays(today, Math.max(0, futureDays));

  const supabase = supabaseAdmin();

  let totalUpserted = 0;

  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    const url = scoreboardUrlForDate(d);

    const resp = await fetch(url, { cache: "no-store" });
    if (!resp.ok) {
      // Don’t hard-fail the entire window because one day failed
      continue;
    }

    const data = (await resp.json()) as EspnScoreboard;
    const events = data.events ?? [];

    const rows = events
      .map((ev) => {
        const comp = ev.competitions?.[0];
        const competitors = comp?.competitors ?? [];

        const home = competitors.find((c) => c.homeAway === "home");
        const away = competitors.find((c) => c.homeAway === "away");

        const homeTeam =
          home?.team?.abbreviation ?? home?.team?.displayName ?? "HOME";
        const awayTeam =
          away?.team?.abbreviation ?? away?.team?.displayName ?? "AWAY";

        const isFinal =
          Boolean(ev.status?.type?.completed) ||
          ev.status?.type?.state === "post";

        return {
          game_id: ev.id,
          sport: "NFL",
          game_date: toGameDateISO(ev.date, d), // <-- IMPORTANT
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
      .filter((r) => r.game_id && r.home_team && r.away_team);

    if (rows.length === 0) continue;

    const { error } = await supabase.from("games").upsert(rows, {
      onConflict: "game_id",
    });

    if (error) {
      // keep going; you can inspect logs if needed
      continue;
    }

    totalUpserted += rows.length;
  }

  return NextResponse.json({
    ok: true,
    window: {
      pastDays,
      futureDays,
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    },
    updated: totalUpserted,
  });
}

export async function GET(req: Request) {
  return POST(req);
}

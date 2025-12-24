"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const USER_ID = "demo-user";

type BetType = "moneyline" | "spread" | "total";

type Bet = {
  id: string;
  game_id: string;
  bet_type: BetType;
  selection: string;
  line: number | null;
};

type GameRow = {
  game_id: string;
  game_date: string;
  home_team: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
  is_final: boolean | null;
  period: number | null;
  clock: string | null;
};

function statusText(g: GameRow) {
  if (g.is_final) return "Final";
  if (g.period != null || g.clock) return `Q${g.period ?? ""} ${g.clock ?? ""}`.trim();
  return "Scheduled";
}

function calcResult(b: Bet, g?: GameRow) {
  if (!g || !g.is_final) return { label: "Pending", tone: "neutral" as const };

  const hs = g.home_score ?? 0;
  const as = g.away_score ?? 0;

  if (b.bet_type === "total") {
    const total = hs + as;
    if (total === b.line) return { label: "Push", tone: "neutral" as const };
    return total > (b.line ?? 0)
      ? { label: "Won", tone: "good" as const }
      : { label: "Lost", tone: "bad" as const };
  }

  if (b.bet_type === "spread") {
    const pickAway = b.selection === g.away_team;
    const diff = pickAway ? as - hs : hs - as;
    const margin = diff + (b.line ?? 0);
    if (margin === 0) return { label: "Push", tone: "neutral" as const };
    return margin > 0 ? { label: "Won", tone: "good" as const } : { label: "Lost", tone: "bad" as const };
  }

  // moneyline
  const won =
    (b.selection === g.home_team && hs > as) ||
    (b.selection === g.away_team && as > hs);

  if (hs === as) return { label: "Push", tone: "neutral" as const };
  return won ? { label: "Won", tone: "good" as const } : { label: "Lost", tone: "bad" as const };
}

function Pill({ text, tone }: { text: string; tone: "good" | "bad" | "neutral" }) {
  const bg = tone === "good" ? "#e9f7ef" : tone === "bad" ? "#fdecec" : "#f4f4f5";
  return (
    <span
      style={{
        padding: "4px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 800,
        border: "1px solid #ddd",
        background: bg,
      }}
    >
      {text}
    </span>
  );
}

export default function Page() {
  const [bets, setBets] = useState<Bet[]>([]);
  const [gamesById, setGamesById] = useState<Record<string, GameRow>>({});
  const [error, setError] = useState<string | null>(null);

  async function loadAll() {
    setError(null);

    const { data: betData, error: betErr } = await supabase
      .from("bets")
      .select("*")
      .eq("user_id", USER_ID)
      .order("created_at", { ascending: false });

    if (betErr) return setError(betErr.message);

    const rows = (betData ?? []) as Bet[];
    setBets(rows);

    const ids = Array.from(new Set(rows.map((b) => b.game_id)));
    if (!ids.length) return setGamesById({});

    const { data: gameData, error: gameErr } = await supabase
      .from("games")
      .select("game_id, game_date, home_team, away_team, home_score, away_score, is_final, period, clock")
      .in("game_id", ids);

    if (gameErr) return setError(gameErr.message);

    const map: Record<string, GameRow> = {};
    for (const g of gameData ?? []) map[g.game_id] = g;
    setGamesById(map);
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function deleteBet(id: string) {
    if (!confirm("Delete this bet?")) return;

    const { error } = await supabase.from("bets").delete().eq("id", id);
    if (error) return setError(error.message);

    await loadAll();
  }

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: 24, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 28, fontWeight: 800 }}>Bet Tracker</h1>
      {error && <div style={{ color: "crimson" }}>{error}</div>}

      <h2 style={{ marginTop: 24 }}>My Bets</h2>

      {bets.length === 0 ? (
        <div style={{ opacity: 0.7 }}>No bets yet.</div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {bets.map((b) => {
            const g = gamesById[b.game_id];
            const r = calcResult(b, g);

            return (
              <div
                key={b.id}
                style={{
                  border: "1px solid #eee",
                  borderRadius: 12,
                  padding: 12,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <Pill text={r.label} tone={r.tone} />
                    <strong>
                      {b.bet_type} — {b.selection} {b.line !== null && `(${b.line})`}
                    </strong>
                  </div>
                  <div style={{ fontSize: 13, opacity: 0.85, marginTop: 6 }}>
                    {g
                      ? `${g.away_team} @ ${g.home_team} — ${g.game_date} • ${g.away_score ?? 0}-${g.home_score ?? 0} • ${statusText(g)}`
                      : b.game_id}
                  </div>
                </div>

                <button
                  onClick={() => deleteBet(b.id)}
                  style={{
                    border: "1px solid #ddd",
                    background: "white",
                    borderRadius: 8,
                    padding: "6px 10px",
                    cursor: "pointer",
                  }}
                >
                  🗑️
                </button>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}

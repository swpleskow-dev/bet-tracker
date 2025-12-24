"use client";

import React, { useEffect, useState } from "react";
// import { supabaseBrowser as supabase } from "@/lib/supabaseClient";
import type { BetRow, GameRow } from "@/lib/evaluateBet";
import { evaluateBet } from "@/lib/evaluateBet";


const USER_ID = "demo-user";

export default function Page() {
  const [bets, setBets] = useState<BetRow[]>([]);
  const [gamesById, setGamesById] = useState<Record<string, GameRow>>({});
  const [gameId, setGameId] = useState("");
  const [betType, setBetType] = useState<BetRow["bet_type"]>("total");
  const [selection, setSelection] = useState("over");
  const [line, setLine] = useState("44.5");
  const [error, setError] = useState<string | null>(null);

  async function loadAll() {
    // 1) load bets
    const { data: betData, error: betErr } = await supabase
      .from("bets")
      .select("*")
      .eq("user_id", USER_ID)
      .order("created_at", { ascending: false });

    if (betErr) throw betErr;

    const betRows = (betData ?? []) as BetRow[];
    setBets(betRows);

    // 2) load matching games
    const ids = Array.from(new Set(betRows.map((b) => b.game_id).filter(Boolean)));
    if (ids.length === 0) {
      setGamesById({});
      return;
    }

    const { data: gameData, error: gameErr } = await supabase
      .from("games")
      .select("*")
      .in("game_id", ids);

    if (gameErr) throw gameErr;

    const map: Record<string, GameRow> = {};
    for (const g of (gameData ?? []) as GameRow[]) map[g.game_id] = g;
    setGamesById(map);
  }

  useEffect(() => {
    loadAll().catch((e) => setError(e.message));
    // Refresh periodically so UI reflects new cron updates
    const t = setInterval(() => loadAll().catch(() => {}), 30_000);
    return () => clearInterval(t);
  }, []);

  async function addBet(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsedLine = betType === "moneyline" ? null : Number(line);
    if (betType !== "moneyline" && Number.isNaN(parsedLine)) {
      setError("Line must be a number.");
      return;
    }

    const { error } = await supabase.from("bets").insert({
      user_id: USER_ID,
      sport: "NFL",
      game_id: gameId.trim(),
      bet_type: betType,
      selection: selection.trim(),
      line: parsedLine,
    });

    if (error) {
      setError(error.message);
      return;
    }

    setGameId("");
    await loadAll();
  }

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: 24, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 28, fontWeight: 800 }}>Bet Tracker</h1>
      <div style={{ opacity: 0.8, marginTop: 4 }}>
        Live status updates about every 30 seconds.
      </div>

      <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16, marginTop: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Add a bet</h2>

        <form onSubmit={addBet} style={{ display: "grid", gap: 10, marginTop: 12 }}>
          <label>
            <div style={labelStyle}>Game ID (ESPN event id)</div>
            <input
              value={gameId}
              onChange={(e) => setGameId(e.target.value)}
              placeholder="Example: 401671789"
              style={inputStyle}
              required
            />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label>
              <div style={labelStyle}>Bet type</div>
              <select value={betType} onChange={(e) => setBetType(e.target.value as any)} style={inputStyle}>
                <option value="moneyline">moneyline</option>
                <option value="spread">spread</option>
                <option value="total">total</option>
              </select>
            </label>

            <label>
              <div style={labelStyle}>Selection</div>
              <input
                value={selection}
                onChange={(e) => setSelection(e.target.value)}
                placeholder='moneyline/spread: "KC" | total: "over"'
                style={inputStyle}
                required
              />
            </label>
          </div>

          <label>
            <div style={labelStyle}>Line (spread/total only)</div>
            <input
              value={line}
              onChange={(e) => setLine(e.target.value)}
              placeholder="Example: -3.5 or 44.5"
              style={inputStyle}
              disabled={betType === "moneyline"}
            />
          </label>

          <button style={buttonStyle} type="submit">
            Add bet
          </button>

          {error && <div style={{ color: "crimson" }}>{error}</div>}
        </form>
      </div>

      <div style={{ marginTop: 18 }}>
        <h2 style={{ fontSize: 18 }}>My bets</h2>

        {bets.length === 0 ? (
          <div style={{ opacity: 0.7 }}>No bets yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {bets.map((b) => {
              const g = gamesById[b.game_id];
              const evalResult = evaluateBet(b, g);

              return (
                <div key={b.id} style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                    <div style={{ fontWeight: 800 }}>
                      {b.bet_type.toUpperCase()} — {b.selection}{" "}
                      {b.line !== null ? `(${b.line})` : ""}
                    </div>

                    <StatusPill label={evalResult.label} tone={evalResult.tone} />
                  </div>

                  <div style={{ marginTop: 6, opacity: 0.85, fontSize: 13 }}>
                    game_id: {b.game_id}
                    {g ? (
                      <>
                        {" "}
                        • {g.away_team} @ {g.home_team} •{" "}
                        <b>
                          {g.away_score}–{g.home_score}
                        </b>{" "}
                        {g.is_final ? (
                          <>• Final</>
                        ) : (
                          <>
                            • Q{g.period ?? "?"} {g.clock ?? ""}
                          </>
                        )}
                      </>
                    ) : (
                      <> • (no game row yet)</>
                    )}
                  </div>

                  {evalResult.margin !== null && (
                    <div style={{ marginTop: 8, fontSize: 13 }}>
                      Margin: <b>{formatMargin(evalResult.margin)}</b>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: "good" | "bad" | "neutral";
}) {
  const style: React.CSSProperties = {
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 800,
    border: "1px solid #ddd",
    background:
      tone === "good" ? "#e9f7ef" : tone === "bad" ? "#fdecec" : "#f4f4f5",
    color: "#111",
    whiteSpace: "nowrap",
  };

  return <span style={style}>{label}</span>;
}

function formatMargin(n: number) {
  const rounded = Math.round(n * 10) / 10;
  return (rounded > 0 ? "+" : "") + String(rounded);
}

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  opacity: 0.7,
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #ccc",
  fontSize: 14,
};

const buttonStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #111",
  background: "#111",
  color: "white",
  fontWeight: 700,
  cursor: "pointer",
};

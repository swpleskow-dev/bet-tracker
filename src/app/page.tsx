"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseClient";

type BetRow = {
  id: string;
  user_id: string;
  sport: string;
  game_id: string;
  bet_type: string;
  selection: string;
  line: number | null;
  created_at: string;
};

const USER_ID = "demo-user"; // MVP: simple string. Later we’ll use Supabase Auth.

export default function Page() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [bets, setBets] = useState<BetRow[]>([]);
  const [gameId, setGameId] = useState("");
  const [betType, setBetType] = useState("total");
  const [selection, setSelection] = useState("over");
  const [line, setLine] = useState("221.5");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const { data, error } = await supabase
      .from("bets")
      .select("*")
      .eq("user_id", USER_ID)
      .order("created_at", { ascending: false });

    if (error) throw error;
    setBets((data ?? []) as BetRow[]);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
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
      sport: "NBA",
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
    await load();
  }

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: 24, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 28, fontWeight: 800 }}>Bet Tracker (MVP)</h1>
      <p style={{ opacity: 0.8 }}>
        Add bets now. We’ll hook live game tracking next.
      </p>

      <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16, marginTop: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Add a bet</h2>

        <form onSubmit={addBet} style={{ display: "grid", gap: 10, marginTop: 12 }}>
          <label>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Game ID</div>
            <input
              value={gameId}
              onChange={(e) => setGameId(e.target.value)}
              placeholder="e.g. 20251221_LAL_BOS (from provider later)"
              style={inputStyle}
              required
            />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Bet type</div>
              <select value={betType} onChange={(e) => setBetType(e.target.value)} style={inputStyle}>
                <option value="moneyline">moneyline</option>
                <option value="spread">spread</option>
                <option value="total">total</option>
              </select>
            </label>

            <label>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Selection</div>
              <input
                value={selection}
                onChange={(e) => setSelection(e.target.value)}
                placeholder='moneyline/spread: "LAL" | total: "over"'
                style={inputStyle}
                required
              />
            </label>
          </div>

          <label>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Line (spread/total only)</div>
            <input
              value={line}
              onChange={(e) => setLine(e.target.value)}
              placeholder="e.g. -3.5 or 221.5"
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
            {bets.map((b) => (
              <div key={b.id} style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
                <div style={{ fontWeight: 700 }}>
                  {b.bet_type.toUpperCase()} — {b.selection} {b.line !== null ? `(${b.line})` : ""}
                </div>
                <div style={{ opacity: 0.75, fontSize: 13 }}>
                  game_id: {b.game_id} • {new Date(b.created_at).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

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

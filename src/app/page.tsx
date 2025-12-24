"use client";

import React, { useEffect, useState } from "react";
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

const USER_ID = "demo-user";

export default function Page() {
  const supabase = supabaseBrowser();

  const [bets, setBets] = useState<BetRow[]>([]);
  const [gameId, setGameId] = useState("");
  const [betType, setBetType] = useState("total");
  const [selection, setSelection] = useState("over");
  const [line, setLine] = useState("44.5");
  const [error, setError] = useState<string | null>(null);

  async function loadBets() {
    const { data, error } = await supabase
      .from("bets")
      .select("*")
      .eq("user_id", USER_ID)
      .order("created_at", { ascending: false });

    if (error) {
      setError(error.message);
      return;
    }

    setBets((data ?? []) as BetRow[]);
  }

  useEffect(() => {
    loadBets();
  }, []);

  async function addBet(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsedLine = betType === "moneyline" ? null : Number(line);
    if (betType !== "moneyline" && Number.isNaN(parsedLine)) {
      setError("Line must be a number");
      return;
    }

    const { error } = await supabase.from("bets").insert({
      user_id: USER_ID,
      sport: "NFL",
      game_id: gameId,
      bet_type: betType,
      selection,
      line: parsedLine,
    });

    if (error) {
      setError(error.message);
      return;
    }

    setGameId("");
    loadBets();
  }

  return (
    <main style={{ maxWidth: 800, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 28, fontWeight: 800 }}>Bet Tracker</h1>

      <form onSubmit={addBet} style={{ marginTop: 16, display: "grid", gap: 10 }}>
        <input
          placeholder="Game ID"
          value={gameId}
          onChange={(e) => setGameId(e.target.value)}
          required
        />

        <select value={betType} onChange={(e) => setBetType(e.target.value)}>
          <option value="moneyline">moneyline</option>
          <option value="spread">spread</option>
          <option value="total">total</option>
        </select>

        <input
          placeholder="Selection (KC / over / under)"
          value={selection}
          onChange={(e) => setSelection(e.target.value)}
          required
        />

        <input
          placeholder="Line"
          value={line}
          onChange={(e) => setLine(e.target.value)}
          disabled={betType === "moneyline"}
        />

        <button type="submit">Add Bet</button>

        {error && <div style={{ color: "red" }}>{error}</div>}
      </form>

      <h2 style={{ marginTop: 24 }}>My Bets</h2>

      {bets.length === 0 ? (
        <div>No bets yet.</div>
      ) : (
        <ul>
          {bets.map((b) => (
            <li key={b.id}>
              {b.bet_type} – {b.selection} {b.line !== null && `(${b.line})`} —{" "}
              {b.game_id}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

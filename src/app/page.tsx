"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type Bet = {
  id: string;
  game_id: string;
  bet_type: string;
  selection: string;
  line: number | null;
};

export default function Page() {
  const [bets, setBets] = useState<Bet[]>([]);
  const [gameId, setGameId] = useState("");
  const [betType, setBetType] = useState("total");
  const [selection, setSelection] = useState("over");
  const [line, setLine] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function loadBets() {
    const { data, error } = await supabase.from("bets").select("*");
    if (error) {
      setError(error.message);
      return;
    }
    setBets((data ?? []) as Bet[]);
  }

  useEffect(() => {
    loadBets();
  }, []);

  async function addBet(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const { error } = await supabase.from("bets").insert({
      game_id: gameId,
      bet_type: betType,
      selection,
      line: line ? Number(line) : null,
    });

    if (error) {
      console.log("INSERT ERROR:", error);
      setError(error.message);
      return;
    }

    setGameId("");
    setLine("");
    await loadBets();
  }

  return (
    <main style={{ padding: 24 }}>
      <h1>Bet Tracker</h1>

      <form onSubmit={addBet} style={{ marginBottom: 20 }}>
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
          placeholder="Selection"
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
      </form>

      {error && <div style={{ color: "red" }}>{error}</div>}

      <ul>
        {bets.map((b) => (
          <li key={b.id}>
            {b.bet_type} – {b.selection} {b.line !== null && `(${b.line})`} —{" "}
            {b.game_id}
          </li>
        ))}
      </ul>
    </main>
  );
}

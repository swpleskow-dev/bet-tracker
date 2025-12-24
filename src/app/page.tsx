"use client";

import { useEffect, useRef, useState } from "react";
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

type GameSearchRow = {
  game_id: string;
  game_date: string; // YYYY-MM-DD
  home_team: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
  is_final: boolean | null;
  period: number | null;
  clock: string | null;
};

export default function Page() {
  // Bets
  const [bets, setBets] = useState<Bet[]>([]);

  // Bet form
  const [gameId, setGameId] = useState("");
  const [betType, setBetType] = useState("total");
  const [selection, setSelection] = useState("");
  const [line, setLine] = useState("");

  // Game search
  const [gameSearch, setGameSearch] = useState("");
  const [searchResults, setSearchResults] = useState<GameSearchRow[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const searchBoxRef = useRef<HTMLDivElement | null>(null);

  async function loadBets() {
    const { data, error } = await supabase
      .from("bets")
      .select("*")
      .order("id", { ascending: false });

    if (error) {
      setError(error.message);
      return;
    }

    setBets((data ?? []) as Bet[]);
  }

  useEffect(() => {
    loadBets();
  }, []);

  // close dropdown on outside click
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!searchBoxRef.current) return;
      if (!searchBoxRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // debounced search
  useEffect(() => {
    const q = gameSearch.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);

    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/nfl/search?q=${encodeURIComponent(q)}`);
        const j = await r.json();
        setSearchResults((j.games ?? []) as GameSearchRow[]);
        setSearchOpen(true);
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 250);

    return () => clearTimeout(t);
  }, [gameSearch]);

  async function addBet(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!gameId) {
      setError("Please select a game");
      return;
    }

    const parsedLine = line.trim() === "" ? null : Number(line);
    if (line && Number.isNaN(parsedLine)) {
      setError("Line must be a number");
      return;
    }

    const { error } = await supabase.from("bets").insert({
      game_id: gameId,
      bet_type: betType,
      selection,
      line: parsedLine,
    });

    if (error) {
      setError(error.message);
      return;
    }

    // reset
    setGameId("");
    setGameSearch("");
    setLine("");
    setSelection("over");
    setBetType("total");
    setSearchResults([]);
    setSearchOpen(false);

    await loadBets();
  }

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: 24, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 28, fontWeight: 800 }}>Bet Tracker</h1>

      {error && <div style={{ color: "crimson", marginBottom: 10 }}>{error}</div>}

      {/* Add bet */}
      <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16 }}>
        <h2>Add a bet</h2>

        <form onSubmit={addBet} style={{ display: "grid", gap: 12 }}>
          {/* Game picker */}
          <div ref={searchBoxRef} style={{ position: "relative" }}>
            <label style={labelStyle}>Game (search by team)</label>
            <input
              value={gameSearch}
              onChange={(e) => {
                setGameSearch(e.target.value);
                setSearchOpen(true);
              }}
              placeholder="DAL, Cowboys, Eagles…"
              style={inputStyle}
            />

            {searchOpen && (
              <div style={dropdownStyle}>
                {searchLoading ? (
                  <div style={rowStyle}>Searching…</div>
                ) : searchResults.length === 0 ? (
                  <div style={rowStyle}>No matches</div>
                ) : (
                  searchResults.map((g) => (
                    <div
                      key={g.game_id}
                      style={rowStyle}
                      onClick={() => {
                        setGameId(g.game_id);
                        setGameSearch(
                          `${g.away_team} @ ${g.home_team} — ${g.game_date}`
                        );
                        setSearchOpen(false);
                      }}
                    >
                      <div style={{ fontWeight: 700 }}>
                        {g.away_team} @ {g.home_team}
                      </div>
                      <div style={{ fontSize: 12, opacity: 0.75 }}>
                        {g.game_date} • {g.away_score ?? 0}-{g.home_score ?? 0}{" "}
                        {g.is_final ? "Final" : g.period ? `Q${g.period} ${g.clock ?? ""}` : ""}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Bet fields */}
          <select value={betType} onChange={(e) => setBetType(e.target.value)} style={inputStyle}>
            <option value="moneyline">moneyline</option>
            <option value="spread">spread</option>
            <option value="total">total</option>
          </select>

          <input
            placeholder="Selection (over / under / team)"
            value={selection}
            onChange={(e) => setSelection(e.target.value)}
            style={inputStyle}
          />

          <input
            placeholder="Line"
            value={line}
            onChange={(e) => setLine(e.target.value)}
            style={inputStyle}
          />

          <button type="submit" style={buttonStyle}>Add Bet</button>
        </form>
      </div>

      {/* Bets */}
      <div style={{ marginTop: 24 }}>
        <h2>My Bets</h2>
        <ul>
          {bets.map((b) => (
            <li key={b.id}>
              {b.bet_type} – {b.selection} {b.line !== null && `(${b.line})`} — game {b.game_id}
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}

/* styles */
const labelStyle: React.CSSProperties = {
  fontSize: 12,
  opacity: 0.7,
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #ccc",
};

const buttonStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #111",
  background: "#111",
  color: "white",
  fontWeight: 700,
};

const dropdownStyle: React.CSSProperties = {
  position: "absolute",
  top: "100%",
  left: 0,
  right: 0,
  background: "white",
  border: "1px solid #ccc",
  borderRadius: 10,
  zIndex: 10,
  maxHeight: 260,
  overflowY: "auto",
};

const rowStyle: React.CSSProperties = {
  padding: 10,
  cursor: "pointer",
  borderBottom: "1px solid #eee",
};

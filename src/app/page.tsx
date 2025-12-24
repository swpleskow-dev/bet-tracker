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

type BetType = "moneyline" | "spread" | "total";

export default function Page() {
  const [bets, setBets] = useState<Bet[]>([]);

  // bet form
  const [gameId, setGameId] = useState("");
  const [selectedGame, setSelectedGame] = useState<GameSearchRow | null>(null);

  const [betType, setBetType] = useState<BetType>("total");
  const [selection, setSelection] = useState<string>("over");
  const [line, setLine] = useState<string>("");

  // game search
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
      if (!searchBoxRef.current.contains(e.target as Node)) setSearchOpen(false);
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
        const r = await fetch(`/api/nfl/search?q=${encodeURIComponent(q)}`, {
          cache: "no-store",
        });
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

  // Make Selection intuitive when bet type changes (and when a game is selected)
  useEffect(() => {
    if (betType === "total") {
      setSelection((prev) => (prev === "under" ? "under" : "over"));
      return;
    }

    // spread/moneyline: default to away team, or keep if already home/away
    if (!selectedGame) {
      setSelection("");
      return;
    }

    const away = selectedGame.away_team;
    const home = selectedGame.home_team;

    setSelection((prev) => {
      if (prev === away || prev === home) return prev;
      return away;
    });
  }, [betType, selectedGame]);

  async function addBet(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!gameId) {
      setError("Please select a game.");
      return;
    }

    if (betType !== "moneyline") {
      const parsed = Number(line);
      if (!line.trim() || Number.isNaN(parsed)) {
        setError("Line must be a number for spread/total.");
        return;
      }
    }

    if (!selection.trim()) {
      setError("Please choose a selection.");
      return;
    }

    const { error } = await supabase.from("bets").insert({
      game_id: gameId,
      bet_type: betType,
      selection,
      line: betType === "moneyline" ? null : Number(line),
    });

    if (error) {
      setError(error.message);
      return;
    }

    // reset
    setLine("");
    setBetType("total");
    setSelection("over");

    await loadBets();
  }

  const selectionUI =
    betType === "total" ? (
      <select value={selection} onChange={(e) => setSelection(e.target.value)} style={inputStyle}>
        <option value="over">over</option>
        <option value="under">under</option>
      </select>
    ) : (
      <select
        value={selection}
        onChange={(e) => setSelection(e.target.value)}
        style={inputStyle}
        disabled={!selectedGame}
      >
        <option value="">{selectedGame ? "Select team…" : "Pick a game first…"}</option>
        {selectedGame && (
          <>
            <option value={selectedGame.away_team}>{selectedGame.away_team} (away)</option>
            <option value={selectedGame.home_team}>{selectedGame.home_team} (home)</option>
          </>
        )}
      </select>
    );

  const lineLabel = betType === "spread" ? "Spread (required)" : betType === "total" ? "Total (required)" : "Line";

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: 24, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 28, fontWeight: 800 }}>Bet Tracker</h1>

      {error && <div style={{ color: "crimson", marginBottom: 10 }}>{error}</div>}

      <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16 }}>
        <h2 style={{ marginTop: 0 }}>Add a bet</h2>

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

            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
              Selected:{" "}
              <b>
                {selectedGame
                  ? `${selectedGame.away_team} @ ${selectedGame.home_team} — ${selectedGame.game_date}`
                  : "—"}
              </b>
              <span style={{ opacity: 0.7 }}> • game_id: {gameId || "—"}</span>
            </div>

            {searchOpen && (
              <div style={dropdownStyle}>
                {searchLoading ? (
                  <div style={rowStyle}>Searching…</div>
                ) : gameSearch.trim().length < 2 ? (
                  <div style={rowStyle}>Type at least 2 characters…</div>
                ) : searchResults.length === 0 ? (
                  <div style={rowStyle}>No matches</div>
                ) : (
                  searchResults.map((g) => (
                    <div
                      key={g.game_id}
                      style={rowStyle}
                      onClick={() => {
                        setSelectedGame(g);
                        setGameId(g.game_id);
                        setGameSearch(`${g.away_team} @ ${g.home_team} — ${g.game_date}`);
                        setSearchOpen(false);
                      }}
                    >
                      <div style={{ fontWeight: 700 }}>
                        {g.away_team} @ {g.home_team}
                      </div>
                      <div style={{ fontSize: 12, opacity: 0.75 }}>
                        {g.game_date} • {(g.away_score ?? 0)}-{(g.home_score ?? 0)}{" "}
                        {g.is_final ? "Final" : g.period ? `Q${g.period} ${g.clock ?? ""}` : ""}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Bet type + Selection */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={labelStyle}>Bet type</label>
              <select
                value={betType}
                onChange={(e) => setBetType(e.target.value as BetType)}
                style={inputStyle}
              >
                <option value="moneyline">moneyline</option>
                <option value="spread">spread</option>
                <option value="total">total</option>
              </select>
            </div>

            <div>
              <label style={labelStyle}>Selection</label>
              {selectionUI}
            </div>
          </div>

          {/* Line */}
          <div>
            <label style={labelStyle}>{lineLabel}</label>
            <input
              placeholder={betType === "spread" ? "e.g. -3.5" : betType === "total" ? "e.g. 44.5" : "—"}
              value={line}
              onChange={(e) => setLine(e.target.value)}
              style={inputStyle}
              disabled={betType === "moneyline"}
            />
          </div>

          <button type="submit" style={buttonStyle}>
            Add Bet
          </button>
        </form>
      </div>

      <div style={{ marginTop: 24 }}>
        <h2 style={{ marginBottom: 8 }}>My Bets</h2>
        {bets.length === 0 ? (
          <div style={{ opacity: 0.7 }}>No bets yet.</div>
        ) : (
          <ul>
            {bets.map((b) => (
              <li key={b.id}>
                {b.bet_type} – {b.selection} {b.line !== null && `(${b.line})`} — {b.game_id}
              </li>
            ))}
          </ul>
        )}
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
  width: "100%",
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
  cursor: "pointer",
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
  maxHeight: 280,
  overflowY: "auto",
  marginTop: 8,
};

const rowStyle: React.CSSProperties = {
  padding: 10,
  cursor: "pointer",
  borderBottom: "1px solid #eee",
};

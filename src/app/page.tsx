"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type Bet = {
  id: string;
  created_at?: string;
  user_id?: string | null;
  game_id: string;
  bet_type: string;
  selection: string;
  line: number | null;
};

type GameSearchRow = {
  game_id: string;
  date: string; // date or ISO string
  home_team: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
  is_final: boolean | null;
  period: number | null;
  clock: string | null;
};

export default function Page() {
  const [bets, setBets] = useState<Bet[]>([]);

  // bet form
  const [gameId, setGameId] = useState("");
  const [betType, setBetType] = useState("total");
  const [selection, setSelection] = useState("over");
  const [line, setLine] = useState("");

  // game search (hits /api/nfl/search)
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
      .order("created_at", { ascending: false });

    if (error) {
      setError(error.message);
      return;
    }
    setBets((data ?? []) as Bet[]);
  }

  useEffect(() => {
    loadBets();
  }, []);

  // close dropdown when clicking outside
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!searchBoxRef.current) return;
      if (!searchBoxRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // debounced search via API
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
        if (!r.ok) {
          console.log("Search error:", j);
          setSearchResults([]);
          return;
        }

        setSearchResults((j.games ?? []) as GameSearchRow[]);
        setSearchOpen(true);
      } catch (e: any) {
        console.log("Search failed:", e?.message ?? e);
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

    if (!gameId.trim()) {
      setError("Pick a game first (click a search result).");
      return;
    }

    const parsedLine = line.trim() === "" ? null : Number(line);
    if (line.trim() !== "" && Number.isNaN(parsedLine)) {
      setError("Line must be a number (or leave blank).");
      return;
    }

    const { error } = await supabase.from("bets").insert({
      game_id: gameId.trim(),
      bet_type: betType,
      selection: selection.trim(),
      line: parsedLine,
    });

    if (error) {
      setError(error.message);
      return;
    }

    // reset form
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
    <main style={{ maxWidth: 980, margin: "0 auto", padding: 24, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>Bet Tracker</h1>

      <div style={{ marginTop: 16, border: "1px solid #e5e5e5", borderRadius: 12, padding: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Add a bet</h2>

        <form onSubmit={addBet} style={{ display: "grid", gap: 12, marginTop: 12 }}>
          {/* Game search */}
          <div ref={searchBoxRef} style={{ position: "relative" }}>
            <div style={labelStyle}>Game (search by team)</div>
            <input
              value={gameSearch}
              onChange={(e) => {
                setGameSearch(e.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              placeholder="Type a team: DAL, Cowboys, Eagles..."
              style={inputStyle}
            />

            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
              Selected game_id: <b>{gameId || "—"}</b>
            </div>

            {searchOpen && (
              <div
                style={{
                  position: "absolute",
                  top: 76,
                  left: 0,
                  right: 0,
                  zIndex: 20,
                  border: "1px solid #e5e5e5",
                  borderRadius: 12,
                  background: "white",
                  boxShadow: "0 8px 30px rgba(0,0,0,0.08)",
                  overflow: "hidden",
                  maxHeight: 300,
                  overflowY: "auto",
                }}
              >
                {searchLoading ? (
                  <div style={{ padding: 12, opacity: 0.7 }}>Searching…</div>
                ) : gameSearch.trim().length < 2 ? (
                  <div style={{ padding: 12, opacity: 0.7 }}>Type at least 2 characters…</div>
                ) : searchResults.length === 0 ? (
                  <div style={{ padding: 12, opacity: 0.7 }}>No matches.</div>
                ) : (
                  searchResults.map((g) => (
                    <div
                      key={g.game_id}
                      onClick={() => {
                        setGameId(g.game_id);
                        setGameSearch(`${g.away_team} @ ${g.home_team} (${g.date})`);
                        setSearchOpen(false);
                      }}
                      style={{
                        padding: 12,
                        cursor: "pointer",
                        borderBottom: "1px solid #f3f3f3",
                      }}
                    >
                      <div style={{ fontWeight: 700 }}>
                        {g.away_team} @ {g.home_team}
                        <span style={{ fontWeight: 400, opacity: 0.7 }}> • {g.date}</span>
                      </div>
                      <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>
                        {(g.away_score ?? 0)}-{(g.home_score ?? 0)}{" "}
                        {g.is_final ? "• Final" : g.period ? `• Q${g.period} ${g.clock ?? ""}` : ""}
                        <span style={{ opacity: 0.6 }}> • id: {g.game_id}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Bet fields */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label>
              <div style={labelStyle}>Bet type</div>
              <select value={betType} onChange={(e) => setBetType(e.target.value)} style={inputStyle}>
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
                placeholder='over / under or team (ex: KC)'
                style={inputStyle}
                required
              />
            </label>
          </div>

          <label>
            <div style={labelStyle}>Line (optional)</div>
            <input
              value={line}
              onChange={(e) => setLine(e.target.value)}
              placeholder="Example: 44.5 or -3.5"
              style={inputStyle}
            />
          </label>

          <button type="submit" style={buttonStyle}>
            Add Bet
          </button>

          {error && <div style={{ color: "crimson" }}>{error}</div>}
        </form>
      </div>

      <div style={{ marginTop: 18 }}>
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>My bets</h2>

        {bets.length === 0 ? (
          <div style={{ opacity: 0.7 }}>No bets yet.</div>
        ) : (
          <ul style={{ paddingLeft: 18 }}>
            {bets.map((b) => (
              <li key={b.id} style={{ marginBottom: 6 }}>
                {b.bet_type} — {b.selection} {b.line !== null ? `(${b.line})` : ""} — {b.game_id}
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  opacity: 0.7,
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: 12,
  border: "1px solid #d6d6d6",
  fontSize: 14,
  outline: "none",
};

const buttonStyle: React.CSSProperties = {
  padding: "12px 14px",
  borderRadius: 12,
  border: "1px solid #111",
  background: "#111",
  color: "white",
  fontWeight: 700,
  cursor: "pointer",
};

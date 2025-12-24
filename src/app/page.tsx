"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const [gameSearch, setGameSearch] = useState("");
const [selectedGame, setSelectedGame] = useState<Game | null>(null);


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

type Game = {
  game_id: string;
  game_date: string; // YYYY-MM-DD
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
  period: number | null;
  clock: string | null;
  is_final: boolean;
};

type WatchItem = {
  id: string;
  game_id: string;
  note: string | null;
  created_at: string;
};

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function Page() {
  // Bets (simple MVP)
  const [bets, setBets] = useState<Bet[]>([]);
  const [gameId, setGameId] = useState("");
  const [betType, setBetType] = useState("total");
  const [selection, setSelection] = useState("over");
  const [line, setLine] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Games-by-date UI
  const [date, setDate] = useState<string>(todayISO());
  const [games, setGames] = useState<Game[]>([]);
  const [gamesLoading, setGamesLoading] = useState(false);

  // Watchlist
  const [watchlist, setWatchlist] = useState<WatchItem[]>([]);
  const [watchLoading, setWatchLoading] = useState(false);

  async function loadBets() {
    const { data, error } = await supabase.from("bets").select("*").order("id", { ascending: false });
    if (error) {
      setError(error.message);
      return;
    }
    setBets((data ?? []) as Bet[]);
  }

  async function loadGames(selectedDate: string) {
    setGamesLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/nfl/games?date=${selectedDate}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "Failed to load games");
      setGames((j?.games ?? []) as Game[]);
    } catch (e: any) {
      setError(e.message);
      setGames([]);
    } finally {
      setGamesLoading(false);
    }
  }

  async function loadWatchlist() {
    setWatchLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/watchlist`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "Failed to load watchlist");
      setWatchlist((j?.watchlist ?? []) as WatchItem[]);
    } catch (e: any) {
      setError(e.message);
      setWatchlist([]);
    } finally {
      setWatchLoading(false);
    }
  }

  useEffect(() => {
    loadBets();
    loadGames(date);
    loadWatchlist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadGames(date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

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
      setError(error.message);
      return;
    }

    setGameId("");
    setLine("");
    await loadBets();
  }

  const watchedIds = useMemo(() => new Set(watchlist.map((w) => w.game_id)), [watchlist]);

  async function watchGame(game_id: string) {
    setError(null);
    const r = await fetch(`/api/watchlist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ game_id }),
    });
    const j = await r.json();
    if (!r.ok) {
      setError(j?.error ?? "Failed to watch game");
      return;
    }
    await loadWatchlist();
  }

  async function unwatchGame(game_id: string) {
    setError(null);
    const r = await fetch(`/api/watchlist?game_id=${encodeURIComponent(game_id)}`, { method: "DELETE" });
    const j = await r.json();
    if (!r.ok) {
      setError(j?.error ?? "Failed to unwatch game");
      return;
    }
    await loadWatchlist();
  }

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: 24, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>Bet Tracker</h1>

      {error && <div style={{ color: "crimson", marginTop: 10 }}>{error}</div>}

      {/* Add bet */}
      <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16, marginTop: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Add a bet</h2>
        <form onSubmit={addBet} style={{ display: "grid", gap: 10, marginTop: 12 }}>
          <div style={{ position: "relative" }}>
  <input
    placeholder="Search game (team name)"
    value={gameSearch}
    onChange={(e) => setGameSearch(e.target.value)}
  />

  {gameSearch && (
    <div
      style={{
        position: "absolute",
        top: "100%",
        left: 0,
        right: 0,
        background: "white",
        border: "1px solid #ccc",
        zIndex: 10,
        maxHeight: 200,
        overflowY: "auto",
      }}
    >
      {games
        .filter((g) => {
          const q = gameSearch.toLowerCase();
          return (
            g.home_team.toLowerCase().includes(q) ||
            g.away_team.toLowerCase().includes(q)
          );
        })
        .map((g) => (
          <div
            key={g.game_id}
            style={{ padding: 8, cursor: "pointer" }}
            onClick={() => {
              setSelectedGame(g);
              setGameId(g.game_id);
              setGameSearch(`${g.away_team} @ ${g.home_team}`);
            }}
          >
            {g.away_team} @ {g.home_team}{" "}
            {g.is_final
              ? `(Final ${g.away_score}-${g.home_score})`
              : `(${g.away_score}-${g.home_score})`}
          </div>
        ))}
    </div>
  )}
</div>


          <select value={betType} onChange={(e) => setBetType(e.target.value)}>
            <option value="moneyline">moneyline</option>
            <option value="spread">spread</option>
            <option value="total">total</option>
          </select>

          <input
            placeholder='Selection (e.g. "KC" or "over")'
            value={selection}
            onChange={(e) => setSelection(e.target.value)}
            required
          />

          <input
            placeholder="Line (spread/total)"
            value={line}
            onChange={(e) => setLine(e.target.value)}
            disabled={betType === "moneyline"}
          />

          <button type="submit">Add Bet</button>
        </form>
      </div>

      {/* Bets list */}
      <div style={{ marginTop: 18 }}>
        <h2 style={{ fontSize: 18 }}>My Bets</h2>
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

      {/* Games by date */}
      <div style={{ marginTop: 18 }}>
        <h2 style={{ fontSize: 18 }}>NFL Games</h2>

        <label style={{ display: "block", marginBottom: 10 }}>
          Date:{" "}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>

        {gamesLoading ? (
          <div>Loading games…</div>
        ) : games.length === 0 ? (
          <div style={{ opacity: 0.7 }}>No games found for {date}.</div>
        ) : (
          <ul style={{ paddingLeft: 18 }}>
            {games.map((g) => {
              const isWatched = watchedIds.has(g.game_id);
              return (
                <li key={g.game_id} style={{ marginBottom: 8 }}>
                  <b>
                    {g.away_team} @ {g.home_team}
                  </b>{" "}
                  — {g.away_score}-{g.home_score}{" "}
                  {g.is_final ? "(Final)" : `(Q${g.period ?? "?"} ${g.clock ?? ""})`}{" "}
                  <span style={{ opacity: 0.7 }}>— id: {g.game_id}</span>{" "}
                  {isWatched ? (
                    <button onClick={() => unwatchGame(g.game_id)} style={{ marginLeft: 8 }}>
                      Unwatch
                    </button>
                  ) : (
                    <button onClick={() => watchGame(g.game_id)} style={{ marginLeft: 8 }}>
                      Watch
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Watchlist */}
      <div style={{ marginTop: 18 }}>
        <h2 style={{ fontSize: 18 }}>Watchlist</h2>
        {watchLoading ? (
          <div>Loading watchlist…</div>
        ) : watchlist.length === 0 ? (
          <div style={{ opacity: 0.7 }}>No watched games yet.</div>
        ) : (
          <ul>
            {watchlist.map((w) => (
              <li key={w.id}>
                {w.game_id}{" "}
                <button onClick={() => unwatchGame(w.game_id)} style={{ marginLeft: 8 }}>
                  Unwatch
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

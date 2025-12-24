"use client";

import React, { useEffect, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const USER_ID = "demo-user"; // change later when you add auth

const BETTORS = ["sydney", "william"] as const;
type Bettor = (typeof BETTORS)[number];

type BetType = "moneyline" | "spread" | "total";

type Bet = {
  id: string;
  user_id: string | null;
  sport: string;
  game_id: string;
  bet_type: BetType;
  selection: string;
  line: number | null;
  created_at: string;

  stake: number; // amount risked
  odds: number; // American odds (-110, +150, etc.)
  bettor: Bettor; // NEW
};

type GameRow = {
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

function statusText(g: GameRow) {
  if (g.is_final) return "Final";
  if (g.period != null || g.clock) {
    const p = g.period != null ? `Q${g.period}` : "";
    const c = g.clock ?? "";
    return `${p} ${c}`.trim() || "Live";
  }
  return "Scheduled";
}

function calcResult(b: Bet, g?: GameRow) {
  if (!g) return { label: "No game data", tone: "neutral" as const };
  const hs = g.home_score ?? 0;
  const as = g.away_score ?? 0;

  if (!g.is_final) return { label: "Pending", tone: "neutral" as const };

  const away = g.away_team;
  const home = g.home_team;

  if (b.bet_type === "total") {
    const line = Number(b.line ?? NaN);
    if (!Number.isFinite(line)) return { label: "Pending", tone: "neutral" as const };

    const total = hs + as;
    const pick = b.selection.toLowerCase();

    if (total === line) return { label: "Push", tone: "neutral" as const };
    const won = pick === "over" ? total > line : pick === "under" ? total < line : false;
    return won ? { label: "Won", tone: "good" as const } : { label: "Lost", tone: "bad" as const };
  }

  if (b.bet_type === "spread") {
    const line = Number(b.line ?? NaN);
    if (!Number.isFinite(line)) return { label: "Pending", tone: "neutral" as const };

    const pick = b.selection.toUpperCase();
    const pickedAway = pick === away;
    const pickedHome = pick === home;
    if (!pickedAway && !pickedHome) return { label: "Pending", tone: "neutral" as const };

    const diffFromPick = pickedHome ? (hs - as) + line : (as - hs) + line;

    if (diffFromPick === 0) return { label: "Push", tone: "neutral" as const };
    return diffFromPick > 0 ? { label: "Won", tone: "good" as const } : { label: "Lost", tone: "bad" as const };
  }

  // moneyline
  const pick = b.selection.toUpperCase();
  const pickedAway = pick === away;
  const pickedHome = pick === home;
  if (!pickedAway && !pickedHome) return { label: "Pending", tone: "neutral" as const };

  const won = pickedHome ? hs > as : pickedAway ? as > hs : false;

  if (hs === as) return { label: "Push", tone: "neutral" as const };
  return won ? { label: "Won", tone: "good" as const } : { label: "Lost", tone: "bad" as const };
}

function Pill({ text, tone }: { text: string; tone: "good" | "bad" | "neutral" }) {
  const bg = tone === "good" ? "#e9f7ef" : tone === "bad" ? "#fdecec" : "#f4f4f5";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 800,
        border: "1px solid #ddd",
        background: bg,
        marginRight: 8,
      }}
    >
      {text}
    </span>
  );
}

function profitFromAmericanOdds(stake: number, odds: number) {
  if (!Number.isFinite(stake) || stake <= 0) return 0;
  if (!Number.isFinite(odds) || odds === 0) return 0;

  // profit only (not including returned stake)
  if (odds > 0) return stake * (odds / 100);
  return stake * (100 / Math.abs(odds));
}

function betProfit(b: Bet, g?: GameRow) {
  const r = calcResult(b, g);
  const stake = Number(b.stake ?? 0);
  const odds = Number(b.odds ?? 0);

  if (r.label === "Won") return profitFromAmericanOdds(stake, odds);
  if (r.label === "Lost") return -stake;
  return 0; // Pending / Push / No game data
}

type Summary = {
  wins: number;
  losses: number;
  pushes: number;
  pending: number;
  totalWinnings: number; // sum of profits on wins
  totalLosses: number; // sum of stakes on losses
  net: number; // winnings - losses
};

function computeSummary(bets: Bet[], gamesById: Record<string, GameRow>): Summary {
  return bets.reduce(
    (acc, b) => {
      const g = gamesById[b.game_id];
      const r = calcResult(b, g);

      if (r.label === "Won") {
        const p = profitFromAmericanOdds(Number(b.stake ?? 0), Number(b.odds ?? 0));
        acc.wins += 1;
        acc.totalWinnings += p;
        acc.net += p;
      } else if (r.label === "Lost") {
        const s = Number(b.stake ?? 0);
        acc.losses += 1;
        acc.totalLosses += s;
        acc.net -= s;
      } else if (r.label === "Push") {
        acc.pushes += 1;
      } else if (r.label === "Pending") {
        acc.pending += 1;
      }

      return acc;
    },
    { wins: 0, losses: 0, pushes: 0, pending: 0, totalWinnings: 0, totalLosses: 0, net: 0 }
  );
}

export default function Page() {
  const [bets, setBets] = useState<Bet[]>([]);
  const [gamesById, setGamesById] = useState<Record<string, GameRow>>({});

  // bet form
  const [bettor, setBettor] = useState<Bettor>("sydney"); // NEW
  const [gameId, setGameId] = useState("");
  const [selectedGame, setSelectedGame] = useState<GameRow | null>(null);
  const [betType, setBetType] = useState<BetType>("total");
  const [selection, setSelection] = useState<string>("over");
  const [line, setLine] = useState<string>("");

  // stake + odds
  const [stake, setStake] = useState<string>("1");
  const [odds, setOdds] = useState<string>("-110");

  // game search
  const [gameSearch, setGameSearch] = useState("");
  const [searchResults, setSearchResults] = useState<GameRow[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchBoxRef = useRef<HTMLDivElement | null>(null);

  // NEW: viewing filter
  const [viewBettor, setViewBettor] = useState<"all" | Bettor>("all");

  const [error, setError] = useState<string | null>(null);

  async function loadAll() {
    setError(null);

    const { data: betData, error: betErr } = await supabase
      .from("bets")
      .select("*")
      .eq("user_id", USER_ID)
      .order("created_at", { ascending: false });

    if (betErr) {
      setError(betErr.message);
      return;
    }

    // normalize bettor in case older rows exist
    const betRowsRaw = (betData ?? []) as any[];
    const betRows = betRowsRaw.map((b) => ({
      ...b,
      bettor: (String(b.bettor || "sydney").toLowerCase() as Bettor),
    })) as Bet[];

    setBets(betRows);

    const ids = Array.from(new Set(betRows.map((b) => b.game_id).filter(Boolean)));
    if (ids.length === 0) {
      setGamesById({});
      return;
    }

    const { data: gameData, error: gameErr } = await supabase
      .from("games")
      .select("game_id, game_date, home_team, away_team, home_score, away_score, is_final, period, clock")
      .in("game_id", ids);

    if (gameErr) {
      setError(gameErr.message);
      return;
    }

    const map: Record<string, GameRow> = {};
    for (const g of (gameData ?? []) as GameRow[]) map[g.game_id] = g;
    setGamesById(map);
  }

  useEffect(() => {
    loadAll();
    const t = setInterval(loadAll, 30_000);
    return () => clearInterval(t);
  }, []);

  // close search dropdown on outside click
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
        const r = await fetch(`/api/nfl/search?q=${encodeURIComponent(q)}`, { cache: "no-store" });
        const j = await r.json();
        setSearchResults((j.games ?? []) as GameRow[]);
        setSearchOpen(true);
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 250);

    return () => clearTimeout(t);
  }, [gameSearch]);

  // intuitive selection
  useEffect(() => {
    if (betType === "total") {
      setSelection((prev) => (prev === "under" ? "under" : "over"));
      return;
    }
    if (!selectedGame) {
      setSelection("");
      return;
    }
    const away = selectedGame.away_team;
    const home = selectedGame.home_team;
    setSelection((prev) => (prev === away || prev === home ? prev : away));
  }, [betType, selectedGame]);

  async function addBet(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!gameId) return setError("Please select a game.");
    if (!selection.trim()) return setError("Please choose a selection.");

    if (betType !== "moneyline") {
      const parsed = Number(line);
      if (!line.trim() || Number.isNaN(parsed)) return setError("Line must be a number for spread/total.");
    }

    const stakeNum = Number(stake);
    const oddsNum = Number(odds);

    if (!stake.trim() || Number.isNaN(stakeNum) || stakeNum <= 0) return setError("Stake must be a positive number.");
    if (!odds.trim() || Number.isNaN(oddsNum) || oddsNum === 0)
      return setError("Odds must be a non-zero number (e.g. -110, +150).");

    const { error } = await supabase.from("bets").insert({
      user_id: USER_ID,
      sport: "NFL",
      game_id: gameId,
      bet_type: betType,
      selection,
      line: betType === "moneyline" ? null : Number(line),

      stake: stakeNum,
      odds: oddsNum,
      bettor, // NEW
    });

    if (error) return setError(error.message);

    // reset (keep bettor as-is)
    setLine("");
    setBetType("total");
    setSelection("over");
    setStake("1");
    setOdds("-110");

    await loadAll();
  }

  async function deleteBet(betId: string) {
    setError(null);

    const { data, error } = await supabase
      .from("bets")
      .delete()
      .eq("id", betId)
      .eq("user_id", USER_ID)
      .select("id");

    if (error) return setError(`Delete failed: ${error.message}`);
    if (!data || data.length === 0) return setError("Delete did nothing (no row matched, or blocked by RLS).");

    setBets((prev) => prev.filter((b) => b.id !== betId));
    await loadAll();
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

  // ---- Filtered bets ----
  const visibleBets = viewBettor === "all" ? bets : bets.filter((b) => b.bettor === viewBettor);

  // ---- Summaries ----
  const summaryAll = computeSummary(bets, gamesById);
  const summarySydney = computeSummary(bets.filter((b) => b.bettor === "sydney"), gamesById);
  const summaryWilliam = computeSummary(bets.filter((b) => b.bettor === "william"), gamesById);

  function SummaryCard({ title, s }: { title: string; s: Summary }) {
    return (
      <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 14, minWidth: 260 }}>
        <div style={{ fontWeight: 900, marginBottom: 8 }}>{title}</div>
        <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
          <div>
            <b>Record:</b> {s.wins}-{s.losses}-{s.pushes} <span style={{ opacity: 0.7 }}>(Pending: {s.pending})</span>
          </div>
          <div>
            <b>Total Winnings:</b> ${s.totalWinnings.toFixed(2)}
          </div>
          <div>
            <b>Total Losses:</b> ${s.totalLosses.toFixed(2)}
          </div>
          <div>
            <b>Net:</b>{" "}
            <span style={{ fontWeight: 900 }}>
              {s.net >= 0 ? "+" : "-"}${Math.abs(s.net).toFixed(2)}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: 24, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 28, fontWeight: 800 }}>Bet Tracker</h1>
      {error && <div style={{ color: "crimson", marginBottom: 10 }}>{error}</div>}

      {/* Add Bet */}
      <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16 }}>
        <h2 style={{ marginTop: 0 }}>Add a bet</h2>

        <form onSubmit={addBet} style={{ display: "grid", gap: 12 }}>
          {/* NEW: Bettor dropdown */}
          <div>
            <label style={labelStyle}>Who placed the bet?</label>
            <select value={bettor} onChange={(e) => setBettor(e.target.value as Bettor)} style={inputStyle}>
              <option value="sydney">sydney</option>
              <option value="william">william</option>
            </select>
          </div>

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
                        {g.game_date} • {(g.away_score ?? 0)}-{(g.home_score ?? 0)} • {statusText(g)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={labelStyle}>Bet type</label>
              <select value={betType} onChange={(e) => setBetType(e.target.value as BetType)} style={inputStyle}>
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

          <div>
            <label style={labelStyle}>
              {betType === "spread" ? "Spread (required)" : betType === "total" ? "Total (required)" : "Line"}
            </label>
            <input
              placeholder={betType === "spread" ? "e.g. -3.5" : betType === "total" ? "e.g. 44.5" : "—"}
              value={line}
              onChange={(e) => setLine(e.target.value)}
              style={inputStyle}
              disabled={betType === "moneyline"}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={labelStyle}>Stake ($ risk)</label>
              <input
                value={stake}
                onChange={(e) => setStake(e.target.value)}
                style={inputStyle}
                placeholder="e.g. 50"
                inputMode="decimal"
              />
            </div>

            <div>
              <label style={labelStyle}>Odds (American)</label>
              <input
                value={odds}
                onChange={(e) => setOdds(e.target.value)}
                style={inputStyle}
                placeholder="e.g. -110 or +150"
                inputMode="numeric"
              />
            </div>
          </div>

          <button type="submit" style={buttonStyle}>
            Add Bet
          </button>
        </form>
      </div>

      {/* Summaries */}
      <div style={{ marginTop: 16 }}>
        <h2 style={{ marginBottom: 10 }}>Summary</h2>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <SummaryCard title="All" s={summaryAll} />
          <SummaryCard title="Sydney" s={summarySydney} />
          <SummaryCard title="William" s={summaryWilliam} />
        </div>
      </div>

      {/* Filter + Bets */}
      <div style={{ marginTop: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap" }}>
          <h2 style={{ marginBottom: 8 }}>My Bets</h2>

          <div style={{ minWidth: 220 }}>
            <label style={labelStyle}>View bets for</label>
            <select value={viewBettor} onChange={(e) => setViewBettor(e.target.value as any)} style={inputStyle}>
              <option value="all">all</option>
              <option value="sydney">sydney</option>
              <option value="william">william</option>
            </select>
          </div>
        </div>

        {visibleBets.length === 0 ? (
          <div style={{ opacity: 0.7 }}>No bets yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {visibleBets.map((b) => {
              const g = gamesById[b.game_id];
              const r = calcResult(b, g);
              const profit = betProfit(b, g);

              const gameLabel = g
                ? `${g.away_team} @ ${g.home_team} — ${g.game_date} • ${g.away_score ?? 0}-${g.home_score ?? 0} • ${statusText(
                    g
                  )}`
                : b.game_id;

              return (
                <div key={b.id} style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
                  <div
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "center",
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <Pill text={r.label} tone={r.tone} />
                      <div style={{ fontWeight: 800 }}>
                        {b.bettor} • {b.bet_type} — {b.selection} {b.line !== null ? `(${b.line})` : ""}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        const ok = confirm("Delete this bet?");
                        if (ok) deleteBet(b.id);
                      }}
                      style={deleteButtonStyle}
                      aria-label="Delete bet"
                      title="Delete bet"
                    >
                      Delete
                    </button>
                  </div>

                  <div style={{ marginTop: 6, opacity: 0.85, fontSize: 13 }}>{gameLabel}</div>

                  <div style={{ marginTop: 6, fontSize: 13, opacity: 0.9 }}>
                    Stake: ${Number(b.stake ?? 0).toFixed(2)} • Odds: {b.odds ?? 0} • Profit:{" "}
                    <span style={{ fontWeight: 800 }}>
                      {profit >= 0 ? "+" : "-"}${Math.abs(profit).toFixed(2)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
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

const deleteButtonStyle: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 10,
  border: "1px solid #ccc",
  background: "white",
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

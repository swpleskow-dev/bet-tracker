"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const USER_ID = "demo-user"; // change later when you add auth

const BETTORS = ["sydney", "william"] as const;
type Bettor = (typeof BETTORS)[number];

type BetType = "moneyline" | "spread" | "total" | "parlay";

type Bet = {
  id: string;
  user_id: string | null;
  sport: string;
  game_id: string; // for parlays we'll store the parlay uuid here (stringified)
  bet_type: BetType;
  selection: string;
  line: number | null;
  created_at: string;

  stake: number; // amount risked
  odds: number; // American odds (-110, +150, etc.)
  bettor: Bettor;

  parlay_id: string | null; // NEW
};

type ParlayLegType = "moneyline" | "spread" | "total";

type ParlayLeg = {
  id: string;
  user_id: string;
  parlay_id: string;

  sport: string;
  game_id: string;
  leg_type: ParlayLegType;
  selection: string;
  line: number | null;
  odds: number;

  created_at: string;
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

function calcResultLike(betType: "moneyline" | "spread" | "total", selection: string, line: number | null, g?: GameRow) {
  if (!g) return { label: "No game data", tone: "neutral" as const };
  const hs = g.home_score ?? 0;
  const as = g.away_score ?? 0;

  if (!g.is_final) return { label: "Pending", tone: "neutral" as const };

  const away = g.away_team;
  const home = g.home_team;

  if (betType === "total") {
    const ln = Number(line ?? NaN);
    if (!Number.isFinite(ln)) return { label: "Pending", tone: "neutral" as const };

    const total = hs + as;
    const pick = selection.toLowerCase();

    if (total === ln) return { label: "Push", tone: "neutral" as const };
    const won = pick === "over" ? total > ln : pick === "under" ? total < ln : false;
    return won ? { label: "Won", tone: "good" as const } : { label: "Lost", tone: "bad" as const };
  }

  if (betType === "spread") {
    const ln = Number(line ?? NaN);
    if (!Number.isFinite(ln)) return { label: "Pending", tone: "neutral" as const };

    const pick = selection.toUpperCase();
    const pickedAway = pick === away;
    const pickedHome = pick === home;
    if (!pickedAway && !pickedHome) return { label: "Pending", tone: "neutral" as const };

    const diffFromPick = pickedHome ? (hs - as) + ln : (as - hs) + ln;

    if (diffFromPick === 0) return { label: "Push", tone: "neutral" as const };
    return diffFromPick > 0 ? { label: "Won", tone: "good" as const } : { label: "Lost", tone: "bad" as const };
  }

  // moneyline
  const pick = selection.toUpperCase();
  const pickedAway = pick === away;
  const pickedHome = pick === home;
  if (!pickedAway && !pickedHome) return { label: "Pending", tone: "neutral" as const };

  if (hs === as) return { label: "Push", tone: "neutral" as const };
  const won = pickedHome ? hs > as : pickedAway ? as > hs : false;
  return won ? { label: "Won", tone: "good" as const } : { label: "Lost", tone: "bad" as const };
}

function calcResult(b: Bet, g?: GameRow) {
  if (b.bet_type === "parlay") return { label: "Pending", tone: "neutral" as const };
  return calcResultLike(b.bet_type, b.selection, b.line, g);
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

// ---------- Odds / Profit ----------
function americanToDecimal(odds: number) {
  if (!Number.isFinite(odds) || odds === 0) return 1;
  return odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds);
}

function decimalToAmerican(decimal: number) {
  if (!Number.isFinite(decimal) || decimal <= 1) return 0;
  if (decimal >= 2) return Math.round((decimal - 1) * 100);
  return -Math.round(100 / (decimal - 1));
}

function profitFromAmericanOdds(stake: number, odds: number) {
  if (!Number.isFinite(stake) || stake <= 0) return 0;
  if (!Number.isFinite(odds) || odds === 0) return 0;
  return odds > 0 ? stake * (odds / 100) : stake * (100 / Math.abs(odds));
}

function computeParlayAmericanOddsFromLegOdds(legs: { odds: number }[]) {
  let dec = 1;
  for (const leg of legs) dec *= americanToDecimal(Number(leg.odds ?? 0));
  return decimalToAmerican(dec);
}

function parlayGrade(legs: ParlayLeg[], gamesById: Record<string, GameRow>) {
  if (!legs || legs.length === 0) return { label: "Pending", tone: "neutral" as const };

  let anyPending = false;
  let anyLost = false;
  let anyNoData = false;

  for (const leg of legs) {
    const g = gamesById[leg.game_id];
    const r = calcResultLike(leg.leg_type, leg.selection, leg.line, g);
    if (r.label === "No game data") anyNoData = true;
    if (r.label === "Pending") anyPending = true;
    if (r.label === "Lost") anyLost = true;
  }

  if (anyLost) return { label: "Lost", tone: "bad" as const };
  if (anyPending) return { label: "Pending", tone: "neutral" as const };

  // At this point everything is Final (Won/Push/No game data).
  // If missing data, be conservative:
  if (anyNoData) return { label: "Pending", tone: "neutral" as const };

  // If all legs are Won or Push, treat as Won (push just reduces effective payout; we’ll adjust profit below).
  return { label: "Won", tone: "good" as const };
}

function effectiveParlayOddsForProfit(legs: ParlayLeg[], gamesById: Record<string, GameRow>, fallbackOdds: number) {
  // If the parlay isn't fully final, just use the stored header odds.
  const g = parlayGrade(legs, gamesById);
  if (g.label !== "Won") return fallbackOdds;

  // If some legs pushed, treat their odds as 1.0 (remove them) to reduce payout.
  let dec = 1;
  for (const leg of legs) {
    const game = gamesById[leg.game_id];
    const r = calcResultLike(leg.leg_type, leg.selection, leg.line, game);
    if (r.label === "Push") {
      dec *= 1;
    } else {
      dec *= americanToDecimal(Number(leg.odds ?? 0));
    }
  }
  const amer = decimalToAmerican(dec);
  return amer === 0 ? fallbackOdds : amer;
}

type Summary = {
  wins: number;
  losses: number;
  pushes: number;
  pending: number;
  totalWinnings: number;
  totalLosses: number;
  net: number;
};

function formatSignedMoney(x: number) {
  const sign = x >= 0 ? "+" : "-";
  return `${sign}$${Math.abs(x).toFixed(2)}`;
}

export default function Page() {
  const [bets, setBets] = useState<Bet[]>([]);
  const [gamesById, setGamesById] = useState<Record<string, GameRow>>({});
  const [legsByParlayId, setLegsByParlayId] = useState<Record<string, ParlayLeg[]>>({});

  // bet form (singles + parlays)
  const [bettor, setBettor] = useState<Bettor>("sydney");
  const [betType, setBetType] = useState<BetType>("total");

  // single bet inputs
  const [singleGameId, setSingleGameId] = useState("");
  const [singleSelectedGame, setSingleSelectedGame] = useState<GameRow | null>(null);
  const [singleSelection, setSingleSelection] = useState<string>("over");
  const [singleLine, setSingleLine] = useState<string>("");

  // stake + odds (single or parlay header)
  const [stake, setStake] = useState<string>("1");
  const [odds, setOdds] = useState<string>("-110"); // for parlays we auto-fill from legs but keep editable

  // single game search
  const [singleGameSearch, setSingleGameSearch] = useState("");
  const [singleSearchResults, setSingleSearchResults] = useState<GameRow[]>([]);
  const [singleSearchOpen, setSingleSearchOpen] = useState(false);
  const [singleSearchLoading, setSingleSearchLoading] = useState(false);
  const singleSearchBoxRef = useRef<HTMLDivElement | null>(null);

  // parlay builder state
  type DraftLeg = {
    tmpId: string;
    game_id: string;
    game?: GameRow;
    leg_type: ParlayLegType;
    selection: string;
    line: string; // input
    odds: string; // input
  };

  const [parlayLegs, setParlayLegs] = useState<DraftLeg[]>([]);
  const [legType, setLegType] = useState<ParlayLegType>("total");
  const [legSelection, setLegSelection] = useState<string>("over");
  const [legLine, setLegLine] = useState<string>("");
  const [legOdds, setLegOdds] = useState<string>("-110");
  const [legGameId, setLegGameId] = useState("");
  const [legSelectedGame, setLegSelectedGame] = useState<GameRow | null>(null);

  // parlay leg search
  const [legGameSearch, setLegGameSearch] = useState("");
  const [legSearchResults, setLegSearchResults] = useState<GameRow[]>([]);
  const [legSearchOpen, setLegSearchOpen] = useState(false);
  const [legSearchLoading, setLegSearchLoading] = useState(false);
  const legSearchBoxRef = useRef<HTMLDivElement | null>(null);

  // view filter
  const [viewBettor, setViewBettor] = useState<"all" | Bettor>("all");

  const [error, setError] = useState<string | null>(null);

  // ---------- Load ----------
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

    const betRowsRaw = (betData ?? []) as any[];
    const betRows = betRowsRaw.map((b) => ({
      ...b,
      bettor: (String(b.bettor || "sydney").toLowerCase() as Bettor),
      bet_type: (String(b.bet_type) as BetType),
      parlay_id: b.parlay_id ?? null,
    })) as Bet[];

    setBets(betRows);

    // fetch parlay legs
    const parlayIds = Array.from(new Set(betRows.filter((b) => b.bet_type === "parlay").map((b) => b.parlay_id).filter(Boolean))) as string[];

    if (parlayIds.length > 0) {
      const { data: legData, error: legErr } = await supabase
        .from("parlay_legs")
        .select("*")
        .eq("user_id", USER_ID)
        .in("parlay_id", parlayIds);

      if (legErr) {
        setError(legErr.message);
        return;
      }

      const map: Record<string, ParlayLeg[]> = {};
      for (const leg of (legData ?? []) as any[]) {
        const pid = String(leg.parlay_id);
        if (!map[pid]) map[pid] = [];
        map[pid].push({
          ...leg,
          parlay_id: pid,
          leg_type: String(leg.leg_type) as ParlayLegType,
          odds: Number(leg.odds ?? -110),
          line: leg.line === null || leg.line === undefined ? null : Number(leg.line),
        } as ParlayLeg);
      }
      // stable ordering (created_at asc)
      for (const pid of Object.keys(map)) {
        map[pid].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
      }
      setLegsByParlayId(map);
    } else {
      setLegsByParlayId({});
    }

    // collect game ids for game lookup:
    // - singles: bet.game_id
    // - parlay legs: leg.game_id
    const singleGameIds = betRows
      .filter((b) => b.bet_type !== "parlay")
      .map((b) => b.game_id)
      .filter(Boolean);

    const legGameIds =
      parlayIds.length > 0
        ? Object.values(legsByParlayId)
            .flat()
            .map((l) => l.game_id)
            .filter(Boolean)
        : [];

    // NOTE: legsByParlayId is state; it may be stale in this function.
    // Safer: derive leg game ids from fetched legData when present.
    let legGameIdsFromFetch: string[] = [];
    if (parlayIds.length > 0) {
      const { data: legData2 } = await supabase
        .from("parlay_legs")
        .select("game_id, parlay_id")
        .eq("user_id", USER_ID)
        .in("parlay_id", parlayIds);

      legGameIdsFromFetch = Array.from(new Set(((legData2 ?? []) as any[]).map((x) => String(x.game_id)).filter(Boolean)));
    }

    const ids = Array.from(new Set([...singleGameIds, ...legGameIdsFromFetch]));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Outside click to close dropdowns ----------
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const t = e.target as Node;

      if (singleSearchBoxRef.current && !singleSearchBoxRef.current.contains(t)) setSingleSearchOpen(false);
      if (legSearchBoxRef.current && !legSearchBoxRef.current.contains(t)) setLegSearchOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // ---------- Debounced search (single) ----------
  useEffect(() => {
    const q = singleGameSearch.trim();
    if (q.length < 2) {
      setSingleSearchResults([]);
      setSingleSearchLoading(false);
      return;
    }

    setSingleSearchLoading(true);

    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/nfl/search?q=${encodeURIComponent(q)}`, { cache: "no-store" });
        const j = await r.json();
        setSingleSearchResults((j.games ?? []) as GameRow[]);
        setSingleSearchOpen(true);
      } catch {
        setSingleSearchResults([]);
      } finally {
        setSingleSearchLoading(false);
      }
    }, 250);

    return () => clearTimeout(t);
  }, [singleGameSearch]);

  // ---------- Debounced search (parlay leg) ----------
  useEffect(() => {
    const q = legGameSearch.trim();
    if (q.length < 2) {
      setLegSearchResults([]);
      setLegSearchLoading(false);
      return;
    }

    setLegSearchLoading(true);

    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/nfl/search?q=${encodeURIComponent(q)}`, { cache: "no-store" });
        const j = await r.json();
        setLegSearchResults((j.games ?? []) as GameRow[]);
        setLegSearchOpen(true);
      } catch {
        setLegSearchResults([]);
      } finally {
        setLegSearchLoading(false);
      }
    }, 250);

    return () => clearTimeout(t);
  }, [legGameSearch]);

  // ---------- Intuitive selection (single) ----------
  useEffect(() => {
    if (betType === "parlay") return; // handled by leg builder
    if (betType === "total") {
      setSingleSelection((prev) => (prev === "under" ? "under" : "over"));
      return;
    }
    if (!singleSelectedGame) {
      setSingleSelection("");
      return;
    }
    const away = singleSelectedGame.away_team;
    const home = singleSelectedGame.home_team;
    setSingleSelection((prev) => (prev === away || prev === home ? prev : away));
  }, [betType, singleSelectedGame]);

  // ---------- Intuitive selection (leg builder) ----------
  useEffect(() => {
    if (legType === "total") {
      setLegSelection((prev) => (prev === "under" ? "under" : "over"));
      return;
    }
    if (!legSelectedGame) {
      setLegSelection("");
      return;
    }
    const away = legSelectedGame.away_team;
    const home = legSelectedGame.home_team;
    setLegSelection((prev) => (prev === away || prev === home ? prev : away));
  }, [legType, legSelectedGame]);

  // Auto-fill parlay odds from legs (but keep editable)
  useEffect(() => {
    if (betType !== "parlay") return;
    if (parlayLegs.length === 0) return;

    const legOddsNums = parlayLegs
      .map((l) => Number(l.odds))
      .filter((n) => Number.isFinite(n) && n !== 0);

    if (legOddsNums.length !== parlayLegs.length) return; // don't overwrite if incomplete

    const computed = computeParlayAmericanOddsFromLegOdds(legOddsNums.map((o) => ({ odds: o })));
    if (computed !== 0) setOdds(String(computed));
  }, [betType, parlayLegs]);

  // ---------- Add / Submit ----------
  async function addSingleBet(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!singleGameId) return setError("Please select a game.");
    if (!singleSelection.trim()) return setError("Please choose a selection.");

    if (betType !== "moneyline" && betType !== "parlay") {
      const parsed = Number(singleLine);
      if (!singleLine.trim() || Number.isNaN(parsed)) return setError("Line must be a number for spread/total.");
    }

    const stakeNum = Number(stake);
    const oddsNum = Number(odds);

    if (!stake.trim() || Number.isNaN(stakeNum) || stakeNum <= 0) return setError("Stake must be a positive number.");
    if (!odds.trim() || Number.isNaN(oddsNum) || oddsNum === 0)
      return setError("Odds must be a non-zero number (e.g. -110, +150).");

    const { error } = await supabase.from("bets").insert({
      user_id: USER_ID,
      sport: "NFL",
      game_id: singleGameId,
      bet_type: betType,
      selection: singleSelection,
      line: betType === "moneyline" ? null : Number(singleLine),

      stake: stakeNum,
      odds: oddsNum,
      bettor,
      parlay_id: null,
    });

    if (error) return setError(error.message);

    // reset (keep bettor)
    setSingleLine("");
    setBetType("total");
    setSingleSelection("over");
    setStake("1");
    setOdds("-110");
    setSingleGameId("");
    setSingleSelectedGame(null);
    setSingleGameSearch("");

    await loadAll();
  }

  function addLegToParlay() {
    setError(null);

    if (!legGameId) return setError("Pick a game for the leg.");
    if (!legSelection.trim()) return setError("Choose a leg selection.");

    if (legType !== "moneyline") {
      const ln = Number(legLine);
      if (!legLine.trim() || Number.isNaN(ln)) return setError("Leg line must be a number for spread/total.");
    }

    const o = Number(legOdds);
    if (!legOdds.trim() || Number.isNaN(o) || o === 0) return setError("Leg odds must be a non-zero number.");

    const tmpId = (globalThis.crypto?.randomUUID?.() ?? `tmp-${Date.now()}-${Math.random()}`).toString();

    setParlayLegs((prev) => [
      ...prev,
      {
        tmpId,
        game_id: legGameId,
        game: legSelectedGame ?? undefined,
        leg_type: legType,
        selection: legSelection,
        line: legType === "moneyline" ? "" : legLine,
        odds: legOdds,
      },
    ]);

    // reset leg inputs (keep leg type)
    setLegGameId("");
    setLegSelectedGame(null);
    setLegGameSearch("");
    setLegLine("");
    setLegSelection(legType === "total" ? "over" : "");
    setLegOdds("-110");
  }

  async function submitParlay(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (parlayLegs.length < 2) return setError("A parlay needs at least 2 legs.");

    const stakeNum = Number(stake);
    const oddsNum = Number(odds);

    if (!stake.trim() || Number.isNaN(stakeNum) || stakeNum <= 0) return setError("Stake must be a positive number.");
    if (!odds.trim() || Number.isNaN(oddsNum) || oddsNum === 0)
      return setError("Parlay odds must be a non-zero number (auto-filled, but editable).");

    const parlayId = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).toString();

    // Insert header bet row
    const { error: headerErr } = await supabase.from("bets").insert({
      user_id: USER_ID,
      sport: "NFL",
      game_id: parlayId, // store the parlay id here
      bet_type: "parlay",
      selection: "parlay",
      line: null,

      stake: stakeNum,
      odds: oddsNum,
      bettor,
      parlay_id: parlayId,
    });

    if (headerErr) return setError(headerErr.message);

    // Insert legs
    const legsPayload = parlayLegs.map((l) => ({
      user_id: USER_ID,
      parlay_id: parlayId,
      sport: "NFL",
      game_id: l.game_id,
      leg_type: l.leg_type,
      selection: l.selection,
      line: l.leg_type === "moneyline" ? null : Number(l.line),
      odds: Number(l.odds),
    }));

    const { error: legsErr } = await supabase.from("parlay_legs").insert(legsPayload);
    if (legsErr) return setError(legsErr.message);

    // reset
    setParlayLegs([]);
    setStake("1");
    setOdds("-110");
    setBetType("total");
    setBettor(bettor);

    setLegType("total");
    setLegSelection("over");
    setLegLine("");
    setLegOdds("-110");
    setLegGameId("");
    setLegSelectedGame(null);
    setLegGameSearch("");

    await loadAll();
  }

  async function deleteBetRow(b: Bet) {
    setError(null);

    const ok = confirm("Delete this bet?");
    if (!ok) return;

    if (b.bet_type === "parlay" && b.parlay_id) {
      // delete legs first
      const { error: legDelErr } = await supabase
        .from("parlay_legs")
        .delete()
        .eq("parlay_id", b.parlay_id)
        .eq("user_id", USER_ID);

      if (legDelErr) return setError(`Delete legs failed: ${legDelErr.message}`);
    }

    const { data, error } = await supabase
      .from("bets")
      .delete()
      .eq("id", b.id)
      .eq("user_id", USER_ID)
      .select("id");

    if (error) return setError(`Delete failed: ${error.message}`);
    if (!data || data.length === 0) return setError("Delete did nothing (no row matched, or blocked by RLS).");

    setBets((prev) => prev.filter((x) => x.id !== b.id));
    await loadAll();
  }

  // ---------- UI Helpers ----------
  const singleSelectionUI =
    betType === "total" ? (
      <select value={singleSelection} onChange={(e) => setSingleSelection(e.target.value)} style={inputStyle}>
        <option value="over">over</option>
        <option value="under">under</option>
      </select>
    ) : (
      <select
        value={singleSelection}
        onChange={(e) => setSingleSelection(e.target.value)}
        style={inputStyle}
        disabled={!singleSelectedGame}
      >
        <option value="">{singleSelectedGame ? "Select team…" : "Pick a game first…"}</option>
        {singleSelectedGame && (
          <>
            <option value={singleSelectedGame.away_team}>{singleSelectedGame.away_team} (away)</option>
            <option value={singleSelectedGame.home_team}>{singleSelectedGame.home_team} (home)</option>
          </>
        )}
      </select>
    );

  const legSelectionUI =
    legType === "total" ? (
      <select value={legSelection} onChange={(e) => setLegSelection(e.target.value)} style={inputStyle}>
        <option value="over">over</option>
        <option value="under">under</option>
      </select>
    ) : (
      <select value={legSelection} onChange={(e) => setLegSelection(e.target.value)} style={inputStyle} disabled={!legSelectedGame}>
        <option value="">{legSelectedGame ? "Select team…" : "Pick a game first…"}</option>
        {legSelectedGame && (
          <>
            <option value={legSelectedGame.away_team}>{legSelectedGame.away_team} (away)</option>
            <option value={legSelectedGame.home_team}>{legSelectedGame.home_team} (home)</option>
          </>
        )}
      </select>
    );

  // ---------- Visible bets ----------
  const visibleBets = useMemo(() => {
    const base = viewBettor === "all" ? bets : bets.filter((b) => b.bettor === viewBettor);
    return base;
  }, [bets, viewBettor]);

  // ---------- Profit for any bet ----------
  function betProfit(b: Bet) {
    const stakeNum = Number(b.stake ?? 0);
    if (b.bet_type !== "parlay") {
      const g = gamesById[b.game_id];
      const r = calcResult(b, g);
      if (r.label === "Won") return profitFromAmericanOdds(stakeNum, Number(b.odds ?? 0));
      if (r.label === "Lost") return -stakeNum;
      return 0;
    }

    const pid = b.parlay_id ?? "";
    const legs = pid ? legsByParlayId[pid] ?? [] : [];
    const grade = parlayGrade(legs, gamesById);

    if (grade.label === "Won") {
      const effOdds = effectiveParlayOddsForProfit(legs, gamesById, Number(b.odds ?? 0));
      return profitFromAmericanOdds(stakeNum, effOdds);
    }
    if (grade.label === "Lost") return -stakeNum;
    return 0;
  }

  function computeSummary(list: Bet[]): Summary {
    return list.reduce(
      (acc, b) => {
        if (b.bet_type !== "parlay") {
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
          } else {
            acc.pending += 1;
          }

          return acc;
        }

        // parlay
        const pid = b.parlay_id ?? "";
        const legs = pid ? legsByParlayId[pid] ?? [] : [];
        const grade = parlayGrade(legs, gamesById);

        if (grade.label === "Won") {
          const effOdds = effectiveParlayOddsForProfit(legs, gamesById, Number(b.odds ?? 0));
          const p = profitFromAmericanOdds(Number(b.stake ?? 0), effOdds);
          acc.wins += 1;
          acc.totalWinnings += p;
          acc.net += p;
        } else if (grade.label === "Lost") {
          const s = Number(b.stake ?? 0);
          acc.losses += 1;
          acc.totalLosses += s;
          acc.net -= s;
        } else if (grade.label === "Pending") {
          acc.pending += 1;
        } else {
          acc.pending += 1;
        }

        return acc;
      },
      { wins: 0, losses: 0, pushes: 0, pending: 0, totalWinnings: 0, totalLosses: 0, net: 0 }
    );
  }

  const summaryAll = useMemo(() => computeSummary(bets), [bets, gamesById, legsByParlayId]);
  const summarySydney = useMemo(() => computeSummary(bets.filter((b) => b.bettor === "sydney")), [bets, gamesById, legsByParlayId]);
  const summaryWilliam = useMemo(() => computeSummary(bets.filter((b) => b.bettor === "william")), [bets, gamesById, legsByParlayId]);

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
            <b>Net:</b> <span style={{ fontWeight: 900 }}>{formatSignedMoney(s.net)}</span>
          </div>
        </div>
      </div>
    );
  }

  // ---------- Render ----------
  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: 24, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 28, fontWeight: 800 }}>Bet Tracker</h1>
      {error && <div style={{ color: "crimson", marginBottom: 10 }}>{error}</div>}

      {/* Add Bet */}
      <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16 }}>
        <h2 style={{ marginTop: 0 }}>Add a bet</h2>

        <div style={{ display: "grid", gap: 12 }}>
          {/* Bettor + Bet type */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={labelStyle}>Who placed the bet?</label>
              <select value={bettor} onChange={(e) => setBettor(e.target.value as Bettor)} style={inputStyle}>
                <option value="sydney">sydney</option>
                <option value="william">william</option>
              </select>
            </div>

            <div>
              <label style={labelStyle}>Bet type</label>
              <select value={betType} onChange={(e) => setBetType(e.target.value as BetType)} style={inputStyle}>
                <option value="moneyline">moneyline</option>
                <option value="spread">spread</option>
                <option value="total">total</option>
                <option value="parlay">parlay</option>
              </select>
            </div>
          </div>

          {/* Shared stake/odds */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={labelStyle}>Stake ($ risk)</label>
              <input value={stake} onChange={(e) => setStake(e.target.value)} style={inputStyle} placeholder="e.g. 50" inputMode="decimal" />
            </div>

            <div>
              <label style={labelStyle}>{betType === "parlay" ? "Parlay odds (auto-filled, editable)" : "Odds (American)"}</label>
              <input value={odds} onChange={(e) => setOdds(e.target.value)} style={inputStyle} placeholder="e.g. -110 or +600" inputMode="numeric" />
              {betType === "parlay" && (
                <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
                  Tip: Add legs below — odds will auto-calculate (still editable).
                </div>
              )}
            </div>
          </div>

          {/* Single bet form */}
          {betType !== "parlay" ? (
            <form onSubmit={addSingleBet} style={{ display: "grid", gap: 12 }}>
              <div ref={singleSearchBoxRef} style={{ position: "relative" }}>
                <label style={labelStyle}>Game (search by team)</label>
                <input
                  value={singleGameSearch}
                  onChange={(e) => {
                    setSingleGameSearch(e.target.value);
                    setSingleSearchOpen(true);
                  }}
                  placeholder="DAL, Cowboys, Eagles…"
                  style={inputStyle}
                />

                <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
                  Selected:{" "}
                  <b>
                    {singleSelectedGame
                      ? `${singleSelectedGame.away_team} @ ${singleSelectedGame.home_team} — ${singleSelectedGame.game_date}`
                      : "—"}
                  </b>
                </div>

                {singleSearchOpen && (
                  <div style={dropdownStyle}>
                    {singleSearchLoading ? (
                      <div style={rowStyle}>Searching…</div>
                    ) : singleGameSearch.trim().length < 2 ? (
                      <div style={rowStyle}>Type at least 2 characters…</div>
                    ) : singleSearchResults.length === 0 ? (
                      <div style={rowStyle}>No matches</div>
                    ) : (
                      singleSearchResults.map((g) => (
                        <div
                          key={g.game_id}
                          style={rowStyle}
                          onClick={() => {
                            setSingleSelectedGame(g);
                            setSingleGameId(g.game_id);
                            setSingleGameSearch(`${g.away_team} @ ${g.home_team} — ${g.game_date}`);
                            setSingleSearchOpen(false);
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
                  <label style={labelStyle}>Selection</label>
                  {singleSelectionUI}
                </div>

                <div>
                  <label style={labelStyle}>{betType === "spread" ? "Spread (required)" : betType === "total" ? "Total (required)" : "Line"}</label>
                  <input
                    placeholder={betType === "spread" ? "e.g. -3.5" : betType === "total" ? "e.g. 44.5" : "—"}
                    value={singleLine}
                    onChange={(e) => setSingleLine(e.target.value)}
                    style={inputStyle}
                    disabled={betType === "moneyline"}
                  />
                </div>
              </div>

              <button type="submit" style={buttonStyle}>
                Add Bet
              </button>
            </form>
          ) : (
            // Parlay builder form
            <form onSubmit={submitParlay} style={{ display: "grid", gap: 12 }}>
              <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
                <div style={{ fontWeight: 900, marginBottom: 10 }}>Add legs</div>

                <div style={{ display: "grid", gap: 12 }}>
                  <div ref={legSearchBoxRef} style={{ position: "relative" }}>
                    <label style={labelStyle}>Leg game (search by team)</label>
                    <input
                      value={legGameSearch}
                      onChange={(e) => {
                        setLegGameSearch(e.target.value);
                        setLegSearchOpen(true);
                      }}
                      placeholder="KC, Chiefs, Bills…"
                      style={inputStyle}
                    />

                    <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
                      Selected:{" "}
                      <b>
                        {legSelectedGame ? `${legSelectedGame.away_team} @ ${legSelectedGame.home_team} — ${legSelectedGame.game_date}` : "—"}
                      </b>
                    </div>

                    {legSearchOpen && (
                      <div style={dropdownStyle}>
                        {legSearchLoading ? (
                          <div style={rowStyle}>Searching…</div>
                        ) : legGameSearch.trim().length < 2 ? (
                          <div style={rowStyle}>Type at least 2 characters…</div>
                        ) : legSearchResults.length === 0 ? (
                          <div style={rowStyle}>No matches</div>
                        ) : (
                          legSearchResults.map((g) => (
                            <div
                              key={g.game_id}
                              style={rowStyle}
                              onClick={() => {
                                setLegSelectedGame(g);
                                setLegGameId(g.game_id);
                                setLegGameSearch(`${g.away_team} @ ${g.home_team} — ${g.game_date}`);
                                setLegSearchOpen(false);
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
                      <label style={labelStyle}>Leg type</label>
                      <select value={legType} onChange={(e) => setLegType(e.target.value as ParlayLegType)} style={inputStyle}>
                        <option value="moneyline">moneyline</option>
                        <option value="spread">spread</option>
                        <option value="total">total</option>
                      </select>
                    </div>

                    <div>
                      <label style={labelStyle}>Leg selection</label>
                      {legSelectionUI}
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <label style={labelStyle}>{legType === "spread" ? "Spread (required)" : legType === "total" ? "Total (required)" : "Line"}</label>
                      <input
                        value={legLine}
                        onChange={(e) => setLegLine(e.target.value)}
                        style={inputStyle}
                        placeholder={legType === "spread" ? "e.g. -3.5" : legType === "total" ? "e.g. 44.5" : "—"}
                        disabled={legType === "moneyline"}
                      />
                    </div>

                    <div>
                      <label style={labelStyle}>Leg odds (American)</label>
                      <input value={legOdds} onChange={(e) => setLegOdds(e.target.value)} style={inputStyle} placeholder="e.g. -110" inputMode="numeric" />
                    </div>
                  </div>

                  <button type="button" style={secondaryButtonStyle} onClick={addLegToParlay}>
                    Add Leg
                  </button>
                </div>
              </div>

              <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
                <div style={{ fontWeight: 900, marginBottom: 10 }}>Current legs ({parlayLegs.length})</div>

                {parlayLegs.length === 0 ? (
                  <div style={{ opacity: 0.7, fontSize: 13 }}>Add at least 2 legs to submit a parlay.</div>
                ) : (
                  <div style={{ display: "grid", gap: 8 }}>
                    {parlayLegs.map((l) => (
                      <div
                        key={l.tmpId}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 10,
                          alignItems: "center",
                          border: "1px solid #f0f0f0",
                          borderRadius: 10,
                          padding: 10,
                        }}
                      >
                        <div style={{ display: "grid", gap: 2 }}>
                          <div style={{ fontWeight: 800, fontSize: 13 }}>
                            {l.game ? `${l.game.away_team} @ ${l.game.home_team}` : l.game_id}
                          </div>
                          <div style={{ fontSize: 12, opacity: 0.8 }}>
                            {l.leg_type} — {l.selection}
                            {l.leg_type === "moneyline" ? "" : ` (${l.line})`} • odds {l.odds}
                          </div>
                        </div>

                        <button
                          type="button"
                          style={tinyDangerButtonStyle}
                          onClick={() => setParlayLegs((prev) => prev.filter((x) => x.tmpId !== l.tmpId))}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {parlayLegs.length > 0 && (
                  <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8 }}>
                    Auto parlay odds from legs:{" "}
                    <b>
                      {(() => {
                        const nums = parlayLegs.map((l) => Number(l.odds));
                        if (nums.some((n) => !Number.isFinite(n) || n === 0)) return "—";
                        const computed = computeParlayAmericanOddsFromLegOdds(nums.map((o) => ({ odds: o })));
                        if (computed === 0) return "—";
                        return computed > 0 ? `+${computed}` : `${computed}`;
                      })()}
                    </b>
                  </div>
                )}
              </div>

              <button type="submit" style={buttonStyle}>
                Submit Parlay
              </button>
            </form>
          )}
        </div>
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
              if (b.bet_type !== "parlay") {
                const g = gamesById[b.game_id];
                const r = calcResult(b, g);
                const profit = betProfit(b);

                const gameLabel = g
                  ? `${g.away_team} @ ${g.home_team} — ${g.game_date} • ${g.away_score ?? 0}-${g.home_score ?? 0} • ${statusText(g)}`
                  : b.game_id;

                return (
                  <div key={b.id} style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        <Pill text={r.label} tone={r.tone} />
                        <div style={{ fontWeight: 800 }}>
                          {b.bettor} • {b.bet_type} — {b.selection} {b.line !== null ? `(${b.line})` : ""}
                        </div>
                      </div>

                      <button type="button" onClick={() => deleteBetRow(b)} style={deleteButtonStyle} title="Delete bet">
                        Delete
                      </button>
                    </div>

                    <div style={{ marginTop: 6, opacity: 0.85, fontSize: 13 }}>{gameLabel}</div>

                    <div style={{ marginTop: 6, fontSize: 13, opacity: 0.9 }}>
                      Stake: ${Number(b.stake ?? 0).toFixed(2)} • Odds: {b.odds ?? 0} • Profit:{" "}
                      <span style={{ fontWeight: 800 }}>{formatSignedMoney(profit)}</span>
                    </div>
                  </div>
                );
              }

              // parlay render
              const pid = b.parlay_id ?? "";
              const legs = pid ? legsByParlayId[pid] ?? [] : [];
              const grade = parlayGrade(legs, gamesById);
              const profit = betProfit(b);

              return (
                <div key={b.id} style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <Pill text={grade.label} tone={grade.tone} />
                      <div style={{ fontWeight: 800 }}>
                        {b.bettor} • parlay • {legs.length} legs
                      </div>
                    </div>

                    <button type="button" onClick={() => deleteBetRow(b)} style={deleteButtonStyle} title="Delete parlay">
                      Delete
                    </button>
                  </div>

                  <div style={{ marginTop: 6, fontSize: 13, opacity: 0.9 }}>
                    Stake: ${Number(b.stake ?? 0).toFixed(2)} • Odds: {b.odds ?? 0} • Profit:{" "}
                    <span style={{ fontWeight: 800 }}>{formatSignedMoney(profit)}</span>
                  </div>

                  <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                    {legs.length === 0 ? (
                      <div style={{ opacity: 0.7, fontSize: 13 }}>No legs found for this parlay.</div>
                    ) : (
                      legs.map((l) => {
                        const g = gamesById[l.game_id];
                        const r = calcResultLike(l.leg_type, l.selection, l.line, g);

                        const label = g
                          ? `${g.away_team} @ ${g.home_team} — ${g.game_date} • ${g.away_score ?? 0}-${g.home_score ?? 0} • ${statusText(g)}`
                          : l.game_id;

                        return (
                          <div key={l.id} style={{ border: "1px solid #f0f0f0", borderRadius: 10, padding: 10 }}>
                            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                              <Pill text={r.label} tone={r.tone} />
                              <div style={{ fontWeight: 800, fontSize: 13 }}>
                                {l.leg_type} — {l.selection} {l.line !== null ? `(${l.line})` : ""} • odds {l.odds}
                              </div>
                            </div>
                            <div style={{ marginTop: 6, opacity: 0.85, fontSize: 13 }}>{label}</div>
                          </div>
                        );
                      })
                    )}
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

const secondaryButtonStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #ccc",
  background: "white",
  color: "#111",
  fontWeight: 800,
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

const tinyDangerButtonStyle: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 10,
  border: "1px solid #e5e5e5",
  background: "#fff5f5",
  fontWeight: 800,
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

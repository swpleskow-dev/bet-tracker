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

type BetType = "moneyline" | "spread" | "total" | "parlay" | "player_prop";

type Bet = {
  id: string;
  user_id: string | null;
  sport: string;

  // For single bets + props: game_id is the actual game id
  // For parlays: game_id stores the parlay id string
  game_id: string;

  bet_type: BetType;
  selection: string;
  line: number | null;
  created_at: string;

  stake: number;
  odds: number;
  bettor: Bettor;

  // parlays
  parlay_id: string | null;

  // props (stored on bets row)
  prop_player: string | null;
  prop_market: string | null;
  prop_side: string | null; // "over"/"under"
  prop_line: number | null;
  prop_notes: string | null;

  // manual grading override (used for props)
  result_override: string | null; // "Won" | "Lost" | "Push" | "Pending"
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

type Result = {
  label: "Won" | "Lost" | "Push" | "Pending" | "No game data";
  tone: "good" | "bad" | "neutral";
};

function normalizeOverride(v: string | null | undefined): Result | null {
  const x = (v ?? "").toLowerCase().trim();
  if (x === "won") return { label: "Won", tone: "good" };
  if (x === "lost") return { label: "Lost", tone: "bad" };
  if (x === "push") return { label: "Push", tone: "neutral" };
  if (x === "pending") return { label: "Pending", tone: "neutral" };
  return null;
}

function teamKey(s?: string | null) {
  const x = (s ?? "").toUpperCase().trim();
  if (!x) return "";
  // take first token, remove non-letters: "DAL COWBOYS" -> "DAL"
  const first = x.split(/\s+/)[0] ?? "";
  return first.replace(/[^A-Z]/g, "");
}



function calcResultLike(
  betType: "moneyline" | "spread" | "total",
  selection: string,
  line: number | null,
  g?: GameRow
): Result {
  if (!g) return { label: "No game data", tone: "neutral" };

  const hs = g.home_score ?? 0;
  const as = g.away_score ?? 0;

  if (!g.is_final) return { label: "Pending", tone: "neutral" };

  const away = g.away_team;
  const home = g.home_team;

  // Totals (over/under) don't depend on team names
  if (betType === "total") {
    const ln = Number(line ?? NaN);
    if (!Number.isFinite(ln)) return { label: "Pending", tone: "neutral" };

    const total = hs + as;
    const pick = (selection ?? "").toLowerCase().trim();

    if (total === ln) return { label: "Push", tone: "neutral" };

    const won =
      pick === "over" ? total > ln :
      pick === "under" ? total < ln :
      false;

    return won ? { label: "Won", tone: "good" } : { label: "Lost", tone: "bad" };
  }

  // Normalize team comparisons so "DAL COWBOYS" matches "DAL"
  const pickKey = teamKey(selection);
  const awayKey = teamKey(away);
  const homeKey = teamKey(home);

  const pickedAway = pickKey === awayKey;
  const pickedHome = pickKey === homeKey;

  if (!pickedAway && !pickedHome) return { label: "Pending", tone: "neutral" };

  if (betType === "spread") {
    const ln = Number(line ?? NaN);
    if (!Number.isFinite(ln)) return { label: "Pending", tone: "neutral" };

    const diffFromPick = pickedHome ? (hs - as) + ln : (as - hs) + ln;

    if (diffFromPick === 0) return { label: "Push", tone: "neutral" };

    return diffFromPick > 0
      ? { label: "Won", tone: "good" }
      : { label: "Lost", tone: "bad" };
  }

  // moneyline
  if (hs === as) return { label: "Push", tone: "neutral" };

  const won = pickedHome ? hs > as : pickedAway ? as > hs : false;
  return won ? { label: "Won", tone: "good" } : { label: "Lost", tone: "bad" };
}


  // moneyline
  const pick = selection.toUpperCase();
  const pickedAway = pick === away;
  const pickedHome = pick === home;
  if (!pickedAway && !pickedHome) return { label: "Pending", tone: "neutral" };

  if (hs === as) return { label: "Push", tone: "neutral" };
  const won = pickedHome ? hs > as : pickedAway ? as > hs : false;
  return won ? { label: "Won", tone: "good" } : { label: "Lost", tone: "bad" };
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

/** ---------- Odds / Profit ---------- */
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

function parlayGrade(legs: ParlayLeg[], gamesById: Record<string, GameRow>): Result {
  if (!legs || legs.length === 0) return { label: "Pending", tone: "neutral" };

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

  if (anyLost) return { label: "Lost", tone: "bad" };
  if (anyPending) return { label: "Pending", tone: "neutral" };
  if (anyNoData) return { label: "Pending", tone: "neutral" };

  return { label: "Won", tone: "good" };
}

function effectiveParlayOddsForProfit(
  legs: ParlayLeg[],
  gamesById: Record<string, GameRow>,
  fallbackOdds: number
) {
  const grade = parlayGrade(legs, gamesById);
  if (grade.label !== "Won") return fallbackOdds;

  let dec = 1;
  for (const leg of legs) {
    const g = gamesById[leg.game_id];
    const r = calcResultLike(leg.leg_type, leg.selection, leg.line, g);
    if (r.label === "Push") dec *= 1;
    else dec *= americanToDecimal(Number(leg.odds ?? 0));
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
  const [importLegSearchError, setImportLegSearchError] = useState<Record<number, string>>({});


  // ---- form: shared ----
  const [bettor, setBettor] = useState<Bettor>("sydney");
  const [betType, setBetType] = useState<BetType>("total");
  const [stake, setStake] = useState<string>("1");
  const [odds, setOdds] = useState<string>("-110");

  // ---- single bet (moneyline/spread/total) ----
  const [singleGameId, setSingleGameId] = useState("");
  const [singleSelectedGame, setSingleSelectedGame] = useState<GameRow | null>(null);
  const [singleSelection, setSingleSelection] = useState<string>("over");
  const [singleLine, setSingleLine] = useState<string>("");

  // single game search
  const [singleGameSearch, setSingleGameSearch] = useState("");
  const [singleSearchResults, setSingleSearchResults] = useState<GameRow[]>([]);
  const [singleSearchOpen, setSingleSearchOpen] = useState(false);
  const [singleSearchLoading, setSingleSearchLoading] = useState(false);
  const singleSearchBoxRef = useRef<HTMLDivElement | null>(null);

  // ---- player props ----
  const [propGameId, setPropGameId] = useState("");
  const [propSelectedGame, setPropSelectedGame] = useState<GameRow | null>(null);
  const [propGameSearch, setPropGameSearch] = useState("");
  const [propSearchResults, setPropSearchResults] = useState<GameRow[]>([]);
  const [propSearchOpen, setPropSearchOpen] = useState(false);
  const [propSearchLoading, setPropSearchLoading] = useState(false);
  const propSearchBoxRef = useRef<HTMLDivElement | null>(null);

  const [propPlayer, setPropPlayer] = useState("");
  const [propMarket, setPropMarket] = useState("");
  const [propSide, setPropSide] = useState<"over" | "under">("over");
  const [propLine, setPropLine] = useState("");
  const [propNotes, setPropNotes] = useState("");

  // ---- parlay builder ----
  type DraftLeg = {
    tmpId: string;
    game_id: string;
    game?: GameRow;
    leg_type: ParlayLegType;
    selection: string;
    line: string;
    odds: string;
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

  // ---- view filter ----
  const [viewBettor, setViewBettor] = useState<"all" | Bettor>("all");

  // ---- import from screenshot ----
  type ImportSlipResponse =
    | { parsed: any; game_id?: string | null }
    | { parsed: any };

  const [importBettor, setImportBettor] = useState<Bettor>("sydney");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState<ImportSlipResponse | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  // --- import: editable draft so we can fix parlay legs before saving ---
const [importDraft, setImportDraft] = useState<any | null>(null);

// per-leg search UI state (indexed by leg index)
const [importLegSearchText, setImportLegSearchText] = useState<Record<number, string>>({});
const [importLegSearchOpen, setImportLegSearchOpen] = useState<Record<number, boolean>>({});
const [importLegSearchLoading, setImportLegSearchLoading] = useState<Record<number, boolean>>({});
const [importLegSearchResults, setImportLegSearchResults] = useState<Record<number, GameRow[]>>({});


function updateImportLeg(idx: number, patch: any) {
  setImportDraft((prev: any) => {
    if (!prev?.legs || !Array.isArray(prev.legs)) return prev;
    const next = { ...prev };
    next.legs = prev.legs.map((l: any, i: number) => (i === idx ? { ...l, ...patch } : l));
    return next;
  });
}

async function searchGamesForLeg(idx: number, q: string) {
  const query = q.trim();
  setImportLegSearchText((p) => ({ ...p, [idx]: q }));
  setImportLegSearchError((p) => ({ ...p, [idx]: "" }));

  if (query.length < 2) {
    setImportLegSearchResults((p) => ({ ...p, [idx]: [] }));
    setImportLegSearchOpen((p) => ({ ...p, [idx]: false }));
    return;
  }

  setImportLegSearchLoading((p) => ({ ...p, [idx]: true }));
  setImportLegSearchOpen((p) => ({ ...p, [idx]: true }));

  try {
    const r = await fetch(`/api/nfl/search?q=${encodeURIComponent(query)}`, {
      cache: "no-store",
    });

    const j = await r.json().catch(() => null);

    if (!r.ok) {
      setImportLegSearchResults((p) => ({ ...p, [idx]: [] }));
      setImportLegSearchError((p) => ({
        ...p,
        [idx]: j?.error ? String(j.error) : `Search failed (${r.status})`,
      }));
      return;
    }

    setImportLegSearchResults((p) => ({ ...p, [idx]: (j?.games ?? []) as GameRow[] }));
  } catch (e: any) {
    setImportLegSearchResults((p) => ({ ...p, [idx]: [] }));
    setImportLegSearchError((p) => ({ ...p, [idx]: e?.message ?? "Network error" }));
  } finally {
    setImportLegSearchLoading((p) => ({ ...p, [idx]: false }));
  }
}


  const [error, setError] = useState<string | null>(null);
  

  /** ---------- Load ---------- */
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
      bet_type: String(b.bet_type) as BetType,
      parlay_id: b.parlay_id ?? null,
      stake: Number(b.stake ?? 0),
      odds: Number(b.odds ?? 0),
      line: b.line === null || b.line === undefined ? null : Number(b.line),

      prop_player: b.prop_player ?? null,
      prop_market: b.prop_market ?? null,
      prop_side: b.prop_side ?? null,
      prop_line: b.prop_line === null || b.prop_line === undefined ? null : Number(b.prop_line),
      prop_notes: b.prop_notes ?? null,
      result_override: b.result_override ?? null,
    })) as Bet[];

    setBets(betRows);

    const parlayIds = Array.from(
      new Set(betRows.filter((b) => b.bet_type === "parlay").map((b) => b.parlay_id).filter(Boolean))
    ) as string[];

    let fetchedLegs: ParlayLeg[] = [];
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

      fetchedLegs = ((legData ?? []) as any[]).map((leg) => ({
        ...leg,
        parlay_id: String(leg.parlay_id),
        leg_type: String(leg.leg_type) as ParlayLegType,
        odds: Number(leg.odds ?? -110),
        line: leg.line === null || leg.line === undefined ? null : Number(leg.line),
      })) as ParlayLeg[];

      const map: Record<string, ParlayLeg[]> = {};
      for (const leg of fetchedLegs) {
        const pid = String(leg.parlay_id);
        if (!map[pid]) map[pid] = [];
        map[pid].push(leg);
      }
      for (const pid of Object.keys(map)) {
        map[pid].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
      }
      setLegsByParlayId(map);
    } else {
      setLegsByParlayId({});
    }

    const gameIdsFromSingles = betRows
      .filter((b) => b.bet_type !== "parlay")
      .map((b) => b.game_id)
      .filter(Boolean);

    const gameIdsFromLegs = fetchedLegs.map((l) => l.game_id).filter(Boolean);

    const ids = Array.from(new Set([...gameIdsFromSingles, ...gameIdsFromLegs]));
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

  /** ---------- Outside click closes dropdowns ---------- */
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const t = e.target as Node;
      if (singleSearchBoxRef.current && !singleSearchBoxRef.current.contains(t)) setSingleSearchOpen(false);
      if (legSearchBoxRef.current && !legSearchBoxRef.current.contains(t)) setLegSearchOpen(false);
      if (propSearchBoxRef.current && !propSearchBoxRef.current.contains(t)) setPropSearchOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  /** ---------- Debounced search helpers ---------- */
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

  useEffect(() => {
    const q = propGameSearch.trim();
    if (q.length < 2) {
      setPropSearchResults([]);
      setPropSearchLoading(false);
      return;
    }

    setPropSearchLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/nfl/search?q=${encodeURIComponent(q)}`, { cache: "no-store" });
        const j = await r.json();
        setPropSearchResults((j.games ?? []) as GameRow[]);
        setPropSearchOpen(true);
      } catch {
        setPropSearchResults([]);
      } finally {
        setPropSearchLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [propGameSearch]);

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

  /** ---------- Intuitive selection ---------- */
  useEffect(() => {
    if (betType === "parlay" || betType === "player_prop") return;
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

  // Auto-fill parlay odds from legs
  useEffect(() => {
    if (betType !== "parlay") return;
    if (parlayLegs.length === 0) return;

    const nums = parlayLegs.map((l) => Number(l.odds));
    if (nums.some((n) => !Number.isFinite(n) || n === 0)) return;

    const computed = computeParlayAmericanOddsFromLegOdds(nums.map((o) => ({ odds: o })));
    if (computed !== 0) setOdds(String(computed));
  }, [betType, parlayLegs]);

  /** ---------- UI helpers ---------- */
  function renderGameSearch({
    boxRef,
    value,
    setValue,
    open,
    setOpen,
    loading,
    results,
    onPick,
    placeholder,
  }: {
    boxRef: React.RefObject<HTMLDivElement | null>;
    value: string;
    setValue: (v: string) => void;
    open: boolean;
    setOpen: (v: boolean) => void;
    loading: boolean;
    results: GameRow[];
    onPick: (g: GameRow) => void;
    placeholder: string;
  }) {
    return (
      <div ref={boxRef} style={{ position: "relative" }}>
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
          }}
          placeholder={placeholder}
          style={inputStyle}
        />

        {open && (
          <div style={dropdownStyle}>
            {loading ? (
              <div style={rowStyle}>Searching…</div>
            ) : value.trim().length < 2 ? (
              <div style={rowStyle}>Type at least 2 characters…</div>
            ) : results.length === 0 ? (
              <div style={rowStyle}>No matches</div>
            ) : (
              results.map((g) => (
                <div key={g.game_id} style={rowStyle} onClick={() => onPick(g)}>
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
    );
  }

  const singleSelectionUI =
    betType === "total" ? (
      <select value={singleSelection} onChange={(e) => setSingleSelection(e.target.value)} style={inputStyle}>
        <option value="over">over</option>
        <option value="under">under</option>
      </select>
    ) : (
      <select value={singleSelection} onChange={(e) => setSingleSelection(e.target.value)} style={inputStyle} disabled={!singleSelectedGame}>
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

  /** ---------- Result/Profit ---------- */
  function betResult(b: Bet): Result {
    const o = normalizeOverride(b.result_override);
    if (o) return o;

    if (b.bet_type === "player_prop") return { label: "Pending", tone: "neutral" };

    if (b.bet_type === "parlay") {
      const pid = b.parlay_id ?? "";
      const legs = pid ? legsByParlayId[pid] ?? [] : [];
      return parlayGrade(legs, gamesById);
    }

    const g = gamesById[b.game_id];
    return calcResultLike(b.bet_type, b.selection, b.line, g);
  }

  function betProfit(b: Bet) {
    const stakeNum = Number(b.stake ?? 0);
    const r = betResult(b);

    if (r.label === "Won") {
      if (b.bet_type === "parlay") {
        const pid = b.parlay_id ?? "";
        const legs = pid ? legsByParlayId[pid] ?? [] : [];
        const effOdds = effectiveParlayOddsForProfit(legs, gamesById, Number(b.odds ?? 0));
        return profitFromAmericanOdds(stakeNum, effOdds);
      }
      return profitFromAmericanOdds(stakeNum, Number(b.odds ?? 0));
    }
    if (r.label === "Lost") return -stakeNum;
    return 0;
  }

  function computeSummary(list: Bet[]): Summary {
    return list.reduce(
      (acc, b) => {
        const r = betResult(b);
        if (r.label === "Won") {
          const p = betProfit(b);
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
        } else {
          acc.pending += 1;
        }
        return acc;
      },
      { wins: 0, losses: 0, pushes: 0, pending: 0, totalWinnings: 0, totalLosses: 0, net: 0 }
    );
  }

  const visibleBets = useMemo(() => (viewBettor === "all" ? bets : bets.filter((b) => b.bettor === viewBettor)), [bets, viewBettor]);

  const summaryAll = useMemo(() => computeSummary(bets), [bets, gamesById, legsByParlayId]);
  const summarySydney = useMemo(() => computeSummary(bets.filter((b) => b.bettor === "sydney")), [bets, gamesById, legsByParlayId]);
  const summaryWilliam = useMemo(() => computeSummary(bets.filter((b) => b.bettor === "william")), [bets, gamesById, legsByParlayId]);

  /** ---------- Add / Update / Delete ---------- */
  async function addSingleBet(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!singleGameId) return setError("Please select a game.");
    if (!singleSelection.trim()) return setError("Please choose a selection.");

    if (betType !== "moneyline") {
      const parsed = Number(singleLine);
      if (!singleLine.trim() || Number.isNaN(parsed)) return setError("Line must be a number for spread/total.");
    }

    const stakeNum = Number(stake);
    const oddsNum = Number(odds);

    if (!stake.trim() || Number.isNaN(stakeNum) || stakeNum <= 0) return setError("Stake must be a positive number.");
    if (!odds.trim() || Number.isNaN(oddsNum) || oddsNum === 0) return setError("Odds must be a non-zero number (e.g. -110, +150).");

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

      prop_player: null,
      prop_market: null,
      prop_side: null,
      prop_line: null,
      prop_notes: null,
      result_override: null,
    });

    if (error) return setError(error.message);

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

  async function addPropBet(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!propGameId) return setError("Please select a game.");
    if (!propPlayer.trim()) return setError("Player is required.");
    if (!propMarket.trim()) return setError("Market is required.");
    const ln = Number(propLine);
    if (!propLine.trim() || Number.isNaN(ln)) return setError("Prop line must be a number.");

    const stakeNum = Number(stake);
    const oddsNum = Number(odds);
    if (!stake.trim() || Number.isNaN(stakeNum) || stakeNum <= 0) return setError("Stake must be a positive number.");
    if (!odds.trim() || Number.isNaN(oddsNum) || oddsNum === 0) return setError("Odds must be a non-zero number (e.g. -110, +150).");

    const { error } = await supabase.from("bets").insert({
      user_id: USER_ID,
      sport: "NFL",
      game_id: propGameId,
      bet_type: "player_prop",
      selection: "prop",
      line: null,

      stake: stakeNum,
      odds: oddsNum,
      bettor,
      parlay_id: null,

      prop_player: propPlayer.trim(),
      prop_market: propMarket.trim(),
      prop_side: propSide,
      prop_line: ln,
      prop_notes: propNotes.trim() ? propNotes.trim() : null,
      result_override: "Pending",
    });

    if (error) return setError(error.message);

    setStake("1");
    setOdds("-110");
    setPropGameId("");
    setPropSelectedGame(null);
    setPropGameSearch("");
    setPropPlayer("");
    setPropMarket("");
    setPropSide("over");
    setPropLine("");
    setPropNotes("");
    setBetType("total");

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
    if (!odds.trim() || Number.isNaN(oddsNum) || oddsNum === 0) return setError("Parlay odds must be a non-zero number (auto-filled, but editable).");

    const parlayId = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).toString();

    const { error: headerErr } = await supabase.from("bets").insert({
      user_id: USER_ID,
      sport: "NFL",
      game_id: parlayId,
      bet_type: "parlay",
      selection: "parlay",
      line: null,

      stake: stakeNum,
      odds: oddsNum,
      bettor,
      parlay_id: parlayId,

      prop_player: null,
      prop_market: null,
      prop_side: null,
      prop_line: null,
      prop_notes: null,
      result_override: null,
    });

    if (headerErr) return setError(headerErr.message);

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

    setParlayLegs([]);
    setStake("1");
    setOdds("-110");
    setBetType("total");

    setLegType("total");
    setLegSelection("over");
    setLegLine("");
    setLegOdds("-110");
    setLegGameId("");
    setLegSelectedGame(null);
    setLegGameSearch("");

    await loadAll();
  }

  async function updatePropGrade(betId: string, next: "Pending" | "Won" | "Lost" | "Push") {
    setError(null);
    const { error } = await supabase.from("bets").update({ result_override: next }).eq("id", betId).eq("user_id", USER_ID);
    if (error) setError(error.message);
    else await loadAll();
  }

  async function deleteBetRow(b: Bet) {
    setError(null);
    const ok = confirm("Delete this bet?");
    if (!ok) return;

    if (b.bet_type === "parlay" && b.parlay_id) {
      const { error: legDelErr } = await supabase
        .from("parlay_legs")
        .delete()
        .eq("parlay_id", b.parlay_id)
        .eq("user_id", USER_ID);

      if (legDelErr) return setError(`Delete legs failed: ${legDelErr.message}`);
    }

    const { data, error } = await supabase.from("bets").delete().eq("id", b.id).eq("user_id", USER_ID).select("id");

    if (error) return setError(`Delete failed: ${error.message}`);
    if (!data || data.length === 0) return setError("Delete did nothing (no row matched, or blocked by RLS).");

    setBets((prev) => prev.filter((x) => x.id !== b.id));
    await loadAll();
  }

  /** ---------- Import from screenshot ---------- */
  async function parseScreenshot() {
    setImportError(null);
    if (!importFile) return setImportError("Choose a screenshot first.");

    setImportLoading(true);
    try {
      const fd = new FormData();
      fd.append("image", importFile);

      const r = await fetch("/api/bets/parse-slip", { method: "POST", body: fd });
      const j = await r.json();
if (!r.ok) {
  const detail =
    j?.status
      ? `(${j.status}) `
      : "";
  const req =
    j?.requestId
      ? ` req:${j.requestId}`
      : "";
  const body =
    j?.body
      ? ` — ${typeof j.body === "string" ? j.body : JSON.stringify(j.body)}`
      : "";

  return setImportError(`${j?.error ?? "Parse failed"} ${detail}${req}${body}`);
}

      setImportResult(j);
      setImportDraft(j.parsed); // <-- ADD THIS
      setImportOpen(true);
    } catch (e: any) {
      setImportError(e?.message ?? "Parse failed");
    } finally {
      setImportLoading(false);
    }
  }

  async function confirmImport() {
    if (!importResult) return;

    const slip = (importResult as any).parsed;

    async function insert(payload: any) {
      const { error } = await supabase.from("bets").insert(payload);
      if (error) throw new Error(error.message);
    }

    // Single bet / prop
    if (slip.bet_type !== "parlay") {
      const game_id = (importResult as any).game_id ?? null;
      if (!game_id) throw new Error("Could not match screenshot to a game (teams/date missing or unclear).");

      const common = {
        user_id: USER_ID,
        sport: "NFL",
        bettor: importBettor,
        stake: Number(slip.stake ?? 0),
        odds: Number(slip.odds ?? 0),
        parlay_id: null,
      };

      if (slip.bet_type === "player_prop") {
        await insert({
          ...common,
          game_id,
          bet_type: "player_prop",
          selection: "prop",
          line: null,
          prop_player: slip.prop_player ?? null,
          prop_market: slip.prop_market ?? null,
          prop_side: slip.prop_side ?? null,
          prop_line: slip.prop_line ?? null,
          prop_notes: slip.sportsbook ? `Imported from ${slip.sportsbook}` : "Imported from screenshot",
          result_override: "Pending",
        });
      } else {
        await insert({
          ...common,
          game_id,
          bet_type: slip.bet_type,
          selection: slip.selection ?? "",
          line: slip.bet_type === "moneyline" ? null : Number(slip.line ?? 0),
          prop_player: null,
          prop_market: null,
          prop_side: null,
          prop_line: null,
          prop_notes: slip.sportsbook ? `Imported from ${slip.sportsbook}` : null,
          result_override: null,
        });
      }

      setImportOpen(false);
      setImportResult(null);
      setImportFile(null);
      await loadAll();
      return;
    }

    // Parlay
    const legs = slip.legs ?? [];
    if (legs.length < 2) throw new Error("Parsed as parlay but found <2 legs.");

    const parlayId = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).toString();

    const { error: headerErr } = await supabase.from("bets").insert({
      user_id: USER_ID,
      sport: "NFL",
      bettor: importBettor,
      stake: Number(slip.stake ?? 0),
      odds: Number(slip.odds ?? 0),
      bet_type: "parlay",
      selection: "parlay",
      line: null,
      game_id: parlayId,
      parlay_id: parlayId,
      prop_player: null,
      prop_market: null,
      prop_side: null,
      prop_line: null,
      prop_notes: slip.sportsbook ? `Imported from ${slip.sportsbook}` : "Imported from screenshot",
      result_override: null,
    });

    if (headerErr) throw new Error(headerErr.message);

    // NOTE: current parlay_legs schema doesn't support prop legs. We skip prop legs or store them as text.
    const legsPayload = (legs as any[]).map((l) => {
      if (!l.game_id) throw new Error("A parlay leg could not be matched to a game.");
      if (l.bet_type === "player_prop") {
        return {
          user_id: USER_ID,
          parlay_id: parlayId,
          sport: "NFL",
          game_id: l.game_id,
          leg_type: "total",
          selection: `PROP: ${l.prop_player ?? ""} ${l.prop_market ?? ""} ${l.prop_side ?? ""} ${l.prop_line ?? ""}`.trim(),
          line: null,
          odds: Number(l.odds ?? -110),
        };
      }
      return {
        user_id: USER_ID,
        parlay_id: parlayId,
        sport: "NFL",
        game_id: l.game_id,
        leg_type: l.bet_type,
        selection: l.selection ?? "",
        line: l.bet_type === "moneyline" ? null : Number(l.line ?? 0),
        odds: Number(l.odds ?? -110),
      };
    });

    const { error: legsErr } = await supabase.from("parlay_legs").insert(legsPayload);
    if (legsErr) throw new Error(legsErr.message);

    setImportOpen(false);
    setImportResult(null);
    setImportFile(null);
    await loadAll();
  }

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
                <option value="player_prop">player prop</option>
              </select>
            </div>
          </div>

          {/* Stake / Odds */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={labelStyle}>Stake ($ risk)</label>
              <input value={stake} onChange={(e) => setStake(e.target.value)} style={inputStyle} placeholder="e.g. 50" inputMode="decimal" />
            </div>

            <div>
              <label style={labelStyle}>{betType === "parlay" ? "Parlay odds (auto-filled, editable)" : "Odds (American)"}</label>
              <input value={odds} onChange={(e) => setOdds(e.target.value)} style={inputStyle} placeholder="e.g. -110 or +600" inputMode="numeric" />
              {betType === "parlay" && <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>Tip: Add legs below — odds will auto-calculate (still editable).</div>}
              {betType === "player_prop" && <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>Props are graded manually after you add them (use the Grade dropdown).</div>}
            </div>
          </div>

          {/* Singles */}
          {betType !== "parlay" && betType !== "player_prop" && (
            <form onSubmit={addSingleBet} style={{ display: "grid", gap: 12 }}>
              <div>
                <label style={labelStyle}>Game (search by team)</label>
                {renderGameSearch({
                  boxRef: singleSearchBoxRef,
                  value: singleGameSearch,
                  setValue: setSingleGameSearch,
                  open: singleSearchOpen,
                  setOpen: setSingleSearchOpen,
                  loading: singleSearchLoading,
                  results: singleSearchResults,
                  placeholder: "DAL, Cowboys, Eagles…",
                  onPick: (g) => {
                    setSingleSelectedGame(g);
                    setSingleGameId(g.game_id);
                    setSingleGameSearch(`${g.away_team} @ ${g.home_team} — ${g.game_date}`);
                    setSingleSearchOpen(false);
                  },
                })}
                <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
                  Selected:{" "}
                  <b>{singleSelectedGame ? `${singleSelectedGame.away_team} @ ${singleSelectedGame.home_team} — ${singleSelectedGame.game_date}` : "—"}</b>
                </div>
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
          )}

          {/* Player Props */}
          {betType === "player_prop" && (
            <form onSubmit={addPropBet} style={{ display: "grid", gap: 12 }}>
              <div>
                <label style={labelStyle}>Game (search by team)</label>
                {renderGameSearch({
                  boxRef: propSearchBoxRef,
                  value: propGameSearch,
                  setValue: setPropGameSearch,
                  open: propSearchOpen,
                  setOpen: setPropSearchOpen,
                  loading: propSearchLoading,
                  results: propSearchResults,
                  placeholder: "BUF, Bills, Dolphins…",
                  onPick: (g) => {
                    setPropSelectedGame(g);
                    setPropGameId(g.game_id);
                    setPropGameSearch(`${g.away_team} @ ${g.home_team} — ${g.game_date}`);
                    setPropSearchOpen(false);
                  },
                })}
                <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
                  Selected:{" "}
                  <b>{propSelectedGame ? `${propSelectedGame.away_team} @ ${propSelectedGame.home_team} — ${propSelectedGame.game_date}` : "—"}</b>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={labelStyle}>Player</label>
                  <input value={propPlayer} onChange={(e) => setPropPlayer(e.target.value)} style={inputStyle} placeholder="e.g. Josh Allen" />
                </div>

                <div>
                  <label style={labelStyle}>Market</label>
                  <input value={propMarket} onChange={(e) => setPropMarket(e.target.value)} style={inputStyle} placeholder="e.g. Passing Yards" />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={labelStyle}>Side</label>
                  <select value={propSide} onChange={(e) => setPropSide(e.target.value as any)} style={inputStyle}>
                    <option value="over">over</option>
                    <option value="under">under</option>
                  </select>
                </div>

                <div>
                  <label style={labelStyle}>Line</label>
                  <input value={propLine} onChange={(e) => setPropLine(e.target.value)} style={inputStyle} placeholder="e.g. 265.5" inputMode="decimal" />
                </div>
              </div>

              <div>
                <label style={labelStyle}>Notes (optional)</label>
                <input value={propNotes} onChange={(e) => setPropNotes(e.target.value)} style={inputStyle} placeholder="Any notes…" />
              </div>

              <button type="submit" style={buttonStyle}>
                Add Prop
              </button>
            </form>
          )}

          {/* Parlays */}
          {betType === "parlay" && (
            <form onSubmit={submitParlay} style={{ display: "grid", gap: 12 }}>
              <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
                <div style={{ fontWeight: 900, marginBottom: 10 }}>Add legs</div>

                <div style={{ display: "grid", gap: 12 }}>
                  <div>
                    <label style={labelStyle}>Leg game (search by team)</label>
                    {renderGameSearch({
                      boxRef: legSearchBoxRef,
                      value: legGameSearch,
                      setValue: setLegGameSearch,
                      open: legSearchOpen,
                      setOpen: setLegSearchOpen,
                      loading: legSearchLoading,
                      results: legSearchResults,
                      placeholder: "KC, Chiefs, Bills…",
                      onPick: (g) => {
                        setLegSelectedGame(g);
                        setLegGameId(g.game_id);
                        setLegGameSearch(`${g.away_team} @ ${g.home_team} — ${g.game_date}`);
                        setLegSearchOpen(false);
                      },
                    })}
                    <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
                      Selected:{" "}
                      <b>{legSelectedGame ? `${legSelectedGame.away_team} @ ${legSelectedGame.home_team} — ${legSelectedGame.game_date}` : "—"}</b>
                    </div>
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
                          <div style={{ fontWeight: 800, fontSize: 13 }}>{l.game ? `${l.game.away_team} @ ${l.game.home_team}` : l.game_id}</div>
                          <div style={{ fontSize: 12, opacity: 0.8 }}>
                            {l.leg_type} — {l.selection}
                            {l.leg_type === "moneyline" ? "" : ` (${l.line})`} • odds {l.odds}
                          </div>
                        </div>

                        <button type="button" style={tinyDangerButtonStyle} onClick={() => setParlayLegs((prev) => prev.filter((x) => x.tmpId !== l.tmpId))}>
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

          {/* Import from screenshot */}
          <div style={{ borderTop: "1px solid #eee", marginTop: 16, paddingTop: 16 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Import from screenshot</div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={labelStyle}>Who placed the bet?</label>
                <select value={importBettor} onChange={(e) => setImportBettor(e.target.value as any)} style={inputStyle}>
                  <option value="sydney">sydney</option>
                  <option value="william">william</option>
                </select>
              </div>

              <div>
                <label style={labelStyle}>Bet slip screenshot</label>
                <input type="file" accept="image/*" onChange={(e) => setImportFile(e.target.files?.[0] ?? null)} style={inputStyle} />
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
              <button type="button" onClick={parseScreenshot} style={buttonStyle} disabled={importLoading}>
                {importLoading ? "Parsing…" : "Parse Screenshot"}
              </button>
              {importError && <div style={{ color: "crimson" }}>{importError}</div>}
              <div style={{ fontSize: 12, opacity: 0.7 }}>Tip: include the part of the slip showing teams, date, stake, odds, and the bet details.</div>
            </div>
          </div>
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
              if (b.bet_type === "player_prop") {
                const g = gamesById[b.game_id];
                const gameLabel = g
                  ? `${g.away_team} @ ${g.home_team} — ${g.game_date} • ${g.away_score ?? 0}-${g.home_score ?? 0} • ${statusText(g)}`
                  : b.game_id;

                const r = betResult(b);
                const profit = betProfit(b);

                return (
                  <div key={b.id} style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        <Pill text={r.label} tone={r.tone} />
                        <div style={{ fontWeight: 800 }}>
                          {b.bettor} • player prop — {b.prop_player} • {b.prop_market} • {b.prop_side} {b.prop_line}
                        </div>
                      </div>

                      <button type="button" onClick={() => deleteBetRow(b)} style={deleteButtonStyle} title="Delete bet">
                        Delete
                      </button>
                    </div>

                    <div style={{ marginTop: 6, opacity: 0.85, fontSize: 13 }}>{gameLabel}</div>

                    {b.prop_notes && <div style={{ marginTop: 6, fontSize: 13, opacity: 0.85 }}>Notes: {b.prop_notes}</div>}

                    <div style={{ marginTop: 10, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                      <div style={{ fontSize: 13, opacity: 0.9 }}>
                        Stake: ${Number(b.stake ?? 0).toFixed(2)} • Odds: {b.odds ?? 0} • Profit:{" "}
                        <span style={{ fontWeight: 800 }}>{formatSignedMoney(profit)}</span>
                      </div>

                      <div style={{ minWidth: 220 }}>
                        <label style={labelStyle}>Grade</label>
                        <select
                          value={(b.result_override ?? "Pending") as any}
                          onChange={(e) => updatePropGrade(b.id, e.target.value as any)}
                          style={inputStyle}
                        >
                          <option value="Pending">Pending</option>
                          <option value="Won">Won</option>
                          <option value="Lost">Lost</option>
                          <option value="Push">Push</option>
                        </select>
                      </div>
                    </div>
                  </div>
                );
              }

              if (b.bet_type === "parlay") {
                const pid = b.parlay_id ?? "";
                const legs = pid ? legsByParlayId[pid] ?? [] : [];
                const grade = betResult(b);
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
              }

              // Single bet
              const g = gamesById[b.game_id];
              const r = betResult(b);
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
            })}
          </div>
        )}
      </div>

            {/* Confirm import modal */}
      {importOpen && importResult && importDraft && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 50,
          }}
        >
          <div style={{ background: "white", borderRadius: 14, padding: 16, maxWidth: 820, width: "100%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div style={{ fontWeight: 900, fontSize: 16 }}>Confirm import</div>
              <button
                type="button"
                style={deleteButtonStyle}
                onClick={() => {
                  setImportOpen(false);
                  setImportError(null);
                }}
              >
                Close
              </button>
            </div>

            {importDraft.bet_type === "parlay" && Array.isArray(importDraft.legs) && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontWeight: 900, marginBottom: 8 }}>Parlay legs</div>

                <div style={{ display: "grid", gap: 10 }}>
                  {importDraft.legs.map((leg: any, idx: number) => (
                    <div key={idx} style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 10,
                          alignItems: "center",
                          flexWrap: "wrap",
                        }}
                      >
                        <div style={{ fontWeight: 800 }}>
                          {leg.bet_type} — {leg.selection ?? ""}
                          {leg.line != null ? ` (${leg.line})` : ""} • odds {leg.odds ?? "—"}
                        </div>

                        <div style={{ fontSize: 12, fontWeight: 800, color: !leg.game_id ? "crimson" : "green" }}>
                          {!leg.game_id ? "Needs game selected" : "Game linked"}
                        </div>
                      </div>

<div style={{ marginTop: 10, position: "relative" }}>
                        <label style={{ fontSize: 12, opacity: 0.7, marginBottom: 4, display: "block" }}>
                          Select the correct game for this leg
                        </label>

                        <input
                          value={importLegSearchText[idx] ?? ""}
                          onChange={(e) => searchGamesForLeg(idx, e.target.value)}
                          placeholder="Search team (DAL, Cowboys, Lions, DET...)"
                          style={inputStyle}
                        />

                        {importLegSearchError[idx] && (
                          <div style={{ marginTop: 6, fontSize: 12, color: "crimson" }}>
                            {importLegSearchError[idx]}
                          </div>
                        )}

                        {(importLegSearchOpen[idx] ?? false) && (
                          <div style={dropdownStyle}>
                            {importLegSearchLoading[idx] ? (
                              <div style={rowStyle}>Searching…</div>
                            ) : (importLegSearchText[idx] ?? "").trim().length < 2 ? (
                              <div style={rowStyle}>Type at least 2 characters…</div>
                            ) : (importLegSearchResults[idx] ?? []).length === 0 ? (
                              <div style={rowStyle}>No matches</div>
                            ) : (
                              (importLegSearchResults[idx] ?? []).map((g) => (
                                <div
                                  key={g.game_id}
                                  style={rowStyle}
                                  onClick={() => {
                                    updateImportLeg(idx, {
                                      game_id: g.game_id,
                                      game: {
                                        game_date: g.game_date,
                                        home_team: g.home_team,
                                        away_team: g.away_team,
                                      },
                                    });
                                    setImportLegSearchOpen((p) => ({ ...p, [idx]: false }));
                                    setImportLegSearchText((p) => ({
                                      ...p,
                                      [idx]: `${g.away_team} @ ${g.home_team} — ${g.game_date}`,
                                    }));
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

                        {leg.game_id && (
                          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
                            Linked game_id: <b>{leg.game_id}</b>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <pre
              style={{
                marginTop: 12,
                padding: 12,
                background: "#f7f7f8",
                borderRadius: 12,
                overflowX: "auto",
                fontSize: 12,
                maxHeight: 260,
              }}
            >
              {JSON.stringify({ parsed: importDraft }, null, 2)}
            </pre>

            <div style={{ display: "flex", gap: 10, marginTop: 12, justifyContent: "flex-end" }}>
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={() => {
                  setImportOpen(false);
                  setImportError(null);
                }}
              >
                Cancel
              </button>

              <button
                type="button"
                style={buttonStyle}
                onClick={async () => {
                  if (importDraft?.bet_type === "parlay" && Array.isArray(importDraft.legs)) {
                    const missing = importDraft.legs.findIndex((l: any) => !l.game_id);
                    if (missing !== -1) {
                      setImportError(`Please select a game for leg #${missing + 1} before confirming.`);
                      return;
                    }
                  }

                  // swap in edited draft then run your existing confirmImport()
                  setImportResult((prev: any) => ({ ...(prev ?? {}), parsed: importDraft }));
                  await confirmImport();
                }}
              >
                Confirm & Add
              </button>
            </div>

            {importError && <div style={{ color: "crimson", marginTop: 10 }}>{importError}</div>}
          </div>
        </div>
      )}

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

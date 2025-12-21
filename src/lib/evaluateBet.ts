type Game = {
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
  is_final: boolean;
};

type Bet = {
  bet_type: "moneyline" | "spread" | "total";
  selection: string;
  line: number | null;
};

export function evaluateBet(bet: Bet, game: Game) {
  if (bet.bet_type === "moneyline") {
    const teamScore =
      bet.selection === game.home_team
        ? game.home_score
        : game.away_score;
    const oppScore =
      bet.selection === game.home_team
        ? game.away_score
        : game.home_score;

    return {
      status:
        teamScore > oppScore
          ? "Winning"
          : teamScore < oppScore
          ? "Losing"
          : "Push",
      delta: teamScore - oppScore,
    };
  }

  if (bet.bet_type === "spread" && bet.line !== null) {
    const teamScore =
      bet.selection === game.home_team
        ? game.home_score
        : game.away_score;
    const oppScore =
      bet.selection === game.home_team
        ? game.away_score
        : game.home_score;

    const delta = teamScore - oppScore - bet.line;

    return {
      status: delta > 0 ? "Winning" : delta < 0 ? "Losing" : "Push",
      delta,
    };
  }

  if (bet.bet_type === "total" && bet.line !== null) {
    const total = game.home_score + game.away_score;
    const delta =
      bet.selection === "over" ? total - bet.line : bet.line - total;

    return {
      status: delta > 0 ? "Winning" : delta < 0 ? "Losing" : "Push",
      delta,
    };
  }

  return { status: "—", delta: 0 };
}

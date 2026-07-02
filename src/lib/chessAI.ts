/**
 * chessAI.ts — Chess AI engine: negamax with alpha-beta pruning,
 * piece-square tables, quiescence search, and 5 difficulty levels.
 *
 * Pure TypeScript module (no React, no DOM). Uses chess.js for move
 * generation and board state. The passed-in `Chess` instance is never
 * mutated — a fresh clone is created from its FEN.
 *
 * @packageDocumentation
 */

import { Chess } from "chess.js";
import type { Color, Move, PieceSymbol } from "chess.js";

// ============================================================
// Public types & constants
// ============================================================

/** Difficulty levels offered to the player. */
export type Difficulty = "easy" | "medium" | "hard" | "expert" | "master";

/** Metadata for a difficulty level (consumed by the UI). */
export interface DifficultyInfo {
  id: Difficulty;
  label: string;
  description: string;
  eloRange: string;
}

/**
 * Difficulty descriptors for UI consumption. Each entry maps a difficulty
 * id to a human label, description, and approximate Elo range.
 */
export const DIFFICULTIES: DifficultyInfo[] = [
  {
    id: "easy",
    label: "Beginner",
    description:
      "Depth 1 search. Picks randomly among the top 4 moves. Makes frequent mistakes.",
    eloRange: "600–900",
  },
  {
    id: "medium",
    label: "Casual",
    description:
      "Depth 2 search. Picks randomly among the top 2 moves. Decent tactical awareness.",
    eloRange: "900–1200",
  },
  {
    id: "hard",
    label: "Club",
    description:
      "Depth 3 search. Plays the single best move. Solid positional play.",
    eloRange: "1300–1600",
  },
  {
    id: "expert",
    label: "Expert",
    description:
      "Depth 4 search. Plays the single best move. Strong tactics and strategy.",
    eloRange: "1700–2000",
  },
  {
    id: "master",
    label: "Master",
    description:
      "Depth 4 search with quiescence extension on captures. Avoids horizon-effect blunders.",
    eloRange: "2100+",
  },
];

/** Result returned by {@link findBestMove}. */
export interface AIMoveResult {
  from: string;
  to: string;
  /** Promotion piece ("q" | "r" | "b" | "n") if the move promotes. */
  promotion?: string;
  /** Standard Algebraic Notation of the move. */
  san: string;
  /** Centipawn evaluation from the AI's perspective (positive = good for AI). */
  score: number;
}

/** Result returned by {@link quickEvaluate}. */
export interface QuickEvaluation {
  /** Centipawn score from WHITE's perspective (clamped to ±9999). */
  scoreCp: number;
  /** Plies to mate (0 = side to move is already checkmated). Undefined if no mate. */
  mateIn?: number;
  /** Human-readable label, e.g. "+1.5", "Equal", "Checkmate — white wins". */
  label: string;
}

// ============================================================
// Internal configuration
// ============================================================

interface DifficultyConfig {
  /** Search depth in plies. */
  depth: number;
  /** 0 = deterministic (pick single best move). N>0 = pick randomly among top N. */
  randomness: number;
  /** Whether to run quiescence search at leaf nodes. */
  useQuiescence: boolean;
}

const DIFFICULTY_CONFIG: Record<Difficulty, DifficultyConfig> = {
  easy: { depth: 1, randomness: 4, useQuiescence: false },
  medium: { depth: 2, randomness: 2, useQuiescence: false },
  hard: { depth: 3, randomness: 0, useQuiescence: false },
  expert: { depth: 4, randomness: 0, useQuiescence: false },
  master: { depth: 4, randomness: 0, useQuiescence: true },
};

/** Standard piece values in centipawns. */
const PIECE_VALUES: Record<PieceSymbol, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000,
};

/** Mate score (centipawns). Larger than any realistic material balance. */
const MATE_SCORE = 1_000_000;

/** Soft cap on nodes searched per move (prevents runaway search). */
const MAX_NODES = 200_000;

/** Wall-clock budget per move (ms). The search returns best-so-far if exceeded. */
const TIME_BUDGET_MS = 2000;

/** Maximum additional plies explored by quiescence search. */
const MAX_QUIESCENCE_DEPTH = 4;

// ============================================================
// Piece-square tables
// (white's perspective; index 0 = a8, 63 = h1, i.e. board()[r][f] -> r*8+f)
// Source: Tomasz Michniewski's "Simplified Evaluation Function".
// For black pieces the index is mirrored vertically: (7-r)*8 + f.
// ============================================================

const PST_PAWN: readonly number[] = [
   0,  0,  0,  0,  0,  0,  0,  0,
  50, 50, 50, 50, 50, 50, 50, 50,
  10, 10, 20, 30, 30, 20, 10, 10,
   5,  5, 10, 25, 25, 10,  5,  5,
   0,  0,  0, 20, 20,  0,  0,  0,
   5, -5,-10,  0,  0,-10, -5,  5,
   5, 10, 10,-20,-20, 10, 10,  5,
   0,  0,  0,  0,  0,  0,  0,  0,
];

const PST_KNIGHT: readonly number[] = [
  -50,-40,-30,-30,-30,-30,-40,-50,
  -40,-20,  0,  0,  0,  0,-20,-40,
  -30,  0, 10, 15, 15, 10,  0,-30,
  -30,  5, 15, 20, 20, 15,  5,-30,
  -30,  0, 15, 20, 20, 15,  0,-30,
  -30,  5, 10, 15, 15, 10,  5,-30,
  -40,-20,  0,  5,  5,  0,-20,-40,
  -50,-40,-30,-30,-30,-30,-40,-50,
];

const PST_BISHOP: readonly number[] = [
  -20,-10,-10,-10,-10,-10,-10,-20,
  -10,  0,  0,  0,  0,  0,  0,-10,
  -10,  0,  5, 10, 10,  5,  0,-10,
  -10,  5,  5, 10, 10,  5,  5,-10,
  -10,  0, 10, 10, 10, 10,  0,-10,
  -10, 10, 10, 10, 10, 10, 10,-10,
  -10,  5,  0,  0,  0,  0,  5,-10,
  -20,-10,-10,-10,-10,-10,-10,-20,
];

const PST_ROOK: readonly number[] = [
   0,  0,  0,  0,  0,  0,  0,  0,
   5, 10, 10, 10, 10, 10, 10,  5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
   0,  0,  0,  5,  5,  0,  0,  0,
];

const PST_QUEEN: readonly number[] = [
  -20,-10,-10, -5, -5,-10,-10,-20,
  -10,  0,  0,  0,  0,  0,  0,-10,
  -10,  0,  5,  5,  5,  5,  0,-10,
   -5,  0,  5,  5,  5,  5,  0, -5,
    0,  0,  5,  5,  5,  5,  0, -5,
  -10,  5,  5,  5,  5,  5,  0,-10,
  -10,  0,  5,  0,  0,  0,  0,-10,
  -20,-10,-10, -5, -5,-10,-10,-20,
];

const PST_KING_MG: readonly number[] = [
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -20,-30,-30,-40,-40,-30,-30,-20,
  -10,-20,-20,-20,-20,-20,-20,-10,
   20, 20,  0,  0,  0,  0, 20, 20,
   20, 30, 10,  0,  0, 10, 30, 20,
];

const PST_KING_EG: readonly number[] = [
  -50,-40,-30,-20,-20,-30,-40,-50,
  -30,-20,-10,  0,  0,-10,-20,-30,
  -30,-10, 20, 30, 30, 20,-10,-30,
  -30,-10, 30, 40, 40, 30,-10,-30,
  -30,-10, 30, 40, 40, 30,-10,-30,
  -30,-10, 20, 30, 30, 20,-10,-30,
  -30,-30,  0,  0,  0,  0,-30,-30,
  -50,-30,-30,-20,-20,-30,-30,-50,
];

const PST_NON_KING: Record<Exclude<PieceSymbol, "k">, readonly number[]> = {
  p: PST_PAWN,
  n: PST_KNIGHT,
  b: PST_BISHOP,
  r: PST_ROOK,
  q: PST_QUEEN,
};

// ============================================================
// Board helpers
// ============================================================

/** The 8×8 board layout returned by `chess.board()` (row 0 = rank 8). */
type Board = ReturnType<Chess["board"]>;

/**
 * Returns true if the position is in the endgame phase.
 * Heuristic: no queens on the board, or very little non-pawn material.
 */
function isEndgame(board: Board): boolean {
  let nonPawnMaterial = 0;
  let queenCount = 0;
  for (const row of board) {
    for (const sq of row) {
      if (!sq) continue;
      if (sq.type === "q") {
        queenCount++;
      } else if (sq.type !== "p" && sq.type !== "k") {
        nonPawnMaterial += PIECE_VALUES[sq.type];
      }
    }
  }
  return queenCount === 0 || nonPawnMaterial <= 1300;
}

/**
 * Centipawn bonus for the given color's king pawn shield (midgame only).
 * Rewards friendly pawns on the three squares directly in front of the king.
 */
function kingShieldBonus(board: Board, color: Color): number {
  let kr = -1;
  let kf = -1;
  for (let r = 0; r < 8 && kr === -1; r++) {
    for (let f = 0; f < 8; f++) {
      const sq = board[r][f];
      if (sq && sq.type === "k" && sq.color === color) {
        kr = r;
        kf = f;
        break;
      }
    }
  }
  if (kr === -1) return 0;
  // White king's shield lies toward rank 8 (lower row index); black's toward rank 1.
  const shieldR = color === "w" ? kr - 1 : kr + 1;
  if (shieldR < 0 || shieldR > 7) return 0;
  let count = 0;
  for (let df = -1; df <= 1; df++) {
    const nf = kf + df;
    if (nf < 0 || nf > 7) continue;
    const sq = board[shieldR][nf];
    if (sq && sq.type === "p" && sq.color === color) count++;
  }
  return count * 8;
}

/**
 * Fast static evaluation: material + piece-square tables + bishop pair +
 * king safety (pawn shield). Returns the score from WHITE's perspective
 * (positive = white better).
 *
 * Does NOT detect terminal states or compute mobility — callers must
 * handle those. The search checks move counts at each node; the public
 * {@link evaluatePosition} adds terminal + mobility on top.
 */
function evalStatic(chess: Chess): number {
  const board = chess.board();
  const endgame = isEndgame(board);

  let score = 0;
  let whiteBishops = 0;
  let blackBishops = 0;

  for (let r = 0; r < 8; r++) {
    const row = board[r];
    for (let f = 0; f < 8; f++) {
      const sq = row[f];
      if (!sq) continue;
      const value = PIECE_VALUES[sq.type];
      if (sq.color === "w") {
        const idx = r * 8 + f;
        const pst =
          sq.type === "k"
            ? endgame
              ? PST_KING_EG[idx]
              : PST_KING_MG[idx]
            : PST_NON_KING[sq.type][idx];
        score += value + pst;
        if (sq.type === "b") whiteBishops++;
      } else {
        // Mirror the table vertically for black so the same tables apply.
        const idx = (7 - r) * 8 + f;
        const pst =
          sq.type === "k"
            ? endgame
              ? PST_KING_EG[idx]
              : PST_KING_MG[idx]
            : PST_NON_KING[sq.type][idx];
        score -= value + pst;
        if (sq.type === "b") blackBishops++;
      }
    }
  }

  // Bishop pair bonus.
  if (whiteBishops >= 2) score += 30;
  if (blackBishops >= 2) score -= 30;

  // King safety only matters in the midgame.
  if (!endgame) {
    score += kingShieldBonus(board, "w");
    score -= kingShieldBonus(board, "b");
  }

  return score;
}

/**
 * Two-sided mobility term (centipawns, from WHITE's perspective).
 *
 * Computes the difference between White's and Black's legal-move counts.
 * Because the difference is used (rather than just the side-to-move count),
 * the term is stable across turns — a position that is good for White
 * stays good for White regardless of whose turn it is.
 *
 * The opponent's move count is obtained by cloning the position and
 * flipping the side to move. In any legal position the side not to move
 * is never in check, so the flip is always legal.
 */
function mobilityTerm(chess: Chess): number {
  const turn = chess.turn();
  const myMoves = Math.min(chess.moves().length, 30);
  let oppMoves = myMoves; // fallback: assume equal mobility
  try {
    const opp = new Chess(chess.fen());
    opp.setTurn(turn === "w" ? "b" : "w");
    oppMoves = Math.min(opp.moves().length, 30);
  } catch {
    // setTurn throws if the resulting position is illegal (e.g., the side
    // not to move is in check). In that case, fall back to equal mobility.
  }
  const whiteMoves = turn === "w" ? myMoves : oppMoves;
  const blackMoves = turn === "w" ? oppMoves : myMoves;
  return (whiteMoves - blackMoves) * 1; // 1 cp per move of advantage
}

/**
 * Full static evaluation from WHITE's perspective (positive = white better).
 * Includes material, piece-square tables, bishop pair, king safety, mobility,
 * and terminal-state detection (checkmate / stalemate / draw).
 */
export function evaluatePosition(chess: Chess): number {
  if (chess.isCheckmate()) {
    // Side to move is checkmated — very bad for that side.
    return chess.turn() === "w" ? -MATE_SCORE : MATE_SCORE;
  }
  if (chess.isDraw()) {
    return 0;
  }
  return evalStatic(chess) + mobilityTerm(chess);
}

// ============================================================
// Move ordering (MVV-LVA + promotion bonus)
// ============================================================

/** Heuristic score used to order moves for better alpha-beta pruning. */
function moveOrderScore(m: Move): number {
  let s = 0;
  if (m.captured) {
    // MVV-LVA: prefer capturing high-value victims with low-value attackers.
    s += 10 * PIECE_VALUES[m.captured] - PIECE_VALUES[m.piece];
  }
  if (m.promotion) {
    s += PIECE_VALUES[m.promotion];
  }
  return s;
}

/** Returns a new array of moves sorted best-first for alpha-beta efficiency. */
function orderMoves(moves: Move[]): Move[] {
  return moves.slice().sort((a, b) => moveOrderScore(b) - moveOrderScore(a));
}

// ============================================================
// Search
// ============================================================

interface SearchContext {
  useQuiescence: boolean;
  nodes: number;
  maxNodes: number;
  deadline: number;
  aborted: boolean;
}

/** Evaluate from the perspective of the side to move. */
function evalSideToMove(chess: Chess): number {
  const w = evalStatic(chess);
  return chess.turn() === "w" ? w : -w;
}

/** Returns true if the soft time/node budget has been exceeded. */
function checkBudget(ctx: SearchContext): boolean {
  if (ctx.nodes > ctx.maxNodes) return true;
  // Date.now() is cheap (~100ns); checking every node keeps the time bound
  // tight even when individual quiescence nodes are slow.
  if (Date.now() > ctx.deadline) return true;
  return false;
}

/**
 * Negamax search with alpha-beta pruning. Returns a score from the
 * perspective of the side to move (positive = side to move is winning).
 *
 * Mate scores are adjusted by `ply` so that faster mates are preferred.
 */
function negamax(
  chess: Chess,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
  ctx: SearchContext,
): number {
  ctx.nodes++;
  if (checkBudget(ctx)) {
    ctx.aborted = true;
    return evalSideToMove(chess);
  }

  // Leaf node: evaluate (with quiescence for "master").
  if (depth === 0) {
    if (ctx.useQuiescence) {
      return quiesce(chess, alpha, beta, MAX_QUIESCENCE_DEPTH, ply, ctx);
    }
    // Cheap checkmate detection at the leaf: only generate moves if in check.
    if (chess.isCheck()) {
      const evasions = chess.moves({ verbose: true });
      if (evasions.length === 0) return -(MATE_SCORE - ply);
    }
    return evalSideToMove(chess);
  }

  // Internal node: full terminal + draw detection.
  const moves = chess.moves({ verbose: true });
  if (moves.length === 0) {
    if (chess.isCheck()) return -(MATE_SCORE - ply); // checkmate
    return 0; // stalemate
  }
  if (
    chess.isInsufficientMaterial() ||
    chess.isDrawByFiftyMoves() ||
    chess.isThreefoldRepetition()
  ) {
    return 0;
  }

  const ordered = orderMoves(moves);
  let best = -Infinity;
  for (const m of ordered) {
    chess.move({ from: m.from, to: m.to, promotion: m.promotion });
    const val = -negamax(chess, depth - 1, -beta, -alpha, ply + 1, ctx);
    chess.undo();
    if (val > best) best = val;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break; // beta cutoff
  }
  return best;
}

/**
 * Quiescence search: extend the search through capture sequences (and
 * check evasions) to avoid the horizon effect. Only capture moves are
 * expanded when not in check; when in check, all evasions are searched
 * because the side to move cannot "stand pat".
 *
 * Limited to {@link MAX_QUIESCENCE_DEPTH} additional plies to prevent
 * search explosion.
 */
function quiesce(
  chess: Chess,
  alpha: number,
  beta: number,
  qdepth: number,
  ply: number,
  ctx: SearchContext,
): number {
  ctx.nodes++;
  if (checkBudget(ctx)) {
    ctx.aborted = true;
    return evalSideToMove(chess);
  }

  if (qdepth === 0) {
    return evalSideToMove(chess);
  }

  const inCheck = chess.isCheck();

  // When in check we must consider every evasion (no stand-pat).
  if (inCheck) {
    const all = chess.moves({ verbose: true });
    if (all.length === 0) {
      return -(MATE_SCORE - ply); // checkmated
    }
    const ordered = orderMoves(all);
    let best = -Infinity;
    for (const m of ordered) {
      chess.move({ from: m.from, to: m.to, promotion: m.promotion });
      const val = -quiesce(chess, -beta, -alpha, qdepth - 1, ply + 1, ctx);
      chess.undo();
      if (val > best) best = val;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  // Not in check: stand-pat + captures only.
  const standPat = evalSideToMove(chess);
  if (standPat >= beta) return beta;
  if (standPat > alpha) alpha = standPat;

  const all = chess.moves({ verbose: true });
  if (all.length === 0) {
    return 0; // stalemate (not in check, no legal moves)
  }
  const captures = all.filter((m) => m.captured !== undefined);
  if (captures.length === 0) {
    return alpha; // quiet position — stand pat
  }

  const ordered = orderMoves(captures);
  for (const m of ordered) {
    chess.move({ from: m.from, to: m.to, promotion: m.promotion });
    const val = -quiesce(chess, -beta, -alpha, qdepth - 1, ply + 1, ctx);
    chess.undo();
    if (val >= beta) return beta;
    if (val > alpha) alpha = val;
  }
  return alpha;
}

// ============================================================
// Public API: findBestMove
// ============================================================

/** Stable string key for a move (used for transposition-style ordering). */
function moveKey(m: Move): string {
  return m.from + m.to + (m.promotion ?? "");
}

/** Build an {@link AIMoveResult} from a verbose move + AI-perspective score. */
function toAIMoveResult(m: Move, score: number): AIMoveResult {
  return {
    from: m.from,
    to: m.to,
    promotion: m.promotion,
    san: m.san,
    score: Math.round(score),
  };
}

/**
 * Pick the best move for the side to move in the given chess.js instance.
 *
 * The passed-in `Chess` instance is NOT mutated — a clone is created from
 * its FEN. `difficulty` controls search depth, randomness, and whether
 * quiescence search is used:
 *
 * - `easy` / `medium`: shallow search with controlled randomness (top-N).
 * - `hard` / `expert` / `master`: deterministic best move via iterative
 *   deepening with alpha-beta pruning. `master` additionally enables
 *   quiescence search. A 2-second soft time budget and 200k-node soft cap
 *   guarantee a timely reply; if exceeded, the best move found so far is
 *   returned.
 *
 * Returns `null` if there are no legal moves (game already over).
 */
export function findBestMove(
  chess: Chess,
  difficulty: Difficulty,
): AIMoveResult | null {
  // Clone so the caller's instance is never mutated.
  const work = new Chess(chess.fen());
  const rootMoves = work.moves({ verbose: true });
  if (rootMoves.length === 0) return null;

  const config = DIFFICULTY_CONFIG[difficulty];
  const ctx: SearchContext = {
    useQuiescence: config.useQuiescence,
    nodes: 0,
    maxNodes: MAX_NODES,
    deadline: Date.now() + TIME_BUDGET_MS,
    aborted: false,
  };

  const orderedRoot = orderMoves(rootMoves);

  // --- Random modes (easy / medium) ---------------------------------------
  // Need exact scores for every root move to pick among the top-N, so the
  // search uses a full window (no root-level pruning) for each move.
  if (config.randomness > 0) {
    const scored: { move: Move; score: number }[] = [];
    for (const m of orderedRoot) {
      work.move({ from: m.from, to: m.to, promotion: m.promotion });
      const val = -negamax(work, config.depth - 1, -Infinity, Infinity, 1, ctx);
      work.undo();
      scored.push({ move: m, score: val });
    }
    scored.sort((a, b) => b.score - a.score);
    const n = Math.min(config.randomness, scored.length);
    const chosen = scored[Math.floor(Math.random() * n)];
    return toAIMoveResult(chosen.move, chosen.score);
  }

  // --- Deterministic modes (hard / expert / master) -----------------------
  // Iterative deepening: search depth 1, 2, … up to config.depth. Each
  // completed iteration improves the move; if a deeper iteration is
  // interrupted by the time/node budget, the previous iteration's best
  // move is kept.
  let bestMove: Move = orderedRoot[0];
  let bestScore = -Infinity;
  const moveScores = new Map<string, number>();

  for (let d = 1; d <= config.depth; d++) {
    if (d > 1) {
      // Reorder root moves by the previous iteration's scores (best first)
      // to improve alpha-beta pruning in the deeper search.
      orderedRoot.sort(
        (a, b) =>
          (moveScores.get(moveKey(b)) ?? -Infinity) -
          (moveScores.get(moveKey(a)) ?? -Infinity),
      );
    }

    let alpha = -Infinity;
    let depthBestMove: Move = orderedRoot[0];
    let depthBestScore = -Infinity;

    for (const m of orderedRoot) {
      work.move({ from: m.from, to: m.to, promotion: m.promotion });
      const val = -negamax(work, d - 1, -Infinity, -alpha, 1, ctx);
      work.undo();
      if (ctx.aborted) break;
      moveScores.set(moveKey(m), val);
      if (val > depthBestScore) {
        depthBestScore = val;
        depthBestMove = m;
      }
      if (val > alpha) alpha = val;
    }

    if (ctx.aborted) break; // keep the best move from the last completed depth
    bestMove = depthBestMove;
    bestScore = depthBestScore;

    // Early exit: a forced mate has been found — no need to search deeper.
    if (bestScore >= MATE_SCORE - 100) break;
  }

  return toAIMoveResult(bestMove, bestScore);
}

// ============================================================
// Public API: quickEvaluate
// ============================================================

/** Format a centipawn score as a human-readable label (e.g. "+1.5", "−0.8"). */
function formatScoreLabel(scoreCp: number): string {
  const abs = Math.abs(scoreCp);
  if (abs < 25) return "Equal";
  const pawns = scoreCp / 100;
  const sign = pawns > 0 ? "+" : "−";
  return `${sign}${Math.abs(pawns).toFixed(1)}`;
}

/**
 * Cheap position evaluation (no search) for the live evaluation bar.
 *
 * Returns a centipawn score from WHITE's perspective plus a human-readable
 * label. Detects checkmate, stalemate, and other draw conditions explicitly.
 * The score combines material, piece-square tables, bishop pair, king safety,
 * and a small mobility bonus.
 */
export function quickEvaluate(chess: Chess): QuickEvaluation {
  if (chess.isCheckmate()) {
    const winner = chess.turn() === "w" ? "black" : "white";
    return {
      scoreCp: 0,
      mateIn: 0,
      label: `Checkmate — ${winner} wins`,
    };
  }
  if (chess.isStalemate()) {
    return { scoreCp: 0, label: "Stalemate — draw" };
  }
  if (chess.isInsufficientMaterial()) {
    return { scoreCp: 0, label: "Draw — insufficient material" };
  }
  if (chess.isThreefoldRepetition()) {
    return { scoreCp: 0, label: "Draw — threefold repetition" };
  }
  if (chess.isDrawByFiftyMoves()) {
    return { scoreCp: 0, label: "Draw — fifty-move rule" };
  }
  if (chess.isDraw()) {
    return { scoreCp: 0, label: "Draw" };
  }

  const raw = evaluatePosition(chess);
  // Clamp so extreme (but non-terminal) material imbalances render sanely.
  const scoreCp = Math.max(-9999, Math.min(9999, Math.round(raw)));
  return { scoreCp, label: formatScoreLabel(scoreCp) };
}

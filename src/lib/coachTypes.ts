/**
 * coachTypes.ts — Shared types for the LLM-powered AI Coach endpoint.
 *
 * The UI imports `CoachResponse` to render the post-game analysis panel,
 * and the `/api/coach` route returns an object matching this shape.
 *
 * @packageDocumentation
 */

/**
 * A single annotated move in the coach's feedback.
 *
 * - `moveNumber` is the full-move number (1, 2, 3, …) — the same number
 *   that appears in PGN notation.
 * - `san` is the move in Standard Algebraic Notation (e.g. `"Nf3+"`,
 *   `"Qxf7#"`). For `mistakes`, this is the move the student actually
 *   played (not the suggested improvement).
 * - `explanation` is a short, human-friendly sentence.
 * - `betterMove` (mistakes only) is the SAN of the move the coach
 *   recommends instead.
 */
export interface CoachMoveNote {
  moveNumber: number;
  san: string;
  explanation: string;
  /** Recommended replacement move (SAN). Present on `mistakes` entries. */
  betterMove?: string;
}

/**
 * Structured coaching feedback for a completed chess game.
 *
 * The `/api/coach` POST endpoint returns this shape on success. When the
 * LLM's response cannot be parsed as JSON, a degraded fallback is returned
 * with the same shape plus a `rawText` field containing the raw model
 * output, so the UI can still display *something* useful.
 */
export interface CoachResponse {
  /** 2–3 sentence overall summary, friendly but honest tone. */
  assessment: string;
  /** Recognized opening name (e.g. `"Italian Game"`), or `"Unknown"`. */
  opening?: string;
  /** One-sentence note about the opening. */
  openingNote?: string;
  /** Exactly 3 of the student's strongest moves with why they were good. */
  strongMoves: CoachMoveNote[];
  /** 2–3 of the student's mistakes / blunders with a suggested improvement. */
  mistakes: CoachMoveNote[];
  /** One specific, actionable piece of advice to practice next. */
  practiceTip: string;
  /** Present only when JSON parsing failed — contains the raw LLM output. */
  rawText?: string;
}

/**
 * Request body accepted by `POST /api/coach`.
 */
export interface CoachRequestBody {
  /** PGN text of the completed game. */
  pgn: string;
  /** Game mode: `"ai"`, `"local"`, etc. */
  mode: string;
  /** AI difficulty id (`"easy" | "medium" | "hard" | "expert" | "master"`) when mode is `"ai"`. */
  difficulty?: string;
  /** Color the student / requestor played as. */
  playerColor: "white" | "black";
  /** Free-form result label, e.g. `"checkmate"`, `"resignation"`, `"draw"`. */
  result: string;
  /** Who won: `"white"`, `"black"`, or `null` for a draw. */
  winner?: string | null;
  /** Number of plies (half-moves) played, as reported by the client. */
  moveCount: number;
  /** Game duration in seconds. */
  durationSec: number;
}

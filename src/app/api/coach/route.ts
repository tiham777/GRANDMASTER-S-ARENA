/**
 * POST /api/coach — LLM-powered post-game chess analysis.
 *
 * Accepts a PGN string + game metadata, replays the game with chess.js to
 * build a clean structured move list (move number, side, SAN, FEN after),
 * asks the z-ai-web-dev-sdk LLM (in the role of an encouraging chess coach)
 * for structured feedback, and returns a `CoachResponse` the UI can render.
 *
 * @packageDocumentation
 */

import { NextRequest, NextResponse } from "next/server";
import { Chess } from "chess.js";
import ZAI from "z-ai-web-dev-sdk";
import type {
  CoachRequestBody,
  CoachMoveNote,
  CoachResponse,
} from "@/lib/coachTypes";

// z-ai-web-dev-sdk relies on Node APIs (fetch, fs for credential discovery,
// etc.) — it must NOT run in the Edge runtime.
export const runtime = "nodejs";

// Give Vercel / the platform a 30s ceiling so the LLM call isn't killed early.
export const maxDuration = 30;

// ============================================================
// Internal types
// ============================================================

/** One entry in the cleaned move list fed to the LLM. */
interface ParsedMove {
  /** Full-move number (1, 2, 3, …). */
  moveNumber: number;
  /** Which color made this move. */
  side: "white" | "black";
  /** SAN, including `+` / `#` markers when applicable. */
  san: string;
  /** FEN of the position immediately after this move. */
  fen: string;
}

/** Result of parsing & replaying the PGN. */
interface ParsedGame {
  moves: ParsedMove[];
  /** True if the final position is checkmate. */
  isCheckmate: boolean;
  /** True if the final position is stalemate. */
  isStalemate: boolean;
  /** True if the final position is a draw (50-move / insufficient / 3-fold). */
  isDraw: boolean;
}

// ============================================================
// PGN parsing
// ============================================================

/**
 * Replay a PGN with chess.js and produce a clean move list + terminal flags.
 *
 * Returns `null` if the PGN cannot be parsed. SAN strings come straight from
 * chess.js (which includes `+` / `#` annotations), and the FEN after each
 * move is taken from the `Move.after` field so the LLM gets exact positions
 * without us having to re-walk the game.
 */
function parsePgn(pgn: string): ParsedGame | null {
  let chess: Chess;
  try {
    chess = new Chess();
    chess.loadPgn(pgn, { strict: false });
  } catch {
    return null;
  }

  const verbose = chess.history({ verbose: true });
  const moves: ParsedMove[] = verbose.map((m, i) => {
    const isWhite = i % 2 === 0;
    // Full-move number: white's k-th move is move k, black's k-th move is also move k.
    const moveNumber = Math.floor(i / 2) + 1;
    return {
      moveNumber,
      side: isWhite ? "white" : "black",
      san: m.san,
      fen: m.after,
    };
  });

  return {
    moves,
    isCheckmate: chess.isCheckmate(),
    isStalemate: chess.isStalemate(),
    isDraw:
      chess.isDraw() ||
      chess.isInsufficientMaterial() ||
      chess.isThreefoldRepetition() ||
      chess.isDrawByFiftyMoves(),
  };
}

/**
 * Compress a long move list into the first 20 + last 20 plies with a note,
 * keeping the prompt under ~4k tokens for very long games.
 */
function compressMoveList(
  moves: ParsedMove[],
): { text: string; truncated: boolean } {
  const HEAD = 20;
  const TAIL = 20;
  if (moves.length <= 80) {
    return { text: formatMoves(moves), truncated: false };
  }
  const first = moves.slice(0, HEAD);
  const last = moves.slice(moves.length - TAIL);
  const middle = moves.length - HEAD - TAIL;
  return {
    text:
      formatMoves(first) +
      `\n… [${middle} plies omitted for brevity] …\n` +
      formatMoves(last),
    truncated: true,
  };
}

/** Render a slice of the move list as compact lines for the LLM. */
function formatMoves(moves: ParsedMove[]): string {
  return moves
    .map(
      (m) =>
        `${m.moveNumber}.${m.side === "white" ? "" : ".."} ${m.san} | FEN: ${m.fen}`,
    )
    .join("\n");
}

// ============================================================
// Prompt construction
// ============================================================

/**
 * Build the coach system prompt. Tells the LLM who it is, who the student is,
 * the game context, and the exact JSON schema to emit.
 */
function buildSystemPrompt(body: CoachRequestBody, game: ParsedGame): string {
  const studentColor = body.playerColor;
  const opponentColor = studentColor === "white" ? "black" : "white";
  const difficultyClause =
    body.mode === "ai" && body.difficulty
      ? `a ${body.difficulty}-difficulty AI`
      : `a ${opponentColor} opponent`;
  const winnerClause = body.winner ? `${body.winner} won` : "the game was a draw";
  const terminationClause = game.isCheckmate
    ? "by checkmate"
    : game.isStalemate
      ? "by stalemate"
      : game.isDraw
        ? "by draw"
        : "";

  return `You are an encouraging but honest chess coach analyzing a student's just-completed game.
The student played as ${studentColor} against ${difficultyClause} in a ${body.mode} game.
The game ended in ${body.result}${winnerClause ? ` (${winnerClause}${terminationClause ? " " + terminationClause : ""})` : ""}.
It lasted ${body.moveCount} plies and ${body.durationSec} seconds.

Your job: analyze the move sequence and provide constructive, specific feedback.
The student's moves are the ${studentColor} moves in the list. Always evaluate from the student's perspective.

You MUST respond with ONLY a single JSON object — no markdown, no code fences, no prose before or after — matching EXACTLY this TypeScript type:

{
  "assessment": string,            // 2-3 sentence overall summary, friendly tone, honest about how the student played
  "opening": string,               // recognized opening name (e.g. "Italian Game", "Sicilian Defense", "French Defense"); "Unknown" if not recognizable from the first few moves
  "openingNote": string,           // one sentence about the opening — main idea or a tip
  "strongMoves": [                 // EXACTLY 3 entries — the student's best moves
    { "moveNumber": number, "san": string, "explanation": string }
  ],
  "mistakes": [                    // 2-3 entries — the student's worst moves; if the student played cleanly, include 1-2 minor inaccuracies and say so
    { "moveNumber": number, "san": string, "explanation": string, "betterMove": string }
  ],
  "practiceTip": string            // one specific, actionable thing to practice next (e.g. a tactic theme, an endgame, an opening line)
}

Rules:
- "moveNumber" is the full-move number (1, 2, 3, …), matching the numbers in the move list.
- "san" in strongMoves/mistakes MUST be one of the STUDENT's actual moves (the ${studentColor} moves), copied verbatim from the list.
- "betterMove" in mistakes is the SAN of the move you recommend instead (it must be legal in the position before the student's move).
- Keep explanations to one sentence each.
- Be warm and specific — avoid generic advice like "develop your pieces".
- Output ONLY the JSON object.`;
}

/** Build the user prompt containing the structured move list. */
function buildUserPrompt(movesText: string, truncated: boolean): string {
  const note = truncated
    ? "\n\nNote: This game was long, so only the first 20 and last 20 plies are shown above (the middle was omitted). Focus your analysis on the shown moves."
    : "";
  return `Here is the complete move list (move number, SAN, and the FEN of the position after each move). The student is the color specified in your instructions.${note}\n\n${movesText}`;
}

// ============================================================
// LLM call + JSON extraction
// ============================================================

/**
 * Strip markdown code fences and extract the first balanced JSON object from
 * a model response. Returns the parsed object or throws on failure.
 */
function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();

  // 1. Try direct parse.
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }

  // 2. Strip ```json ... ``` fences.
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1]);
    } catch {
      // fall through
    }
  }

  // 3. Find the first `{` … last `}` slice and try to parse that.
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const slice = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(slice);
    } catch {
      // fall through
    }
  }

  throw new Error("No JSON object found in LLM response");
}

/** Validate + coerce the parsed LLM payload into a strict `CoachResponse`. */
function coerceCoachResponse(parsed: unknown): CoachResponse | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const p = parsed as Record<string, unknown>;

  const assessment = typeof p.assessment === "string" ? p.assessment : "";
  const opening = typeof p.opening === "string" ? p.opening : undefined;
  const openingNote =
    typeof p.openingNote === "string" ? p.openingNote : undefined;
  const practiceTip = typeof p.practiceTip === "string" ? p.practiceTip : "";
  const strongMoves = coerceMoveNotes(p.strongMoves);
  const mistakes = coerceMoveNotes(p.mistakes);

  if (!assessment || !practiceTip || strongMoves.length === 0) {
    return null;
  }

  return {
    assessment,
    opening,
    openingNote,
    strongMoves,
    mistakes,
    practiceTip,
  };
}

/** Coerce an array of raw move-note objects into typed `CoachMoveNote`s. */
function coerceMoveNotes(raw: unknown): CoachMoveNote[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry === "object" && entry !== null,
    )
    .map((entry) => {
      const moveNumber =
        typeof entry.moveNumber === "number"
          ? entry.moveNumber
          : Number(entry.moveNumber);
      const san = typeof entry.san === "string" ? entry.san : "";
      const explanation =
        typeof entry.explanation === "string" ? entry.explanation : "";
      const betterMove =
        typeof entry.betterMove === "string" ? entry.betterMove : undefined;
      return { moveNumber, san, explanation, betterMove };
    })
    .filter((note) => !Number.isNaN(note.moveNumber) && note.san !== "");
}

// ============================================================
// Route handler
// ============================================================

/**
 * Handle a coaching request.
 *
 * - Validates the JSON body (400 on missing/invalid fields).
 * - Parses the PGN with chess.js (400 on unparseable PGN).
 * - Calls the LLM via z-ai-web-dev-sdk (502 on failure).
 * - Parses the model's JSON output and returns a `CoachResponse`.
 *   If the JSON cannot be parsed, returns a degraded fallback (200) with
 *   the raw text in `rawText`.
 *
 * @example
 * // Request:
 * fetch("/api/coach", {
 *   method: "POST",
 *   headers: { "Content-Type": "application/json" },
 *   body: JSON.stringify({
 *     pgn: "1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6?? 4. Qxf7#",
 *     mode: "ai",
 *     difficulty: "easy",
 *     playerColor: "white",
 *     result: "checkmate",
 *     winner: "white",
 *     moveCount: 7,
 *     durationSec: 45,
 *   }),
 * });
 * // Response (200):
 * // {
 * //   "assessment": "Nice job — you converted a quick Scholar's-Mate-style attack into a clean checkmate. Watch out for early queen development though.",
 * //   "opening": "Italian Game",
 * //   "openingNote": "...",
 * //   "strongMoves": [ { "moveNumber": 3, "san": "Bc4", "explanation": "..." }, ... ],
 * //   "mistakes": [ { "moveNumber": 1, "san": "e4", "explanation": "...", "betterMove": "e4" }, ... ],
 * //   "practiceTip": "..."
 * // }
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Parse + validate body.
  let body: CoachRequestBody;
  try {
    body = (await req.json()) as CoachRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (
    typeof body.pgn !== "string" ||
    body.pgn.trim().length === 0 ||
    typeof body.mode !== "string" ||
    (body.playerColor !== "white" && body.playerColor !== "black") ||
    typeof body.result !== "string" ||
    typeof body.moveCount !== "number" ||
    typeof body.durationSec !== "number"
  ) {
    return NextResponse.json(
      { error: "Missing or invalid fields" },
      { status: 400 },
    );
  }

  // 2. Parse the PGN.
  const game = parsePgn(body.pgn);
  if (!game || game.moves.length === 0) {
    return NextResponse.json({ error: "Could not parse PGN" }, { status: 400 });
  }

  // 3. Build prompts.
  const systemPrompt = buildSystemPrompt(body, game);
  const { text: movesText, truncated } = compressMoveList(game.moves);
  const userPrompt = buildUserPrompt(movesText, truncated);

  // 4. Call the LLM.
  let rawText: string;
  try {
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      thinking: { type: "disabled" },
    });
    rawText = completion.choices[0]?.message?.content ?? "";
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Coach service unavailable", detail },
      { status: 502 },
    );
  }

  if (!rawText.trim()) {
    return NextResponse.json(
      { error: "Coach service unavailable", detail: "Empty LLM response" },
      { status: 502 },
    );
  }

  // 5. Parse + coerce the LLM's JSON.
  let parsed: CoachResponse | null = null;
  try {
    const json = extractJsonObject(rawText);
    parsed = coerceCoachResponse(json);
  } catch {
    parsed = null;
  }

  // 6a. Success — return the structured response.
  if (parsed) {
    return NextResponse.json(parsed);
  }

  // 6b. Fallback — LLM didn't emit valid JSON. Return a degraded response
  // with the raw text so the UI can still display *something*.
  const fallback: CoachResponse = {
    assessment:
      "The coach finished its analysis but couldn't format the feedback as structured data. The raw notes are below — feel free to ask for a re-analysis.",
    opening: "Unknown",
    openingNote: "",
    strongMoves: [],
    mistakes: [],
    practiceTip:
      "Review the move list yourself and look for any captures you missed or pieces you left hanging.",
    rawText,
  };
  return NextResponse.json(fallback);
}

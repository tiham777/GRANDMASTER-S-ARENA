"use client";

/**
 * CapturedPieces — shows pieces captured by each side and the material
 * advantage. Derived from a chess.js board() snapshot.
 */
import { PIECE_GLYPHS, PIECE_VALUES } from "@/lib/chessThemes";
import type { PieceSymbol, Color } from "chess.js";

interface CapturedPiecesProps {
  /** Pieces captured BY white (i.e. black pieces white took). */
  capturedByWhite: PieceSymbol[];
  /** Pieces captured BY black (i.e. white pieces black took). */
  capturedByBlack: PieceSymbol[];
  /** Which side's captures to show. */
  side: "top" | "bottom";
  /** The color of the player whose captures we show. */
  forColor: "w" | "b";
}

const PIECE_ORDER: Record<string, number> = { q: 0, r: 1, b: 2, n: 3, p: 4 };

export function CapturedPieces({
  capturedByWhite,
  capturedByBlack,
  side,
  forColor,
}: CapturedPiecesProps) {
  // The pieces this player has captured = the opponent's pieces taken.
  const captured = forColor === "w" ? capturedByWhite : capturedByBlack;
  // Material balance from this player's perspective.
  const myValue = captured.reduce((sum, p) => sum + (PIECE_VALUES[p] ?? 0), 0);
  const oppCaptured = forColor === "w" ? capturedByBlack : capturedByWhite;
  const oppValue = oppCaptured.reduce((sum, p) => sum + (PIECE_VALUES[p] ?? 0), 0);
  const diff = myValue - oppValue;

  // Sort captured pieces by value descending for nicer display.
  const sorted = [...captured].sort(
    (a, b) => (PIECE_ORDER[a] ?? 9) - (PIECE_ORDER[b] ?? 9),
  );

  return (
    <div className="flex min-h-[20px] items-center gap-0.5">
      {sorted.length === 0 ? (
        <span className="text-xs text-muted-foreground/50">—</span>
      ) : (
        sorted.map((p, i) => (
          <span
            key={i}
            className="text-lg leading-none"
            style={{
              color: forColor === "w" ? "#1c1917" : "#fafaf9",
              textShadow:
                forColor === "w"
                  ? "0 1px 1px rgba(255,255,255,0.2)"
                  : "0 1px 1px rgba(0,0,0,0.5)",
            }}
          >
            {PIECE_GLYPHS[forColor === "w" ? "b" : "w"][p]}
          </span>
        ))
      )}
      {diff > 0 && (
        <span className="ml-1 rounded bg-emerald-500/20 px-1.5 text-xs font-semibold text-emerald-300">
          +{diff}
        </span>
      )}
    </div>
  );
}

/**
 * Compute the lists of captured pieces from the current board state.
 * Compares against the initial piece counts.
 */
export function computeCaptured(board: ReturnType<
  import("chess.js").Chess["board"]
>): { capturedByWhite: PieceSymbol[]; capturedByBlack: PieceSymbol[] } {
  const initial: Record<"w" | "b", Record<string, number>> = {
    w: { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 },
    b: { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 },
  };
  const current: Record<"w" | "b", Record<string, number>> = {
    w: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 },
    b: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 },
  };
  for (const row of board) {
    for (const cell of row) {
      if (cell) {
        const color = cell.color as Color;
        const type = cell.type as PieceSymbol;
        current[color][type] = (current[color][type] ?? 0) + 1;
      }
    }
  }
  // White captured = pieces missing from black's army.
  const capturedByWhite: PieceSymbol[] = [];
  for (const t of ["q", "r", "b", "n", "p"] as PieceSymbol[]) {
    const missing = initial.b[t] - current.b[t];
    for (let i = 0; i < missing; i++) capturedByWhite.push(t);
  }
  const capturedByBlack: PieceSymbol[] = [];
  for (const t of ["q", "r", "b", "n", "p"] as PieceSymbol[]) {
    const missing = initial.w[t] - current.w[t];
    for (let i = 0; i < missing; i++) capturedByBlack.push(t);
  }
  return { capturedByWhite, capturedByBlack };
}

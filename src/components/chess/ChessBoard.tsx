"use client";

/**
 * ChessBoard — themed wrapper around react-chessboard v5.
 *
 * Designed to match the original Grandmaster's Arena board exactly:
 *  - 8px solid border (color = theme's light square), 16px radius
 *  - max-width 560px, aspect-ratio 1
 *  - default SVG piece set (CBurnett) — same as the original
 *  - square highlights: selected (yellow + inset ring), last-move (yellow),
 *    check (red + pulse animation), legal-move dots/rings
 *  - corner coordinates (a-h, 1-8), 10px bold, positioned like the original
 *
 * The board theme is driven by `data-board-theme` on the wrapper element,
 * which sets CSS variables for the light/dark square colors + border color.
 */
import { useMemo } from "react";
import { Chessboard, type ChessboardOptions } from "react-chessboard";
import type { Square } from "chess.js";
import { useChessStore } from "@/lib/chessStore";
import { buildPieces } from "@/lib/chessPieces";

export interface BoardInteraction {
  onPieceDrop?: (sourceSquare: string, targetSquare: string, piece: string) => boolean;
  onSquareClick?: (square: string) => void;
  onSquareRightClick?: (square: string) => void;
}

interface ChessBoardProps extends BoardInteraction {
  fen: string;
  /** Squares to highlight (e.g. selected piece + legal targets). */
  highlightSquares?: Record<string, React.CSSProperties>;
  /** Last move {from,to} for the last-move highlight. */
  lastMove?: { from: string; to: string } | null;
  /** Square of the king in check, for the red radial highlight. */
  checkSquare?: string | null;
  /** Board orientation. */
  boardOrientation?: "white" | "black";
  /** Whether interaction is allowed (false = display-only). */
  interactive?: boolean;
  /** Optional arrows to draw on the board (for hints). */
  arrows?: { startSquare: string; endSquare: string; color: string }[];
  /** Whether to allow the user to draw arrows with shift+drag. */
  allowDrawingArrows?: boolean;
}

export function ChessBoard({
  fen,
  highlightSquares,
  lastMove,
  checkSquare,
  boardOrientation = "white",
  interactive = true,
  onPieceDrop,
  onSquareClick,
  onSquareRightClick,
  arrows,
  allowDrawingArrows = true,
}: ChessBoardProps) {
  const boardTheme = useChessStore((s) => s.boardTheme);
  const pieceSet = useChessStore((s) => s.pieceSet);
  const boardBorder = useChessStore((s) => s.boardBorder);
  const showCoordinates = useChessStore((s) => s.showCoordinates);

  // Merge last-move + check highlights into the highlight squares map,
  // matching the original's exact styles.
  const squareStyles = useMemo(() => {
    const map: Record<string, React.CSSProperties> = { ...(highlightSquares ?? {}) };
    if (lastMove) {
      // Last-move highlight: warm yellow tint (matches original .last-move)
      map[lastMove.from] = {
        ...map[lastMove.from],
        background: "rgba(254, 240, 138, 0.45)",
      };
      map[lastMove.to] = {
        ...map[lastMove.to],
        background: "rgba(254, 240, 138, 0.55)",
      };
    }
    if (checkSquare) {
      // Check highlight: red with pulse — matches original .check + check-pulse
      map[checkSquare] = {
        ...map[checkSquare],
        background: "rgba(239, 68, 68, 0.55)",
        boxShadow: "inset 0 0 0 4px rgba(239, 68, 68, 0.6)",
        animation: "check-pulse 1.2s ease-in-out infinite",
      };
    }
    return map;
  }, [highlightSquares, lastMove, checkSquare]);

  // Build the pieces for the selected set (memoized — only rebuilds when set changes).
  const pieces = useMemo(() => buildPieces(pieceSet), [pieceSet]);

  const options: ChessboardOptions = {
    position: fen,
    boardOrientation,
    // Original Grandmaster's Arena SVG pieces (amber white / stone black,
    // with detail highlights) — matches the original webapp exactly.
    pieces,
    squareStyles,
    darkSquareStyle: { backgroundColor: "var(--board-dark)" },
    lightSquareStyle: { backgroundColor: "var(--board-light)" },
    boardStyle: boardBorder
      ? {
          // With border: 8px theme-colored border + 16px rounded corners
          borderRadius: "16px",
          overflow: "hidden",
          border: "8px solid var(--board-light)",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
          transition: "border-color 0.3s",
        }
      : {
          // Without border: no border, square corners (0 radius)
          borderRadius: "0px",
          overflow: "hidden",
          border: "none",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
        },
    showNotation: showCoordinates,
    animationDurationInMs: 200,
    allowDragging: interactive,
    allowDrawingArrows: interactive && allowDrawingArrows,
    arrows: arrows ?? [],
    darkSquareNotationStyle: {
      color: "rgba(255,255,255,0.55)",
      fontSize: "10px",
      fontWeight: 700,
    },
    lightSquareNotationStyle: {
      color: "rgba(0,0,0,0.5)",
      fontSize: "10px",
      fontWeight: 700,
    },
    onPieceDrop: interactive
      ? ({ sourceSquare, targetSquare }) => {
          if (!onPieceDrop || !targetSquare) return false;
          return onPieceDrop(sourceSquare, targetSquare, "");
        }
      : undefined,
    onSquareClick: interactive
      ? ({ square }) => {
          if (onSquareClick) onSquareClick(square);
        }
      : undefined,
    onSquareRightClick: interactive
      ? ({ square }) => {
          if (onSquareRightClick) onSquareRightClick(square);
        }
      : undefined,
  };

  return (
    <div
      className="chess-board-wrap relative w-full"
      data-board-theme={boardTheme}
    >
      <Chessboard options={options} />
    </div>
  );
}

/**
 * Build the legal-move indicator styles for a set of target squares.
 * Empty squares get a centered dot; occupied squares (captures) get a ring.
 * Matches the original .dot and .ring styles.
 */
export function buildLegalMoveHighlights(
  game: { get: (sq: Square) => { type: string; color: string } | null | false },
  from: Square,
  legalMoves: { to: string }[],
): Record<string, React.CSSProperties> {
  const targets: Record<string, React.CSSProperties> = {};
  for (const m of legalMoves) {
    const occupant = game.get(m.to as Square);
    if (occupant) {
      // Capture ring — matches .ring
      targets[m.to] = {
        background: "radial-gradient(circle, transparent 55%, rgba(244,63,94,0.25) 56%)",
        boxShadow: "inset 0 0 0 4px rgba(244,63,94,0.6)",
        borderRadius: "50%",
      };
    } else {
      // Empty-square dot — matches .dot
      targets[m.to] = {
        background:
          "radial-gradient(circle, rgba(120,53,15,0.35) 0%, rgba(120,53,15,0.35) 28%, transparent 29%)",
      };
    }
  }
  // Selected square highlight — matches .selected
  targets[from] = {
    background: "rgba(251, 191, 36, 0.55)",
    boxShadow: "inset 0 0 0 4px rgba(251, 191, 36, 0.5)",
  };
  return targets;
}

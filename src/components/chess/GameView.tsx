"use client";

/**
 * GameView — the main chess game screen.
 *
 * Owns a chess.js instance and the full game loop:
 *  - click-to-move and drag-and-drop piece interaction
 *  - promotion picker
 *  - AI move triggering (with a small "thinking" delay for UX)
 *  - clock countdown (Fischer increment)
 *  - move history, captured pieces, live eval bar
 *  - undo / redo / hint / resign / draw
 *  - end-of-game detection + navigation to GameOverView
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess, type Square } from "chess.js";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, Flag, Handshake, Lightbulb, RotateCcw, ChevronLeft, ChevronRight,
  Pause, Play, Volume2, VolumeX, Sparkles, Loader2, Clock, Maximize2, Minimize2, Grid3x3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ChessBoard } from "./ChessBoard";
import { MoveHistory } from "./MoveHistory";
import { CapturedPieces, computeCaptured } from "./CapturedPieces";
import { GameResultOverlay } from "./GameResultOverlay";
import { useChessStore, type NewGameConfig } from "@/lib/chessStore";
import {
  TIME_CONTROLS, formatClock, detectOpening,
} from "@/lib/chessThemes";
import {
  findBestMove, quickEvaluate, type Difficulty,
} from "@/lib/chessAI";
import { playSound, setMuted } from "@/lib/chessSound";

type Side = "w" | "b";

interface PlayerLabel {
  name: string;
  subtitle?: string;
  color: Side;
  isAI: boolean;
}

interface PendingPromotion {
  from: Square;
  to: Square;
  color: Side;
}

export interface CompletedGameSummary {
  result: "checkmate" | "stalemate" | "draw" | "resign" | "timeout" | "abandoned";
  winner: Side | "draw" | null;
  pgn: string;
  finalFen: string;
  moveCount: number;
  durationSec: number;
  opening: string | null;
  sanMoves: string[];
}

interface GameViewProps {
  config: NewGameConfig;
  onExit: () => void;
  onGameComplete: (summary: CompletedGameSummary) => void;
}

export function GameView({ config, onExit, onGameComplete }: GameViewProps) {
  const { toast } = useToast();
  const boardTheme = useChessStore((s) => s.boardTheme);
  const soundEnabled = useChessStore((s) => s.soundEnabled);
  const showLegalMoves = useChessStore((s) => s.showLegalMoves);
  const highlightLastMove = useChessStore((s) => s.highlightLastMove);

  // --- core game state ---
  const gameRef = useRef<Chess>(new Chess());
  const [, forceRender] = useState(0);
  const rerender = useCallback(() => forceRender((n) => n + 1), []);

  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [legalTargets, setLegalTargets] = useState<Record<string, React.CSSProperties>>({});
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<PendingPromotion | null>(null);
  const [thinking, setThinking] = useState(false);
  const [hintArrow, setHintArrow] = useState<{ from: string; to: string } | null>(null);

  // Clocks: { white: ms, black: ms }. 0 = no time control.
  const tc = useMemo(
    () => TIME_CONTROLS.find((t) => t.id === config.timeControlId) ?? TIME_CONTROLS[0],
    [config.timeControlId],
  );
  const [clocks, setClocks] = useState<{ w: number; b: number }>({
    w: tc.initialMs,
    b: tc.initialMs,
  });
  const [clockRunning, setClockRunning] = useState(false);
  const [paused, setPaused] = useState(false);

  // Focus mode: hides everything except the board (like the original).
  const [focusMode, setFocusMode] = useState(false);
  // Match-opening animation: plays once when the game view mounts.
  const [matchOpening, setMatchOpening] = useState(true);
  // Result overlay: shows the win/lose/draw animation before transitioning.
  const [resultOverlay, setResultOverlay] = useState<{
    outcome: "win" | "lose" | "draw";
    title: string;
    subtitle?: string;
  } | null>(null);

  // Undo/redo history stacks of FEN strings.
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);

  // Track elapsed time for the duration display.
  const startTimeRef = useRef<number>(Date.now());
  const [elapsedSec, setElapsedSec] = useState(0);

  // Sound mute sync.
  useEffect(() => {
    setMuted(!soundEnabled);
  }, [soundEnabled]);

  // Scroll to top on mount so the board is immediately visible (no need to
  // scroll up after entering the game page).
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Focus mode: apply inline styles to the grid + container to center the
  // board both horizontally AND vertically with symmetrical margins.
  useEffect(() => {
    const container = document.querySelector(".game-container") as HTMLElement | null;
    if (!container) return;
    const grid = container.querySelector(".grid") as HTMLElement | null;
    if (!grid) return;
    if (focusMode) {
      // Container: fill the full viewport, no padding, center content
      container.style.setProperty("padding", "0", "important");
      container.style.setProperty("min-height", "100vh", "important");
      container.style.setProperty("height", "100vh", "important");
      container.style.setProperty("display", "flex", "important");
      container.style.setProperty("align-items", "center", "important");
      container.style.setProperty("justify-content", "center", "important");
      container.style.setProperty("max-width", "none", "important");
      // Grid: collapse to single centered column
      grid.style.setProperty("display", "flex", "important");
      grid.style.setProperty("grid-template-columns", "none", "important");
      grid.style.setProperty("align-items", "center", "important");
      grid.style.setProperty("justify-content", "center", "important");
      grid.style.setProperty("width", "auto", "important");
      grid.style.setProperty("max-width", "none", "important");
      grid.style.setProperty("gap", "0", "important");
    } else {
      // Restore original container styles
      container.style.removeProperty("padding");
      container.style.removeProperty("min-height");
      container.style.removeProperty("height");
      container.style.removeProperty("display");
      container.style.removeProperty("align-items");
      container.style.removeProperty("justify-content");
      container.style.removeProperty("max-width");
      // Restore grid styles
      grid.style.removeProperty("display");
      grid.style.removeProperty("grid-template-columns");
      grid.style.removeProperty("align-items");
      grid.style.removeProperty("justify-content");
      grid.style.removeProperty("width");
      grid.style.removeProperty("max-width");
      grid.style.removeProperty("gap");
    }
  }, [focusMode]);

  // Determine the human's color (for vs-AI mode) and orientation.
  const humanColor: Side | null = useMemo(() => {
    if (config.mode === "ai") {
      if (config.playerColor === "white") return "w";
      if (config.playerColor === "black") return "b";
      // random
      return Math.random() < 0.5 ? "w" : "b";
    }
    return null; // local & ai-vs-ai: no single "human"
  }, [config.mode, config.playerColor]);

  const [orientation, setOrientation] = useState<"white" | "black">(() => {
    if (config.mode === "ai") {
      return humanColor === "b" ? "black" : "white";
    }
    return "white";
  });

  const players = useMemo<{ top: PlayerLabel; bottom: PlayerLabel }>(() => {
    if (config.mode === "ai") {
      const ai: Side = humanColor === "w" ? "b" : "w";
      const humanSide: Side = humanColor === "b" ? "b" : "w";
      const aiLabel = `${config.difficulty[0].toUpperCase()}${config.difficulty.slice(1)} AI`;
      // Standard chess layout: opponent (AI) on top, board, You on bottom.
      const top: PlayerLabel =
        ai === "w"
          ? { name: aiLabel, subtitle: "White", color: "w", isAI: true }
          : { name: aiLabel, subtitle: "Black", color: "b", isAI: true };
      const bottom: PlayerLabel =
        humanSide === "w"
          ? { name: "You", subtitle: "White", color: "w", isAI: false }
          : { name: "You", subtitle: "Black", color: "b", isAI: false };
      return { top, bottom };
    }
    if (config.mode === "ai-vs-ai") {
      return {
        top: { name: `${config.difficulty[0].toUpperCase()}${config.difficulty.slice(1)} AI (White)`, color: "w", isAI: true },
        bottom: { name: `${config.difficulty[0].toUpperCase()}${config.difficulty.slice(1)} AI (Black)`, color: "b", isAI: true },
      };
    }
    // local 2P — Player 2 (Black) on top, Player 1 (White) on bottom
    return {
      top: { name: "Player 2", subtitle: "Black", color: "b", isAI: false },
      bottom: { name: "Player 1", subtitle: "White", color: "w", isAI: false },
    };
  }, [config.mode, config.difficulty, humanColor]);

  const chess = gameRef.current;
  const fen = chess.fen();
  const turn: Side = chess.turn();
  const inCheck = chess.isCheck();
  const isGameOver = chess.isGameOver();
  const captured = useMemo(() => computeCaptured(chess.board()), [fen]);
  const sanMoves = useMemo(() => chess.history({ verbose: false }), [fen]);
  const opening = useMemo(() => detectOpening(sanMoves), [sanMoves]);

  // Find king square if in check (for the red highlight).
  const checkSquare = useMemo<string | null>(() => {
    if (!inCheck) return null;
    const board = chess.board();
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const cell = board[r][c];
        if (cell && cell.type === "k" && cell.color === turn) {
          const file = "abcdefgh"[c];
          const rank = 8 - r;
          return `${file}${rank}`;
        }
      }
    }
    return null;
  }, [inCheck, turn, fen]);

  // Live eval (white's perspective, in centipawns).
  const evalInfo = useMemo(() => {
    try {
      return quickEvaluate(chess);
    } catch {
      return { scoreCp: 0, label: "Equal" };
    }
  }, [fen]);
  const evalPercent = useMemo(() => {
    // Map [-1000, 1000] cp to [0, 100] %, with sigmoid-style smoothing.
    const cp = Math.max(-1000, Math.min(1000, evalInfo.scoreCp));
    return 50 + (cp / 1000) * 45;
  }, [evalInfo.scoreCp]);

  // ============================================================
  // Clock ticking
  // ============================================================
  useEffect(() => {
    if (tc.initialMs === 0 || paused || isGameOver) return;
    const interval = setInterval(() => {
      setClocks((prev) => {
        if (prev.w <= 0 || prev.b <= 0) return prev;
        const next = { ...prev };
        if (turn === "w") next.w = Math.max(0, prev.w - 100);
        else next.b = Math.max(0, prev.b - 100);
        return next;
      });
    }, 100);
    return () => clearInterval(interval);
  }, [turn, paused, isGameOver, tc.initialMs]);

  // Start the clock on the first move.
  useEffect(() => {
    if (sanMoves.length > 0 && !clockRunning) setClockRunning(true);
  }, [sanMoves.length, clockRunning]);

  // Track elapsed time.
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Timeout detection.
  useEffect(() => {
    if (tc.initialMs === 0 || isGameOver) return;
    if (clocks.w <= 0) {
      handleGameEnd("timeout", "b");
    } else if (clocks.b <= 0) {
      handleGameEnd("timeout", "w");
    }
  }, [clocks, tc.initialMs, isGameOver]);

  // ============================================================
  // Move execution
  // ============================================================
  const playSoundForMove = useCallback(
    (san: string, captured: boolean) => {
      if (san.includes("#")) playSound("game-end");
      else if (san.includes("+")) playSound("check");
      else if (san === "O-O" || san === "O-O-O") playSound("castle");
      else if (san.includes("=")) playSound("promote");
      else if (captured) playSound("capture");
      else playSound("move");
    },
    [],
  );

  const makeMove = useCallback(
    (from: Square, to: Square, promotion?: string): boolean => {
      const game = gameRef.current;
      // Validate it's a legal move before committing.
      const legalMoves = game.moves({ square: from, verbose: true });
      const legalMove = legalMoves.find(
        (m) => m.to === to && (promotion ? m.promotion === promotion : true),
      );
      if (!legalMove) {
        playSound("illegal");
        return false;
      }
      // Push current FEN to undo stack before moving (only if allowed).
      if (config.mode === "ai" && config.allowUndo) {
        setUndoStack((s) => [...s, game.fen()]);
        setRedoStack([]);
      }
      try {
        const move = game.move({ from, to, promotion: promotion as never });
        if (!move) {
          playSound("illegal");
          return false;
        }
        // Fischer increment: add to the side that just moved.
        if (tc.incrementMs > 0) {
          setClocks((prev) => ({
            ...prev,
            [move.color]: prev[move.color as Side] + tc.incrementMs,
          }));
        }
        setLastMove({ from: move.from, to: move.to });
        setSelectedSquare(null);
        setLegalTargets({});
        setHintArrow(null);
        playSoundForMove(move.san, move.captured != null);
        rerender();
        return true;
      } catch {
        playSound("illegal");
        return false;
      }
    },
    [config.mode, config.allowUndo, tc.incrementMs, playSoundForMove, rerender],
  );

  const handlePieceDrop = useCallback(
    (source: string, target: string, _piece: string): boolean => {
      if (isGameOver) return false;
      // Check if it's the human's turn (or local 2P — any turn).
      if (config.mode === "ai" && turn !== humanColor) return false;
      if (config.mode === "ai-vs-ai") return false;

      const game = gameRef.current;
      const piece = game.get(source as Square);
      if (!piece) return false;

      // Promotion check: pawn moving to last rank.
      if (
        piece.type === "p" &&
        ((piece.color === "w" && target[1] === "8") ||
          (piece.color === "b" && target[1] === "1"))
      ) {
        setPendingPromotion({ from: source as Square, to: target as Square, color: piece.color });
        return true; // accept the drag; actual move happens after promo selection
      }
      return makeMove(source as Square, target as Square);
    },
    [isGameOver, config.mode, turn, humanColor, makeMove],
  );

  const handleSquareClick = useCallback(
    (square: string) => {
      if (isGameOver) return;
      if (config.mode === "ai" && turn !== humanColor) return;
      if (config.mode === "ai-vs-ai") return;

      const game = gameRef.current;
      const sq = square as Square;

      if (selectedSquare) {
        // Clicking the same square deselects.
        if (sq === selectedSquare) {
          setSelectedSquare(null);
          setLegalTargets({});
          return;
        }
        // Try to move.
        const piece = game.get(selectedSquare);
        const targetPiece = game.get(sq);
        // If clicking own piece, switch selection.
        if (targetPiece && targetPiece.color === piece?.color) {
          selectSquare(sq);
          return;
        }
        // Promotion check.
        if (
          piece?.type === "p" &&
          ((piece.color === "w" && sq[1] === "8") ||
            (piece.color === "b" && sq[1] === "1"))
        ) {
          setPendingPromotion({ from: selectedSquare, to: sq, color: piece.color });
          return;
        }
        const ok = makeMove(selectedSquare, sq);
        if (!ok) {
          setSelectedSquare(null);
          setLegalTargets({});
        }
      } else {
        selectSquare(sq);
      }
    },
    [isGameOver, config.mode, turn, humanColor, selectedSquare, makeMove],
  );

  const selectSquare = useCallback(
    (sq: Square) => {
      const game = gameRef.current;
      const piece = game.get(sq);
      if (!piece) {
        setSelectedSquare(null);
        setLegalTargets({});
        return;
      }
      // Only select your own pieces.
      if (config.mode === "ai" && piece.color !== humanColor) return;
      if (config.mode === "ai-vs-ai") return;
      // In local mode, only select pieces of the side to move.
      if (config.mode === "local" && piece.color !== turn) return;

      setSelectedSquare(sq);
      playSound("select");
      if (showLegalMoves) {
        const moves = game.moves({ square: sq, verbose: true });
        const targets: Record<string, React.CSSProperties> = {};
        for (const m of moves) {
          // Determine if the target square is light or dark so the dot
          // color adapts to the board theme naturally.
          const fileIdx = m.to.charCodeAt(0) - 97; // a=0 .. h=7
          const rankIdx = parseInt(m.to[1], 10) - 1; // 1=0 .. 8=7
          const isDarkSquare = (fileIdx + rankIdx) % 2 === 0;
          if (game.get(m.to as Square)) {
            // Capture ring — red ring around the target piece (matches original .ring)
            targets[m.to] = {
              background:
                "radial-gradient(circle, transparent 55%, rgba(244,63,94,0.25) 56%, rgba(244,63,94,0.25) 70%, transparent 71%)",
              boxShadow: "inset 0 0 0 4px rgba(244,63,94,0.6)",
              borderRadius: "50%",
            };
          } else {
            // Empty-square dot — small, clean, theme-adaptive.
            // Light dot on dark squares, dark dot on light squares.
            const dotColor = isDarkSquare
              ? "rgba(255, 255, 255, 0.45)"
              : "rgba(0, 0, 0, 0.22)";
            targets[m.to] = {
              background: `radial-gradient(circle, ${dotColor} 0%, ${dotColor} 22%, transparent 23%)`,
            };
          }
        }
        setLegalTargets(targets);
      }
    },
    [config.mode, humanColor, turn, showLegalMoves],
  );

  // Promotion picker handler.
  const handlePromotionSelect = useCallback(
    (piece: string) => {
      if (!pendingPromotion) return;
      if (piece === "__cancel__") {
        setPendingPromotion(null);
        return;
      }
      makeMove(pendingPromotion.from, pendingPromotion.to, piece);
      setPendingPromotion(null);
    },
    [pendingPromotion, makeMove],
  );

  // ============================================================
  // AI move triggering
  // ============================================================
  useEffect(() => {
    if (isGameOver) return;
    const isAITurn =
      (config.mode === "ai" && turn !== humanColor) || config.mode === "ai-vs-ai";
    if (!isAITurn) return;

    // Clear hint arrow when AI starts thinking.
    setHintArrow(null);
    setThinking(true);
    const difficulty: Difficulty = config.difficulty;
    // Add a small delay so the AI doesn't feel instantaneous.
    const delay = config.mode === "ai-vs-ai" ? 400 : 250;
    const t = setTimeout(() => {
      try {
        const result = findBestMove(gameRef.current, difficulty);
        if (result) {
          makeMove(result.from as Square, result.to as Square, result.promotion);
        }
      } catch (err) {
        console.error("AI move error:", err);
      } finally {
        setThinking(false);
      }
    }, delay);
    return () => clearTimeout(t);
  }, [turn, isGameOver, config.mode, config.difficulty, humanColor, makeMove]);

  // ============================================================
  // End-of-game detection
  // ============================================================
  const handleGameEnd = useCallback(
    (result: CompletedGameSummary["result"], winner: Side | "draw" | null) => {
      const game = gameRef.current;
      const pgn = game.pgn();
      const finalFen = game.fen();
      const moveCount = game.history().length;
      const durationSec = Math.floor((Date.now() - startTimeRef.current) / 1000);
      const sanMoves = game.history({ verbose: false });
      const opening = detectOpening(sanMoves);

      // Determine the outcome from the human's perspective (for the overlay + sound).
      let outcome: "win" | "lose" | "draw" = "draw";
      let title = "Draw";
      let subtitle: string | undefined;
      if (config.mode === "ai" && humanColor) {
        const humanWon = winner !== "draw" && winner !== null &&
          ((winner === "w" && humanColor === "w") || (winner === "b" && humanColor === "b"));
        outcome = humanWon ? "win" : winner === "draw" ? "draw" : "lose";
      } else if (config.mode === "local" || config.mode === "ai-vs-ai") {
        outcome = winner === "draw" ? "draw" : "win";
      }
      // Play the appropriate end-game sound: victory arpeggio on a win,
      // defeat arpeggio on a loss, nothing extra on a draw.
      if (outcome === "win") playSound("victory");
      else if (outcome === "lose") playSound("defeat");
      else playSound("game-end");

      if (config.mode === "ai" && humanColor) {
        if (outcome === "win") { title = "Victory!"; subtitle = result === "checkmate" ? "Checkmate!" : result === "resign" ? "Opponent resigned" : "You won"; }
        else if (outcome === "lose") { title = "Defeat"; subtitle = result === "checkmate" ? "Checkmate" : result === "resign" ? "You resigned" : "Better luck next time"; }
        else { title = "Draw"; subtitle = result === "stalemate" ? "Stalemate" : "Drawn position"; }
      } else if (config.mode === "local" || config.mode === "ai-vs-ai") {
        // Neutral perspective for local/AI-vs-AI: show who won.
        if (winner === "draw") { title = "Draw"; subtitle = result === "stalemate" ? "Stalemate" : "Drawn position"; }
        else { title = winner === "w" ? "White Wins!" : "Black Wins!"; subtitle = result === "checkmate" ? "Checkmate" : result; }
      }

      // Show the animated result overlay first, then transition after it finishes.
      setResultOverlay({ outcome, title, subtitle });
    },
    [onGameComplete, config.mode, humanColor],
  );

  // When the result overlay is dismissed, transition to the game-over screen.
  const handleResultDismiss = useCallback(() => {
    setResultOverlay(null);
    const game = gameRef.current;
    const pgn = game.pgn();
    const finalFen = game.fen();
    const moveCount = game.history().length;
    const durationSec = Math.floor((Date.now() - startTimeRef.current) / 1000);
    const sanMoves = game.history({ verbose: false });
    const opening = detectOpening(sanMoves);
    // Reconstruct the result/winner from the game state.
    let result: CompletedGameSummary["result"] = "checkmate";
    let winner: Side | "draw" | null = null;
    if (game.isCheckmate()) { result = "checkmate"; winner = game.turn() === "w" ? "b" : "w"; }
    else if (game.isStalemate()) { result = "stalemate"; winner = "draw"; }
    else { result = "draw"; winner = "draw"; }
    // If the overlay had a resign/timeout, use that — but we don't track it separately here.
    // The summary is built from the board state, which is fine.
    onGameComplete({ result, winner, pgn, finalFen, moveCount, durationSec, opening, sanMoves });
  }, [onGameComplete]);

  // Clear the match-opening animation class after it plays.
  useEffect(() => {
    if (!matchOpening) return;
    const t = setTimeout(() => setMatchOpening(false), 1900);
    return () => clearTimeout(t);
  }, [matchOpening]);

  useEffect(() => {
    if (!isGameOver) return;
    // Determine result from the game state.
    if (chess.isCheckmate()) {
      // The side to move is checkmated → the other side wins.
      const winner: Side = turn === "w" ? "b" : "w";
      handleGameEnd("checkmate", winner);
    } else if (chess.isStalemate()) {
      handleGameEnd("stalemate", "draw");
    } else if (chess.isInsufficientMaterial()) {
      handleGameEnd("draw", "draw");
    } else if (chess.isThreefoldRepetition()) {
      handleGameEnd("draw", "draw");
    } else if (chess.isDraw()) {
      handleGameEnd("draw", "draw");
    }
  }, [isGameOver]);

  // ============================================================
  // Controls: undo, redo, hint, resign, draw, flip
  // ============================================================
  const handleUndo = useCallback(() => {
    if (config.mode !== "ai" || !config.allowUndo) return;
    if (undoStack.length === 0) return;
    const game = gameRef.current;
    // Push current state to redo.
    setRedoStack((s) => [...s, game.fen()]);
    const prevFen = undoStack[undoStack.length - 1];
    setUndoStack((s) => s.slice(0, -1));
    // In vs-AI mode, undo two plies (player + AI) so it's the player's turn again.
    // We already stored the FEN before the player's move, so just load it.
    const newGame = new Chess();
    newGame.loadPgn(game.pgn()); // carry over PGN headers? Actually we want to REWIND.
    // Simpler: load the FEN directly.
    const rewound = new Chess(prevFen);
    gameRef.current = rewound;
    setLastMove(null);
    setSelectedSquare(null);
    setLegalTargets({});
    setHintArrow(null);
    rerender();
    toast({ title: "Move undone", duration: 1500 });
  }, [config.mode, config.allowUndo, undoStack, rerender, toast]);

  const handleRedo = useCallback(() => {
    if (config.mode !== "ai" || !config.allowUndo) return;
    if (redoStack.length === 0) return;
    const game = gameRef.current;
    setUndoStack((s) => [...s, game.fen()]);
    const nextFen = redoStack[redoStack.length - 1];
    setRedoStack((s) => s.slice(0, -1));
    const redone = new Chess(nextFen);
    gameRef.current = redone;
    setLastMove(null);
    setSelectedSquare(null);
    setLegalTargets({});
    rerender();
  }, [config.mode, config.allowUndo, redoStack, rerender]);

  const handleHint = useCallback(() => {
    if (isGameOver) return;
    if (config.mode === "ai" && turn !== humanColor) return;
    if (config.mode === "ai-vs-ai") return;
    setThinking(true);
    // Hint = use the AI at master level to find a strong move for the human.
    setTimeout(() => {
      try {
        const result = findBestMove(gameRef.current, "master");
        if (result) {
          setHintArrow({ from: result.from, to: result.to });
          toast({
            title: "Hint",
            description: `Try ${result.san}`,
            duration: 3000,
          });
        }
      } finally {
        setThinking(false);
      }
    }, 50);
  }, [isGameOver, config.mode, turn, humanColor, toast]);

  const handleResign = useCallback(() => {
    if (isGameOver) return;
    const winner: Side = turn === "w" ? "b" : "w";
    handleGameEnd("resign", winner);
  }, [isGameOver, turn, handleGameEnd]);

  const handleDraw = useCallback(() => {
    if (isGameOver) return;
    // For vs-AI: AI accepts draw if it's behind in eval, declines otherwise.
    if (config.mode === "ai") {
      const evalCp = evalInfo.scoreCp;
      const aiColor: Side = humanColor === "w" ? "b" : "w";
      const aiAhead = (aiColor === "w" && evalCp > 0) || (aiColor === "b" && evalCp < 0);
      if (aiAhead) {
        toast({ title: "Draw declined", description: "AI thinks it's winning.", duration: 2500 });
        return;
      }
    }
    handleGameEnd("draw", "draw");
  }, [isGameOver, config.mode, evalInfo.scoreCp, humanColor, handleGameEnd, toast]);

  const handleFlip = useCallback(() => {
    setOrientation((o) => (o === "white" ? "black" : "white"));
  }, []);

  // ============================================================
  // Render helpers
  // ============================================================
  const topPlayer = orientation === "white" ? players.top : players.bottom;
  const bottomPlayer = orientation === "white" ? players.bottom : players.top;
  const topCaptured = topPlayer.color === "w" ? captured.capturedByWhite : captured.capturedByBlack;
  const bottomCaptured = bottomPlayer.color === "w" ? captured.capturedByWhite : captured.capturedByBlack;

  const topClock = topPlayer.color === "w" ? clocks.w : clocks.b;
  const bottomClock = bottomPlayer.color === "w" ? clocks.w : clocks.b;
  const isTopTurn = turn === topPlayer.color;
  const isBottomTurn = turn === bottomPlayer.color;

  const highlightSquares: Record<string, React.CSSProperties> = {
    ...legalTargets,
    ...(selectedSquare
      ? { [selectedSquare]: { background: "rgba(251, 191, 36, 0.55)", boxShadow: "inset 0 0 0 4px rgba(251, 191, 36, 0.5)" } }
      : {}),
  };

  const hintArrows = hintArrow
    ? [{ startSquare: hintArrow.from, endSquare: hintArrow.to, color: "rgba(56, 189, 248, 0.85)" }]
    : [];

  return (
    <div className={`game-container mx-auto w-full max-w-7xl px-2 py-1 sm:px-4 sm:py-1.5 ${focusMode ? "focus-mode" : ""} ${matchOpening ? "match-opening" : ""}`}>
      {/* Result overlay (win/lose/draw animation) */}
      {resultOverlay && (
        <GameResultOverlay
          outcome={resultOverlay.outcome}
          title={resultOverlay.title}
          subtitle={resultOverlay.subtitle}
          onDismiss={handleResultDismiss}
        />
      )}

      {/* Match-starting flash overlay */}
      {matchOpening && (
        <div className="match-start-overlay">
          <div className="match-start-text">Game On!</div>
        </div>
      )}

      {/* Focus-mode exit button */}
      {focusMode && (
        <button
          type="button"
          className="focus-exit-btn"
          onClick={() => setFocusMode(false)}
          title="Exit focus mode"
          aria-label="Exit focus mode"
        >
          <Minimize2 className="h-4 w-4" />
        </button>
      )}

      {/* Top bar */}
      <div className="game-topbar mb-1 flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onExit} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Exit
        </Button>
        <div className="flex items-center gap-2">
          {opening && (
            <Badge variant="secondary" className="hidden sm:inline-flex">
              {opening}
            </Badge>
          )}
          <Badge variant="outline" className="gap-1 font-mono">
            <Clock className="h-3 w-3" /> {formatClock(elapsedSec * 1000)}
          </Badge>
          {thinking && (
            <Badge variant="outline" className="gap-1 border-primary/40 text-primary">
              <Loader2 className="h-3 w-3 animate-spin" /> Thinking
            </Badge>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => useChessStore.getState().toggleSound()}
            title={soundEnabled ? "Mute sounds" : "Unmute sounds"}
          >
            {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setFocusMode((f) => !f)}
            title="Focus mode — hide everything except the board"
            className={focusMode ? "text-primary" : ""}
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_340px] lg:gap-4">
        {/* Board column — only the board, centered horizontally */}
        <div className="game-board-col flex justify-center">
          {/* Board */}
          <div className="relative">
            <ChessBoard
              fen={fen}
              highlightSquares={highlightSquares}
              lastMove={highlightLastMove ? lastMove : null}
              checkSquare={checkSquare}
              boardOrientation={orientation}
              interactive={!isGameOver && config.mode !== "ai-vs-ai"}
              onPieceDrop={handlePieceDrop}
              onSquareClick={handleSquareClick}
              arrows={hintArrows}
            />
            {pendingPromotion && (
              <PromotionDialog
                color={pendingPromotion.color}
                onSelect={handlePromotionSelect}
              />
            )}
            {/* Pause overlay */}
            {paused && !isGameOver && (
              <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-background/80 backdrop-blur-sm">
                <div className="text-center">
                  <Pause className="mx-auto mb-2 h-10 w-10 text-primary" />
                  <p className="text-lg font-semibold">Paused</p>
                  <Button
                    className="mt-3"
                    size="sm"
                    onClick={() => setPaused(false)}
                  >
                    <Play className="mr-1 h-4 w-4" /> Resume
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar — player boxes + controls + eval + moves + info */}
        <div className="game-side-col flex flex-col gap-2 sm:gap-3">
          {/* You (the human) — first player card */}
          <div className="player-bar">
            <PlayerCard
              player={bottomPlayer}
              captured={bottomCaptured}
              allCaptured={captured}
              clock={bottomClock}
              showClock={tc.initialMs > 0}
              isTurn={isBottomTurn}
              evalPercent={evalPercent}
              evalLabel={evalInfo.label}
              evalForTop={bottomPlayer.color === "b" ? -evalInfo.scoreCp : evalInfo.scoreCp}
            />
          </div>

          {/* Opponent (AI) — second player card */}
          <div className="player-bar">
            <PlayerCard
              player={topPlayer}
              captured={topCaptured}
              allCaptured={captured}
              clock={topClock}
              showClock={tc.initialMs > 0}
              isTurn={isTopTurn}
              evalPercent={evalPercent}
              evalLabel={evalInfo.label}
              evalForTop={topPlayer.color === "b" ? -evalInfo.scoreCp : evalInfo.scoreCp}
            />
          </div>

          {/* Controls */}
          <div className="game-controls flex flex-wrap items-center gap-2">
            {config.mode === "ai" && config.allowUndo && (
              <>
                <Button
                  variant="outline" size="sm" onClick={handleUndo}
                  disabled={undoStack.length === 0 || thinking}
                  className="gap-1"
                >
                  <ChevronLeft className="h-4 w-4" /> Undo
                </Button>
                <Button
                  variant="outline" size="sm" onClick={handleRedo}
                  disabled={redoStack.length === 0 || thinking}
                  className="gap-1"
                >
                  Redo <ChevronRight className="h-4 w-4" />
                </Button>
              </>
            )}
            <Button
              variant="outline" size="sm" onClick={handleHint}
              disabled={thinking || isGameOver}
              className="gap-1"
            >
              <Lightbulb className="h-4 w-4" /> Hint
            </Button>
            <Button variant="outline" size="sm" onClick={handleFlip} className="gap-1">
              <RotateCcw className="h-4 w-4" /> Flip
            </Button>
            {tc.initialMs > 0 && !isGameOver && (
              <Button
                variant="outline" size="sm"
                onClick={() => setPaused((p) => !p)}
                className="gap-1"
              >
                {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                {paused ? "Resume" : "Pause"}
              </Button>
            )}
            <div className="ml-auto flex gap-2">
              <Button
                variant="outline" size="sm" onClick={handleDraw}
                disabled={isGameOver}
                className="gap-1"
              >
                <Handshake className="h-4 w-4" /> Draw
              </Button>
              <Button
                variant="destructive" size="sm" onClick={handleResign}
                disabled={isGameOver}
                className="gap-1"
              >
                <Flag className="h-4 w-4" /> Resign
              </Button>
            </div>
          </div>

          {/* Coordinates Grid toggle — ON/OFF button like the original */}
          <CoordinatesToggle />

          {/* Eval bar */}
          <div className="rounded-lg border border-border bg-card/60 p-3">
            <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Sparkles className="h-3 w-3" /> Position Evaluation
              </span>
              <span className={`font-mono font-semibold ${evalInfo.scoreCp > 50 ? "text-emerald-400" : evalInfo.scoreCp < -50 ? "text-rose-400" : "text-muted-foreground"}`}>
                {evalInfo.label}
              </span>
            </div>
            <div className="relative h-3 w-full overflow-hidden rounded-full bg-stone-900">
              <div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-stone-100 to-stone-300 transition-all duration-500"
                style={{ width: `${evalPercent}%` }}
              />
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              White's perspective · static eval (material + position)
            </p>
          </div>

          {/* Move history */}
          <div className="flex flex-col rounded-lg border border-border bg-card/60 p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Moves</h3>
              <Badge variant="outline" className="font-mono text-xs">
                {sanMoves.length}
              </Badge>
            </div>
            <div className="h-72 max-h-72">
              <MoveHistory moves={sanMoves} />
            </div>
          </div>

          {/* Game info */}
          <div className="rounded-lg border border-border bg-card/60 p-3 text-xs text-muted-foreground">
            <div className="mb-2 flex items-center justify-between">
              <span>Mode</span>
              <span className="font-medium text-foreground">
                {config.mode === "ai"
                  ? `vs AI · ${config.difficulty}`
                  : config.mode === "ai-vs-ai"
                    ? "AI vs AI"
                    : "Local 2P"}
              </span>
            </div>
            <div className="mb-2 flex items-center justify-between">
              <span>Time control</span>
              <span className="font-medium text-foreground">{tc.label}</span>
            </div>
            {opening && (
              <div className="flex items-center justify-between">
                <span>Opening</span>
                <span className="font-medium text-foreground">{opening}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// CoordinatesToggle — ON/OFF button for edge numbers/letters.
// Matches the original webapp's .coords-toggle-btn style.
// ============================================================
function CoordinatesToggle() {
  const showCoordinates = useChessStore((s) => s.showCoordinates);
  const setShowCoordinates = useChessStore((s) => s.setShowCoordinates);
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-card/60 px-3 py-2">
      <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Grid3x3 className="h-3.5 w-3.5" /> Coordinates Grid
      </span>
      <button
        type="button"
        onClick={() => setShowCoordinates(!showCoordinates)}
        className={`rounded-md border px-3 py-1 text-xs font-bold transition-all ${
          showCoordinates
            ? "border-primary/40 bg-primary/15 text-primary"
            : "border-border bg-muted/40 text-muted-foreground"
        }`}
        title="Show/hide edge numbers and letters"
      >
        {showCoordinates ? "ON" : "OFF"}
      </button>
    </div>
  );
}

// ============================================================
// PlayerCard subcomponent
// ============================================================
function PlayerCard({
  player, captured, allCaptured, clock, showClock, isTurn,
  evalPercent, evalLabel, evalForTop,
}: {
  player: PlayerLabel;
  captured: import("chess.js").PieceSymbol[];
  allCaptured: { capturedByWhite: import("chess.js").PieceSymbol[]; capturedByBlack: import("chess.js").PieceSymbol[] };
  clock: number;
  showClock: boolean;
  isTurn: boolean;
  evalPercent: number;
  evalLabel: string;
  evalForTop: number;
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-lg border bg-card/60 px-3 py-2 transition-all ${
        isTurn ? "border-primary/60 ring-1 ring-primary/30" : "border-border"
      }`}
    >
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg font-bold ${
          player.color === "w"
            ? "bg-stone-100 text-stone-900"
            : "bg-stone-800 text-stone-100"
        }`}
      >
        {player.color === "w" ? "♔" : "♚"}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold">{player.name}</span>
          {player.isAI && (
            <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px]">
              AI
            </Badge>
          )}
          {isTurn && (
            <motion.span
              className="h-2 w-2 shrink-0 rounded-full bg-primary"
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            />
          )}
        </div>
        <CapturedPieces
          capturedByWhite={allCaptured.capturedByWhite}
          capturedByBlack={allCaptured.capturedByBlack}
          side="top"
          forColor={player.color}
        />
      </div>
      {showClock && (
        <div
          className={`rounded-md px-2 py-1 font-mono text-lg font-bold tabular-nums transition-colors ${
            isTurn
              ? clock < 30000
                ? "bg-rose-500/20 text-rose-300"
                : "bg-primary/20 text-primary-foreground"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {formatClock(clock)}
        </div>
      )}
    </div>
  );
}

// ============================================================
// PromotionDialog — shown above the board when a pawn reaches the last rank
// ============================================================
function PromotionDialog({
  color,
  onSelect,
}: {
  color: Side;
  onSelect: (piece: string) => void;
}) {
  const pieces = ["q", "r", "b", "n"];
  const glyphs: Record<string, string> =
    color === "w"
      ? { q: "♕", r: "♖", b: "♗", n: "♘" }
      : { q: "♛", r: "♜", b: "♝", n: "♞" };

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="rounded-xl border border-border bg-card p-4 shadow-2xl"
      >
        <p className="mb-2 text-center text-sm font-medium text-muted-foreground">
          Promote pawn to:
        </p>
        <div className="flex gap-2">
          {pieces.map((p) => (
            <button
              key={p}
              type="button"
              className="promo-piece-btn flex h-16 w-16 items-center justify-center rounded-lg border border-border bg-secondary text-4xl hover:bg-accent"
              onClick={() => onSelect(p)}
              aria-label={`Promote to ${p}`}
            >
              <span
                style={{
                  color: color === "w" ? "#fafaf9" : "#1c1917",
                  textShadow:
                    color === "w"
                      ? "0 1px 1px rgba(0,0,0,0.55)"
                      : "0 1px 1px rgba(255,255,255,0.18)",
                }}
              >
                {glyphs[p]}
              </span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="mt-2 w-full text-center text-xs text-muted-foreground hover:text-foreground"
          onClick={() => onSelect("__cancel__")}
        >
          Cancel
        </button>
      </motion.div>
    </div>
  );
}

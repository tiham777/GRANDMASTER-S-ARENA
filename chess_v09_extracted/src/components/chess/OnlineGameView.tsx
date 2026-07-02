"use client";

/**
 * OnlineGameView — real-time online chess via the chess-online socket service.
 *
 * Unlike the local GameView, here the chess.js instance is driven by the
 * server: moves are sent to the server for validation + broadcast, and the
 * server's `fen`/`pgn` is the source of truth. We render optimistically on
 * our own move and revert on `room:error`.
 *
 * Features:
 *  - click-to-move + drag (only on your turn)
 *  - promotion picker
 *  - live move history, captured pieces, eval bar
 *  - in-game chat panel
 *  - resign / draw offer + response modal
 *  - opponent-disconnect detection (server emits game:ended with "abandoned")
 *  - share-link button so you can re-copy the invite mid-game
 */
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Chess, type Square } from "chess.js";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, Flag, Handshake, Copy, Send, Wifi, WifiOff, Globe,
  Volume2, VolumeX, Loader2, Check, X, MessageCircle, Maximize2, Minimize2, Grid3x3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ChessBoard } from "./ChessBoard";
import { MoveHistory } from "./MoveHistory";
import { CapturedPieces, computeCaptured } from "./CapturedPieces";
import { useSharedOnlineChess } from "./OnlineSocketProvider";
import { useChessStore } from "@/lib/chessStore";
import { TIME_CONTROLS, formatClock } from "@/lib/chessThemes";
import { quickEvaluate } from "@/lib/chessAI";
import { playSound, setMuted } from "@/lib/chessSound";
import type { OnlineColor } from "@/lib/onlineTypes";

type Side = "w" | "b";

interface OnlineGameViewProps {
  onExit: () => void;
  onGameEnded: (summary: {
    result: string;
    winner: OnlineColor | "draw" | null;
    pgn: string;
    finalFen: string;
    moveCount: number;
    durationSec: number;
    opening: string | null;
    sanMoves: string[];
    playerColor: OnlineColor;
    opponentName: string;
  }) => void;
}

export function OnlineGameView({ onExit, onGameEnded }: OnlineGameViewProps) {
  const { toast } = useToast();
  const online = useSharedOnlineChess();
  const soundEnabled = useChessStore((s) => s.soundEnabled);
  const showLegalMoves = useChessStore((s) => s.showLegalMoves);
  const highlightLastMove = useChessStore((s) => s.highlightLastMove);

  const room = online.room;
  const myColor = online.myColor;

  // Local chess.js instance synced from the server's FEN.
  const gameRef = useRef<Chess>(new Chess());
  const [, forceRender] = useState(0);
  const rerender = useCallback(() => forceRender((n) => n + 1), []);

  // Track whether we've applied the host's preferences (so we only do it once
  // and can restore the player's own preferences on exit).
  const savedPrefsRef = useRef<Record<string, unknown> | null>(null);

  // When the room data arrives with hostPreferences, apply them temporarily
  // so the joining player sees the same board/pieces as the host.
  useEffect(() => {
    if (!room?.hostPreferences || savedPrefsRef.current) return;
    const store = useChessStore.getState();
    // Save the player's current preferences so we can restore them later.
    savedPrefsRef.current = {
      boardTheme: store.boardTheme,
      pieceSet: store.pieceSet,
      boardBorder: store.boardBorder,
      showCoordinates: store.showCoordinates,
      showLegalMoves: store.showLegalMoves,
      highlightLastMove: store.highlightLastMove,
    };
    // Apply the host's preferences.
    const prefs = room.hostPreferences;
    if (prefs.boardTheme) useChessStore.getState().setBoardTheme(prefs.boardTheme as never);
    if (prefs.pieceSet) useChessStore.getState().setPieceSet(prefs.pieceSet as never);
    if (prefs.boardBorder !== undefined) useChessStore.getState().setBoardBorder(prefs.boardBorder);
    if (prefs.showCoordinates !== undefined) useChessStore.getState().setShowCoordinates(prefs.showCoordinates);
    if (prefs.showLegalMoves !== undefined) useChessStore.getState().setShowLegalMoves(prefs.showLegalMoves);
    if (prefs.highlightLastMove !== undefined) useChessStore.getState().setHighlightLastMove(prefs.highlightLastMove);
  }, [room?.hostPreferences]);

  // Restore the player's own preferences when leaving the game.
  const handleExit = useCallback(() => {
    if (savedPrefsRef.current) {
      const prefs = savedPrefsRef.current as Record<string, unknown>;
      if (prefs.boardTheme) useChessStore.getState().setBoardTheme(prefs.boardTheme as never);
      if (prefs.pieceSet) useChessStore.getState().setPieceSet(prefs.pieceSet as never);
      if (prefs.boardBorder !== undefined) useChessStore.getState().setBoardBorder(prefs.boardBorder as boolean);
      if (prefs.showCoordinates !== undefined) useChessStore.getState().setShowCoordinates(prefs.showCoordinates as boolean);
      if (prefs.showLegalMoves !== undefined) useChessStore.getState().setShowLegalMoves(prefs.showLegalMoves as boolean);
      if (prefs.highlightLastMove !== undefined) useChessStore.getState().setHighlightLastMove(prefs.highlightLastMove as boolean);
      savedPrefsRef.current = null;
    }
    onExit();
  }, [onExit]);
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [legalTargets, setLegalTargets] = useState<Record<string, React.CSSProperties>>({});
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<{ from: Square; to: Square; color: Side } | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [showChat, setShowChat] = useState(true);
  const [waitingForOpponent, setWaitingForOpponent] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [matchOpening, setMatchOpening] = useState(true);

  // Sync local chess instance from server FEN.
  useEffect(() => {
    if (!room) return;
    try {
      const newGame = new Chess(room.fen);
      gameRef.current = newGame;
      // Set lastMove from the most recent move in the room's move list.
      if (room.moves.length > 0) {
        const last = room.moves[room.moves.length - 1];
        setLastMove({ from: last.from, to: last.to });
      }
      setSelectedSquare(null);
      setLegalTargets({});
      rerender();
    } catch (err) {
      console.error("[online] failed to load FEN:", err);
    }
  }, [room?.fen, room?.moves.length, rerender]);

  // Sound mute sync.
  useEffect(() => { setMuted(!soundEnabled); }, [soundEnabled]);

  // Scroll to top on mount so the board is immediately visible.
  useEffect(() => { window.scrollTo(0, 0); }, []);

  // Focus mode: apply inline styles to the grid + container to center the
  // board both horizontally AND vertically with symmetrical margins.
  useEffect(() => {
    const container = document.querySelector(".game-container") as HTMLElement | null;
    if (!container) return;
    const grid = container.querySelector(".grid") as HTMLElement | null;
    if (!grid) return;
    if (focusMode) {
      container.style.setProperty("padding", "0", "important");
      container.style.setProperty("min-height", "100vh", "important");
      container.style.setProperty("height", "100vh", "important");
      container.style.setProperty("display", "flex", "important");
      container.style.setProperty("align-items", "center", "important");
      container.style.setProperty("justify-content", "center", "important");
      container.style.setProperty("max-width", "none", "important");
      grid.style.setProperty("display", "flex", "important");
      grid.style.setProperty("grid-template-columns", "none", "important");
      grid.style.setProperty("align-items", "center", "important");
      grid.style.setProperty("justify-content", "center", "important");
      grid.style.setProperty("width", "auto", "important");
      grid.style.setProperty("max-width", "none", "important");
      grid.style.setProperty("gap", "0", "important");
    } else {
      container.style.removeProperty("padding");
      container.style.removeProperty("min-height");
      container.style.removeProperty("height");
      container.style.removeProperty("display");
      container.style.removeProperty("align-items");
      container.style.removeProperty("justify-content");
      container.style.removeProperty("max-width");
      grid.style.removeProperty("display");
      grid.style.removeProperty("grid-template-columns");
      grid.style.removeProperty("align-items");
      grid.style.removeProperty("justify-content");
      grid.style.removeProperty("width");
      grid.style.removeProperty("max-width");
      grid.style.removeProperty("gap");
    }
  }, [focusMode]);

  // Detect game end.
  useEffect(() => {
    if (!room || room.status !== "finished" || !myColor) return;
    const winner = room.winner ?? null;
    const opponentName = myColor === "white" ? (room.guestName ?? room.hostName) : room.hostName;
    if (myColor === "white" && room.blackId) {
      // ok
    }
    const game = gameRef.current;
    onGameEnded({
      result: room.result ?? "abandoned",
      winner: winner as OnlineColor | "draw" | null,
      pgn: room.pgn || game.pgn(),
      finalFen: room.fen || game.fen(),
      moveCount: room.moves.length,
      durationSec: Math.floor((Date.now() - room.createdAt) / 1000),
      opening: null,
      sanMoves: room.moves.map((m) => m.san),
      playerColor: myColor,
      opponentName,
    });
  }, [room?.status]);

  const chess = gameRef.current;
  const turn: Side = chess.turn();
  const isMyTurn = myColor != null && ((myColor === "white" && turn === "w") || (myColor === "black" && turn === "b"));
  const inCheck = chess.isCheck();
  const isGameOver = room?.status === "finished";

  const captured = useMemo(() => computeCaptured(chess.board()), [room?.fen]);
  const sanMoves = useMemo(() => room?.moves.map((m) => m.san) ?? [], [room?.moves]);

  const checkSquare = useMemo<string | null>(() => {
    if (!inCheck) return null;
    const board = chess.board();
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const cell = board[r][c];
        if (cell && cell.type === "k" && cell.color === turn) {
          return "abcdefgh"[c] + (8 - r);
        }
      }
    }
    return null;
  }, [inCheck, turn, room?.fen]);

  const evalInfo = useMemo(() => {
    try {
      return quickEvaluate(chess);
    } catch {
      return { scoreCp: 0, label: "Equal" };
    }
  }, [room?.fen]);
  const evalPercent = useMemo(() => {
    const cp = Math.max(-1000, Math.min(1000, evalInfo.scoreCp));
    return 50 + (cp / 1000) * 45;
  }, [evalInfo.scoreCp]);

  // ============================================================
  // Clocks (client-side enforcement; server stores timeControlId only)
  // ============================================================
  const tc = useMemo(
    () => TIME_CONTROLS.find((t) => t.id === (room?.timeControlId ?? "unlimited")) ?? TIME_CONTROLS[0],
    [room?.timeControlId],
  );
  const [clocks, setClocks] = useState<{ w: number; b: number }>({ w: tc.initialMs, b: tc.initialMs });
  const startTimeRef = useRef<number>(Date.now());

  // Reset clocks when the game starts.
  useEffect(() => {
    if (room?.status === "playing" && startTimeRef.current === 0) {
      startTimeRef.current = Date.now();
      setClocks({ w: tc.initialMs, b: tc.initialMs });
    }
  }, [room?.status, tc.initialMs]);

  // Tick the active player's clock.
  useEffect(() => {
    if (tc.initialMs === 0 || isGameOver) return;
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
  }, [turn, isGameOver, tc.initialMs]);

  // Add increment on our own moves (when we see a new move by us).
  const lastMyMoveCountRef = useRef(0);
  useEffect(() => {
    if (!room || !myColor || tc.incrementMs === 0) return;
    const myMoves = room.moves.filter((_, i) => {
      const moverColor: Side = i % 2 === 0 ? "w" : "b";
      return moverColor === (myColor === "white" ? "w" : "b");
    }).length;
    if (myMoves > lastMyMoveCountRef.current) {
      setClocks((prev) => ({
        ...prev,
        [myColor === "white" ? "w" : "b"]: prev[myColor === "white" ? "w" : "b"] + tc.incrementMs,
      }));
    }
    lastMyMoveCountRef.current = myMoves;
  }, [room?.moves.length, myColor, tc.incrementMs]);

  // Timeout: send resign-equivalent (we just notify the server via game:resign).
  useEffect(() => {
    if (tc.initialMs === 0 || isGameOver || !room || !myColor) return;
    if (clocks.w <= 0 || clocks.b <= 0) {
      const loser: OnlineColor = clocks.w <= 0 ? "white" : "black";
      if (loser === myColor) {
        toast({ title: "Time's up!", description: "You lost on time.", variant: "destructive" });
        online.resign(room.code);
      }
    }
  }, [clocks, tc.initialMs, isGameOver]);

  // ============================================================
  // Move execution
  // ============================================================
  const playSoundForMove = useCallback((san: string, captured: boolean) => {
    if (san.includes("#")) playSound("game-end");
    else if (san.includes("+")) playSound("check");
    else if (san === "O-O" || san === "O-O-O") playSound("castle");
    else if (san.includes("=")) playSound("promote");
    else if (captured) playSound("capture");
    else playSound("move");
  }, []);

  const attemptMove = useCallback(
    (from: Square, to: Square, promotion?: string) => {
      if (!room || !myColor || !isMyTurn) {
        playSound("illegal");
        return false;
      }
      // Validate locally first (for instant feedback + sound).
      const game = gameRef.current;
      const legalMoves = game.moves({ square: from, verbose: true });
      const legalMove = legalMoves.find(
        (m) => m.to === to && (promotion ? m.promotion === promotion : true),
      );
      if (!legalMove) {
        playSound("illegal");
        return false;
      }
      // Apply locally for optimistic render.
      try {
        const move = game.move({ from, to, promotion: promotion as never });
        if (!move) {
          playSound("illegal");
          return false;
        }
        setLastMove({ from: move.from, to: move.to });
        setSelectedSquare(null);
        setLegalTargets({});
        playSoundForMove(move.san, move.captured != null);
        rerender();
      } catch {
        playSound("illegal");
        return false;
      }
      // Send to server. Server will broadcast game:move (which re-syncs us)
      // or room:error (which we handle by reverting).
      setWaitingForOpponent(true);
      online.sendMove(room.code, from, to, promotion);
      return true;
    },
    [room, myColor, isMyTurn, online, playSoundForMove, rerender],
  );

  // Revert optimistic move on room:error.
  useEffect(() => {
    if (online.error && room) {
      // Reload from server FEN.
      try {
        gameRef.current = new Chess(room.fen);
        rerender();
      } catch { /* ignore */ }
      setWaitingForOpponent(false);
    }
  }, [online.error, room?.fen, rerender]);

  // Clear waiting state when it becomes our turn again (opponent moved).
  useEffect(() => {
    if (isMyTurn) setWaitingForOpponent(false);
  }, [isMyTurn]);

  // Clear the match-opening animation class after it plays.
  useEffect(() => {
    if (!matchOpening) return;
    const t = setTimeout(() => setMatchOpening(false), 1900);
    return () => clearTimeout(t);
  }, [matchOpening]);

  const handlePieceDrop = useCallback(
    (source: string, target: string, _piece: string): boolean => {
      if (isGameOver || !isMyTurn) return false;
      const game = gameRef.current;
      const piece = game.get(source as Square);
      if (!piece) return false;
      if (
        piece.type === "p" &&
        ((piece.color === "w" && target[1] === "8") ||
          (piece.color === "b" && target[1] === "1"))
      ) {
        setPendingPromotion({ from: source as Square, to: target as Square, color: piece.color });
        return true;
      }
      return attemptMove(source as Square, target as Square);
    },
    [isGameOver, isMyTurn, attemptMove],
  );

  const selectSquare = useCallback(
    (sq: Square) => {
      const game = gameRef.current;
      const piece = game.get(sq);
      if (!piece || !myColor) {
        setSelectedSquare(null);
        setLegalTargets({});
        return;
      }
      if (piece.color !== (myColor === "white" ? "w" : "b")) return;
      setSelectedSquare(sq);
      playSound("select");
      if (showLegalMoves) {
        const moves = game.moves({ square: sq, verbose: true });
        const targets: Record<string, React.CSSProperties> = {};
        for (const m of moves) {
          // Determine if the target square is light or dark so the dot
          // color adapts to the board theme naturally.
          const fileIdx = m.to.charCodeAt(0) - 97;
          const rankIdx = parseInt(m.to[1], 10) - 1;
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
    [myColor, showLegalMoves],
  );

  const handleSquareClick = useCallback(
    (square: string) => {
      if (isGameOver || !isMyTurn) return;
      const sq = square as Square;
      if (selectedSquare) {
        if (sq === selectedSquare) {
          setSelectedSquare(null);
          setLegalTargets({});
          return;
        }
        const game = gameRef.current;
        const piece = game.get(selectedSquare);
        const targetPiece = game.get(sq);
        if (targetPiece && targetPiece.color === piece?.color) {
          selectSquare(sq);
          return;
        }
        if (
          piece?.type === "p" &&
          ((piece.color === "w" && sq[1] === "8") ||
            (piece.color === "b" && sq[1] === "1"))
        ) {
          setPendingPromotion({ from: selectedSquare, to: sq, color: piece.color });
          return;
        }
        const ok = attemptMove(selectedSquare, sq);
        if (!ok) {
          setSelectedSquare(null);
          setLegalTargets({});
        }
      } else {
        selectSquare(sq);
      }
    },
    [isGameOver, isMyTurn, selectedSquare, selectSquare, attemptMove],
  );

  const handlePromotionSelect = useCallback(
    (piece: string) => {
      if (!pendingPromotion) return;
      if (piece === "__cancel__") {
        setPendingPromotion(null);
        return;
      }
      attemptMove(pendingPromotion.from, pendingPromotion.to, piece);
      setPendingPromotion(null);
    },
    [pendingPromotion, attemptMove],
  );

  // ============================================================
  // Chat
  // ============================================================
  const handleSendChat = useCallback(() => {
    if (!room || !chatInput.trim()) return;
    online.sendChat(room.code, chatInput.trim());
    setChatInput("");
  }, [room, chatInput, online]);

  // ============================================================
  // Resign / Draw
  // ============================================================
  const handleResign = useCallback(() => {
    if (!room) return;
    online.resign(room.code);
  }, [room, online]);

  const handleDrawOffer = useCallback(() => {
    if (!room) return;
    online.offerDraw(room.code);
    toast({ title: "Draw offered", duration: 1500 });
  }, [room, online, toast]);

  const handleDrawRespond = useCallback(
    (accept: boolean) => {
      if (!room) return;
      online.respondDraw(room.code, accept);
    },
    [room, online],
  );

  // ============================================================
  // Render
  // ============================================================
  if (!room || !myColor) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Connecting to game…</p>
          <Button variant="ghost" size="sm" onClick={handleExit} className="mt-4">Back to lobby</Button>
        </div>
      </div>
    );
  }

  const mySide: Side = myColor === "white" ? "w" : "b";
  const opponentSide: Side = myColor === "white" ? "b" : "w";
  const myName = myColor === "white" ? room.hostName : (room.guestName ?? "Guest");
  const opponentName = myColor === "white" ? (room.guestName ?? "Guest") : room.hostName;

  const orientation = myColor; // "white" | "black" — board faces me

  // Standard chess layout: opponent on top, board, You on bottom.
  const topPlayer = {
    name: opponentName,
    color: opponentSide,
    isAI: false,
    isMe: false,
  };
  const bottomPlayer = {
    name: myName,
    color: mySide,
    isAI: false,
    isMe: true,
  };

  const topClock = opponentSide === "w" ? clocks.w : clocks.b;
  const bottomClock = mySide === "w" ? clocks.w : clocks.b;
  const isTopTurn = turn === opponentSide;
  const isBottomTurn = turn === mySide;

  const topCaptured = opponentSide === "w" ? captured.capturedByWhite : captured.capturedByBlack;
  const bottomCaptured = mySide === "w" ? captured.capturedByWhite : captured.capturedByBlack;

  const highlightSquares: Record<string, React.CSSProperties> = {
    ...legalTargets,
    ...(selectedSquare
      ? { [selectedSquare]: { background: "rgba(251, 191, 36, 0.55)", boxShadow: "inset 0 0 0 4px rgba(251, 191, 36, 0.5)" } }
      : {}),
  };

  return (
    <div className={`game-container mx-auto w-full max-w-7xl px-2 py-1 sm:px-4 sm:py-1.5 ${focusMode ? "focus-mode" : ""} ${matchOpening ? "match-opening" : ""}`}>
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
        <Button variant="ghost" size="sm" onClick={handleExit} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Leave
        </Button>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1 font-mono">
            <Globe className="h-3 w-3" /> {room.code}
          </Badge>
          <Badge variant="outline" className={`gap-1 ${online.connected ? "text-emerald-400" : "text-rose-400"}`}>
            {online.connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {online.connected ? "Live" : "Reconnecting"}
          </Badge>
          <Button
            variant="ghost" size="icon"
            onClick={() => useChessStore.getState().toggleSound()}
            title={soundEnabled ? "Mute" : "Unmute"}
          >
            {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost" size="icon"
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
              fen={chess.fen()}
              highlightSquares={highlightSquares}
              lastMove={highlightLastMove ? lastMove : null}
              checkSquare={checkSquare}
              boardOrientation={orientation}
              interactive={!isGameOver && isMyTurn}
              onPieceDrop={handlePieceDrop}
              onSquareClick={handleSquareClick}
            />
            {pendingPromotion && (
              <PromotionDialog
                color={pendingPromotion.color}
                onSelect={handlePromotionSelect}
              />
            )}
          </div>
        </div>

        {/* Sidebar — player boxes + controls + eval + moves + chat */}
        <div className="game-side-col flex flex-col gap-2 sm:gap-3">
          {/* You — first player card */}
          <div className="player-bar">
            <OnlinePlayerCard
              player={bottomPlayer}
              captured={bottomCaptured}
              allCaptured={captured}
              clock={bottomClock}
              showClock={tc.initialMs > 0}
              isTurn={isBottomTurn}
            />
          </div>

          {/* Opponent — second player card */}
          <div className="player-bar">
            <OnlinePlayerCard
              player={topPlayer}
              captured={topCaptured}
              allCaptured={captured}
              clock={topClock}
              showClock={tc.initialMs > 0}
              isTurn={isTopTurn}
            />
          </div>

          {/* Opponent's turn indicator — small animated badge in the sidebar */}
          {waitingForOpponent && !isGameOver && (
            <div className="flex items-center justify-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 animate-fade-up">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              <span className="text-xs font-semibold text-primary">Opponent&apos;s turn…</span>
              <span className="flex gap-0.5">
                <motion.span
                  className="h-1 w-1 rounded-full bg-primary"
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1.2, repeat: Infinity, delay: 0 }}
                />
                <motion.span
                  className="h-1 w-1 rounded-full bg-primary"
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1.2, repeat: Infinity, delay: 0.2 }}
                />
                <motion.span
                  className="h-1 w-1 rounded-full bg-primary"
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1.2, repeat: Infinity, delay: 0.4 }}
                />
              </span>
            </div>
          )}

          {/* Controls */}
          <div className="game-controls flex flex-wrap items-center gap-2">
            <Button
              variant="outline" size="sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(`${window.location.origin}/?join=${room.code}`);
                  toast({ title: "Invite link copied", duration: 1500 });
                } catch { /* ignore */ }
              }}
              className="gap-1"
            >
              <Copy className="h-4 w-4" /> Invite
            </Button>
            <Button
              variant="outline" size="sm" onClick={handleDrawOffer}
              disabled={isGameOver || online.drawOfferedBy !== null}
              className="gap-1"
            >
              <Handshake className="h-4 w-4" /> Offer Draw
            </Button>
            <div className="ml-auto">
              <Button
                variant="destructive" size="sm" onClick={handleResign}
                disabled={isGameOver}
                className="gap-1"
              >
                <Flag className="h-4 w-4" /> Resign
              </Button>
            </div>
          </div>

          {/* Coordinates Grid toggle */}
          <OnlineCoordsToggle />

          {/* Eval bar */}
          <div className="rounded-lg border border-border bg-card/60 p-3">
            <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
              <span>Position</span>
              <span className={`font-mono font-semibold ${evalInfo.scoreCp > 50 ? "text-emerald-400" : evalInfo.scoreCp < -50 ? "text-rose-400" : ""}`}>
                {evalInfo.label}
              </span>
            </div>
            <div className="relative h-3 w-full overflow-hidden rounded-full bg-stone-900">
              <div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-stone-100 to-stone-300 transition-all duration-500"
                style={{ width: `${evalPercent}%` }}
              />
            </div>
          </div>

          {/* Move history */}
          <div className="rounded-lg border border-border bg-card/60 p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Moves</h3>
              <Badge variant="outline" className="font-mono text-xs">{sanMoves.length}</Badge>
            </div>
            <div className="h-56 max-h-56">
              <MoveHistory moves={sanMoves} />
            </div>
          </div>

          {/* Chat */}
          <div className="flex flex-col rounded-lg border border-border bg-card/60 p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                <MessageCircle className="h-4 w-4" /> Chat
              </h3>
              <Button
                variant="ghost" size="sm"
                onClick={() => setShowChat((s) => !s)}
                className="h-6 px-2 text-xs"
              >
                {showChat ? "Hide" : "Show"}
              </Button>
            </div>
            {showChat && (
              <>
                <div className="scroll-thin mb-2 h-32 max-h-32 space-y-1 overflow-y-auto pr-1">
                  {online.chat.length === 0 ? (
                    <p className="py-4 text-center text-xs text-muted-foreground/70">
                      Say hello to your opponent!
                    </p>
                  ) : (
                    online.chat.map((msg, i) => {
                      const mine = msg.from === myColor;
                      return (
                        <div key={i} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
                          <span className="text-[10px] text-muted-foreground">{msg.name}</span>
                          <span
                            className={`max-w-[85%] rounded-lg px-2 py-1 text-xs ${
                              mine
                                ? "bg-primary/20 text-primary-foreground"
                                : "bg-muted text-foreground"
                            }`}
                          >
                            {msg.message}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
                <div className="flex gap-1">
                  <Input
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value.slice(0, 200))}
                    onKeyDown={(e) => { if (e.key === "Enter") handleSendChat(); }}
                    placeholder="Type a message…"
                    className="h-8 text-xs"
                    maxLength={200}
                  />
                  <Button size="sm" onClick={handleSendChat} disabled={!chatInput.trim()} className="h-8 w-8 p-0">
                    <Send className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Draw offer modal */}
      <AnimatePresence>
        {online.drawOfferedBy && online.drawOfferedBy !== myColor && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="rounded-xl border border-border bg-card p-6 shadow-2xl"
            >
              <div className="mb-4 text-center">
                <Handshake className="mx-auto mb-2 h-10 w-10 text-primary" />
                <h3 className="text-lg font-semibold">Draw offered</h3>
                <p className="text-sm text-muted-foreground">
                  {opponentName} offers a draw. Accept?
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline" className="flex-1 gap-1"
                  onClick={() => handleDrawRespond(false)}
                >
                  <X className="h-4 w-4" /> Decline
                </Button>
                <Button
                  className="flex-1 gap-1 bg-emerald-600 hover:bg-emerald-500"
                  onClick={() => handleDrawRespond(true)}
                >
                  <Check className="h-4 w-4" /> Accept
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================
// Subcomponents
// ============================================================

/** Coordinates Grid ON/OFF toggle — subscribes to the store for reactivity. */
function OnlineCoordsToggle() {
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

function OnlinePlayerCard({
  player, captured, allCaptured, clock, showClock, isTurn,
}: {
  player: { name: string; color: Side; isAI: boolean; isMe: boolean };
  captured: import("chess.js").PieceSymbol[];
  allCaptured: { capturedByWhite: import("chess.js").PieceSymbol[]; capturedByBlack: import("chess.js").PieceSymbol[] };
  clock: number;
  showClock: boolean;
  isTurn: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-lg border bg-card/60 px-3 py-2 transition-all ${
        isTurn ? "border-primary/60 ring-1 ring-primary/30" : "border-border"
      }`}
    >
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg font-bold ${
          player.color === "w" ? "bg-stone-100 text-stone-900" : "bg-stone-800 text-stone-100"
        }`}
      >
        {player.color === "w" ? "♔" : "♚"}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold">{player.name}</span>
          {player.isMe && (
            <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px]">You</Badge>
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

function PromotionDialog({
  color, onSelect,
}: {
  color: Side;
  onSelect: (piece: string) => void;
}) {
  const pieces = ["q", "r", "b", "n"];
  const glyphs: Record<string, string> =
    color === "w" ? { q: "♕", r: "♖", b: "♗", n: "♘" } : { q: "♛", r: "♜", b: "♝", n: "♞" };
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="rounded-xl border border-border bg-card p-4 shadow-2xl"
      >
        <p className="mb-2 text-center text-sm font-medium text-muted-foreground">Promote to:</p>
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
                  textShadow: color === "w" ? "0 1px 1px rgba(0,0,0,0.55)" : "0 1px 1px rgba(255,255,255,0.18)",
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

// (Globe icon imported at the top of the file.)

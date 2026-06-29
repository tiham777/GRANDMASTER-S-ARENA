"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Chess, type Square } from "chess.js";
import { Chessboard } from "react-chessboard";
import {
  Crown,
  ArrowLeft,
  Flag,
  Handshake,
  Loader2,
  CircleDot,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Volume2,
  VolumeX,
  RotateCcw,
  Sun,
  Moon,
  Maximize,
  Minimize,
  Palette,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useChessStore } from "@/lib/store";
import {
  watchGame,
  submitMove,
  resignGame,
  offerDraw,
  respondDraw,
  finalizeStats,
  loseOnTime,
} from "@/lib/chessApi";
import type { GameDoc, PieceColor, GameStatus } from "@/lib/types";
import { INITIAL_TIME_MS } from "@/lib/types";

function fmtTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

// The 5 board color themes — identical palette to the offline chess-game.html.
// `light`/`dark` are used for the swatch buttons in the picker; the actual
// board square colors come from the CSS variables in globals.css
// (`.chess-board-wrap[data-board-theme="..."]`).
const BOARD_THEMES: {
  id: "classic" | "tournament" | "midnight" | "oceanic" | "sunset";
  name: string;
  light: string;
  dark: string;
}[] = [
  { id: "classic", name: "Classic Walnut", light: "#f0d9b5", dark: "#b58863" },
  { id: "tournament", name: "Tournament Field", light: "#ececd7", dark: "#739552" },
  { id: "midnight", name: "Midnight Slate", light: "#d6d3d1", dark: "#57534e" },
  { id: "oceanic", name: "Oceanic Depths", light: "#e9edf0", dark: "#4b7399" },
  { id: "sunset", name: "Velvet Sunset", light: "#fed7aa", dark: "#9a3412" },
];

// Simple "level" tier shown on the player cards, derived from total wins.
// This mirrors the spirit of the offline game's level badge without
// requiring a separate ranking system.
function levelFromWins(wins: number): { label: string; tone: string } {
  if (wins >= 50) return { label: "Master", tone: "text-amber-300" };
  if (wins >= 20) return { label: "Skilled", tone: "text-emerald-300" };
  if (wins >= 5) return { label: "Casual", tone: "text-sky-300" };
  return { label: "Beginner", tone: "text-stone-300" };
}

export default function GameView() {
  const profile = useChessStore((s) => s.profile)!;
  const activeGameId = useChessStore((s) => s.activeGameId);
  const activeGame = useChessStore((s) => s.activeGame);
  const myColor = useChessStore((s) => s.myColor);
  const setActiveGame = useChessStore((s) => s.setActiveGame);
  const setView = useChessStore((s) => s.setView);
  const { toast } = useToast();

  const [game, setGame] = useState<Chess>(() => new Chess());
  const [fen, setFen] = useState<string>(game.fen());
  const [checkSquare, setCheckSquare] = useState<Record<string, React.CSSProperties>>({});
  const [optionSquares, setOptionSquares] = useState<Record<string, React.CSSProperties>>({});
  const [moveSource, setMoveSource] = useState<Square | null>(null);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [drawDialog, setDrawDialog] = useState<"incoming" | "outgoing" | null>(null);
  const [resignDialog, setResignDialog] = useState(false);
  const [muted, setMuted] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const finalizedRef = useRef<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  // NEW: UI state for the offline-style top bar controls.
  // - isDark toggles the .light-mode class on the root container
  // - isFocus hides everything except the top bar + the board
  // - boardTheme drives the data-board-theme attribute on .chess-board-wrap
  const [isDark, setIsDark] = useState(true);
  const [isFocus, setIsFocus] = useState(false);
  const [boardTheme, setBoardTheme] =
    useState<"classic" | "tournament" | "midnight" | "oceanic" | "sunset">("classic");

  // NEW: ticking "now" timestamp — used to count down the active player's
  // chess clock on the client side (the source of truth remains Firestore;
  // we just render a live countdown).
  const [now, setNow] = useState(() => Date.now());

  // Subscribe to game doc
  useEffect(() => {
    if (!activeGameId) return;
    const unsub = watchGame(activeGameId, (g) => {
      if (!g) {
        toast({ title: "Game not found", description: "It may have been aborted.", variant: "destructive" });
        setActiveGame(null, null, null);
        setView("lobby");
        return;
      }
      setActiveGame(activeGameId, g, myColor);
      try {
        const next = new Chess(g.fen);
        setGame(next);
        setFen(next.fen());
        const last = g.moves[g.moves.length - 1];
        setLastMove(last ? { from: last.from, to: last.to } : null);
        // Highlight king in check
        if (next.inCheck()) {
          const turn2 = next.turn();
          const pieces = next.board();
          const kingSquare = findKing(pieces, turn2);
          if (kingSquare) {
            setCheckSquare({
              [kingSquare]: {
                background: "radial-gradient(circle, rgba(244,63,94,0.85) 30%, rgba(244,63,94,0.4) 55%, transparent 70%)",
              },
            });
          }
        } else {
          setCheckSquare({});
        }
      } catch {
        /* ignore fen errors */
      }
    });
    return () => unsub();
  }, [activeGameId, myColor, setActiveGame, setView, toast]);

  // Update stats once when game ends
  useEffect(() => {
    if (!activeGame) return;
    if (activeGame.status === "playing") return;
    if (finalizedRef.current === activeGame.id) return;
    finalizedRef.current = activeGame.id;
    finalizeStats(activeGame).catch(() => {});
  }, [activeGame]);

  // Per-turn elapsed timer (count-up; kept for the small "turn elapsed"
  // indicator next to the move list — independent from the chess clock)
  useEffect(() => {
    if (!activeGame || activeGame.status !== "playing") return;
    const id = setInterval(() => {
      const nowT = Date.now();
      setElapsed(nowT - activeGame.lastMoveAt);
    }, 250);
    return () => clearInterval(id);
  }, [activeGame]);

  // NEW: chess clock countdown. The active player's clock ticks down every
  // 250ms while the game is still playing. Stored values come from Firestore
  // (updated on every move via submitMove); we just animate between updates.
  useEffect(() => {
    if (!activeGame || activeGame.status !== "playing") return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [activeGame]);

  // Beep on opponent move
  useEffect(() => {
    if (muted) return;
    if (!activeGame) return;
    const last = activeGame.moves[activeGame.moves.length - 1];
    if (!last) return;
    if (last.by === profile.uid) return;
    try {
      if (!audioCtxRef.current) {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioCtxRef.current = new Ctx();
      }
      const ctx = audioCtxRef.current;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.frequency.value = 660;
      o.type = "triangle";
      g.gain.setValueAtTime(0.08, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.15);
      o.start();
      o.stop(ctx.currentTime + 0.15);
    } catch { /* noop */ }
  }, [activeGame, muted, profile.uid]);

  const isMyTurn = useMemo(() => {
    if (!activeGame) return false;
    return activeGame.turn === myColor && activeGame.status === "playing";
  }, [activeGame, myColor]);

  const opponent = useMemo(() => {
    if (!activeGame) return null;
    if (myColor === "white") {
      return { name: activeGame.blackName, uid: activeGame.blackUid, color: "black" as PieceColor };
    }
    return { name: activeGame.whiteName, uid: activeGame.whiteUid, color: "white" as PieceColor };
  }, [activeGame, myColor]);

  const me = useMemo(() => {
    if (!activeGame) return null;
    if (myColor === "white") {
      return { name: activeGame.whiteName, uid: activeGame.whiteUid, color: "white" as PieceColor };
    }
    return { name: activeGame.blackName, uid: activeGame.blackUid, color: "black" as PieceColor };
  }, [activeGame, myColor]);

  // Captured pieces (for the small bar above/below the board, like the offline game)
  const captured = useMemo(() => {
    if (!activeGame) return { mine: [] as string[], opp: [] as string[] };
    const moves = activeGame.moves;
    const myCaptured: string[] = [];
    const oppCaptured: string[] = [];
    // Replay moves to figure out captures
    const replay = new Chess();
    for (const m of moves) {
      const before = replay.get(m.to as Square);
      if (before) {
        // captured piece — `before.color` is the color that was captured
        if (m.by === profile.uid) {
          myCaptured.push(before.type);
        } else {
          oppCaptured.push(before.type);
        }
      }
      try { replay.move({ from: m.from, to: m.to, promotion: m.promotion }); } catch { break; }
    }
    return { mine: myCaptured, opp: oppCaptured };
  }, [activeGame, profile.uid]);

  // NEW: live chess-clock computations. These recompute every tick (every
  // 250ms) for the player whose turn it currently is. The other player's
  // clock stays at the last stored value.
  const whiteClockMs = useMemo(() => {
    if (!activeGame) return INITIAL_TIME_MS;
    const stored = activeGame.whiteTimeLeftMs ?? INITIAL_TIME_MS;
    if (activeGame.status !== "playing") return stored;
    if (activeGame.turn !== "white") return stored;
    return Math.max(0, stored - (now - activeGame.lastMoveAt));
  }, [activeGame, now]);

  const blackClockMs = useMemo(() => {
    if (!activeGame) return INITIAL_TIME_MS;
    const stored = activeGame.blackTimeLeftMs ?? INITIAL_TIME_MS;
    if (activeGame.status !== "playing") return stored;
    if (activeGame.turn !== "black") return stored;
    return Math.max(0, stored - (now - activeGame.lastMoveAt));
  }, [activeGame, now]);

  // NEW: auto-flag when a player's clock reaches 0. Either client can do
  // this — first one to call loseOnTime wins the race (Firestore will
  // simply overwrite an already-finished game's status, which is fine).
  const timeOutHandledRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeGame || activeGame.status !== "playing") return;
    if (timeOutHandledRef.current === activeGame.id) return;
    if (whiteClockMs <= 0) {
      timeOutHandledRef.current = activeGame.id;
      loseOnTime(activeGame.id, activeGame.blackUid).catch(() => {
        timeOutHandledRef.current = null;
      });
      toast({
        title: "White ran out of time",
        description: `${activeGame.whiteName} flagged — ${activeGame.blackName} wins on time.`,
        variant: "destructive",
      });
    } else if (blackClockMs <= 0) {
      timeOutHandledRef.current = activeGame.id;
      loseOnTime(activeGame.id, activeGame.whiteUid).catch(() => {
        timeOutHandledRef.current = null;
      });
      toast({
        title: "Black ran out of time",
        description: `${activeGame.blackName} flagged — ${activeGame.whiteName} wins on time.`,
        variant: "destructive",
      });
    }
  }, [activeGame, whiteClockMs, blackClockMs, toast]);

  // Reset timeout guard when we switch to a new game.
  useEffect(() => {
    timeOutHandledRef.current = null;
  }, [activeGameId]);

  // Draw offer state
  useEffect(() => {
    if (!activeGame) return;
    if (!activeGame.drawOfferBy) {
      setDrawDialog(null);
      return;
    }
    if (activeGame.drawOfferBy === profile.uid) {
      setDrawDialog("outgoing");
    } else {
      setDrawDialog("incoming");
    }
  }, [activeGame, profile.uid]);

  // ----- move handling ----------------------------------------------------

  const tryMove = useCallback(async (from: Square, to: Square, promotion?: string) => {
    if (!activeGame || !isMyTurn || busy) return;
    setBusy(true);
    setMoveSource(null);
    setOptionSquares({});
    try {
      const next = new Chess(activeGame.fen);
      let mv: ReturnType<Chess["move"]>;
      try {
        mv = next.move({ from, to, promotion: promotion ?? "q" });
      } catch {
        return;
      }
      if (!mv) return;
      const san = mv.san;
      const fenAfter = next.fen();
      const turn: PieceColor = next.turn() === "w" ? "white" : "black";
      let status: GameStatus = "playing";
      let winnerUid: string | null = null;
      if (next.isCheckmate()) {
        status = "checkmate";
        winnerUid = profile.uid;
      } else if (next.isStalemate()) {
        status = "stalemate";
      } else if (next.isThreefoldRepetition() || next.isInsufficientMaterial() || next.isDraw()) {
        status = "draw";
      }
      const pgn = next.pgn();
      await submitMove(
        activeGame.id,
        { from, to, promotion: promotion ?? "q", san, fenAfter, by: profile.uid, at: Date.now() },
        fenAfter,
        turn,
        pgn,
        status,
        winnerUid,
        // NEW: chess clock info — deduct my thinking time from my own clock.
        myColor ?? undefined,
        {
          whiteTimeLeftMs: activeGame.whiteTimeLeftMs ?? INITIAL_TIME_MS,
          blackTimeLeftMs: activeGame.blackTimeLeftMs ?? INITIAL_TIME_MS,
        },
        activeGame.lastMoveAt
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Move failed";
      toast({ title: "Move failed", description: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }, [activeGame, isMyTurn, busy, profile.uid, myColor, toast]);

  // react-chessboard v5: handlers receive { piece, square }
  const onSquareClick = useCallback(({ square }: { piece: unknown; square: string }) => {
    if (!isMyTurn || busy) return;
    const sq = square as Square;
    if (moveSource) {
      if (sq === moveSource) {
        setMoveSource(null);
        setOptionSquares({});
        return;
      }
      void tryMove(moveSource, sq);
      return;
    }
    const piece = game.get(sq);
    if (!piece) return;
    if (piece.color !== (myColor === "white" ? "w" : "b")) return;
    setMoveSource(sq);
    const moves = game.moves({ square: sq, verbose: true });
    const opts: Record<string, React.CSSProperties> = {};
    moves.forEach((m) => {
      const dest = game.get(m.to as Square);
      const isCapture = !!dest && dest.color !== piece.color;
      if (isCapture) {
        // Capture indicator: ring around the target piece
        opts[m.to] = {
          background: "radial-gradient(circle, rgba(244,63,94,0.35) 55%, transparent 60%)",
          boxShadow: "inset 0 0 0 4px rgba(244,63,94,0.65)",
          borderRadius: "8%",
        };
      } else {
        // Empty square: small emerald dot
        opts[m.to] = {
          background:
            "radial-gradient(circle, rgba(15,145,89,0.7) 22%, transparent 24%)",
          borderRadius: "50%",
        };
      }
    });
    // Selected source square: amber tint
    opts[sq] = { background: "rgba(254,215,170,0.55)" };
    setOptionSquares(opts);
  }, [moveSource, isMyTurn, busy, game, myColor, tryMove]);

  const onPieceDrop = useCallback(({ sourceSquare, targetSquare, piece }: { piece: { pieceType: string; isSparePiece: boolean }; sourceSquare: string; targetSquare: string | null }) => {
    if (!isMyTurn || busy || !targetSquare) return false;
    const isPromotion =
      (sourceSquare[1] === "7" && targetSquare[1] === "8" && piece.pieceType === "wP") ||
      (sourceSquare[1] === "2" && targetSquare[1] === "1" && piece.pieceType === "bP");
    void tryMove(sourceSquare as Square, targetSquare as Square, isPromotion ? "q" : undefined);
    return true;
  }, [isMyTurn, busy, tryMove]);

  // ----- end-of-game dialog ----------------------------------------------

  const endGameInfo = useMemo(() => {
    if (!activeGame || activeGame.status === "playing") return null;
    const iWon = activeGame.winnerUid === profile.uid;
    const isDraw = activeGame.status === "draw" || activeGame.status === "stalemate";
    let title = "Game over";
    let tone: "win" | "loss" | "draw" = "draw";
    let detail = "";
    if (iWon) {
      title = "Victory!";
      tone = "win";
      detail = `${opponent?.name} has been defeated.`;
    } else if (isDraw) {
      title = "Draw";
      tone = "draw";
      detail = `Reason: ${activeGame.status}.`;
    } else if (activeGame.winnerUid) {
      title = "Defeat";
      tone = "loss";
      detail = `${opponent?.name} won.`;
    } else if (activeGame.status === "aborted") {
      title = "Aborted";
      tone = "draw";
      detail = "Game was aborted.";
    }
    return { title, tone, detail };
  }, [activeGame, profile.uid, opponent]);

  async function handleResign() {
    if (!activeGame || !opponent) return;
    setBusy(true);
    try {
      await resignGame(activeGame.id, opponent.uid);
      toast({ title: "You resigned.", description: `${opponent.name} wins.` });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed.";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setBusy(false);
      setResignDialog(false);
    }
  }

  async function handleOfferDraw() {
    if (!activeGame) return;
    setBusy(true);
    try {
      await offerDraw(activeGame.id, profile.uid);
      toast({ title: "Draw offer sent." });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed.";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function handleDrawResponse(accept: boolean) {
    if (!activeGame) return;
    setBusy(true);
    try {
      await respondDraw(activeGame.id, accept);
      toast({ title: accept ? "Draw accepted." : "Draw declined." });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed.";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  // CHANGED: the back button now means "resign" while a match is in
  // progress. If the game is already over, it just returns to the lobby.
  // The resign confirmation dialog lets the user back out if they pressed
  // back by accident.
  function handleLeave() {
    if (activeGame && activeGame.status === "playing") {
      setResignDialog(true);
    } else {
      setActiveGame(null, null, null);
      setView("lobby");
    }
  }

  // After the game ends, "leave" just navigates back without resigning
  // (the game is already over).
  function handleLeaveAfterGame() {
    setActiveGame(null, null, null);
    setView("lobby");
  }

  if (!activeGame || !me || !opponent) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="size-8 text-amber-400 animate-spin mx-auto mb-3" />
          <p className="text-sm text-stone-400">Loading game…</p>
        </div>
      </div>
    );
  }

  const boardOrientation = myColor === "white" ? "white" : "black";

  // Build square styles object combining highlights (matches offline game)
  const squareStyles: Record<string, React.CSSProperties> = {
    ...(lastMove
      ? {
          [lastMove.from]: { background: "rgba(254,215,170,0.55)" },
          [lastMove.to]: { background: "rgba(254,215,170,0.75)" },
        }
      : {}),
    ...optionSquares,
    ...checkSquare,
  };

  // Material count: pawn=1, knight/bishop=3, rook=5, queen=9
  const materialValue = (types: string[]) =>
    types.reduce((s, t) => s + ({ p: 1, n: 3, b: 3, r: 5, q: 9 }[t] ?? 0), 0);
  const myMaterial = materialValue(captured.mine);
  const oppMaterial = materialValue(captured.opp);
  const materialDiff = myMaterial - oppMaterial;

  // Compute each player's level from wins (only available for me; opponent
  // shows a neutral "Player" label since we don't have their stats loaded).
  const myLevel = levelFromWins(profile.wins);

  // Helper class names so the same component renders correctly in both
  // dark (default) and light theme (driven by the `.light-mode` class on
  // the root container).
  const rootCls = `min-h-screen flex flex-col bg-stone-950 ${!isDark ? "light-mode" : ""}`;
  const headerCls = `border-b ${isDark ? "border-stone-900 bg-stone-950/90" : "border-stone-300 bg-stone-50/95"} backdrop-blur-sm sticky top-0 z-30`;
  const headerTextPrimary = isDark ? "text-stone-100" : "text-stone-900";
  const headerTextMuted = isDark ? "text-stone-500" : "text-stone-500";
  const headerTextSubtle = isDark ? "text-stone-400" : "text-stone-600";
  const ctrlBtnCls = `size-9 rounded-xl border transition-all ${
    isDark
      ? "border-stone-800 bg-stone-900 hover:bg-stone-800 hover:border-stone-700 text-stone-400 hover:text-stone-200"
      : "border-stone-300 bg-white hover:bg-stone-100 hover:border-stone-400 text-stone-600 hover:text-stone-900"
  }`;
  const cardCls = `rounded-xl border p-3 ${isDark ? "border-stone-800 bg-stone-900/60" : "border-stone-300 bg-white"}`;
  const subCardCls = `rounded-2xl border overflow-hidden shadow-md ${isDark ? "border-stone-800 bg-stone-900" : "border-stone-300 bg-white"}`;
  const actionBtnCls = isDark
    ? "border-stone-800 bg-stone-900 text-stone-200 hover:bg-stone-800"
    : "border-stone-300 bg-white text-stone-800 hover:bg-stone-100";

  return (
    <div className={rootCls}>
      {/* Top bar — matches the offline game's 3-button control row:
          sound toggle · theme toggle · focus mode. The back button now
          doubles as "resign" during an active match (see handleLeave). */}
      <header className={headerCls}>
        <div className="max-w-7xl mx-auto px-4 h-12 flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLeave}
            className={isDark ? "text-stone-400 hover:text-stone-200 hover:bg-stone-800/60" : "text-stone-600 hover:text-stone-900 hover:bg-stone-200/60"}
            title={activeGame.status === "playing" ? "Resign and return to lobby" : "Return to lobby"}
          >
            <ArrowLeft className="size-4" />
            <span className="ml-1.5 hidden sm:inline">
              {activeGame.status === "playing" ? "Resign" : "Lobby"}
            </span>
          </Button>
          <div className="size-7 rounded bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-sm">
            <Crown className="size-4 text-stone-950" />
          </div>
          <div className="flex flex-col leading-none">
            <span className={`text-sm font-semibold tracking-tight ${headerTextPrimary}`}>
              Grandmaster&apos;s Arena
            </span>
            <span className={`text-[10px] uppercase tracking-wider mt-0.5 hidden sm:inline ${headerTextMuted}`}>
              {isFocus ? "Focus Mode · Online Multiplayer" : "Online Multiplayer · 15 min clock"}
            </span>
          </div>
          <Badge
            variant="outline"
            className={`ml-1 text-[10px] ${isDark ? "border-stone-700 text-stone-300" : "border-stone-300 text-stone-700"}`}
          >
            <CircleDot
              className={`size-2.5 mr-1 ${
                isMyTurn ? "text-emerald-400 dot-online" : isDark ? "text-stone-600" : "text-stone-400"
              }`}
            />
            {isMyTurn ? "Your move" : "Waiting…"}
          </Badge>
          <div className="flex-1" />

          {/* The 3 offline-style control buttons — sound, theme, focus */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMuted((m) => !m)}
            title={muted ? "Enable Audio" : "Disable Audio"}
            className={ctrlBtnCls}
          >
            {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsDark((d) => !d)}
            title="Toggle Light/Dark Mode"
            className={ctrlBtnCls}
          >
            {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsFocus((f) => !f)}
            title={
              isFocus
                ? "Exit Focus Mode"
                : "Enter Focus Mode — hide everything except the board"
            }
            className={`size-9 rounded-xl border transition-all ${
              isFocus
                ? "border-amber-500 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25"
                : ctrlBtnCls
            }`}
          >
            {isFocus ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
          </Button>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-4 md:py-6">
        {/* Player cards row — MY card first, OPPONENT card after.
            Both show: avatar, level label, username, and color chip.
            Hidden entirely in focus mode. */}
        {!isFocus && (
          <div className="grid sm:grid-cols-2 gap-3 mb-3">
            <PlayerCard
              name={me.name}
              color={me.color}
              levelLabel={`Level: ${myLevel.label}`}
              levelTone={myLevel.tone}
              stats={`${profile.wins}W · ${profile.losses}L · ${profile.draws}D`}
              photoURL={profile.photoURL}
              isMe
              isDark={isDark}
            />
            <PlayerCard
              name={opponent.name}
              color={opponent.color}
              levelLabel="Level: Opponent"
              levelTone={isDark ? "text-stone-400" : "text-stone-500"}
              stats="Online now"
              photoURL={null}
              isOpponent
              isDark={isDark}
            />
          </div>
        )}

        {/* 2 Lost Pieces boxes — show the pieces each player has lost
            (i.e. the pieces the OTHER player captured from them).
            Hidden in focus mode. */}
        {!isFocus && (
          <div className="grid sm:grid-cols-2 gap-3 mb-3">
            <LostBox
              title="Your Lost Pieces"
              subtitle=""
              materialScore={materialDiff < 0 ? materialDiff : 0}
              // "My lost pieces" = pieces the opponent captured from me = captured.opp
              types={captured.opp}
              // These pieces belong to me — render in my color's glyph shade.
              ownerColor={me.color}
              isDark={isDark}
            />
            <LostBox
              title="Opponent's Lost Pieces"
              subtitle=""
              materialScore={materialDiff > 0 ? materialDiff : 0}
              // "Opponent lost pieces" = pieces I captured = captured.mine
              types={captured.mine}
              ownerColor={opponent.color}
              isDark={isDark}
            />
          </div>
        )}

        {/* Board color picker — 5 theme swatches, exactly like the offline page.
            Hidden in focus mode. */}
        {!isFocus && (
          <div className={`flex items-center gap-2 mb-3 flex-wrap ${isDark ? "" : "text-stone-700"}`}>
            <Palette className={`size-4 ${isDark ? "text-stone-500" : "text-stone-500"}`} />
            <span className={`text-[10px] uppercase tracking-wider ${headerTextMuted}`}>Board Theme</span>
            <div className="flex items-center gap-1.5 ml-1">
              {BOARD_THEMES.map((t) => {
                const selected = boardTheme === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setBoardTheme(t.id)}
                    title={t.name}
                    className={`size-7 rounded-md overflow-hidden border-2 transition-all ${
                      selected
                        ? "border-amber-400 ring-2 ring-amber-400/40 scale-105"
                        : isDark
                          ? "border-stone-700 hover:border-stone-500"
                          : "border-stone-300 hover:border-stone-500"
                    }`}
                  >
                    <span className="flex w-full h-full">
                      <span className="w-1/2 h-full" style={{ backgroundColor: t.light }} />
                      <span className="w-1/2 h-full" style={{ backgroundColor: t.dark }} />
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className={`grid ${isFocus ? "grid-cols-1" : "xl:grid-cols-12"} gap-6 items-start`}>
          {/* Board column — center, large, like offline focus mode */}
          <div className={`${isFocus ? "w-full max-w-3xl mx-auto" : "xl:col-span-8"} flex flex-col items-center gap-3 w-full`}>
            {/* The board — themed via data-board-theme (drives CSS variables) */}
            <div
              className="chess-board-wrap relative w-full max-w-2xl aspect-square rounded-2xl overflow-hidden border-4 md:border-8 shadow-2xl shadow-black/50"
              data-board-theme={boardTheme}
              style={{ borderColor: isDark ? "#1c1917" : "#a8a29e" }}
            >
              <Chessboard
                options={{
                  position: fen,
                  onPieceDrop,
                  onSquareClick,
                  boardOrientation: boardOrientation as "white" | "black",
                  boardStyle: { borderRadius: "0" },
                  darkSquareStyle: { backgroundColor: "var(--dark-sq)" },
                  lightSquareStyle: { backgroundColor: "var(--light-sq)" },
                  squareStyles,
                  animationDurationInMs: 180,
                  allowDragging: isMyTurn && !busy,
                  showNotation: true,
                }}
              />
              {activeGame.status === "playing" && !isMyTurn && (
                <div className="absolute inset-0 pointer-events-none bg-stone-950/5" />
              )}
              {busy && (
                <div className="absolute top-2 right-2 bg-stone-950/70 backdrop-blur-sm rounded-md px-2 py-1 flex items-center gap-1.5 text-xs text-amber-300">
                  <Loader2 className="size-3 animate-spin" />
                  syncing
                </div>
              )}
            </div>

            {/* Turn status bar — always visible, even in focus mode */}
            <div className={`w-full max-w-2xl flex items-center justify-between gap-3 px-1`}>
              <div className={`flex items-center gap-2 text-sm font-semibold ${
                activeGame.status !== "playing"
                  ? "text-stone-400"
                  : isMyTurn
                  ? "text-emerald-400"
                  : isDark ? "text-stone-400" : "text-stone-600"
              }`}>
                <span className={`size-2.5 rounded-full flex-shrink-0 ${
                  activeGame.status !== "playing"
                    ? "bg-stone-600"
                    : isMyTurn
                    ? "bg-emerald-400 animate-pulse"
                    : "bg-stone-600"
                }`} />
                {activeGame.status !== "playing"
                  ? `Game over — ${activeGame.status}`
                  : isMyTurn
                  ? "Your move"
                  : `${opponent.name} is thinking…`}
                {activeGame.status === "playing" && game.inCheck() && (
                  <span className="text-xs font-bold text-rose-400 bg-rose-500/15 border border-rose-500/30 px-1.5 py-0.5 rounded-md">
                    CHECK
                  </span>
                )}
              </div>
              <div className={`text-xs font-mono tabular-nums font-bold ${
                activeGame.turn === myColor
                  ? (myColor === "white" ? whiteClockMs : blackClockMs) <= 30000
                    ? "text-rose-400"
                    : "text-emerald-400"
                  : isDark ? "text-stone-500" : "text-stone-400"
              }`}>
                {fmtTime(myColor === "white" ? whiteClockMs : blackClockMs)}
              </div>
            </div>

            {/* Action bar — hidden in focus mode (back button at top handles resign) */}
            {!isFocus && activeGame.status === "playing" && (
              <div className="flex gap-2 pt-2 w-full max-w-2xl">
                <Button
                  variant="outline"
                  onClick={() => setResignDialog(true)}
                  disabled={busy}
                  className={`flex-1 h-10 hover:bg-rose-950/30 hover:text-rose-300 hover:border-rose-800 game-action-btn ${actionBtnCls}`}
                  title="Resign this game"
                >
                  <Flag className="size-3.5 mr-1.5" />
                  Resign
                </Button>
                <Button
                  variant="outline"
                  onClick={handleOfferDraw}
                  disabled={busy || !!activeGame.drawOfferBy}
                  className={`flex-1 h-10 hover:bg-amber-950/30 hover:text-amber-300 hover:border-amber-800 game-action-btn ${actionBtnCls} ${activeGame.drawOfferBy === profile.uid ? "border-amber-700/50 text-amber-400" : ""}`}
                  title={activeGame.drawOfferBy === profile.uid ? "Draw offer pending…" : "Offer a draw"}
                >
                  <Handshake className="size-3.5 mr-1.5" />
                  {activeGame.drawOfferBy === profile.uid ? "Draw offered…" : "Offer Draw"}
                </Button>
              </div>
            )}
          </div>

          {/* Right rail: 15-min chess clock + move history.
              Hidden entirely in focus mode. */}
          {!isFocus && (
            <aside className="xl:col-span-4 w-full">
              {/* 15-minute chess clock */}
              <div className={subCardCls}>
                <div className={`px-4 py-3 border-b flex items-center justify-between gap-2 ${isDark ? "border-stone-800" : "border-stone-300"}`}>
                  <div className="flex items-center gap-2">
                    <Clock className="size-4 text-amber-400" />
                    <h3 className={`text-xs font-bold uppercase tracking-wider ${isDark ? "text-stone-400" : "text-stone-600"}`}>
                      Game Clock
                    </h3>
                  </div>
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${isDark ? "bg-stone-800 text-stone-500" : "bg-stone-100 text-stone-400"}`}>
                    15 min rapid
                  </span>
                </div>
                <div className="p-3 space-y-2">
                  <ClockRow
                    name={opponent.name}
                    color={opponent.color}
                    ms={opponent.color === "white" ? whiteClockMs : blackClockMs}
                    isTurn={activeGame.turn === opponent.color && activeGame.status === "playing"}
                    isDark={isDark}
                    isMe={false}
                  />
                  <ClockRow
                    name={me.name}
                    color={me.color}
                    ms={me.color === "white" ? whiteClockMs : blackClockMs}
                    isTurn={activeGame.turn === me.color && activeGame.status === "playing"}
                    isDark={isDark}
                    isMe
                  />
                  <div className={`flex items-center gap-1.5 pt-1 text-[10px] ${isDark ? "text-stone-600" : "text-stone-400"}`}>
                    <CircleDot className="size-3 text-emerald-500" />
                    Clock ticks on your turn · run out = lose on time
                  </div>
                </div>
              </div>

              {/* Move history panel */}
              <div className={`mt-4 ${subCardCls}`}>
                <div className={`px-4 py-3 border-b flex items-center justify-between gap-2 ${isDark ? "border-stone-800" : "border-stone-300"}`}>
                  <div className="flex items-center gap-2">
                    <span className="text-base">♟</span>
                    <h3 className={`text-xs font-bold uppercase tracking-wider ${isDark ? "text-stone-400" : "text-stone-600"}`}>
                      Move History
                    </h3>
                  </div>
                  <span className={`text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded ${isDark ? "bg-stone-800 text-stone-500" : "bg-stone-100 text-stone-400"}`}>
                    {Math.ceil(activeGame.moves.length / 2)} moves
                  </span>
                </div>
                <MoveList
                  game={activeGame}
                  myUid={profile.uid}
                  opponentName={opponent.name}
                  myName={me.name}
                  isDark={isDark}
                />
              </div>

              <div className={`mt-4 rounded-2xl border p-4 text-xs leading-relaxed ${isDark ? "border-stone-800 bg-stone-900/60 text-stone-400" : "border-stone-300 bg-white text-stone-600"}`}>
                <p className={`font-medium mb-1.5 ${isDark ? "text-stone-300" : "text-stone-800"}`}>Focus mode tips</p>
                <ul className="space-y-1 list-disc list-inside">
                  <li>Click a piece, then click target square to move.</li>
                  <li>Drag-and-drop is also supported.</li>
                  <li>Green dots = legal moves. Red rings = captures.</li>
                  <li>Moves sync in real-time via Firestore.</li>
                  <li>The back button = resign while a match is live.</li>
                  <li>Press the focus button to hide everything except the board.</li>
                </ul>
              </div>
            </aside>
          )}
        </div>
      </main>

      <Dialog open={resignDialog} onOpenChange={setResignDialog}>
        <DialogContent className="bg-stone-900 border-stone-700 text-stone-100">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Flag className="size-5 text-rose-400" />
              Resign this game?
            </DialogTitle>
            <DialogDescription className="text-stone-400">
              Pressing the back button during a live match counts as resigning.
              This will count as a loss — {opponent.name} will be awarded the win.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setResignDialog(false)} className="text-stone-300">
              Keep playing
            </Button>
            <Button onClick={handleResign} disabled={busy} className="bg-rose-500 text-white hover:bg-rose-400">
              <Flag className="size-4 mr-1.5" />
              Resign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={drawDialog === "incoming"} onOpenChange={(o) => !o && setDrawDialog(null)}>
        <DialogContent className="bg-stone-900 border-stone-700 text-stone-100">
          <DialogHeader>
            <DialogTitle>Draw offer</DialogTitle>
            <DialogDescription className="text-stone-400">
              {opponent.name} is offering a draw. Accept to end the game in a tie.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => handleDrawResponse(false)} disabled={busy} className="text-stone-300">
              <XCircle className="size-4 mr-1.5" />
              Decline
            </Button>
            <Button onClick={() => handleDrawResponse(true)} disabled={busy} className="bg-emerald-500 text-stone-950 hover:bg-emerald-400">
              <CheckCircle2 className="size-4 mr-1.5" />
              Accept
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={drawDialog === "outgoing"} onOpenChange={(o) => !o && setDrawDialog(null)}>
        <DialogContent className="bg-stone-900 border-stone-700 text-stone-100">
          <DialogHeader>
            <DialogTitle>Draw offer sent</DialogTitle>
            <DialogDescription className="text-stone-400">
              Waiting for {opponent.name} to respond…
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDrawDialog(null)} className="text-stone-300">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!endGameInfo} onOpenChange={() => {}}>
        <DialogContent className="bg-stone-900 border-stone-700 text-stone-100 overflow-hidden p-0 max-w-sm">
          {/* Result banner */}
          <div className={`relative px-6 pt-8 pb-6 text-center ${
            endGameInfo?.tone === "win"
              ? "bg-gradient-to-b from-amber-500/20 to-transparent"
              : endGameInfo?.tone === "loss"
              ? "bg-gradient-to-b from-rose-500/15 to-transparent"
              : "bg-gradient-to-b from-stone-700/30 to-transparent"
          }`}>
            {endGameInfo?.tone === "win" && (
              <div className="mb-3">
                <motion.div
                  initial={{ scale: 0, rotate: -20 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: "spring", stiffness: 300, damping: 18 }}
                  className="size-16 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center mx-auto shadow-lg shadow-amber-500/30"
                >
                  <Crown className="size-8 text-stone-950" />
                </motion.div>
              </div>
            )}
            {endGameInfo?.tone === "loss" && (
              <div className="mb-3">
                <div className="size-16 rounded-full bg-rose-500/20 border border-rose-500/40 flex items-center justify-center mx-auto">
                  <Flag className="size-8 text-rose-400" />
                </div>
              </div>
            )}
            {endGameInfo?.tone === "draw" && (
              <div className="mb-3">
                <div className="size-16 rounded-full bg-stone-700/50 border border-stone-600 flex items-center justify-center mx-auto">
                  <Handshake className="size-8 text-stone-300" />
                </div>
              </div>
            )}
            <h2 className={`text-2xl font-black mb-1 ${
              endGameInfo?.tone === "win" ? "text-amber-300" :
              endGameInfo?.tone === "loss" ? "text-rose-400" : "text-stone-200"
            }`}>{endGameInfo?.title}</h2>
            <p className="text-sm text-stone-400">{endGameInfo?.detail}</p>
          </div>

          {/* Stats row */}
          <div className="px-6 pb-2">
            <div className="grid grid-cols-3 gap-2 mb-4">
              <div className="rounded-lg bg-stone-800/60 p-2.5 text-center">
                <div className="text-xs text-stone-500 uppercase tracking-wider mb-1">Moves</div>
                <div className="text-lg font-bold text-stone-200">{Math.ceil(activeGame.moves.length / 2)}</div>
              </div>
              <div className="rounded-lg bg-stone-800/60 p-2.5 text-center">
                <div className="text-xs text-stone-500 uppercase tracking-wider mb-1">Result</div>
                <div className={`text-lg font-bold ${
                  endGameInfo?.tone === "win" ? "text-emerald-400" :
                  endGameInfo?.tone === "loss" ? "text-rose-400" : "text-stone-300"
                }`}>
                  {endGameInfo?.tone === "win" ? "+1" : endGameInfo?.tone === "loss" ? "-1" : "½"}
                </div>
              </div>
              <div className="rounded-lg bg-stone-800/60 p-2.5 text-center">
                <div className="text-xs text-stone-500 uppercase tracking-wider mb-1">Type</div>
                <div className="text-xs font-bold text-stone-300 leading-tight mt-0.5 capitalize">{activeGame.status}</div>
              </div>
            </div>

            <div className="flex gap-2 pb-6">
              <Button
                variant="outline"
                onClick={handleLeaveAfterGame}
                className="flex-1 border-stone-700 bg-stone-800 text-stone-200 hover:bg-stone-700"
              >
                <ArrowLeft className="size-4 mr-1.5" />
                Lobby
              </Button>
              <Button
                onClick={handleLeaveAfterGame}
                className="flex-1 bg-amber-500 text-stone-950 hover:bg-amber-400 font-semibold"
              >
                <RotateCcw className="size-4 mr-1.5" />
                New Game
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ----- Player card (top of page) — avatar + level + username + color chip --

function PlayerCard({
  name,
  color,
  levelLabel,
  levelTone,
  stats,
  photoURL,
  isMe,
  isOpponent,
  isDark,
}: {
  name: string;
  color: PieceColor;
  levelLabel: string;
  levelTone: string;
  stats: string;
  photoURL: string | null;
  isMe?: boolean;
  isOpponent?: boolean;
  isDark: boolean;
}) {
  const cardBg = isDark ? "border-stone-800 bg-stone-900/60" : "border-stone-300 bg-white";
  const nameColor = isDark ? "text-stone-100" : "text-stone-900";
  const mutedColor = isDark ? "text-stone-500" : "text-stone-500";
  const subColor = isDark ? "text-stone-400" : "text-stone-600";
  return (
    <div className={`rounded-xl border p-3 flex items-center gap-3 ${cardBg}`}>
      <Avatar className={`size-10 ring-1 ${isDark ? "ring-stone-700" : "ring-stone-300"}`}>
        <AvatarImage src={photoURL ?? undefined} />
        <AvatarFallback className={isDark ? "bg-stone-800 text-amber-300 text-sm" : "bg-stone-200 text-amber-700 text-sm"}>
          {name.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-sm font-semibold truncate ${nameColor}`}>{name}</span>
          {isMe && (
            <Badge variant="outline" className="border-amber-500/30 text-amber-300 text-[9px] px-1 py-0">
              You
            </Badge>
          )}
          {isOpponent && (
            <Badge variant="outline" className={`text-[9px] px-1 py-0 ${isDark ? "border-stone-700 text-stone-400" : "border-stone-300 text-stone-500"}`}>
              Opponent
            </Badge>
          )}
        </div>
        <div className={`text-[10px] uppercase tracking-wider mt-0.5 ${mutedColor}`}>
          <span className={levelTone}>{levelLabel}</span>
          <span className="mx-1.5">·</span>
          <span className={subColor}>{stats}</span>
        </div>
      </div>
      <ColorChipBadge color={color} />
    </div>
  );
}

// Color chip badge used by PlayerCard.
function ColorChipBadge({ color }: { color: PieceColor }) {
  const isWhite = color === "white";
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border ${
        isWhite
          ? "bg-stone-100 text-stone-900 border-stone-300"
          : "bg-stone-950 text-stone-100 border-stone-700"
      }`}
    >
      <span
        className={`size-3 rounded-sm ${isWhite ? "bg-white border border-stone-300" : "bg-stone-950 border border-stone-600"}`}
      />
      {isWhite ? "White" : "Black"}
    </span>
  );
}

// ----- Lost Pieces box — shows the chessman glyphs each player has lost --
const PIECE_GLYPHS: Record<string, string> = {
  p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚",
};

function LostBox({
  title,
  subtitle,
  types,
  materialScore,
  ownerColor,
  isDark,
}: {
  title: string;
  subtitle: string;
  types: string[];
  materialScore: number; // positive = up, negative = down, 0 = even
  ownerColor: PieceColor;
  isDark: boolean;
}) {
  const cardBg = isDark ? "border-stone-800 bg-stone-900/40" : "border-stone-300 bg-white";
  const titleColor = isDark ? "text-stone-400" : "text-stone-600";
  // Sort by piece value so pawns come first, queen last
  const order: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  const sorted = [...types].sort((a, b) => (order[a] ?? 0) - (order[b] ?? 0));

  const materialCls = materialScore > 0
    ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
    : materialScore < 0
    ? "bg-rose-500/10 text-rose-400 border border-rose-500/25"
    : "bg-stone-700/30 text-stone-500 border border-stone-700/40";

  return (
    <div className={`rounded-xl border p-3 ${cardBg}`}>
      <div className="flex items-center justify-between mb-2">
        <span className={`text-[10px] uppercase tracking-wider font-bold ${titleColor}`}>{title}</span>
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${materialCls}`}>
          {materialScore > 0 ? `+${materialScore}` : materialScore < 0 ? `${materialScore}` : "Even"}
        </span>
      </div>
      <div className="flex items-center gap-0.5 min-h-[28px] flex-wrap">
        {sorted.length === 0 ? (
          <span className={`text-[11px] italic ${isDark ? "text-stone-600" : "text-stone-400"}`}>—</span>
        ) : (
          sorted.map((t, i) => (
            <span
              key={i}
              title={({ p: "Pawn", n: "Knight", b: "Bishop", r: "Rook", q: "Queen", k: "King" }[t] ?? "")}
              className={`text-[22px] leading-none captured-piece cursor-default ${
                ownerColor === "white"
                  ? isDark ? "text-stone-100" : "text-stone-800"
                  : isDark ? "text-stone-900 drop-shadow-[0_0_1px_rgba(255,255,255,0.6)]" : "text-stone-900"
              }`}
              style={{ filter: ownerColor === "black" && isDark ? "drop-shadow(0 0 2px rgba(255,255,255,0.5))" : undefined }}
            >
              {PIECE_GLYPHS[t] ?? ""}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

// ----- Clock row in the right-side Game Clock panel -----------------------

function ClockRow({
  name,
  color,
  ms,
  isTurn,
  isMe,
  isDark,
}: {
  name: string;
  color: PieceColor;
  ms: number;
  isTurn: boolean;
  isMe: boolean;
  isDark: boolean;
}) {
  const lowTime = ms <= 30_000; // under 30s — render in rose
  const criticalTime = ms <= 10_000; // under 10s — extra urgent
  const pct = Math.max(0, Math.min(100, (ms / INITIAL_TIME_MS) * 100));

  const rowBg = isTurn
    ? lowTime
      ? "bg-rose-500/10 border-rose-500/40"
      : "bg-emerald-500/8 border-emerald-500/30"
    : isDark
      ? "bg-stone-950/60 border-stone-800"
      : "bg-stone-50 border-stone-300";

  const timeColor = criticalTime
    ? "text-rose-400 clock-low"
    : lowTime
    ? "text-rose-400"
    : isTurn
      ? "text-emerald-300"
      : isDark
        ? "text-stone-300"
        : "text-stone-700";

  const barColor = criticalTime
    ? "bg-rose-500"
    : lowTime
    ? "bg-orange-500"
    : isTurn
    ? "bg-emerald-500"
    : "bg-stone-600";

  const nameColor = isDark ? "text-stone-200" : "text-stone-800";
  const mutedColor = isDark ? "text-stone-500" : "text-stone-500";

  return (
    <div className={`rounded-lg border overflow-hidden transition-all duration-300 ${rowBg}`}>
      {/* Time progress bar at top */}
      <div className={`h-0.5 ${isDark ? "bg-stone-800" : "bg-stone-200"}`}>
        <div
          className={`h-full transition-all duration-1000 ease-linear ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center gap-3 px-3 py-2">
        <span
          className={`size-3.5 rounded-full border-2 flex-shrink-0 shadow-sm ${
            color === "white"
              ? "bg-stone-100 border-stone-300 shadow-stone-200/50"
              : "bg-stone-950 border-stone-600 shadow-stone-900/50"
          }`}
        />
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-semibold truncate flex items-center gap-1.5 ${nameColor}`}>
            {name}
            {isMe && (
              <span className={`text-[9px] uppercase tracking-wider px-1 py-0.5 rounded bg-amber-500/15 text-amber-400 font-bold`}>you</span>
            )}
          </div>
          <div className={`text-[10px] uppercase tracking-wider flex items-center gap-1 ${mutedColor}`}>
            {color === "white" ? "♔ White" : "♚ Black"}
            {isTurn && (
              <span className="text-emerald-400 font-bold ml-1">● THINKING</span>
            )}
          </div>
        </div>
        <div className={`font-mono text-xl tabular-nums font-bold tracking-tight ${timeColor}`}>
          {fmtTime(ms)}
        </div>
      </div>
    </div>
  );
}

// ----- Move list (right column, second panel) -----------------------------

function MoveList({
  game,
  myUid,
  opponentName,
  myName,
  isDark,
}: {
  game: GameDoc;
  myUid: string;
  opponentName: string;
  myName: string;
  isDark: boolean;
}) {
  const moves = game.moves;
  if (moves.length === 0) {
    return (
      <div className="p-6 text-center">
        <div className="size-10 rounded-full bg-stone-800/60 flex items-center justify-center mx-auto mb-3">
          <span className="text-2xl">♟</span>
        </div>
        <p className={`text-xs font-semibold mb-1 ${isDark ? "text-stone-400" : "text-stone-600"}`}>No moves yet</p>
        <p className={`text-[10px] ${isDark ? "text-stone-600" : "text-stone-400"}`}>
          {game.turn === "white" ? "White" : "Black"} to move first.
        </p>
      </div>
    );
  }
  const rows: { num: number; white?: { san: string; by: string }; black?: { san: string; by: string } }[] = [];
  for (let i = 0; i < moves.length; i += 2) {
    rows.push({
      num: Math.floor(i / 2) + 1,
      white: moves[i] ? { san: moves[i].san, by: moves[i].by } : undefined,
      black: moves[i + 1] ? { san: moves[i + 1].san, by: moves[i + 1].by } : undefined,
    });
  }
  const headBg = isDark ? "bg-stone-900" : "bg-stone-50";
  const headText = isDark ? "text-stone-500" : "text-stone-500";
  const rowText = isDark ? "text-stone-300" : "text-stone-700";
  const rowHover = isDark ? "hover:bg-amber-500/5" : "hover:bg-amber-500/10";
  const numText = isDark ? "text-stone-600" : "text-stone-400";
  const moveText = isDark ? "text-stone-200" : "text-stone-900";
  const divider = isDark ? "divide-stone-800/60" : "divide-stone-200";
  const border = isDark ? "border-stone-800" : "border-stone-300";
  return (
    <div className="max-h-[60vh] overflow-y-auto move-history-scroll">
      <table className="w-full text-left border-collapse">
        <thead className={`sticky top-0 ${headBg}`}>
          <tr className={`text-[10px] font-black uppercase ${headText} border-b ${border}`}>
            <th className="py-2 px-3 text-center w-12">#</th>
            <th className="py-2 px-3">White Move</th>
            <th className="py-2 px-3">Black Move</th>
          </tr>
        </thead>
        <tbody className={`divide-y ${divider} text-xs font-medium ${rowText}`}>
          {rows.map((r, rowIdx) => {
            const isLastRow = rowIdx === rows.length - 1;
            return (
              <tr
                key={r.num}
                className={`${rowHover} transition-colors ${isLastRow ? "move-current" : ""}`}
              >
                <td className={`py-2 px-3 font-bold text-center tabular-nums ${numText}`}>{r.num}.</td>
                <td className={`py-2 px-3 font-mono font-semibold ${moveText}`}>
                  {r.white?.san ?? "—"}
                  {r.white && r.white.by === myUid && (
                    <span className="ml-1 text-[8px] font-sans uppercase tracking-wider text-amber-400/60">you</span>
                  )}
                </td>
                <td className={`py-2 px-3 font-mono font-semibold ${moveText}`}>
                  {r.black ? (
                    <>
                      {r.black.san}
                      {r.black.by === myUid && (
                        <span className="ml-1 text-[8px] font-sans uppercase tracking-wider text-amber-400/60">you</span>
                      )}
                    </>
                  ) : (
                    <span className="text-[10px] italic font-sans text-stone-600">…</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <AnimatePresence>
        <motion.div
          key={moves.length}
          initial={{ opacity: 0, x: -4 }}
          animate={{ opacity: 1, x: 0 }}
          className={`px-3 py-2 text-[10px] border-t ${border} ${isDark ? "bg-stone-950/40 text-stone-500" : "bg-stone-50 text-stone-500"}`}
        >
          Last move by{" "}
          <span className={isDark ? "text-stone-300" : "text-stone-700"}>
            {moves[moves.length - 1]?.by === myUid ? myName : opponentName}
          </span>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function findKing(pieces: ReturnType<Chess["board"]>, color: "w" | "b"): string | null {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = pieces[r][c];
      if (p && p.type === "k" && p.color === color) {
        const file = "abcdefgh"[c];
        const rank = 8 - r;
        return `${file}${rank}`;
      }
    }
  }
  return null;
}

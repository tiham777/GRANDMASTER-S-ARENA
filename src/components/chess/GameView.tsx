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
} from "@/lib/chessApi";
import type { GameDoc, PieceColor, GameStatus } from "@/lib/types";

function fmtTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
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

  // Per-turn elapsed timer (count-up; no per-game clock in v1)
  useEffect(() => {
    if (!activeGame || activeGame.status !== "playing") return;
    const id = setInterval(() => {
      const now = Date.now();
      setElapsed(now - activeGame.lastMoveAt);
    }, 250);
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
        winnerUid
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Move failed";
      toast({ title: "Move failed", description: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }, [activeGame, isMyTurn, busy, profile.uid, toast]);

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

  function handleLeave() {
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

  const topPlayer = opponent;
  const bottomPlayer = me;
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

  return (
    <div className="min-h-screen flex flex-col bg-stone-950">
      {/* Top bar — merged with offline look */}
      <header className="border-b border-stone-900 bg-stone-950/90 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 h-12 flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLeave}
            className="text-stone-400 hover:text-stone-200 hover:bg-stone-800/60"
          >
            <ArrowLeft className="size-4" />
            <span className="ml-1.5 hidden sm:inline">Lobby</span>
          </Button>
          <div className="size-7 rounded bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-sm">
            <Crown className="size-4 text-stone-950" />
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-sm font-semibold text-stone-100 tracking-tight">
              Grandmaster&apos;s Arena
            </span>
            <span className="text-[10px] text-stone-500 uppercase tracking-wider mt-0.5 hidden sm:inline">
              Focus Mode · Online Multiplayer
            </span>
          </div>
          <Badge
            variant="outline"
            className="ml-1 border-stone-700 text-stone-300 text-[10px]"
          >
            <CircleDot
              className={`size-2.5 mr-1 ${
                isMyTurn ? "text-emerald-400 dot-online" : "text-stone-600"
              }`}
            />
            {isMyTurn ? "Your move" : "Waiting…"}
          </Badge>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-stone-400 hover:text-stone-200"
            onClick={() => setMuted((m) => !m)}
            title={muted ? "Enable audio" : "Disable audio"}
          >
            {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </Button>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-4 md:py-6">
        <div className="grid xl:grid-cols-12 gap-6 items-start">
          {/* Board column — center, large, like offline focus mode */}
          <div className="xl:col-span-8 flex flex-col items-center gap-3 w-full">
            {/* Opponent (top) — captured pieces + name + timer */}
            <PlayerBar
              name={topPlayer.name}
              color={topPlayer.color}
              isTurn={activeGame.turn === topPlayer.color && activeGame.status === "playing"}
              elapsedMs={activeGame.turn === topPlayer.color ? elapsed : 0}
              photoURL={null}
              capturedTypes={captured.opp}
              materialDiff={-materialDiff}
              isOpponent
            />

            {/* The board — Classic Walnut theme (matches offline) */}
            <div className="chess-board-wrap relative w-full max-w-2xl aspect-square rounded-2xl overflow-hidden border-4 md:border-8 border-stone-900 shadow-2xl shadow-black/50">
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

            {/* Me (bottom) — captured pieces + name + timer */}
            <PlayerBar
              name={bottomPlayer.name}
              color={bottomPlayer.color}
              isTurn={activeGame.turn === bottomPlayer.color && activeGame.status === "playing"}
              elapsedMs={activeGame.turn === bottomPlayer.color ? elapsed : 0}
              photoURL={profile.photoURL}
              capturedTypes={captured.mine}
              materialDiff={materialDiff}
              isMe
            />

            {/* Action bar */}
            {activeGame.status === "playing" && (
              <div className="flex gap-2 pt-1 w-full max-w-2xl">
                <Button
                  variant="outline"
                  onClick={() => setResignDialog(true)}
                  disabled={busy}
                  className="flex-1 border-stone-800 bg-stone-900 hover:bg-rose-950/30 hover:text-rose-300 hover:border-rose-800 text-stone-200"
                >
                  <Flag className="size-4 mr-1.5" />
                  Resign
                </Button>
                <Button
                  variant="outline"
                  onClick={handleOfferDraw}
                  disabled={busy || !!activeGame.drawOfferBy}
                  className="flex-1 border-stone-800 bg-stone-900 hover:bg-amber-950/30 hover:text-amber-300 hover:border-amber-800 text-stone-200"
                >
                  <Handshake className="size-4 mr-1.5" />
                  {activeGame.drawOfferBy === profile.uid ? "Offered" : "Draw"}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleLeave}
                  disabled={busy}
                  className="border-stone-800 bg-stone-900 hover:bg-stone-800 text-stone-300"
                  title="Leave game (return to lobby)"
                >
                  <RotateCcw className="size-4" />
                  <span className="ml-1.5 hidden sm:inline">Lobby</span>
                </Button>
              </div>
            )}
          </div>

          {/* Right rail: move history — matches the offline game's "Move Timeline" panel */}
          <aside className="xl:col-span-4 w-full">
            <div className="rounded-2xl border border-stone-800 bg-stone-900 overflow-hidden shadow-md">
              <div className="px-4 py-3 border-b border-stone-800 flex items-center gap-2">
                <Clock className="size-4 text-amber-400" />
                <h3 className="text-xs font-bold text-stone-400 uppercase tracking-wider">
                  Move Timeline
                </h3>
              </div>
              <MoveList game={activeGame} myUid={profile.uid} opponentName={opponent.name} myName={me.name} />
            </div>

            <div className="mt-4 rounded-2xl border border-stone-800 bg-stone-900/60 p-4 text-xs text-stone-400 leading-relaxed">
              <p className="text-stone-300 font-medium mb-1.5">Focus mode tips</p>
              <ul className="space-y-1 list-disc list-inside">
                <li>Click a piece, then click target square to move.</li>
                <li>Drag-and-drop is also supported.</li>
                <li>Green dots = legal moves. Red rings = captures.</li>
                <li>Moves sync in real-time via Firestore.</li>
                <li>Resign or offer a draw anytime.</li>
              </ul>
            </div>
          </aside>
        </div>
      </main>

      <Dialog open={resignDialog} onOpenChange={setResignDialog}>
        <DialogContent className="bg-stone-900 border-stone-700 text-stone-100">
          <DialogHeader>
            <DialogTitle>Resign this game?</DialogTitle>
            <DialogDescription className="text-stone-400">
              This will count as a loss. {opponent.name} will be awarded the win.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setResignDialog(false)} className="text-stone-300">
              Cancel
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
        <DialogContent className="bg-stone-900 border-stone-700 text-stone-100">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {endGameInfo?.tone === "win" && <Crown className="size-5 text-amber-400" />}
              {endGameInfo?.tone === "loss" && <AlertTriangle className="size-5 text-rose-400" />}
              {endGameInfo?.tone === "draw" && <Handshake className="size-5 text-stone-300" />}
              {endGameInfo?.title}
            </DialogTitle>
            <DialogDescription className="text-stone-400">{endGameInfo?.detail}</DialogDescription>
          </DialogHeader>
          <div className="text-xs text-stone-500">
            Status: <span className="text-stone-300">{activeGame.status}</span>
            {activeGame.winnerUid && (
              <> · Winner: <span className="text-stone-300">{activeGame.winnerUid === profile.uid ? "You" : opponent.name}</span></>
            )}
          </div>
          <DialogFooter>
            <Button onClick={handleLeave} className="bg-amber-500 text-stone-950 hover:bg-amber-400">
              Back to Lobby
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ----- PlayerBar with captured pieces (matches offline game's captured bar) -----------

const PIECE_GLYPHS: Record<string, string> = {
  p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚",
};

function PlayerBar({
  name,
  color,
  isTurn,
  elapsedMs,
  photoURL,
  capturedTypes,
  materialDiff,
  isMe,
  isOpponent,
}: {
  name: string;
  color: PieceColor;
  isTurn: boolean;
  elapsedMs: number;
  photoURL: string | null;
  capturedTypes: string[];
  materialDiff: number;
  isMe?: boolean;
  isOpponent?: boolean;
}) {
  return (
    <div className="w-full max-w-2xl flex items-center gap-3 px-3 py-2 rounded-xl bg-stone-900/60 border border-stone-800">
      <Avatar className="size-9 ring-1 ring-stone-700">
        <AvatarImage src={photoURL ?? undefined} />
        <AvatarFallback className="bg-stone-800 text-amber-300 text-xs">
          {name.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-stone-100 truncate">{name}</span>
          {isMe && (
            <Badge variant="outline" className="border-amber-500/30 text-amber-300 text-[9px] px-1 py-0">
              You
            </Badge>
          )}
          {isOpponent && (
            <Badge variant="outline" className="border-stone-700 text-stone-400 text-[9px] px-1 py-0">
              Opponent
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] uppercase tracking-wider text-stone-500">
            {color === "white" ? "White" : "Black"}
          </span>
          {/* Captured pieces */}
          <div className="flex items-center gap-0.5 text-stone-300 text-sm leading-none">
            {capturedTypes.map((t, i) => (
              <span key={i} className={color === "white" ? "text-stone-900 invert" : "text-stone-100"}>
                {PIECE_GLYPHS[t] ?? ""}
              </span>
            ))}
          </div>
          {materialDiff > 0 && (
            <span className="text-[10px] font-bold text-emerald-400">+{materialDiff}</span>
          )}
        </div>
      </div>
      <div
        className={`px-2.5 py-1.5 rounded-md font-mono text-sm tabular-nums ${
          isTurn
            ? "bg-amber-500/15 text-amber-300 border border-amber-500/40"
            : "bg-stone-950/60 text-stone-500 border border-stone-800"
        }`}
      >
        {isTurn ? fmtTime(elapsedMs) : "—"}
      </div>
    </div>
  );
}

function MoveList({
  game,
  myUid,
  opponentName,
  myName,
}: {
  game: GameDoc;
  myUid: string;
  opponentName: string;
  myName: string;
}) {
  const moves = game.moves;
  if (moves.length === 0) {
    return (
      <div className="p-6 text-center text-xs text-stone-500">
        <p className="font-bold text-stone-400 mb-1">No moves registered yet</p>
        <p className="text-[10px] text-stone-600">
          {game.turn === "white" ? "White" : "Black"} to start the match.
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
  return (
    <div className="max-h-[60vh] overflow-y-auto move-history-scroll">
      <table className="w-full text-left border-collapse">
        <thead className="sticky top-0 bg-stone-900">
          <tr className="text-[10px] font-black uppercase text-stone-500 border-b border-stone-800">
            <th className="py-2 px-3 text-center w-12">#</th>
            <th className="py-2 px-3">White Move</th>
            <th className="py-2 px-3">Black Move</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-800/60 text-xs font-medium text-stone-300">
          {rows.map((r) => (
            <tr key={r.num} className="hover:bg-amber-500/5 transition-colors">
              <td className="py-2 px-3 font-bold text-stone-600 text-center">{r.num}</td>
              <td className="py-2 px-3 font-semibold text-stone-200">
                {r.white?.san ?? ""}
                {r.white && r.white.by === myUid && (
                  <span className="ml-1 text-[9px] text-amber-400/70">(you)</span>
                )}
              </td>
              <td className="py-2 px-3 font-semibold text-stone-200">
                {r.black?.san ?? (
                  <span className="text-[10px] italic text-stone-600 font-normal">thinking…</span>
                )}
                {r.black && r.black.by === myUid && (
                  <span className="ml-1 text-[9px] text-amber-400/70">(you)</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <AnimatePresence>
        <motion.div
          key={moves.length}
          initial={{ opacity: 0, x: -4 }}
          animate={{ opacity: 1, x: 0 }}
          className="px-3 py-2 text-[10px] text-stone-500 border-t border-stone-800/60 bg-stone-950/40"
        >
          Last move by{" "}
          <span className="text-stone-300">
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

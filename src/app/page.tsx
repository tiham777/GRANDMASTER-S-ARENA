"use client";

/**
 * Home page — the chess app's single entry point.
 *
 * Acts as a view router based on the Zustand store's `view` field. The app
 * is intentionally single-route (`/`) — all navigation is in-client via the
 * store, so the back button and refresh behave predictably.
 *
 * Online games support deep-linking via `?join=CODE` — if present on load,
 * we jump straight to the online lobby with the code pre-filled.
 */
import { useState, useCallback, useEffect } from "react";
import { motion } from "framer-motion";
import { Crown, Heart, Trophy, Flag, Handshake, Globe, RefreshCw, Home as HomeIcon, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { HomeView } from "@/components/chess/HomeView";
import { GameView, type CompletedGameSummary } from "@/components/chess/GameView";
import { GameOverView } from "@/components/chess/GameOverView";
import { StatsView } from "@/components/chess/StatsView";
import { OnlineLobbyView } from "@/components/chess/OnlineLobbyView";
import { OnlineGameView } from "@/components/chess/OnlineGameView";
import { OnlineSocketProvider, useSharedOnlineChess } from "@/components/chess/OnlineSocketProvider";
import { useChessStore, type NewGameConfig } from "@/lib/chessStore";
import { formatClock } from "@/lib/chessThemes";
import type { OnlineColor } from "@/lib/onlineTypes";

/** Extended summary for online games (includes opponent info). */
interface OnlineCompletedSummary {
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
}

export default function Home() {
  const view = useChessStore((s) => s.view);
  const activeConfig = useChessStore((s) => s.activeConfig);
  const startGame = useChessStore((s) => s.startGame);
  const goToView = useChessStore((s) => s.goToView);
  const backToHome = useChessStore((s) => s.backToHome);

  const [completedSummary, setCompletedSummary] = useState<CompletedGameSummary | null>(null);
  const [onlineSummary, setOnlineSummary] = useState<OnlineCompletedSummary | null>(null);
  // Read ?join=CODE once on mount (lazy initializer — runs only client-side
  // since this component is "use client").
  const [pendingJoinCode] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("join");
    if (code) {
      // Clean the URL so a refresh doesn't re-trigger.
      window.history.replaceState({}, "", window.location.pathname);
      return code.toUpperCase().slice(0, 6);
    }
    return null;
  });

  // If we arrived via ?join=CODE, jump straight to the online lobby.
  useEffect(() => {
    if (pendingJoinCode) {
      goToView("online-lobby");
    }
  }, [pendingJoinCode, goToView]);

  const handleStart = useCallback((config: NewGameConfig) => {
    setCompletedSummary(null);
    startGame(config);
  }, [startGame]);

  const handleGameComplete = useCallback((summary: CompletedGameSummary) => {
    setCompletedSummary(summary);
    goToView("gameover");
  }, [goToView]);

  const handleRematch = useCallback(() => {
    if (!activeConfig) {
      backToHome();
      return;
    }
    setCompletedSummary(null);
    startGame(activeConfig);
  }, [activeConfig, startGame, backToHome]);

  const handleExitGame = useCallback(() => {
    setCompletedSummary(null);
    backToHome();
  }, [backToHome]);

  const handleOnlineGameEnded = useCallback((summary: OnlineCompletedSummary) => {
    setOnlineSummary(summary);
    goToView("online-gameover");
  }, [goToView]);

  return (
    <div className="flex min-h-screen flex-col">
      <main className="flex-1">
        {view === "home" && (
          <HomeView
            onStart={handleStart}
            onShowStats={() => goToView("stats")}
            onShowHistory={() => goToView("stats")}
            onPlayOnline={() => goToView("online-lobby")}
          />
        )}

        {view === "game" && activeConfig && (
          <GameView
            config={activeConfig}
            onExit={handleExitGame}
            onGameComplete={handleGameComplete}
          />
        )}

        {view === "gameover" && completedSummary && activeConfig && (
          <GameOverView
            summary={completedSummary}
            config={activeConfig}
            onRematch={handleRematch}
            onHome={backToHome}
          />
        )}

        {view === "stats" && <StatsView onBack={backToHome} />}

        {(view === "online-lobby" || view === "online-game" || view === "online-gameover") && (
          <OnlineSocketProvider>
            {view === "online-lobby" && (
              <OnlineLobbyView
                onBack={backToHome}
                onGameStart={() => goToView("online-game")}
                initialJoinCode={pendingJoinCode}
              />
            )}
            {view === "online-game" && (
              <OnlineGameView
                onExit={() => {
                  goToView("online-lobby");
                }}
                onGameEnded={handleOnlineGameEnded}
              />
            )}
            {view === "online-gameover" && onlineSummary && (
              <OnlineGameOverView
                summary={onlineSummary}
                onHome={backToHome}
                onRematchStart={() => goToView("online-game")}
              />
            )}
          </OnlineSocketProvider>
        )}
      </main>

      {/* Sticky footer */}
      <footer className="mt-auto border-t border-border/60 bg-card/30 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:px-6">
          <div className="flex items-center gap-1.5">
            <Crown className="h-3.5 w-3.5 text-primary" />
            <span className="font-medium">Grandmaster&apos;s Arena</span>
            <span className="text-muted-foreground/60">·</span>
            <span>Chess.js + React-Chessboard + AI Coach + Online</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              Built with <Heart className="h-3 w-3 text-rose-400" /> for the royal game
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ============================================================
// OnlineGameOverView — inline, simpler than the AI version (no coach)
// ============================================================

function OnlineGameOverView({
  summary, onHome, onRematchStart,
}: {
  summary: OnlineCompletedSummary;
  onHome: () => void;
  onRematchStart: () => void;
}) {
  const { result, winner, playerColor, opponentName, pgn, moveCount, durationSec } = summary;
  const draw = result === "draw" || winner === "draw";
  const humanWon = winner === playerColor;
  const online = useSharedOnlineChess();
  const { toast } = useToast();

  const meta = draw
    ? { title: "Draw", icon: Handshake, color: "text-amber-400", bg: "bg-amber-500/15" }
    : humanWon
      ? { title: "Victory!", icon: Trophy, color: "text-emerald-400", bg: "bg-emerald-500/15" }
      : { title: "Defeat", icon: Flag, color: "text-rose-400", bg: "bg-rose-500/15" };
  const Icon = meta.icon;

  const room = online.room;
  const roomCode = room?.code ?? "";

  // When the game starts (rematch accepted), transition to the game view.
  useEffect(() => {
    if (room?.status === "playing") {
      onRematchStart();
    }
  }, [room?.status, onRematchStart]);

  // Handle rematch request
  const handleRequestRematch = () => {
    if (!roomCode) return;
    online.requestRematch(roomCode);
    toast({ title: "Rematch requested", description: "Waiting for opponent to accept…", duration: 2500 });
  };

  // Handle accept/decline
  const handleRespondRematch = (accept: boolean) => {
    if (!roomCode) return;
    online.respondRematch(roomCode, accept);
  };

  const rematchRequestedByOpponent =
    online.rematchRequestedBy && online.rematchRequestedBy !== playerColor;
  const rematchSentByMe = online.rematchSent && !online.rematchRequestedBy;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="mb-6 text-center"
      >
        <div className={`mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl ${meta.bg}`}>
          <Icon className={`h-9 w-9 ${meta.color}`} />
        </div>
        <h1 className={`text-3xl font-bold sm:text-4xl ${meta.color}`}>{meta.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          vs <span className="font-medium text-foreground">{opponentName}</span> · {result}
        </p>
      </motion.div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-card/60 p-3">
          <div className="text-xs text-muted-foreground">Your color</div>
          <div className="text-sm font-semibold capitalize">{playerColor}</div>
        </div>
        <div className="rounded-lg border border-border bg-card/60 p-3">
          <div className="text-xs text-muted-foreground">Moves</div>
          <div className="text-sm font-semibold">{moveCount}</div>
        </div>
        <div className="rounded-lg border border-border bg-card/60 p-3">
          <div className="text-xs text-muted-foreground">Duration</div>
          <div className="text-sm font-semibold">{formatClock(durationSec * 1000)}</div>
        </div>
      </div>

      {/* Rematch section */}
      <div className="mb-4">
        {/* Opponent requested rematch — show accept/decline */}
        {rematchRequestedByOpponent && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-center"
          >
            <p className="mb-3 text-sm font-semibold text-primary">
              {opponentName} wants a rematch!
            </p>
            <div className="flex justify-center gap-3">
              <Button
                size="lg"
                onClick={() => handleRespondRematch(true)}
                className="gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 font-semibold text-white hover:from-emerald-400 hover:to-teal-500"
              >
                <RefreshCw className="h-5 w-5" /> Accept
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => handleRespondRematch(false)}
                className="gap-2"
              >
                <X className="h-5 w-5" /> Decline
              </Button>
            </div>
          </motion.div>
        )}

        {/* You sent rematch — waiting */}
        {rematchSentByMe && (
          <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card/60 p-4">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="text-sm font-medium">Waiting for {opponentName} to accept…</span>
          </div>
        )}

        {/* Default: show rematch button */}
        {!rematchRequestedByOpponent && !rematchSentByMe && (
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              size="lg"
              onClick={handleRequestRematch}
              className="flex-1 gap-2 bg-gradient-to-r from-amber-500 to-amber-600 font-semibold text-stone-950 hover:from-amber-400 hover:to-amber-500"
            >
              <RefreshCw className="h-5 w-5" /> Request Rematch
            </Button>
            <Button size="lg" variant="outline" onClick={onHome} className="flex-1 gap-2">
              <HomeIcon className="h-5 w-5" /> Back to Menu
            </Button>
          </div>
        )}

        {/* If rematch declined or we declined, show back to menu */}
        {(online.rematchRequestedBy === null && !online.rematchSent) && !rematchRequestedByOpponent && (
          <div className="flex justify-center">
            <Button size="lg" variant="outline" onClick={onHome} className="gap-2">
              <HomeIcon className="h-5 w-5" /> Back to Menu
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

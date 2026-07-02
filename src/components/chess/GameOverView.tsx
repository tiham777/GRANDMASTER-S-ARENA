"use client";

/**
 * GameOverView — post-game screen.
 *
 * Shows the result, lets the player request AI coaching analysis,
 * copy/export the PGN, save the game to history, or start a rematch.
 */
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Crown, Trophy, Handshake, Clock, Flag, Sparkles, Loader2, Copy, Check,
  RefreshCw, Home, Download, Brain, AlertCircle, ThumbsUp, ThumbsDown,
  Lightbulb, FileText, ListOrdered,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import type { CompletedGameSummary } from "./GameView";
import type { NewGameConfig } from "@/lib/chessStore";
import type { CoachResponse, CoachMoveNote } from "@/lib/coachTypes";
import { formatClock } from "@/lib/chessThemes";

interface GameOverViewProps {
  summary: CompletedGameSummary;
  config: NewGameConfig;
  onRematch: () => void;
  onHome: () => void;
}

export function GameOverView({ summary, config, onRematch, onHome }: GameOverViewProps) {
  const { toast } = useToast();
  const [coach, setCoach] = useState<CoachResponse | null>(null);
  const [coachLoading, setCoachLoading] = useState(false);
  const [coachError, setCoachError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  // Determine the human's perspective for messaging.
  const humanColor = config.mode === "ai" ? config.playerColor : null;
  const humanWon =
    humanColor && summary.winner && summary.winner !== "draw"
      ? (summary.winner === "w" && humanColor === "white") ||
        (summary.winner === "b" && humanColor === "black")
      : null;

  const resultMeta = getResultMeta(summary.result, summary.winner, humanColor);

  // Auto-save the game once on mount (only for AI & local modes — not ai-vs-ai).
  useEffect(() => {
    if (saved) return;
    if (config.mode === "ai-vs-ai") {
      setSaved(true); // don't persist AI vs AI exhibitions
      return;
    }
    fetch("/api/games", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: config.mode,
        playerColor: humanColor,
        difficulty: config.mode === "ai" ? config.difficulty : null,
        result: summary.result,
        winner: summary.winner === "draw" ? "draw" : summary.winner,
        pgn: summary.pgn,
        fen: summary.finalFen,
        moveCount: summary.moveCount,
        durationSec: summary.durationSec,
        opening: summary.opening,
      }),
    })
      .then((r) => r.json())
      .then(() => setSaved(true))
      .catch((err) => {
        console.error("Failed to save game:", err);
        setSaved(true); // don't block the UI on save failure
      });
  }, [saved, config.mode, config.difficulty, humanColor, summary]);

  // Auto-request coaching for AI games (the most useful case).
  useEffect(() => {
    if (config.mode === "ai" && humanColor) {
      void requestCoach();
    }
  }, []);

  const requestCoach = async () => {
    setCoachLoading(true);
    setCoachError(null);
    try {
      const res = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pgn: summary.pgn,
          mode: config.mode,
          difficulty: config.difficulty,
          playerColor: humanColor === "black" ? "black" : "white",
          result: summary.result,
          winner: summary.winner === "draw" ? null : summary.winner,
          moveCount: summary.moveCount,
          durationSec: summary.durationSec,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || err.error || `HTTP ${res.status}`);
      }
      const data: CoachResponse = await res.json();
      setCoach(data);
    } catch (err) {
      setCoachError(err instanceof Error ? err.message : "Failed to get coaching");
    } finally {
      setCoachLoading(false);
    }
  };

  const handleCopyPgn = async () => {
    try {
      await navigator.clipboard.writeText(summary.pgn);
      setCopied(true);
      toast({ title: "PGN copied to clipboard", duration: 2000 });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Failed to copy", variant: "destructive" });
    }
  };

  const handleDownloadPgn = () => {
    const blob = new Blob([summary.pgn], { type: "application/x-chess-pgn" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `game-${new Date().toISOString().slice(0, 10)}.pgn`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      {/* Result banner */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="mb-6 text-center"
      >
        <div className={`mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl ${resultMeta.bg}`}>
          <resultMeta.icon className={`h-9 w-9 ${resultMeta.color}`} />
        </div>
        <h1 className={`text-3xl font-bold sm:text-4xl ${resultMeta.color}`}>
          {resultMeta.title}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{resultMeta.subtitle}</p>
      </motion.div>

      {/* Game summary cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard icon={<Crown className="h-4 w-4" />} label="Result" value={summary.result} />
        <SummaryCard icon={<ListOrdered className="h-4 w-4" />} label="Moves" value={String(summary.moveCount)} />
        <SummaryCard icon={<Clock className="h-4 w-4" />} label="Duration" value={formatClock(summary.durationSec * 1000)} />
        <SummaryCard
          icon={<Sparkles className="h-4 w-4" />}
          label="Opening"
          value={summary.opening ?? "—"}
        />
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          size="lg"
          onClick={onRematch}
          className="flex-1 gap-2 bg-gradient-to-r from-amber-500 to-amber-600 font-semibold text-stone-950 hover:from-amber-400 hover:to-amber-500"
        >
          <RefreshCw className="h-5 w-5" /> Rematch
        </Button>
        <Button size="lg" variant="outline" onClick={onHome} className="flex-1 gap-2">
          <Home className="h-5 w-5" /> Back to Menu
        </Button>
      </div>
    </div>
  );
}

// ============================================================
// Helpers
// ============================================================

function getResultMeta(
  result: CompletedGameSummary["result"],
  winner: Side | "draw" | null,
  humanColor: "white" | "black" | null,
): { title: string; subtitle: string; icon: typeof Crown; color: string; bg: string } {
  type Side = "w" | "b";
  const draw = result === "draw" || result === "stalemate" || winner === "draw";
  const humanWon =
    humanColor && winner && winner !== "draw"
      ? (winner === "w" && humanColor === "white") ||
        (winner === "b" && humanColor === "black")
      : null;

  if (draw) {
    return {
      title: "Draw",
      subtitle: result === "stalemate" ? "Stalemate — no legal moves." : "A balanced game.",
      icon: Handshake,
      color: "text-amber-400",
      bg: "bg-amber-500/15",
    };
  }
  if (humanColor) {
    // vs AI: human perspective
    if (humanWon) {
      return {
        title: "Victory!",
        subtitle: result === "resign"
          ? "Your opponent resigned."
          : result === "timeout"
            ? "Your opponent ran out of time."
            : "Checkmate!",
        icon: Trophy,
        color: "text-emerald-400",
        bg: "bg-emerald-500/15",
      };
    }
    return {
      title: "Defeat",
      subtitle: result === "resign"
        ? "You resigned."
        : result === "timeout"
          ? "You ran out of time."
          : "Checkmate — better luck next time.",
      icon: Flag,
      color: "text-rose-400",
      bg: "bg-rose-500/15",
    };
  }
  // local / ai-vs-ai: neutral
  const winnerName = winner === "w" ? "White" : winner === "b" ? "Black" : "";
  return {
    title: `${winnerName} wins`,
    subtitle: result === "checkmate" ? "By checkmate." : result === "resign" ? "By resignation." : result === "timeout" ? "On time." : "",
    icon: Crown,
    color: "text-amber-400",
    bg: "bg-amber-500/15",
  };
}

function SummaryCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card/60 p-3">
      <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="truncate text-sm font-semibold capitalize">{value}</div>
    </div>
  );
}

function CoachMoveCard({ note, tone }: { note: CoachMoveNote; tone: "good" | "bad" }) {
  const isGood = tone === "good";
  return (
    <div
      className={`rounded-lg border p-2.5 ${
        isGood ? "border-emerald-500/30 bg-emerald-500/5" : "border-rose-500/30 bg-rose-500/5"
      }`}
    >
      <div className="mb-1 flex items-center gap-2">
        <Badge
          variant="outline"
          className={`font-mono text-xs ${
            isGood ? "border-emerald-500/40 text-emerald-300" : "border-rose-500/40 text-rose-300"
          }`}
        >
          {note.moveNumber}. {note.san}
        </Badge>
        {note.betterMove && (
          <span className="text-xs text-muted-foreground">
            Better: <span className="font-mono font-medium text-emerald-300">{note.betterMove}</span>
          </span>
        )}
      </div>
      <p className="text-xs leading-relaxed text-foreground/90">{note.explanation}</p>
    </div>
  );
}

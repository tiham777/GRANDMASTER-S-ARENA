"use client";

/**
 * StatsView — aggregate player stats + recent game history.
 */
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft, Trophy, Flame, TrendingUp, Clock, Target, BarChart3,
  Crown, Handshake, Flag, History, Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { DIFFICULTIES } from "@/lib/chessAI";
import { formatClock } from "@/lib/chessThemes";

interface Stats {
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  currentStreak: number;
  bestStreak: number;
  avgMovesPerGame: number;
}

interface GameRow {
  id: string;
  mode: string;
  playerColor: string | null;
  difficulty: string | null;
  result: string;
  winner: string | null;
  moveCount: number;
  durationSec: number;
  opening: string | null;
  createdAt: string;
}

interface StatsViewProps {
  onBack: () => void;
}

export function StatsView({ onBack }: StatsViewProps) {
  const { toast } = useToast();
  const [stats, setStats] = useState<Stats | null>(null);
  const [games, setGames] = useState<GameRow[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = () => {
    setLoading(true);
    Promise.all([
      fetch("/api/stats").then((r) => r.json()),
      fetch("/api/games?limit=50").then((r) => r.json()),
    ])
      .then(([statsRes, gamesRes]) => {
        if (statsRes.stats) setStats(statsRes.stats);
        if (gamesRes.games) setGames(gamesRes.games);
      })
      .catch((err) => console.error("Failed to load stats:", err))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadData(); }, []);

  const winRate = stats && stats.gamesPlayed > 0
    ? Math.round((stats.wins / stats.gamesPlayed) * 100)
    : 0;

  const handleReset = async () => {
    try {
      await fetch("/api/stats", { method: "POST" });
      toast({ title: "Stats reset", duration: 2000 });
      loadData();
    } catch {
      toast({ title: "Failed to reset", variant: "destructive" });
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        {stats && stats.gamesPlayed > 0 && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1 text-destructive hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" /> Reset Stats
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset all stats?</AlertDialogTitle>
                <AlertDialogDescription>
                  This clears your win/loss record to zero. Saved games are not deleted.
                  This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleReset}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Reset
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6"
      >
        <h1 className="flex items-center gap-2 text-2xl font-bold sm:text-3xl">
          <BarChart3 className="h-7 w-7 text-primary" /> Your Statistics
        </h1>
        <p className="text-sm text-muted-foreground">
          Track your progress across all games played against the AI.
        </p>
      </motion.div>

      {loading ? (
        <div className="py-20 text-center text-muted-foreground">Loading…</div>
      ) : !stats || stats.gamesPlayed === 0 ? (
        <div className="rounded-xl border border-border bg-card/60 py-20 text-center">
          <Trophy className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">No games played yet.</p>
          <Button onClick={onBack} className="mt-4" size="sm">Play your first game</Button>
        </div>
      ) : (
        <>
          {/* Big stats grid */}
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <BigStat
              icon={<Trophy className="h-5 w-5" />}
              label="Games Played"
              value={stats.gamesPlayed}
              tone="text-foreground"
            />
            <BigStat
              icon={<Target className="h-5 w-5" />}
              label="Win Rate"
              value={`${winRate}%`}
              tone="text-emerald-400"
            />
            <BigStat
              icon={<Flame className="h-5 w-5" />}
              label="Best Streak"
              value={stats.bestStreak}
              tone="text-amber-400"
              suffix=" wins"
            />
            <BigStat
              icon={<TrendingUp className="h-5 w-5" />}
              label="Avg Moves"
              value={Math.round(stats.avgMovesPerGame)}
              tone="text-sky-400"
            />
          </div>

          {/* W/L/D breakdown */}
          <div className="mb-6 grid grid-cols-3 gap-3">
            <ResultCard
              label="Wins" value={stats.wins}
              icon={<Crown className="h-4 w-4" />}
              tone="emerald"
            />
            <ResultCard
              label="Losses" value={stats.losses}
              icon={<Flag className="h-4 w-4" />}
              tone="rose"
            />
            <ResultCard
              label="Draws" value={stats.draws}
              icon={<Handshake className="h-4 w-4" />}
              tone="amber"
            />
          </div>

          {/* Current streak banner */}
          {stats.currentStreak !== 0 && (
            <div className="mb-6 flex items-center justify-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
              <Flame className="h-4 w-4 text-amber-400" />
              <span>
                {stats.currentStreak > 0
                  ? `You're on a ${stats.currentStreak}-game win streak!`
                  : `You're on a ${Math.abs(stats.currentStreak)}-game losing streak.`}
              </span>
            </div>
          )}

          {/* Recent games */}
          <div className="rounded-xl border border-border bg-card/60 p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <History className="h-4 w-4" /> Recent Games
            </h2>
            <ScrollArea className="max-h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Date</TableHead>
                    <TableHead className="text-xs">Mode</TableHead>
                    <TableHead className="text-xs">Result</TableHead>
                    <TableHead className="text-xs text-right">Moves</TableHead>
                    <TableHead className="text-xs text-right">Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {games.map((g) => {
                    const humanWon =
                      g.mode === "ai" && g.playerColor && g.winner
                        ? g.winner === g.playerColor
                        : null;
                    return (
                      <TableRow key={g.id}>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(g.createdAt).toLocaleDateString(undefined, {
                            month: "short", day: "numeric",
                            hour: "2-digit", minute: "2-digit",
                          })}
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="flex flex-col">
                            <span>
                              {g.mode === "ai"
                                ? "vs AI"
                                : g.mode === "ai-vs-ai"
                                  ? "AI vs AI"
                                  : "Local 2P"}
                            </span>
                            {g.difficulty && (
                              <span className="text-[10px] text-muted-foreground">
                                {DIFFICULTIES.find((d) => d.id === g.difficulty)?.label ?? g.difficulty}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">
                          <ResultBadge result={g.result} humanWon={humanWon} winner={g.winner} />
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">{g.moveCount}</TableCell>
                        <TableCell className="text-right font-mono text-xs text-muted-foreground">
                          {formatClock(g.durationSec * 1000)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollArea>
          </div>
        </>
      )}
    </div>
  );
}

function BigStat({
  icon, label, value, tone, suffix,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  tone: string;
  suffix?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card/60 p-4">
      <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={`text-2xl font-bold sm:text-3xl ${tone}`}>
        {value}{suffix && <span className="ml-1 text-sm font-normal text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}

function ResultCard({
  label, value, icon, tone,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: "emerald" | "rose" | "amber";
}) {
  const toneClasses = {
    emerald: "border-emerald-500/30 bg-emerald-500/5 text-emerald-400",
    rose: "border-rose-500/30 bg-rose-500/5 text-rose-400",
    amber: "border-amber-500/30 bg-amber-500/5 text-amber-400",
  }[tone];
  return (
    <div className={`rounded-xl border p-4 ${toneClasses}`}>
      <div className="mb-1 flex items-center gap-1.5 text-xs uppercase tracking-wide opacity-80">
        {icon}
        {label}
      </div>
      <div className="text-2xl font-bold sm:text-3xl">{value}</div>
    </div>
  );
}

function ResultBadge({
  result, humanWon, winner,
}: {
  result: string;
  humanWon: boolean | null;
  winner: string | null;
}) {
  if (humanWon === true) {
    return <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40">Win</Badge>;
  }
  if (humanWon === false) {
    return <Badge className="bg-rose-500/20 text-rose-300 border-rose-500/40">Loss</Badge>;
  }
  if (result === "draw" || result === "stalemate" || winner === "draw") {
    return <Badge variant="secondary">Draw</Badge>;
  }
  if (winner) {
    return <Badge variant="outline" className="capitalize">{winner}</Badge>;
  }
  return <Badge variant="outline" className="capitalize">{result}</Badge>;
}

"use client";

/**
 * HomeView — the landing/setup screen.
 *
 * Lets the player choose:
 *  - game mode (vs AI / local 2P / Play Online)
 *  - difficulty (for AI modes)
 *  - their color (for vs AI)
 *  - time control
 *  - board theme + piece set + display options
 *
 * Also shows a compact stats summary and recent games list.
 */
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Crown, Bot, Users, Swords, ChevronRight, BarChart3, History,
  Volume2, VolumeX, Palette, Eye, Check, Trophy, Flame, TrendingUp, Globe, Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  BOARD_THEMES, PIECE_SETS, TIME_CONTROLS,
  type BoardThemeId, type PieceSetId,
} from "@/lib/chessThemes";
import { DIFFICULTIES, type Difficulty } from "@/lib/chessAI";
import { useChessStore, type GameMode } from "@/lib/chessStore";

interface HomeViewProps {
  onStart: (config: import("@/lib/chessStore").NewGameConfig) => void;
  onShowStats: () => void;
  onShowHistory: () => void;
  onPlayOnline: () => void;
}

export function HomeView({ onStart, onShowStats, onShowHistory, onPlayOnline }: HomeViewProps) {
  const store = useChessStore();
  const [mode, setMode] = useState<GameMode>(store.defaultMode);
  const [difficulty, setDifficulty] = useState<Difficulty>(store.defaultDifficulty);
  const [playerColor, setPlayerColor] = useState<"white" | "black" | "random">("white");
  const [timeControlId, setTimeControlId] = useState<string>(store.defaultTimeControlId);
  const [allowUndo, setAllowUndo] = useState(true);

  // Persist defaults when changed.
  useEffect(() => { store.setDefaultMode(mode); }, [mode]);
  useEffect(() => { store.setDefaultDifficulty(difficulty); }, [difficulty]);
  useEffect(() => { store.setDefaultTimeControlId(timeControlId); }, [timeControlId]);

  const handleStart = () => {
    onStart({
      mode,
      difficulty,
      playerColor,
      timeControlId,
      boardTheme: store.boardTheme,
      pieceSet: store.pieceSet,
      showCoordinates: store.showCoordinates,
      showLegalMoves: store.showLegalMoves,
      highlightLastMove: store.highlightLastMove,
      soundEnabled: store.soundEnabled,
      allowUndo: mode === "ai" ? allowUndo : false,
    });
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      {/* Theme toggle — fixed top-right */}
      <div className="fixed right-4 top-4 z-50">
        <ThemeToggle className="border border-border bg-card/80 backdrop-blur" />
      </div>

      {/* Hero */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8 text-left sm:text-center"
      >
        <div className="mb-3 flex items-center justify-start gap-3 sm:justify-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Crown className="h-7 w-7" />
          </div>
          <h1 className="chess-title bg-gradient-to-br bg-clip-text text-3xl font-bold tracking-tight text-transparent sm:text-5xl">
            Grandmaster&apos;s Arena
          </h1>
        </div>
        <p className="max-w-xl text-sm text-muted-foreground sm:mx-auto sm:text-base">
          Play chess against an AI tuned to your level, challenge a friend online,
          and master the royal game.
        </p>
      </motion.div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
        {/* Setup column */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="space-y-5"
        >
          {/* Mode selection */}
          <section className="rounded-xl border border-border bg-card/60 p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              <Swords className="h-4 w-4" /> Game Mode
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <ModeCard
                active={mode === "ai"}
                onClick={() => setMode("ai")}
                icon={<Bot className="h-5 w-5" />}
                title="vs AI"
                description="Play against the computer"
              />
              <ModeCard
                active={mode === "local"}
                onClick={() => setMode("local")}
                icon={<Users className="h-5 w-5" />}
                title="Local 2P"
                description="Pass-and-play with a friend"
              />
              <ModeCard
                active={false}
                onClick={onPlayOnline}
                icon={<Globe className="h-5 w-5" />}
                title="Play Online"
                description="Challenge a friend in real-time"
              />
            </div>
          </section>

          {/* Difficulty (AI mode) */}
          {mode === "ai" && (
            <motion.section
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              className="rounded-xl border border-border bg-card/60 p-5"
            >
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                <TrendingUp className="h-4 w-4" /> Difficulty
              </h2>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {DIFFICULTIES.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setDifficulty(d.id)}
                    className={`rounded-lg border p-3 text-left transition-all ${
                      difficulty === d.id
                        ? "border-primary bg-primary/10 ring-1 ring-primary/40"
                        : "border-border bg-background/40 hover:border-primary/40 hover:bg-accent/40"
                    }`}
                  >
                    <div className="text-sm font-semibold">{d.label}</div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">{d.eloRange}</div>
                  </button>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {DIFFICULTIES.find((d) => d.id === difficulty)?.description}
              </p>
            </motion.section>
          )}

          {/* Color choice (vs AI only) */}
          {mode === "ai" && (
            <motion.section
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              className="rounded-xl border border-border bg-card/60 p-5"
            >
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                <Crown className="h-4 w-4" /> Your Color
              </h2>
              <div className="flex gap-2">
                {(["white", "random", "black"] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setPlayerColor(c)}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium capitalize transition-all ${
                      playerColor === c
                        ? "border-primary bg-primary/10 ring-1 ring-primary/40"
                        : "border-border bg-background/40 hover:bg-accent/40"
                    }`}
                  >
                    {c === "white" && <span className="text-lg">♔</span>}
                    {c === "black" && <span className="text-lg">♚</span>}
                    {c === "random" && <span className="text-lg">♜</span>}
                    {c}
                  </button>
                ))}
              </div>
            </motion.section>
          )}

          {/* Time control */}
          <section className="rounded-xl border border-border bg-card/60 p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              <Crown className="h-4 w-4" /> Time Control
            </h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {TIME_CONTROLS.map((tc) => (
                <button
                  key={tc.id}
                  type="button"
                  onClick={() => setTimeControlId(tc.id)}
                  className={`rounded-lg border px-3 py-2 text-center transition-all ${
                    timeControlId === tc.id
                      ? "border-primary bg-primary/10 ring-1 ring-primary/40"
                      : "border-border bg-background/40 hover:bg-accent/40"
                  }`}
                >
                  <div className="text-sm font-semibold">{tc.shortLabel}</div>
                  <div className="text-[10px] text-muted-foreground">{tc.label.split(" · ")[0]}</div>
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {TIME_CONTROLS.find((t) => t.id === timeControlId)?.description}
            </p>
          </section>

          {/* Allow undo (vs AI only) */}
          {mode === "ai" && (
            <section className="flex items-center justify-between rounded-xl border border-border bg-card/60 p-4">
              <div>
                <div className="text-sm font-medium">Allow Undo</div>
                <div className="text-xs text-muted-foreground">
                  Take back your last move (and the AI&apos;s reply). Disabled for fair play in other modes.
                </div>
              </div>
              <Switch checked={allowUndo} onCheckedChange={setAllowUndo} />
            </section>
          )}

          {/* Start button */}
          <Button
            size="lg"
            onClick={handleStart}
            className="w-full gap-2 bg-gradient-to-r from-amber-500 to-amber-600 text-base font-semibold text-stone-950 hover:from-amber-400 hover:to-amber-500"
          >
            <Crown className="h-5 w-5" /> Start Game <ChevronRight className="h-5 w-5" />
          </Button>
        </motion.div>

        {/* Sidebar: stats + settings */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="space-y-5"
        >
          {/* Stats summary */}
          <StatsSummary onShowStats={onShowStats} onShowHistory={onShowHistory} />

          {/* Settings */}
          <Tabs defaultValue="board">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="board" className="gap-1 text-xs">
                <Palette className="h-3.5 w-3.5" /> Board
              </TabsTrigger>
              <TabsTrigger value="display" className="gap-1 text-xs">
                <Eye className="h-3.5 w-3.5" /> Display
              </TabsTrigger>
            </TabsList>

            <TabsContent value="board" className="mt-3 rounded-xl border border-border bg-card/60 p-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Board Theme
              </h3>
              <div className="grid grid-cols-4 gap-2">
                {BOARD_THEMES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => store.setBoardTheme(t.id as BoardThemeId)}
                    className={`group relative aspect-square overflow-hidden rounded-lg bg-gradient-to-br ${t.swatch} ring-2 transition-all ${
                      store.boardTheme === t.id ? "ring-primary" : "ring-transparent hover:ring-primary/40"
                    }`}
                    title={t.name}
                    aria-label={t.name}
                  >
                    {store.boardTheme === t.id && (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/30">
                        <Check className="h-5 w-5 text-white" />
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {BOARD_THEMES.find((t) => t.id === store.boardTheme)?.name}
              </p>

              <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Piece Set
              </h3>
              <div className="flex flex-wrap gap-2">
                {PIECE_SETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => store.setPieceSet(p.id as PieceSetId)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                      store.pieceSet === p.id
                        ? "border-primary bg-primary/10 text-primary-foreground"
                        : "border-border bg-background/40 hover:bg-accent/40"
                    }`}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="display" className="mt-3 space-y-3 rounded-xl border border-border bg-card/60 p-4">
              <DisplayToggle
                label="Sound effects"
                description="Move, capture, check, and game-end sounds"
                checked={store.soundEnabled}
                onCheckedChange={store.toggleSound}
                icon={store.soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              />
              <DisplayToggle
                label="Show coordinates"
                description="a-h, 1-8 labels on the board"
                checked={store.showCoordinates}
                onCheckedChange={store.setShowCoordinates}
              />
              <DisplayToggle
                label="Highlight legal moves"
                description="Show dots on squares a piece can move to"
                checked={store.showLegalMoves}
                onCheckedChange={store.setShowLegalMoves}
              />
              <DisplayToggle
                label="Highlight last move"
                description="Yellow glow on the from/to squares"
                checked={store.highlightLastMove}
                onCheckedChange={store.setHighlightLastMove}
              />
              <DisplayToggle
                label="Board border"
                description="Theme-colored border + rounded corners (off = square corners, no border)"
                checked={store.boardBorder}
                onCheckedChange={store.setBoardBorder}
                icon={<Square className="h-4 w-4" />}
              />
            </TabsContent>
          </Tabs>
        </motion.div>
      </div>
    </div>
  );
}

function ModeCard({
  active, onClick, icon, title, description,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-all ${
        active
          ? "border-primary bg-primary/10 ring-1 ring-primary/40"
          : "border-border bg-background/40 hover:border-primary/40 hover:bg-accent/40"
      }`}
    >
      <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${active ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>
        {icon}
      </div>
      <div>
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
    </button>
  );
}

function DisplayToggle({
  label, description, checked, onCheckedChange, icon,
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex-1">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          {icon}
          {label}
        </div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function StatsSummary({ onShowStats, onShowHistory }: { onShowStats: () => void; onShowHistory: () => void }) {
  const [stats, setStats] = useState<{
    gamesPlayed: number; wins: number; losses: number; draws: number;
    currentStreak: number; bestStreak: number;
  } | null>(null);

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => r.json())
      .then((d) => {
        if (d.stats) {
          setStats({
            gamesPlayed: d.stats.gamesPlayed,
            wins: d.stats.wins,
            losses: d.stats.losses,
            draws: d.stats.draws,
            currentStreak: d.stats.currentStreak,
            bestStreak: d.stats.bestStreak,
          });
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div className="rounded-xl border border-border bg-card/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Trophy className="h-4 w-4 text-amber-400" /> Your Record
        </h3>
        <Button variant="ghost" size="sm" onClick={onShowStats} className="gap-1 text-xs">
          <BarChart3 className="h-3.5 w-3.5" /> Details
        </Button>
      </div>
      {stats && stats.gamesPlayed > 0 ? (
        <div className="grid grid-cols-3 gap-2 text-center">
          <StatBox label="Wins" value={stats.wins} className="text-emerald-400" />
          <StatBox label="Losses" value={stats.losses} className="text-rose-400" />
          <StatBox label="Draws" value={stats.draws} className="text-amber-400" />
          {stats.currentStreak !== 0 && (
            <div className="col-span-3 mt-2 flex items-center justify-center gap-1.5 rounded-md bg-muted/50 px-2 py-1.5 text-xs">
              <Flame className="h-3.5 w-3.5 text-amber-400" />
              <span>
                {stats.currentStreak > 0
                  ? `${stats.currentStreak}-game win streak`
                  : `${Math.abs(stats.currentStreak)}-game losing streak`}
              </span>
              <span className="text-muted-foreground">
                (best: {stats.bestStreak})
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="py-6 text-center">
          <p className="text-sm text-muted-foreground">
            No games played yet.
          </p>
          <p className="text-xs text-muted-foreground/70">
            Start your first game to begin tracking your record.
          </p>
        </div>
      )}
      <Button variant="ghost" size="sm" onClick={onShowHistory} className="mt-2 w-full gap-1 text-xs">
        <History className="h-3.5 w-3.5" /> View game history
      </Button>
    </div>
  );
}

function StatBox({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <div className="rounded-md bg-muted/40 p-2">
      <div className={`text-xl font-bold ${className}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

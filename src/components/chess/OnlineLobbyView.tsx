"use client";

/**
 * OnlineLobbyView — create or join an online chess room.
 *
 * Lets the player:
 *  - Pick a display name (persisted to localStorage)
 *  - Choose their preferred color + time control
 *  - Create a new room (gets a shareable code + link)
 *  - Join an existing room by code
 *  - Browse the list of open rooms waiting for an opponent
 *
 * When a game starts (room becomes "playing"), the parent swaps to the
 * OnlineGameView.
 */
import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, Globe, Copy, Check, Users, Plus, LogIn, Share2, Loader2,
  Wifi, WifiOff, Crown, Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useSharedOnlineChess } from "./OnlineSocketProvider";
import { useChessStore } from "@/lib/chessStore";
import { TIME_CONTROLS } from "@/lib/chessThemes";

const NAME_KEY = "grandmasters-arena-online-name";

interface OnlineLobbyViewProps {
  onBack: () => void;
  onGameStart: () => void;
  /** Optional pre-filled join code (from ?join=CODE deep link). */
  initialJoinCode?: string | null;
}

export function OnlineLobbyView({ onBack, onGameStart, initialJoinCode }: OnlineLobbyViewProps) {
  const { toast } = useToast();
  const online = useSharedOnlineChess();
  const [name, setName] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem(NAME_KEY) ?? "";
  });
  const [preferredColor, setPreferredColor] = useState<"white" | "black" | "random">("white");
  const [timeControlId, setTimeControlId] = useState("unlimited");
  const [joinCode, setJoinCode] = useState(initialJoinCode ?? "");
  const [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState(false);

  // Auto-join if we arrived via ?join=CODE and have a saved name.
  useEffect(() => {
    if (initialJoinCode && !online.room) {
      const saved = typeof window !== "undefined" ? localStorage.getItem(NAME_KEY) : null;
      if (saved) {
        // Slight delay to ensure socket is connected.
        setTimeout(() => online.joinRoom(initialJoinCode, saved), 500);
      }
    }
  }, [initialJoinCode]);

  // Subscribe to the lobby room list while mounted.
  useEffect(() => {
    online.subscribeLobby();
    return () => online.unsubscribeLobby();
  }, []);

  // When the room transitions to "playing", notify the parent.
  useEffect(() => {
    if (online.room?.status === "playing") {
      onGameStart();
    }
  }, [online.room?.status, onGameStart]);

  // Show error toasts.
  useEffect(() => {
    if (online.error) {
      toast({ title: "Online error", description: online.error, variant: "destructive", duration: 3000 });
      online.setError(null);
    }
  }, [online.error, online.setError, toast]);

  const handleCreate = useCallback(() => {
    if (!name.trim()) {
      toast({ title: "Enter a display name", variant: "destructive" });
      return;
    }
    localStorage.setItem(NAME_KEY, name.trim());
    setCreating(true);
    // Send the host's visual preferences so the joining player auto-matches.
    const store = useChessStore.getState();
    online.createRoom(name.trim(), preferredColor, timeControlId, {
      boardTheme: store.boardTheme,
      pieceSet: store.pieceSet,
      boardBorder: store.boardBorder,
      showCoordinates: store.showCoordinates,
      showLegalMoves: store.showLegalMoves,
      highlightLastMove: store.highlightLastMove,
    });
  }, [name, preferredColor, timeControlId, online, toast]);

  const handleJoin = useCallback(
    (code: string) => {
      if (!name.trim()) {
        toast({ title: "Enter a display name", variant: "destructive" });
        return;
      }
      if (!code.trim()) {
        toast({ title: "Enter a room code", variant: "destructive" });
        return;
      }
      localStorage.setItem(NAME_KEY, name.trim());
      online.joinRoom(code, name.trim());
    },
    [name, online, toast],
  );

  const handleCopyLink = useCallback(async () => {
    if (!online.room) return;
    const url = `${window.location.origin}/?join=${online.room.code}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast({ title: "Link copied!", description: "Share it with your opponent.", duration: 2000 });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  }, [online.room, toast]);

  const handleCopyCode = useCallback(async () => {
    if (!online.room) return;
    try {
      await navigator.clipboard.writeText(online.room.code);
      toast({ title: "Code copied", duration: 1500 });
    } catch {
      /* ignore */
    }
  }, [online.room, toast]);

  // If a room was created and we're waiting for an opponent.
  if (online.room && online.room.status === "waiting") {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
        <Button variant="ghost" size="sm" onClick={() => online.leaveRoom(online.room!.code)} className="mb-6 gap-2">
          <ArrowLeft className="h-4 w-4" /> Cancel
        </Button>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="rounded-2xl border border-primary/30 bg-card/60 p-8 text-center"
        >
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/15">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
          <h2 className="mb-1 text-2xl font-bold">Waiting for opponent…</h2>
          <p className="mb-6 text-sm text-muted-foreground">
            Share the code or link below with a friend to start playing.
          </p>

          {/* Room code */}
          <div className="mb-4">
            <Label className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">
              Room Code
            </Label>
            <button
              type="button"
              onClick={handleCopyCode}
              className="mx-auto block rounded-xl border-2 border-dashed border-primary/40 bg-primary/5 px-8 py-4 font-mono text-4xl font-bold tracking-[0.3em] text-primary hover:bg-primary/10"
            >
              {online.room.code}
            </button>
          </div>

          {/* Share link */}
          <div className="mb-6 flex items-center gap-2">
            <Input
              readOnly
              value={`${typeof window !== "undefined" ? window.location.origin : ""}/?join=${online.room.code}`}
              className="font-mono text-xs"
            />
            <Button size="sm" onClick={handleCopyLink} className="gap-1 shrink-0">
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>

          <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Crown className="h-3.5 w-3.5" /> You: {online.room.hostName}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" /> {TIME_CONTROLS.find(t => t.id === online.room!.timeControlId)?.label ?? "Unlimited"}
            </span>
          </div>
          <div className="mt-3 text-xs text-muted-foreground">
            Preferred color: <span className="font-medium text-foreground capitalize">{online.room.hostColor}</span>
          </div>
        </motion.div>
      </div>
    );
  }

  // Create/Join lobby.
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6 flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <Badge variant="outline" className={`gap-1 ${online.connected ? "text-emerald-400" : "text-muted-foreground"}`}>
          {online.connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
          {online.connected ? "Connected" : "Connecting…"}
        </Badge>
      </div>

      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6 text-center"
      >
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-primary">
          <Globe className="h-7 w-7" />
        </div>
        <h1 className="text-2xl font-bold sm:text-3xl">Play Online</h1>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          Create a private room and invite a friend, or join an open game. Real-time
          play over WebSocket — no account needed.
        </p>
      </motion.div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {/* Create room */}
        <motion.div
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          className="rounded-xl border border-border bg-card/60 p-5"
        >
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <Plus className="h-4 w-4" /> Create a Room
          </h2>

          <div className="space-y-3">
            <div>
              <Label htmlFor="name-create" className="mb-1 block text-xs">Your name</Label>
              <Input
                id="name-create"
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, 20))}
                placeholder="e.g. KasparovFan"
                maxLength={20}
              />
            </div>

            <div>
              <Label className="mb-1 block text-xs">Your color</Label>
              <div className="flex gap-2">
                {(["white", "random", "black"] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setPreferredColor(c)}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs font-medium capitalize transition-all ${
                      preferredColor === c
                        ? "border-primary bg-primary/10 ring-1 ring-primary/40"
                        : "border-border bg-background/40 hover:bg-accent/40"
                    }`}
                  >
                    {c === "white" && <span>♔</span>}
                    {c === "black" && <span>♚</span>}
                    {c === "random" && <span>♜</span>}
                    {c}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label className="mb-1 block text-xs">Time control</Label>
              <select
                value={timeControlId}
                onChange={(e) => setTimeControlId(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {TIME_CONTROLS.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            </div>

            <Button
              onClick={handleCreate}
              disabled={creating || !online.connected}
              className="w-full gap-2 bg-gradient-to-r from-amber-500 to-amber-600 font-semibold text-stone-950 hover:from-amber-400 hover:to-amber-500"
            >
              <Plus className="h-4 w-4" /> Create Room
            </Button>
          </div>
        </motion.div>

        {/* Join room */}
        <motion.div
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          className="rounded-xl border border-border bg-card/60 p-5"
        >
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <LogIn className="h-4 w-4" /> Join a Room
          </h2>

          <div className="space-y-3">
            <div>
              <Label htmlFor="name-join" className="mb-1 block text-xs">Your name</Label>
              <Input
                id="name-join"
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, 20))}
                placeholder="e.g. KnightRider"
                maxLength={20}
              />
            </div>

            <div>
              <Label htmlFor="join-code" className="mb-1 block text-xs">Room code</Label>
              <Input
                id="join-code"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 6))}
                placeholder="ABC123"
                className="font-mono text-lg tracking-[0.3em] text-center uppercase"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleJoin(joinCode);
                }}
              />
            </div>

            <Button
              onClick={() => handleJoin(joinCode)}
              disabled={!joinCode.trim() || !online.connected}
              className="w-full gap-2"
              variant="outline"
            >
              <LogIn className="h-4 w-4" /> Join Game
            </Button>

            {/* Open rooms browser */}
            <div className="pt-2">
              <Label className="mb-2 block text-xs text-muted-foreground">
                <Users className="mr-1 inline h-3 w-3" />
                Open rooms ({online.lobbyRooms.length})
              </Label>
              <div className="max-h-40 space-y-1 overflow-y-auto scroll-thin">
                <AnimatePresence mode="popLayout">
                  {online.lobbyRooms.length === 0 ? (
                    <p className="py-3 text-center text-xs text-muted-foreground/70">
                      No open rooms right now. Create one!
                    </p>
                  ) : (
                    online.lobbyRooms.map((r) => (
                      <motion.button
                        key={r.code}
                        layout
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        type="button"
                        onClick={() => handleJoin(r.code)}
                        className="flex w-full items-center justify-between rounded-md border border-border bg-background/40 px-3 py-2 text-left text-xs transition-colors hover:bg-accent/40"
                      >
                        <span className="font-mono font-semibold text-primary">{r.code}</span>
                        <span className="flex-1 truncate px-2 text-muted-foreground">{r.hostName}</span>
                        <span className="capitalize text-muted-foreground">{r.hostColor}</span>
                      </motion.button>
                    ))
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* How it works */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="mt-6 rounded-xl border border-border bg-card/40 p-4"
      >
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Share2 className="h-3.5 w-3.5" /> How online play works
        </h3>
        <ol className="space-y-1 text-xs text-muted-foreground">
          <li><span className="font-semibold text-foreground">1.</span> Create a room — you&apos;ll get a 6-character code and a shareable link.</li>
          <li><span className="font-semibold text-foreground">2.</span> Send the link (or code) to a friend. They open it and click Join.</li>
          <li><span className="font-semibold text-foreground">3.</span> Once they join, the game starts instantly. Moves sync in real time.</li>
          <li><span className="font-semibold text-foreground">4.</span> If your opponent disconnects, you can claim the win.</li>
        </ol>
        <p className="mt-2 text-[11px] text-muted-foreground/70">
          Tip: open this page in two browser tabs (or share with a friend on another device) to test it.
        </p>
      </motion.div>
    </div>
  );
}

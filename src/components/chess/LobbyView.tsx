"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Crown,
  Search,
  Swords,
  Loader2,
  LogOut,
  Cpu,
  RefreshCw,
  Trophy,
  CircleDot,
  Shield,
  User as UserIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useChessStore } from "@/lib/store";
import {
  watchOnlinePlayers,
  searchUsersByUsername,
  sendChallenge,
  logoutUser,
} from "@/lib/chessApi";
import type { UserProfile } from "@/lib/types";
import {
  IncomingChallengeModal,
  OutgoingChallengeModal,
  ChallengeExpiredNotice,
} from "./ChallengeModal";

export default function LobbyView() {
  const profile = useChessStore((s) => s.profile);
  const onlinePlayers = useChessStore((s) => s.onlinePlayers);
  const setOnlinePlayers = useChessStore((s) => s.setOnlinePlayers);
  const incoming = useChessStore((s) => s.incoming);
  const setIncoming = useChessStore((s) => s.setIncoming);
  const outgoing = useChessStore((s) => s.outgoing);
  const setView = useChessStore((s) => s.setView);
  const setProfile = useChessStore((s) => s.setProfile);

  const [search, setSearch] = useState("");
  const [results, setResults] = useState<UserProfile[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [expiredShown, setExpiredShown] = useState(false);
  // Challenge color picker dialog state
  const [colorPickFor, setColorPickFor] = useState<UserProfile | null>(null);
  const [pendingColor, setPendingColor] = useState<"white" | "black" | "random">("white");
  const { toast } = useToast();
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setActiveGame = useChessStore((s) => s.setActiveGame);

  // Subscribe to online players
  useEffect(() => {
    if (!profile) return;
    const unsub = watchOnlinePlayers(profile.uid, setOnlinePlayers);
    return () => unsub();
  }, [profile, setOnlinePlayers]);

  // 🔥 CRITICAL: When an outgoing challenge is accepted, jump into the game.
  // This is what was missing — the challenger used to get stuck in the lobby
  // after the opponent clicked Accept.
  useEffect(() => {
    if (!profile) return;
    const accepted = outgoing.find(
      (c) => c.status === "accepted" && c.gameId
    );
    if (accepted && accepted.gameId) {
      // Resolve my color from the challenger's chosen color (now stored on
      // the challenge doc). Backward-compatible: if no color is recorded,
      // the challenger plays white.
      const choice = accepted.challengerColor ?? "white";
      let myColor: "white" | "black";
      if (choice === "white") myColor = "white";
      else if (choice === "black") myColor = "black";
      else {
        // For "random", the actual side was decided by acceptChallenge and
        // committed to the game doc. We optimistically default to white here;
        // GameView will read the true color from the live game doc as soon as
        // it loads, and our color picker UI shows the right info to the user.
        myColor = "white";
      }
      setActiveGame(accepted.gameId, null, myColor);
      setView("game");
      toast({
        title: "Challenge accepted!",
        description: "Match starting — entering focus mode.",
      });
    }
  }, [outgoing, profile, setActiveGame, setView, toast]);

  // Auto-detect outgoing expiration (only show notice once per cycle)
  useEffect(() => {
    if (outgoing.length === 0) {
      setExpiredShown(false);
    }
  }, [outgoing.length]);

  // Watch search input with debounce
  useEffect(() => {
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    if (!search.trim()) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchDebounce.current = setTimeout(async () => {
      try {
        const r = await searchUsersByUsername(search, profile?.uid ?? null);
        setResults(r);
      } finally {
        setSearching(false);
      }
    }, 280);
    return () => {
      if (searchDebounce.current) clearTimeout(searchDebounce.current);
    };
  }, [search, profile]);

  // Step 1: clicking "Challenge" opens the color-picker dialog instead of
  // sending the challenge immediately. This lets the challenger pick which
  // color they want to play before the challenge is created.
  function openColorPicker(target: UserProfile) {
    setColorPickFor(target);
    setPendingColor("white");
  }

  // Step 2: after the user picks a color, actually send the challenge.
  async function confirmChallenge() {
    if (!profile || !colorPickFor) return;
    const target = colorPickFor;
    setBusyUid(target.uid);
    setColorPickFor(null);
    try {
      await sendChallenge(profile, target.uid, target.username, pendingColor);
      toast({
        title: "Challenge sent!",
        description: `Waiting for ${target.username} to accept (5 min). You'll play ${pendingColor === "random" ? "a random side" : pendingColor}.`,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed.";
      toast({ title: "Challenge failed", description: msg, variant: "destructive" });
    } finally {
      setBusyUid(null);
    }
  }

  async function handleLogout() {
    try {
      await logoutUser();
      setProfile(null);
      setView("login");
      toast({ title: "Signed out." });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed.";
      toast({ title: "Logout failed", description: msg, variant: "destructive" });
    }
  }

  // The most recent incoming challenge (highest priority)
  const topIncoming = incoming[0] ?? null;
  // Show outgoing pending challenge banner (only one at a time)
  const pendingOutgoing = outgoing.find((c) => c.status === "pending") ?? null;
  // Show expired notice if we had a pending that expired (transient: just-declined still kept in list)
  const justDeclined = outgoing.find((c) => c.status === "declined");
  useEffect(() => {
    if (justDeclined && !expiredShown) {
      toast({
        title: "Challenge declined",
        description: `${justDeclined.targetName} declined your challenge.`,
        variant: "destructive",
      });
    }
  }, [justDeclined, expiredShown, toast]);

  const stats = useMemo(() => {
    if (!profile) return null;
    return {
      wins: profile.wins,
      losses: profile.losses,
      draws: profile.draws,
      total: profile.wins + profile.losses + profile.draws,
    };
  }, [profile]);

  if (!profile) return null;

  const listToShow = results ?? onlinePlayers;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-stone-800/80 bg-stone-950/80 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-3">
          <div className="size-8 rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center">
            <Crown className="size-4 text-stone-950" />
          </div>
          <span className="font-semibold tracking-tight">Grandmaster&apos;s Arena</span>
          <Badge variant="outline" className="ml-1 border-amber-500/30 text-amber-300 bg-amber-500/5">
            <CircleDot className="size-3 mr-1 text-emerald-400 dot-online" />
            Online
          </Badge>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setView("offline")}
            className="text-stone-300 hover:text-amber-300 hover:bg-amber-500/5"
          >
            <Cpu className="size-4 mr-1.5" />
            vs AI / Local
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            className="text-stone-400 hover:text-rose-300 hover:bg-rose-500/10"
          >
            <LogOut className="size-4" />
            <span className="hidden sm:inline ml-1.5">Sign out</span>
          </Button>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6">
        {/* Profile banner */}
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-stone-800 bg-gradient-to-br from-stone-900/80 to-stone-900/40 p-4 mb-6 relative overflow-hidden"
        >
          {/* Decorative amber glow */}
          <div className="absolute top-0 left-0 w-32 h-full bg-gradient-to-r from-amber-500/5 to-transparent pointer-events-none" />

          <div className="flex items-center gap-4 relative">
            <div className="relative flex-shrink-0">
              <Avatar className="size-14 ring-2 ring-amber-500/40 shadow-lg">
                <AvatarImage src={profile.photoURL ?? undefined} />
                <AvatarFallback className="bg-gradient-to-br from-amber-500/20 to-stone-800 text-amber-300 text-lg font-bold">
                  {profile.username.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full bg-emerald-400 ring-2 ring-stone-900 dot-online" />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <h2 className="text-lg font-bold text-stone-100">{profile.username}</h2>
                {profile.provider === "google" ? (
                  <Badge variant="outline" className="border-amber-500/30 text-amber-300 bg-amber-500/8 text-[10px] h-5">
                    <Shield className="size-2.5 mr-1" />
                    Google
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-stone-700 text-stone-400 text-[10px] h-5">
                    <UserIcon className="size-2.5 mr-1" />
                    Guest
                  </Badge>
                )}
                {stats && stats.wins >= 50 && (
                  <Badge className="bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[10px] h-5">
                    <Crown className="size-2.5 mr-1" />Master
                  </Badge>
                )}
              </div>
              <p className="text-xs text-stone-500 truncate mb-2">
                {profile.email ?? "Playing anonymously"}
              </p>
              {stats && stats.total > 0 && (
                <div className="flex items-center gap-1 flex-wrap">
                  <div className="h-1.5 rounded-full bg-stone-800 flex-1 max-w-[120px] overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all"
                      style={{ width: `${(stats.wins / stats.total) * 100}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-stone-500">
                    {Math.round((stats.wins / stats.total) * 100)}% win rate
                  </span>
                </div>
              )}
            </div>

            {stats && (
              <div className="hidden sm:flex items-center gap-2">
                <Stat label="Wins" value={stats.wins} tone="emerald" />
                <Stat label="Losses" value={stats.losses} tone="rose" />
                <Stat label="Draws" value={stats.draws} tone="stone" />
              </div>
            )}
          </div>

          {/* Mobile stats */}
          {stats && (
            <div className="flex sm:hidden items-center gap-2 mt-3 pt-3 border-t border-stone-800">
              <div className="flex-1 text-center">
                <div className="text-base font-bold text-emerald-400">{stats.wins}</div>
                <div className="text-[9px] uppercase tracking-wider text-stone-500">Wins</div>
              </div>
              <div className="w-px h-8 bg-stone-800" />
              <div className="flex-1 text-center">
                <div className="text-base font-bold text-rose-400">{stats.losses}</div>
                <div className="text-[9px] uppercase tracking-wider text-stone-500">Losses</div>
              </div>
              <div className="w-px h-8 bg-stone-800" />
              <div className="flex-1 text-center">
                <div className="text-base font-bold text-stone-300">{stats.draws}</div>
                <div className="text-[9px] uppercase tracking-wider text-stone-500">Draws</div>
              </div>
            </div>
          )}
        </motion.section>

        {/* Outgoing challenge banner */}
        {pendingOutgoing && (
          <div className="mb-6">
            <OutgoingChallengeModal challenge={pendingOutgoing} />
          </div>
        )}

        {/* Search + online players */}
        <section className="grid lg:grid-cols-[1fr_280px] gap-6">
          <div className="space-y-4">
            <div>
              <div className="relative">
                <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-500" />
                <Input
                  placeholder="Search player by username…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10 h-11 bg-stone-900/60 border-stone-700 text-stone-100 placeholder:text-stone-600 focus:border-amber-500 focus:ring-amber-500/30"
                />
                {searching && (
                  <Loader2 className="size-4 absolute right-3 top-1/2 -translate-y-1/2 text-amber-400 animate-spin" />
                )}
              </div>
              <p className="text-[11px] text-stone-500 mt-1.5">
                {results
                  ? `${results.length} match${results.length === 1 ? "" : "es"} for "${search.trim()}"`
                  : `${onlinePlayers.length} player${onlinePlayers.length === 1 ? "" : "s"} online right now`}
              </p>
            </div>

            {/* Player list */}
            <div className="rounded-xl border border-stone-800 bg-stone-900/40 overflow-hidden">
              {listToShow.length === 0 ? (
                <div className="p-10 text-center">
                  {search.trim() ? (
                    <>
                      <div className="size-12 rounded-full bg-stone-800/60 flex items-center justify-center mx-auto mb-3">
                        <Search className="size-5 text-stone-600" />
                      </div>
                      <p className="text-sm font-semibold text-stone-400 mb-1">No results found</p>
                      <p className="text-xs text-stone-600">Try a different username.</p>
                    </>
                  ) : (
                    <>
                      <div className="size-12 rounded-full bg-stone-800/60 flex items-center justify-center mx-auto mb-3">
                        <span className="text-2xl">♟</span>
                      </div>
                      <p className="text-sm font-semibold text-stone-400 mb-1">No players online</p>
                      <p className="text-xs text-stone-600 max-w-[200px] mx-auto">
                        Share this link with a friend to start a match!
                      </p>
                    </>
                  )}
                </div>
              ) : (
                <ul className="divide-y divide-stone-800/80 max-h-[55vh] overflow-y-auto">
                  {listToShow.map((p) => {
                    const isBusy = busyUid === p.uid;
                    const alreadyChallenged = outgoing.some(
                      (c) => c.targetUid === p.uid && c.status === "pending"
                    );
                    const total = p.wins + p.losses + p.draws;
                    const winRate = total > 0 ? Math.round((p.wins / total) * 100) : 0;
                    const levelLabel = p.wins >= 50 ? "Master" : p.wins >= 20 ? "Skilled" : p.wins >= 5 ? "Casual" : "Beginner";
                    const levelColor = p.wins >= 50 ? "text-amber-400" : p.wins >= 20 ? "text-emerald-400" : p.wins >= 5 ? "text-sky-400" : "text-stone-400";
                    return (
                      <motion.li
                        key={p.uid}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="lobby-player-card"
                      >
                        <div className="flex items-center gap-3 px-3 py-3 hover:bg-stone-800/50 transition-all rounded-lg mx-1 my-0.5">
                          <div className="relative flex-shrink-0">
                            <Avatar className="size-10 ring-2 ring-stone-700">
                              <AvatarImage src={p.photoURL ?? undefined} />
                              <AvatarFallback className="bg-gradient-to-br from-stone-700 to-stone-800 text-amber-300 text-sm font-bold">
                                {p.username.slice(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full bg-emerald-400 ring-2 ring-stone-900" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="text-sm font-semibold text-stone-100 truncate">
                                {p.username}
                              </p>
                              {p.provider === "google" && (
                                <Shield className="size-3 text-amber-400 flex-shrink-0" />
                              )}
                              <span className={`text-[9px] font-bold uppercase tracking-wider ${levelColor}`}>
                                {levelLabel}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[10px] text-emerald-500 font-semibold">{p.wins}W</span>
                              <span className="text-[10px] text-stone-600">·</span>
                              <span className="text-[10px] text-rose-500 font-semibold">{p.losses}L</span>
                              <span className="text-[10px] text-stone-600">·</span>
                              <span className="text-[10px] text-stone-500 font-semibold">{p.draws}D</span>
                              {total > 0 && (
                                <>
                                  <span className="text-[10px] text-stone-600">·</span>
                                  <span className="text-[10px] text-amber-400/70 font-medium">{winRate}% WR</span>
                                </>
                              )}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant={alreadyChallenged ? "outline" : "default"}
                            disabled={isBusy || alreadyChallenged}
                            onClick={() => openColorPicker(p)}
                            className={
                              alreadyChallenged
                                ? "border-stone-700 text-stone-500 text-xs h-8"
                                : "bg-amber-500 text-stone-950 hover:bg-amber-400 text-xs h-8 font-semibold game-action-btn"
                            }
                          >
                            {isBusy ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : alreadyChallenged ? (
                              <>✓ Sent</>
                            ) : (
                              <><Swords className="size-3.5 mr-1" />Challenge</>
                            )}
                          </Button>
                        </div>
                      </motion.li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          {/* Right rail: tips / activity */}
          <aside className="space-y-4">
            <div className="rounded-xl border border-stone-800 bg-stone-900/40 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Trophy className="size-4 text-amber-400" />
                <h3 className="text-sm font-semibold text-stone-200">How it works</h3>
              </div>
              <ol className="space-y-2 text-xs text-stone-400 leading-relaxed list-decimal list-inside">
                <li>Search any registered username above.</li>
                <li>Hit <span className="text-amber-300">Challenge</span> — they get a popup.</li>
                <li>They have <span className="text-amber-300">5 minutes</span> to accept.</li>
                <li>Once accepted, you both jump into focus-mode board.</li>
                <li>Moves sync in real time via Firestore.</li>
              </ol>
            </div>

            <div className="rounded-xl border border-stone-800 bg-stone-900/40 p-4">
              <h3 className="text-sm font-semibold text-stone-200 mb-2">Quick stats</h3>
              <div className="grid grid-cols-3 gap-2 text-center">
                <MiniStat label="Wins" value={stats?.wins ?? 0} tone="text-emerald-400" />
                <MiniStat label="Losses" value={stats?.losses ?? 0} tone="text-rose-400" />
                <MiniStat label="Draws" value={stats?.draws ?? 0} tone="text-stone-300" />
              </div>
              <div className="h-px bg-stone-800 my-3" />
              <p className="text-[11px] text-stone-500 leading-relaxed">
                {stats?.total ?? 0 === 0
                  ? "Play your first online match to start building your record."
                  : `${stats?.total ?? 0} game${(stats?.total ?? 0) === 1 ? "" : "s"} played.`}
              </p>
            </div>
          </aside>
        </section>
      </main>

      <footer className="border-t border-stone-900 mt-6 py-4 text-center text-[11px] text-stone-600">
        Grandmaster&apos;s Arena · Next.js + Firebase · {new Date().getFullYear()}
      </footer>

      {/* Incoming challenge modal — top priority */}
      {topIncoming && <IncomingChallengeModal challenge={topIncoming} />}

      {/* If our most recent outgoing got declined, show a tiny notice briefly */}
      {justDeclined && !pendingOutgoing && <ChallengeExpiredNotice />}

      {/* Color picker dialog — challenger chooses which side to play */}
      <Dialog open={!!colorPickFor} onOpenChange={(o) => !o && setColorPickFor(null)}>
        <DialogContent className="bg-stone-900 border-stone-700 text-stone-100 max-w-sm p-0 overflow-hidden">
          {/* Header banner */}
          <div className="bg-gradient-to-b from-amber-500/10 to-transparent px-5 pt-5 pb-4 border-b border-stone-800">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center flex-shrink-0">
                <Swords className="size-5 text-stone-950" />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-amber-400 font-bold">Challenge</p>
                <h2 className="text-base font-bold text-stone-100">{colorPickFor?.username}</h2>
              </div>
            </div>
          </div>

          <div className="p-5">
            <p className="text-xs text-stone-500 mb-4">
              Pick your side — your opponent will see this before accepting.
            </p>
            <div className="grid grid-cols-3 gap-2 mb-5">
              <ColorOption
                label="White"
                description="Move first"
                selected={pendingColor === "white"}
                onClick={() => setPendingColor("white")}
                swatch={
                  <span className="size-10 rounded-full bg-stone-100 border-2 border-stone-300 shadow-sm shadow-stone-200/20" />
                }
              />
              <ColorOption
                label="Black"
                description="2nd mover"
                selected={pendingColor === "black"}
                onClick={() => setPendingColor("black")}
                swatch={
                  <span className="size-10 rounded-full bg-stone-950 border-2 border-stone-600 shadow-sm" />
                }
              />
              <ColorOption
                label="Random"
                description="Coin flip"
                selected={pendingColor === "random"}
                onClick={() => setPendingColor("random")}
                swatch={
                  <span className="size-10 rounded-full overflow-hidden border-2 border-stone-600 flex shadow-sm">
                    <span className="w-1/2 h-full bg-stone-100" />
                    <span className="w-1/2 h-full bg-stone-950" />
                  </span>
                }
              />
            </div>

            <div className="flex gap-2">
              <Button
                variant="ghost"
                onClick={() => setColorPickFor(null)}
                className="flex-1 border border-stone-700 text-stone-400 hover:text-stone-200 hover:bg-stone-800"
              >
                Cancel
              </Button>
              <Button
                onClick={confirmChallenge}
                className="flex-1 bg-amber-500 text-stone-950 hover:bg-amber-400 font-semibold"
              >
                <Swords className="size-4 mr-1.5" />
                Send!
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Color option tile used by the color picker dialog.
function ColorOption({
  label,
  description,
  selected,
  onClick,
  swatch,
}: {
  label: string;
  description: string;
  selected: boolean;
  onClick: () => void;
  swatch: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center gap-2.5 py-4 px-2 rounded-xl border-2 transition-all relative overflow-hidden ${
        selected
          ? "border-amber-500 bg-amber-500/10 shadow-md shadow-amber-500/10"
          : "border-stone-700 bg-stone-950/40 hover:border-stone-500 hover:bg-stone-900/80"
      }`}
    >
      {selected && (
        <span className="absolute top-1.5 right-1.5 size-4 rounded-full bg-amber-500 flex items-center justify-center">
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
            <path d="M1.5 4L3.5 6L6.5 2" stroke="#0c0a09" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>
      )}
      {swatch}
      <div className="text-center">
        <div className={`text-xs font-bold ${selected ? "text-amber-300" : "text-stone-200"}`}>
          {label}
        </div>
        <div className="text-[9px] text-stone-500 mt-0.5">{description}</div>
      </div>
    </button>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "emerald" | "rose" | "stone";
}) {
  const tones = {
    emerald: "text-emerald-400",
    rose: "text-rose-400",
    stone: "text-stone-300",
  };
  const borders = {
    emerald: "border-emerald-500/20 bg-emerald-500/5",
    rose: "border-rose-500/20 bg-rose-500/5",
    stone: "border-stone-700 bg-stone-800/40",
  };
  return (
    <div className={`flex flex-col items-center px-3.5 py-2 rounded-xl border min-w-[64px] ${borders[tone]}`}>
      <span className={`text-xl font-bold tabular-nums ${tones[tone]}`}>{value}</span>
      <span className="text-[9px] uppercase tracking-wider text-stone-500 font-semibold mt-0.5">{label}</span>
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="p-2 rounded-lg bg-stone-950/60 border border-stone-800">
      <div className={`text-base font-semibold ${tone}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-stone-500">{label}</div>
    </div>
  );
}

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
      // Challenger plays white (challengerUid == whiteUid, see acceptChallenge in chessApi)
      const myColor: "white" | "black" =
        accepted.challengerUid === profile.uid ? "white" : "black";
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

  async function handleChallenge(target: UserProfile) {
    if (!profile) return;
    setBusyUid(target.uid);
    try {
      await sendChallenge(profile, target.uid, target.username);
      toast({
        title: "Challenge sent!",
        description: `Waiting for ${target.username} to accept (5 min).`,
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
          className="rounded-2xl border border-stone-800 bg-stone-900/50 p-4 mb-6 flex items-center gap-4"
        >
          <Avatar className="size-14 ring-2 ring-amber-500/40">
            <AvatarImage src={profile.photoURL ?? undefined} />
            <AvatarFallback className="bg-stone-800 text-amber-300 text-lg">
              {profile.username.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-semibold text-stone-100">{profile.username}</h2>
              {profile.provider === "google" ? (
                <Badge variant="outline" className="border-amber-500/30 text-amber-300 bg-amber-500/5">
                  <Shield className="size-3 mr-1" />
                  Google
                </Badge>
              ) : (
                <Badge variant="outline" className="border-stone-700 text-stone-400">
                  <UserIcon className="size-3 mr-1" />
                  Guest
                </Badge>
              )}
            </div>
            <p className="text-xs text-stone-500 truncate">
              {profile.email ?? "No email — playing anonymously"}
            </p>
          </div>
          {stats && (
            <div className="hidden sm:flex items-center gap-2">
              <Stat label="Wins" value={stats.wins} tone="emerald" />
              <Stat label="Losses" value={stats.losses} tone="rose" />
              <Stat label="Draws" value={stats.draws} tone="stone" />
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
                <div className="p-8 text-center">
                  {search.trim() ? (
                    <>
                      <Search className="size-6 text-stone-700 mx-auto mb-2" />
                      <p className="text-sm text-stone-500">No players match your search.</p>
                    </>
                  ) : (
                    <>
                      <RefreshCw className="size-6 text-stone-700 mx-auto mb-2" />
                      <p className="text-sm text-stone-500">
                        No one else online right now. Share the link with a friend!
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
                    return (
                      <li
                        key={p.uid}
                        className="flex items-center gap-3 p-3 hover:bg-stone-800/40 transition-colors"
                      >
                        <div className="relative">
                          <Avatar className="size-9">
                            <AvatarImage src={p.photoURL ?? undefined} />
                            <AvatarFallback className="bg-stone-800 text-amber-300 text-xs">
                              {p.username.slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full bg-emerald-500 ring-2 ring-stone-900 dot-online" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium text-stone-100 truncate">
                              {p.username}
                            </p>
                            {p.provider === "google" ? (
                              <Shield className="size-3 text-amber-400" />
                            ) : (
                              <UserIcon className="size-3 text-stone-500" />
                            )}
                            <span className="text-[10px] text-stone-500">
                              {p.wins}W · {p.losses}L
                            </span>
                          </div>
                          <p className="text-[11px] text-stone-500 truncate">
                            {p.isOnline ? "Online now" : "Offline"}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant={alreadyChallenged ? "outline" : "default"}
                          disabled={isBusy || alreadyChallenged}
                          onClick={() => handleChallenge(p)}
                          className={
                            alreadyChallenged
                              ? "border-stone-700 text-stone-500"
                              : "bg-amber-500 text-stone-950 hover:bg-amber-400"
                          }
                        >
                          {isBusy ? (
                            <Loader2 className="size-3.5 mr-1 animate-spin" />
                          ) : (
                            <Swords className="size-3.5 mr-1" />
                          )}
                          {alreadyChallenged ? "Sent" : "Challenge"}
                        </Button>
                      </li>
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
    </div>
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
  return (
    <div className="flex flex-col items-center px-3 py-1.5 rounded-lg bg-stone-950/60 border border-stone-800 min-w-[60px]">
      <span className={`text-lg font-semibold ${tones[tone]}`}>{value}</span>
      <span className="text-[10px] uppercase tracking-wider text-stone-500">{label}</span>
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

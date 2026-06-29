"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Clock, Swords, X, Check, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useChessStore } from "@/lib/store";
import {
  acceptChallenge,
  declineChallenge,
  cancelChallenge,
} from "@/lib/chessApi";
import { CHALLENGE_TTL_MS } from "@/lib/types";
import type { Challenge } from "@/lib/types";

function fmt(ms: number): string {
  if (ms <= 0) return "0:00";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

// Incoming challenge: target = me. I can accept or decline within TTL.
export function IncomingChallengeModal({ challenge }: { challenge: Challenge }) {
  const [remaining, setRemaining] = useState(challenge.expiresAt - Date.now());
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const profile = useChessStore((s) => s.profile);
  const setActiveGame = useChessStore((s) => s.setActiveGame);
  const setView = useChessStore((s) => s.setView);

  useEffect(() => {
    const id = setInterval(() => {
      const r = challenge.expiresAt - Date.now();
      setRemaining(r);
      if (r <= 0) clearInterval(id);
    }, 250);
    return () => clearInterval(id);
  }, [challenge.expiresAt]);

  async function handleAccept() {
    if (!profile) return;
    setBusy(true);
    try {
      const { gameId, myColor } = await acceptChallenge(challenge, profile);
      // Accepter plays the opposite color of what the challenger picked.
      setActiveGame(gameId, null, myColor);
      setView("game");
      toast({ title: "Challenge accepted!", description: "Match starting…" });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to accept.";
      toast({ title: "Accept failed", description: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function handleDecline() {
    setBusy(true);
    try {
      await declineChallenge(challenge.id);
      toast({ title: "Challenge declined." });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed.";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  const urgency = remaining < 60_000;
  const critical = remaining < 20_000;

  return (
    <AnimatePresence>
      {remaining > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md"
        >
          <motion.div
            initial={{ scale: 0.88, y: 16, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.88, y: 16, opacity: 0 }}
            transition={{ type: "spring", stiffness: 340, damping: 26 }}
            className={`w-full max-w-sm rounded-2xl border shadow-2xl overflow-hidden ${
              critical
                ? "border-rose-500/50 bg-stone-900 shadow-rose-900/40"
                : urgency
                ? "border-orange-500/40 bg-stone-900 shadow-orange-900/30"
                : "border-amber-500/30 bg-stone-900 shadow-amber-900/25"
            }`}
          >
            {/* Countdown progress bar */}
            <div className="h-1.5 bg-stone-800 relative overflow-hidden">
              <div
                className={`h-full ${
                  critical ? "bg-rose-500" : urgency ? "bg-orange-500" : "bg-amber-500"
                }`}
                style={{
                  width: `${Math.max(0, (remaining / (5 * 60 * 1000)) * 100)}%`,
                  transition: "width 1s linear"
                }}
              />
            </div>

            <div className="p-5">
              <div className="flex items-center gap-3 mb-4">
                <motion.div
                  animate={{ scale: [1, 1.06, 1] }}
                  transition={{ repeat: Infinity, duration: 1.8 }}
                  className="size-12 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-lg shadow-amber-500/25 flex-shrink-0"
                >
                  <Swords className="size-5 text-stone-950" />
                </motion.div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] uppercase tracking-widest text-amber-400 font-bold mb-0.5">
                    ⚔ Challenge incoming
                  </p>
                  <h2 className="text-lg font-bold text-stone-100 truncate">
                    {challenge.challengerName}
                  </h2>
                </div>
                <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-sm font-mono font-bold ${
                  critical
                    ? "bg-rose-500/15 border-rose-500/40 text-rose-300"
                    : urgency
                    ? "bg-orange-500/15 border-orange-500/40 text-orange-300"
                    : "bg-stone-950/60 border-stone-700 text-amber-300"
                }`}>
                  <Clock className={`size-3.5 ${critical ? "animate-ping" : urgency ? "animate-pulse" : ""}`} />
                  {fmt(remaining)}
                </div>
              </div>

              {/* Color display — side by side */}
              <div className="grid grid-cols-2 gap-2 mb-4">
                <div className="p-3 rounded-xl bg-stone-950/50 border border-stone-800 text-center">
                  <div className="text-[9px] uppercase tracking-widest text-stone-500 font-bold mb-1.5">They play</div>
                  <ColorChip choice={challenge.challengerColor ?? "white"} />
                </div>
                <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/20 text-center">
                  <div className="text-[9px] uppercase tracking-widest text-amber-500/70 font-bold mb-1.5">You play</div>
                  <ColorChip
                    choice={
                      (challenge.challengerColor ?? "white") === "white"
                        ? "black"
                        : (challenge.challengerColor ?? "white") === "black"
                        ? "white"
                        : "random"
                    }
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={handleDecline}
                  disabled={busy}
                  className="flex-1 h-11 border-stone-700 bg-stone-800/40 hover:bg-stone-800 text-stone-300 hover:text-stone-100"
                >
                  <X className="size-4 mr-1.5" />
                  Decline
                </Button>
                <Button
                  onClick={handleAccept}
                  disabled={busy}
                  className="flex-1 h-11 bg-emerald-500 hover:bg-emerald-400 text-stone-950 font-bold shadow-md shadow-emerald-500/20"
                >
                  <Check className="size-4 mr-1.5" />
                  Accept!
                </Button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Outgoing challenge: I sent it, watching for acceptance. I can cancel.
export function OutgoingChallengeModal({ challenge }: { challenge: Challenge }) {
  const [remaining, setRemaining] = useState(challenge.expiresAt - Date.now());
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const id = setInterval(() => {
      const r = challenge.expiresAt - Date.now();
      setRemaining(r);
      if (r <= 0) clearInterval(id);
    }, 250);
    return () => clearInterval(id);
  }, [challenge.expiresAt]);

  async function handleCancel() {
    setBusy(true);
    try {
      await cancelChallenge(challenge.id);
      toast({ title: "Challenge cancelled." });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed.";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  const urgency = remaining < 60_000;
  const pct = Math.max(0, (remaining / (5 * 60 * 1000)) * 100);

  return (
    <div className={`rounded-xl border overflow-hidden ${urgency ? "border-orange-500/30 bg-orange-500/5" : "border-amber-500/20 bg-amber-500/5"}`}>
      {/* Countdown bar */}
      <div className="h-0.5 bg-stone-800">
        <div
          className={`h-full transition-all ${urgency ? "bg-orange-500" : "bg-amber-500"}`}
          style={{ width: `${pct}%`, transition: "width 1s linear" }}
        />
      </div>
      <div className="flex items-center gap-3 p-4">
        <div className={`size-9 rounded-full flex items-center justify-center flex-shrink-0 ${urgency ? "bg-orange-500/20" : "bg-amber-500/20"}`}>
          <Clock className={`size-4 ${urgency ? "text-orange-400" : "text-amber-400"} animate-pulse`} />
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-[10px] uppercase tracking-wider font-bold ${urgency ? "text-orange-400" : "text-amber-400"}`}>
            Waiting for response
          </p>
          <p className="text-sm text-stone-200 truncate">
            → <span className="font-semibold">{challenge.targetName}</span>
          </p>
        </div>
        <div className={`font-mono text-sm font-bold ${urgency ? "text-orange-300" : "text-amber-300"}`}>
          {fmt(remaining)}
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleCancel}
          disabled={busy}
          className="text-stone-500 hover:text-rose-300 hover:bg-rose-500/10 text-xs"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function ChallengeExpiredNotice() {
  return (
    <div className="rounded-xl border border-stone-800 bg-stone-900/40 p-3 text-center text-xs text-stone-500">
      A challenge expired (no response in {Math.floor(CHALLENGE_TTL_MS / 60000)} min).
    </div>
  );
}

// Small visual chip used inside the IncomingChallengeModal to show
// which color the challenger picked.
function ColorChip({ choice }: { choice: "white" | "black" | "random" }) {
  if (choice === "random") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-stone-800 border border-stone-700 text-stone-200 text-xs font-semibold">
        <span className="flex">
          <span className="size-3 rounded-l-sm bg-stone-100 border border-stone-300" />
          <span className="size-3 rounded-r-sm bg-stone-950 border border-stone-700" />
        </span>
        Random
      </span>
    );
  }
  const isWhite = choice === "white";
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

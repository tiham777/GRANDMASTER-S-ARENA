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
      const gameId = await acceptChallenge(challenge, profile);
      // Challenger plays white, accepter plays black
      setActiveGame(gameId, null, "black");
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

  return (
    <AnimatePresence>
      {remaining > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
        >
          <motion.div
            initial={{ scale: 0.9, y: 10 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 10 }}
            transition={{ type: "spring", stiffness: 320, damping: 24 }}
            className="w-full max-w-md rounded-2xl border border-amber-500/30 bg-stone-900 shadow-2xl shadow-amber-900/30 overflow-hidden"
          >
            <div className="h-1 bg-shimmer" />
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="size-12 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center">
                  <Swords className="size-5 text-stone-950" />
                </div>
                <div className="flex-1">
                  <p className="text-xs uppercase tracking-wider text-amber-400 font-medium">
                    Challenge received
                  </p>
                  <h2 className="text-lg font-semibold text-stone-100">
                    {challenge.challengerName}
                  </h2>
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-stone-950/60 border border-stone-800 text-amber-300 text-sm font-mono">
                  <Clock className="size-3.5" />
                  {fmt(remaining)}
                </div>
              </div>

              <div className="flex items-center gap-2 mb-5 text-stone-400 text-sm">
                <AlertCircle className="size-4 text-stone-500" />
                Accept within 5 minutes or the challenge expires.
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={handleDecline}
                  disabled={busy}
                  className="flex-1 h-11 border-stone-700 hover:bg-stone-800 text-stone-200"
                >
                  <X className="size-4 mr-1.5" />
                  Decline
                </Button>
                <Button
                  onClick={handleAccept}
                  disabled={busy}
                  className="flex-1 h-11 bg-emerald-500 hover:bg-emerald-400 text-stone-950"
                >
                  <Check className="size-4 mr-1.5" />
                  Accept
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

  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
      <div className="flex items-center gap-3">
        <div className="size-9 rounded-full bg-amber-500/20 flex items-center justify-center">
          <Clock className="size-4 text-amber-400 animate-pulse" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-amber-400 uppercase tracking-wider">
            Waiting for response
          </p>
          <p className="text-sm text-stone-200 truncate">
            Challenge to <span className="font-medium">{challenge.targetName}</span>
          </p>
        </div>
        <div className="text-amber-300 font-mono text-sm">{fmt(remaining)}</div>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleCancel}
          disabled={busy}
          className="text-stone-400 hover:text-rose-300 hover:bg-rose-500/10"
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

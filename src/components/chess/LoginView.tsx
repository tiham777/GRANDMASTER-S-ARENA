"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Crown, LogIn, User, Loader2, Sparkles, Swords, Cpu, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useChessStore } from "@/lib/store";
import {
  signInWithGoogle,
  signInAsGuest,
  validateUsername,
  sanitizeUsername,
  isUsernameTaken,
} from "@/lib/chessApi";
import type { AuthProvider } from "@/lib/types";

type Mode = "choose" | "google" | "guest";

export default function LoginView() {
  const [mode, setMode] = useState<Mode>("choose");
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState<AuthProvider | null>(null);
  const { toast } = useToast();
  const setProfile = useChessStore((s) => s.setProfile);
  const setView = useChessStore((s) => s.setView);

  useEffect(() => {
    return () => {};
  }, []);

  async function handleGoogle() {
    setBusy("google");
    try {
      const finalName = username.trim() ? sanitizeUsername(username) : "";
      if (finalName) {
        const v = validateUsername(finalName);
        if (!v.ok) {
          toast({ title: "Invalid username", description: v.reason, variant: "destructive" });
          setBusy(null);
          return;
        }
        const taken = await isUsernameTaken(finalName);
        if (taken) {
          toast({
            title: "Username taken",
            description: "Try another name — we'll auto-suffix if you leave it blank.",
            variant: "destructive",
          });
          setBusy(null);
          return;
        }
      }
      const p = await signInWithGoogle(finalName || undefined);
      setProfile(p);
      setView("lobby");
      toast({ title: `Welcome, ${p.username}`, description: "Signed in with Google." });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Google sign-in failed.";
      toast({ title: "Sign-in failed", description: msg, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  async function handleGuest() {
    const v = validateUsername(username);
    if (!v.ok) {
      toast({ title: "Invalid username", description: v.reason, variant: "destructive" });
      return;
    }
    const clean = sanitizeUsername(username);
    if (await isUsernameTaken(clean)) {
      toast({ title: "Username taken", description: "Pick a different name.", variant: "destructive" });
      return;
    }
    setBusy("guest");
    try {
      const p = await signInAsGuest(clean);
      setProfile(p);
      setView("lobby");
      toast({ title: `Welcome, ${p.username}`, description: "Playing as guest." });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Guest sign-in failed.";
      toast({ title: "Sign-in failed", description: msg, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  function enterOffline() {
    setView("offline");
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      <div className="pointer-events-none absolute -top-32 -left-32 w-96 h-96 rounded-full bg-amber-500/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-emerald-500/10 blur-3xl" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="relative w-full max-w-md"
      >
        <div className="rounded-2xl border border-stone-800 bg-stone-900/80 backdrop-blur-sm shadow-2xl shadow-black/40 overflow-hidden">
          <div className="h-1 w-full bg-shimmer" />

          <div className="p-8">
            <div className="text-center mb-7">
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.1, type: "spring", stiffness: 300 }}
                className="size-16 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-xl shadow-amber-900/40 mx-auto mb-4"
              >
                <Crown className="size-8 text-stone-950" />
              </motion.div>
              <h1 className="text-2xl font-black tracking-tight text-stone-100 mb-1">
                Grandmaster&apos;s Arena
              </h1>
              <p className="text-xs text-stone-500 uppercase tracking-widest">Online Chess Platform</p>
            </div>

            <AnimatePresence mode="wait">
              {mode === "choose" && (
                <motion.div
                  key="choose"
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 8 }}
                  className="space-y-3"
                >
                  <Button
                    onClick={() => setMode("google")}
                    className="w-full h-12 bg-stone-100 text-stone-950 hover:bg-stone-200 font-medium"
                  >
                    <LogIn className="size-4 mr-2" />
                    Continue with Google
                  </Button>
                  <Button
                    onClick={() => setMode("guest")}
                    variant="outline"
                    className="w-full h-12 bg-stone-900/60 border-stone-700 hover:bg-stone-800 text-stone-100"
                  >
                    <User className="size-4 mr-2" />
                    Play as Guest
                  </Button>
                  <div className="h-px bg-stone-800 my-4" />
                  <Button
                    onClick={enterOffline}
                    variant="ghost"
                    className="w-full h-10 text-stone-300 hover:text-amber-300 hover:bg-amber-500/5"
                  >
                    <Cpu className="size-4 mr-2" />
                    Skip — Play vs AI / Local 2P
                  </Button>

                  <div className="mt-6 grid grid-cols-3 gap-2 text-[10px]">
                    <div className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-stone-950/50 border border-stone-800/60 text-center">
                      <Swords className="size-4 text-amber-400" />
                      <span className="text-stone-400 font-medium">Online PvP</span>
                    </div>
                    <div className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-stone-950/50 border border-stone-800/60 text-center">
                      <Users className="size-4 text-emerald-400" />
                      <span className="text-stone-400 font-medium">Challenges</span>
                    </div>
                    <div className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-stone-950/50 border border-stone-800/60 text-center">
                      <Sparkles className="size-4 text-rose-400" />
                      <span className="text-stone-400 font-medium">vs AI</span>
                    </div>
                  </div>
                </motion.div>
              )}

              {(mode === "google" || mode === "guest") && (
                <motion.div
                  key={mode}
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  className="space-y-4"
                >
                  <div>
                    <Label htmlFor="username" className="text-stone-300 text-xs uppercase tracking-wider">
                      Choose your username
                    </Label>
                    <Input
                      id="username"
                      autoFocus
                      placeholder="e.g. knight_rider"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      maxLength={20}
                      className="mt-2 h-11 bg-stone-950/60 border-stone-700 text-stone-100 placeholder:text-stone-600 focus:border-amber-500 focus:ring-amber-500/30"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          if (mode === "google") handleGoogle();
                          else handleGuest();
                        }
                      }}
                    />
                    <p className="mt-2 text-[11px] text-stone-500">
                      3–20 chars · letters, numbers, underscores.
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      onClick={() => setMode("choose")}
                      className="text-stone-400 hover:text-stone-200 hover:bg-stone-800/60"
                    >
                      Back
                    </Button>
                    <div className="flex-1" />
                    {mode === "google" ? (
                      <Button
                        onClick={handleGoogle}
                        disabled={busy !== null}
                        className="bg-stone-100 text-stone-950 hover:bg-stone-200 h-11 px-5"
                      >
                        {busy === "google" ? (
                          <Loader2 className="size-4 mr-2 animate-spin" />
                        ) : (
                          <LogIn className="size-4 mr-2" />
                        )}
                        Continue with Google
                      </Button>
                    ) : (
                      <Button
                        onClick={handleGuest}
                        disabled={busy !== null}
                        className="bg-amber-500 text-stone-950 hover:bg-amber-400 h-11 px-5"
                      >
                        {busy === "guest" ? (
                          <Loader2 className="size-4 mr-2 animate-spin" />
                        ) : (
                          <User className="size-4 mr-2" />
                        )}
                        Enter as Guest
                      </Button>
                    )}
                  </div>

                  <p className="text-[11px] text-stone-500 leading-relaxed">
                    {mode === "google"
                      ? "Google auth lets you keep your win/loss record and findable username across devices. We only see your name and email."
                      : "Guest uses an anonymous Firebase session. You can play online but if you clear browser data your record is lost."}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <p className="text-center text-[11px] text-stone-600 mt-4">
          By continuing you agree to play nice. Built on Next.js + Firebase.
        </p>
      </motion.div>
    </div>
  );
}

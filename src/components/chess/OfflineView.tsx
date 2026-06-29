"use client";

import { motion } from "framer-motion";
import {
  ArrowLeft,
  Crown,
  Volume2,
  VolumeX,
  Sun,
  Moon,
  Maximize,
  Minimize,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useChessStore } from "@/lib/store";
import { useEffect, useRef, useState } from "react";

export default function OfflineView() {
  const setView = useChessStore((s) => s.setView);
  const profile = useChessStore((s) => s.profile);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Mirror the inner game's state so our outer buttons reflect it
  const [muted, setMuted] = useState(false);
  const [isDark, setIsDark] = useState(true); // chess-game.html defaults to dark
  const [isFocus, setIsFocus] = useState(false);

  // After the iframe loads, inject CSS to hide the original's <header>
  // so we don't get a duplicate top bar. The Next.js app's header replaces it.
  // The original's 3 control buttons (audio/theme/focus) are triggered remotely
  // by our own buttons below, by clicking the iframe's hidden buttons.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    function injectHideHeader() {
      try {
        const doc = iframe!.contentDocument;
        if (!doc) return;
        if (doc.getElementById("__hide_header_css__")) return;
        const style = doc.createElement("style");
        style.id = "__hide_header_css__";
        // Hide the original's sticky top header entirely — our merged topbar
        // (with back button + crown + 3 controls) replaces it.
        style.textContent = `
          header.sticky, header[class*="sticky"] { display: none !important; }
          main { padding-top: 0 !important; margin-top: 0 !important; }
        `;
        doc.head.appendChild(style);
      } catch {
        /* cross-origin or not ready — ignore */
      }
    }

    iframe.addEventListener("load", injectHideHeader);
    injectHideHeader();

    return () => {
      iframe.removeEventListener("load", injectHideHeader);
    };
  }, []);

  // Helper: find a button inside the iframe by its title attribute and click it.
  // The original chess-game.html exposes 3 titled buttons:
  //   - title="Disable Audio" / "Enable Audio"
  //   - title="Toggle Light/Dark Mode"
  //   - title="Enter Focus Mode — hide everything except the board" /
  //     title="Exit Focus Mode"
  function clickInnerButton(titlePattern: string): HTMLButtonElement | null {
    try {
      const doc = iframeRef.current?.contentDocument;
      if (!doc) return null;
      const btn = doc.querySelector<HTMLButtonElement>(
        `button[title*="${titlePattern}"], button[title*="${titlePattern.toLowerCase()}"]`
      );
      if (btn) {
        btn.click();
        return btn;
      }
    } catch {
      /* noop */
    }
    return null;
  }

  function handleAudioToggle() {
    const btn = clickInnerButton("Audio");
    if (btn) setMuted((m) => !m);
  }

  function handleThemeToggle() {
    const btn = clickInnerButton("Light/Dark");
    if (btn) setIsDark((d) => !d);
  }

  function handleFocusToggle() {
    const btn = clickInnerButton("Focus Mode");
    if (btn) setIsFocus((f) => !f);
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Merged topbar — replaces the original's duplicate header.
          Now contains the 3 control buttons the original had:
          audio toggle, theme toggle, focus mode. */}
      <header className="border-b border-stone-900 bg-stone-950/90 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 h-12 flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setView(profile ? "lobby" : "login")}
            className="text-stone-400 hover:text-stone-200 hover:bg-stone-800/60"
          >
            <ArrowLeft className="size-4" />
            <span className="ml-1.5 hidden sm:inline">
              {profile ? "Lobby" : "Login"}
            </span>
          </Button>
          <div className="size-7 rounded bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-sm">
            <Crown className="size-4 text-stone-950" />
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-sm font-semibold text-stone-100 tracking-tight">
              Grandmaster&apos;s Arena
            </span>
            <span className="text-[10px] text-stone-500 uppercase tracking-wider mt-0.5 hidden sm:inline">
              Chess Platform &amp; Engine Analysis
            </span>
          </div>
          <div className="flex-1" />

          {/* The 3 original-game control buttons — same look as chess-game.html */}
          <Button
            variant="ghost"
            size="icon"
            onClick={handleAudioToggle}
            title={muted ? "Enable Audio" : "Disable Audio"}
            className="size-9 rounded-xl border border-stone-800 bg-stone-900 hover:bg-stone-800 hover:border-stone-700 text-stone-400 hover:text-stone-200 transition-all"
          >
            {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={handleThemeToggle}
            title="Toggle Light/Dark Mode"
            className="size-9 rounded-xl border border-stone-800 bg-stone-900 hover:bg-stone-800 hover:border-stone-700 text-stone-400 hover:text-stone-200 transition-all"
          >
            {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={handleFocusToggle}
            title={
              isFocus
                ? "Exit Focus Mode"
                : "Enter Focus Mode — hide everything except the board"
            }
            className={`size-9 rounded-xl border transition-all ${
              isFocus
                ? "border-amber-500 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25"
                : "border-stone-800 bg-stone-900 hover:bg-stone-800 hover:border-stone-700 text-stone-400 hover:text-stone-200"
            }`}
          >
            {isFocus ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
          </Button>
        </div>
      </header>

      <motion.main
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex-1"
      >
        <iframe
          ref={iframeRef}
          src="/chess-game.html"
          title="Grandmaster's Arena — Offline"
          className="w-full"
          style={{ height: "calc(100vh - 48px)", border: "none", background: "#0c0a09" }}
          allow="fullscreen"
        />
      </motion.main>
    </div>
  );
}

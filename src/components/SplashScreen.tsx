"use client";

/**
 * SplashScreen — opening animation matching the original Grandmaster's Arena.
 *
 * Plays once on first load:
 *  1. Six chess piece glyphs (♔♕♖♗♘♙) fade in one-by-one with a
 *     slide-up + blur-in effect.
 *  2. "GRANDMASTER'S" title fades up (gold gradient).
 *  3. "ARENA" subtitle fades up (letterspaced).
 *  4. "Chess · Engine · Analysis" tagline fades in.
 *  5. A loading bar fills.
 *  6. After ~3.7s the whole splash fades out and is removed (4.2s total).
 *
 * Plays on every page load (including reloads) — no sessionStorage gating,
 * so reloading always shows the full animation.
 */
import { useEffect, useState } from "react";

const PIECE_GLYPHS: { glyph: string; delay: number }[] = [
  { glyph: "♔", delay: 0.15 },
  { glyph: "♕", delay: 0.23 },
  { glyph: "♖", delay: 0.31 },
  { glyph: "♗", delay: 0.39 },
  { glyph: "♘", delay: 0.47 },
  { glyph: "♙", delay: 0.55 },
];

export function SplashScreen() {
  const [visible, setVisible] = useState(true);
  const [hiding, setHiding] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Full animation: pieces (0.15–0.55s) + title (0.95s) + subtitle (1.1s)
    // + tagline (1.35s) + loader (1.5–3.3s). Start fade-out at 3.1s,
    // fully removed at 3.6s. Plays on every page load (including reloads).
    const hideTimer = setTimeout(() => setHiding(true), 3100);
    const removeTimer = setTimeout(() => {
      setVisible(false);
    }, 3600);

    return () => {
      clearTimeout(hideTimer);
      clearTimeout(removeTimer);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "linear-gradient(135deg, #0c0a09 0%, #1c1917 50%, #0c0a09 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        opacity: hiding ? 0 : 1,
        pointerEvents: hiding ? "none" : "auto",
        transition: "opacity 0.5s ease",
      }}
    >
      {/* Chess piece glyphs — fade in one-by-one */}
      <div style={{ display: "flex", gap: "4px", marginBottom: "32px" }}>
        {PIECE_GLYPHS.map((p, i) => (
          <span
            key={i}
            style={{
              fontSize: "clamp(24px, 5vw, 40px)",
              color: "#f59e0b",
              textShadow: "0 4px 8px rgba(0,0,0,0.5)",
              opacity: 0,
              animation: `splash-piece-in 0.65s cubic-bezier(0.22, 1, 0.36, 1) ${p.delay}s forwards`,
            }}
          >
            {p.glyph}
          </span>
        ))}
      </div>

      {/* Title */}
      <h1
        style={{
          fontSize: "clamp(28px, 5vw, 48px)",
          fontWeight: 900,
          letterSpacing: "-0.02em",
          background: "linear-gradient(to right, #fde68a, #f59e0b, #d97706)",
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          WebkitTextFillColor: "transparent",
          textAlign: "center",
          margin: 0,
          opacity: 0,
          animation: "splash-fade-up 0.7s ease-out 0.95s forwards",
        }}
      >
        GRANDMASTER&apos;S
      </h1>

      {/* Subtitle */}
      <h2
        style={{
          fontSize: "clamp(20px, 3vw, 32px)",
          fontWeight: 900,
          letterSpacing: "0.3em",
          color: "#f5f5f4",
          marginTop: "4px",
          opacity: 0,
          animation: "splash-fade-up 0.7s ease-out 1.1s forwards",
        }}
      >
        ARENA
      </h2>

      {/* Tagline */}
      <p
        style={{
          fontSize: "10px",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.4em",
          color: "rgba(245, 158, 11, 0.7)",
          marginTop: "20px",
          opacity: 0,
          animation: "splash-fade-in 0.6s ease-out 1.35s forwards",
        }}
      >
        Chess · Engine · Analysis
      </p>

      {/* Loading bar */}
      <div
        style={{
          marginTop: "40px",
          width: "200px",
          height: "3px",
          background: "#292524",
          borderRadius: "999px",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: "0%",
            background: "linear-gradient(to right, #f59e0b, #fcd34d)",
            borderRadius: "999px",
            animation: "splash-load 1.8s ease-in-out 1.5s forwards",
          }}
        />
      </div>

      {/* Init text */}
      <p
        style={{
          fontSize: "9px",
          fontFamily: "monospace",
          textTransform: "uppercase",
          letterSpacing: "0.2em",
          color: "#57534e",
          marginTop: "12px",
          opacity: 0,
          animation: "splash-fade-in 0.6s ease-out 1.5s forwards",
        }}
      >
        Initializing engine…
      </p>
    </div>
  );
}

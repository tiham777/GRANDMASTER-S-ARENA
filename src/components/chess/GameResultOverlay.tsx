"use client";

/**
 * GameResultOverlay — full-screen win / lose / draw animation overlay.
 *
 * Matches the original Grandmaster's Arena game-result-overlay exactly:
 *  - Win:  golden gradient text + winPulse + sparkles + radial golden bg
 *  - Lose: red text + loseShake + red vignette
 *  - Draw: gray text + drawFadeIn
 *
 * Shows for ~2.5s then calls onDismiss so the app can transition to the
 * detailed game-over screen.
 */
import { useEffect, useState, useMemo } from "react";

interface GameResultOverlayProps {
  /** "win" | "lose" | "draw" — from the player's perspective. */
  outcome: "win" | "lose" | "draw";
  /** Main text, e.g. "Checkmate!" or "Victory!" */
  title: string;
  /** Subtitle, e.g. "You won by checkmate" */
  subtitle?: string;
  /** Called after the overlay finishes its animation (~2.8s). */
  onDismiss: () => void;
}

export function GameResultOverlay({ outcome, title, subtitle, onDismiss }: GameResultOverlayProps) {
  // Generate sparkle positions (only for win).
  const sparkles = useMemo(() => {
    if (outcome !== "win") return [];
    return Array.from({ length: 12 }, (_, i) => ({
      id: i,
      left: `${10 + Math.random() * 80}%`,
      top: `${20 + Math.random() * 50}%`,
      delay: `${Math.random() * 0.8}s`,
    }));
  }, [outcome]);

  // Auto-dismiss after the animation plays.
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => {
      setVisible(false);
      onDismiss();
    }, 2800);
    return () => clearTimeout(t);
  }, [onDismiss]);

  if (!visible) return null;

  const overlayClass = `game-result-overlay ${outcome}`;
  const titleStyle: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 200,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "none",
    opacity: 0,
    animation: "result-fade-in 0.5s ease-out forwards",
  };

  const bgMap = {
    win: "radial-gradient(circle at center, rgba(245, 158, 11, 0.25) 0%, rgba(0, 0, 0, 0.6) 70%)",
    lose: "radial-gradient(circle at center, rgba(244, 63, 94, 0.2) 0%, rgba(0, 0, 0, 0.7) 70%)",
    draw: "radial-gradient(circle at center, rgba(168, 162, 158, 0.15) 0%, rgba(0, 0, 0, 0.6) 70%)",
  };
  titleStyle.background = bgMap[outcome];

  const titleText: React.CSSProperties = outcome === "win"
    ? {
        fontSize: "clamp(40px, 8vw, 72px)",
        fontWeight: 900,
        letterSpacing: "-0.02em",
        background: "linear-gradient(135deg, #fde68a 0%, #f59e0b 50%, #d97706 100%)",
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        WebkitTextFillColor: "transparent",
        textShadow: "0 0 40px rgba(245, 158, 11, 0.5)",
        animation: "win-pulse 2s ease-in-out infinite",
        textAlign: "center",
      }
    : outcome === "lose"
      ? {
          fontSize: "clamp(36px, 7vw, 64px)",
          fontWeight: 900,
          color: "#fb7185",
          textShadow: "0 0 30px rgba(244, 63, 94, 0.5)",
          animation: "lose-shake 0.6s ease-in-out",
          textAlign: "center",
        }
      : {
          fontSize: "clamp(36px, 7vw, 64px)",
          fontWeight: 900,
          color: "#d6d3d1",
          animation: "draw-fade-in 1s ease-out",
          textAlign: "center",
        };

  const subStyle: React.CSSProperties = {
    fontSize: "16px",
    marginTop: "12px",
    textTransform: "uppercase",
    letterSpacing: "0.2em",
    color: outcome === "win" ? "#fbbf24" : outcome === "lose" ? "#fb7185" : "#a8a29e",
    animation: outcome === "win"
      ? "win-sub-fade 1s ease-out 0.5s both"
      : outcome === "lose"
        ? "lose-sub-fade 1s ease-out 0.6s both"
        : "none",
  };

  return (
    <div className={overlayClass} style={titleStyle}>
      {/* Golden burst + sparkles for win */}
      {outcome === "win" && (
        <>
          <div className="win-burst" style={{ left: "50%", top: "50%", transform: "translate(-50%, -50%)" }} />
          {sparkles.map((s) => (
            <span
              key={s.id}
              className="sparkle"
              style={{ left: s.left, top: s.top, animationDelay: s.delay }}
            />
          ))}
        </>
      )}
      <div style={titleText}>{title}</div>
      {subtitle && <div style={subStyle}>{subtitle}</div>}
    </div>
  );
}

/**
 * chessThemes.ts — board themes, piece-set metadata, and opening names.
 *
 * Pure data module — safe to import from both client and server.
 */

export type BoardThemeId =
  | "classic"
  | "tournament"
  | "midnight"
  | "oceanic"
  | "sunset"
  | "ice"
  | "royal"
  | "sandstone";

export interface BoardTheme {
  id: BoardThemeId;
  name: string;
  light: string;
  dark: string;
  /** Tailwind gradient class for the swatch button. */
  swatch: string;
}

/** The 5 board themes — exact colors from the original Grandmaster's Arena. */
export const BOARD_THEMES: BoardTheme[] = [
  {
    id: "classic",
    name: "Classic Walnut",
    light: "#f0d9b5",
    dark: "#b58863",
    swatch: "from-[#f0d9b5] to-[#b58863]",
  },
  {
    id: "tournament",
    name: "Tournament Green",
    light: "#ececd7",
    dark: "#739552",
    swatch: "from-[#ececd7] to-[#739552]",
  },
  {
    id: "midnight",
    name: "Midnight Slate",
    light: "#d6d3d1",
    dark: "#57534e",
    swatch: "from-[#d6d3d1] to-[#57534e]",
  },
  {
    id: "oceanic",
    name: "Oceanic Depths",
    light: "#e9edf0",
    dark: "#4b7399",
    swatch: "from-[#e9edf0] to-[#4b7399]",
  },
  {
    id: "sunset",
    name: "Velvet Sunset",
    light: "#fed7aa",
    dark: "#9a3412",
    swatch: "from-[#fed7aa] to-[#9a3412]",
  },
  {
    id: "ice",
    name: "Arctic Ice",
    light: "#e0f2fe",
    dark: "#0ea5e9",
    swatch: "from-[#e0f2fe] to-[#0ea5e9]",
  },
  {
    id: "royal",
    name: "Royal Purple",
    light: "#f3e8ff",
    dark: "#7e22ce",
    swatch: "from-[#f3e8ff] to-[#7e22ce]",
  },
  {
    id: "sandstone",
    name: "Sandstone Desert",
    light: "#fef3c7",
    dark: "#a16207",
    swatch: "from-[#fef3c7] to-[#a16207]",
  },
];

export type PieceSetId = "classic" | "cburnett" | "realistic" | "tournament" | "marble" | "neon";

export interface PieceSet {
  id: PieceSetId;
  name: string;
  description: string;
}

/**
 * The piece sets offered.
 */
export const PIECE_SETS: PieceSet[] = [
  { id: "classic", name: "Classic Staunton", description: "The original amber & stone Staunton pieces." },
  { id: "realistic", name: "Realistic 3D", description: "Shaded, lifelike pieces with gradients & depth." },
  { id: "tournament", name: "Tournament", description: "Bold, chunky tournament-style silhouettes." },
  { id: "marble", name: "Marble Lux", description: "Polished marble with veined texture & gold accents." },
  { id: "neon", name: "Neon Glow", description: "Modern glowing pieces with luminous edges." },
  { id: "cburnett", name: "CBurnett", description: "The classic Wikipedia-style set. Clean and readable." },
];

/**
 * Common opening names keyed by the first few SAN moves (joined by space).
 * Used to label games in the UI and to give the coach a hint.
 *
 * This is intentionally a small subset — the coach LLM is the authoritative
 * source for opening identification; this just powers the in-game label.
 */
const OPENING_TABLE: Record<string, string> = {
  "e4 e5 Nf3 Nc6 Bc4": "Italian Game",
  "e4 e5 Nf3 Nc6 Bc4 Bc5": "Italian Game · Giuoco Piano",
  "e4 e5 Nf3 Nc6 Bc4 Nf6": "Italian Game · Two Knights Defense",
  "e4 e5 Nf3 Nc6 Bb5": "Ruy Lopez",
  "e4 e5 Nf3 Nc6 Bb5 a6": "Ruy Lopez · Morphy Defense",
  "e4 e5 Nf3 Nc6 d4": "Scotch Game",
  "e4 e5 Nf3 Nc6 Nc3": "Three Knights Opening",
  "e4 e5 Nf3 Nc6 Nc3 Nf6": "Four Knights Game",
  "e4 e5 Nf3 Nf6": "Petrov Defense",
  "e4 e5 Nc3": "Vienna Game",
  "e4 e5 f4": "King's Gambit",
  "e4 c5": "Sicilian Defense",
  "e4 c5 Nf3 d6": "Sicilian Defense · Open",
  "e4 c5 Nf3 Nc6": "Sicilian Defense · Open",
  "e4 c5 Nf3 e6": "Sicilian Defense · Taimanov",
  "e4 e6": "French Defense",
  "e4 c6": "Caro-Kann Defense",
  "e4 d5": "Scandinavian Defense",
  "e4 d6": "Pirc Defense",
  "e4 g6": "Modern Defense",
  "e4 Nf6": "Alekhine Defense",
  "d4 d5 c4": "Queen's Gambit",
  "d4 d5 c4 e6": "Queen's Gambit Declined",
  "d4 d5 c4 dxc4": "Queen's Gambit Accepted",
  "d4 d5 c4 c6": "Slav Defense",
  "d4 Nf6 c4 e6 Nc3 Bb4": "Nimzo-Indian Defense",
  "d4 Nf6 c4 e6 Nf3 b6": "Queen's Indian Defense",
  "d4 Nf6 c4 g6": "Grunfeld Defense",
  "d4 Nf6 c4 g6 Nc3 Bg7": "King's Indian Defense",
  "d4 f5": "Dutch Defense",
  "d4 e6": "Queen's Pawn Game",
  "c4": "English Opening",
  "c4 e5": "English Opening · Reversed Sicilian",
  "Nf3": "Réti Opening",
  "Nf3 d5": "Réti Opening",
  "g3": "Hungarian Opening",
  "b3": "Larsen's Opening",
  "f4": "Bird's Opening",
  "b4": "Polish (Sokolsky) Opening",
  "e4 e5 Qh5": "Scholar's Mate attempt",
  "e4 e5 Bc4": "Bishop's Opening",
};

/**
 * Detect the opening name from a list of SAN moves.
 * Returns `null` if no match is found in the first ~6 plies.
 */
export function detectOpening(sanMoves: string[]): string | null {
  // Try progressively longer prefixes (up to 6 plies = 3 full moves each side).
  for (let len = Math.min(8, sanMoves.length); len >= 2; len--) {
    const key = sanMoves.slice(0, len).join(" ");
    if (OPENING_TABLE[key]) return OPENING_TABLE[key];
  }
  return null;
}

/**
 * Time-control presets. `initialMs` is the starting clock; `incrementMs`
 * is added after each move (Fischer increment). 0 = no time control.
 */
export interface TimeControl {
  id: string;
  label: string;
  shortLabel: string;
  initialMs: number;
  incrementMs: number;
  description: string;
}

export const TIME_CONTROLS: TimeControl[] = [
  {
    id: "unlimited",
    label: "Unlimited",
    shortLabel: "∞",
    initialMs: 0,
    incrementMs: 0,
    description: "No clock. Take your time and think.",
  },
  {
    id: "bullet1",
    label: "Bullet · 1+0",
    shortLabel: "1+0",
    initialMs: 60_000,
    incrementMs: 0,
    description: "1 minute, no increment. Pure instinct.",
  },
  {
    id: "bullet2",
    label: "Bullet · 2+1",
    shortLabel: "2+1",
    initialMs: 120_000,
    incrementMs: 1_000,
    description: "2 minutes + 1s increment. Fast and sharp.",
  },
  {
    id: "blitz3",
    label: "Blitz · 3+0",
    shortLabel: "3+0",
    initialMs: 180_000,
    incrementMs: 0,
    description: "3 minutes, no increment. Classic blitz.",
  },
  {
    id: "blitz5",
    label: "Blitz · 5+0",
    shortLabel: "5+0",
    initialMs: 300_000,
    incrementMs: 0,
    description: "5 minutes, no increment. The standard blitz format.",
  },
  {
    id: "rapid10",
    label: "Rapid · 10+0",
    shortLabel: "10+0",
    initialMs: 600_000,
    incrementMs: 0,
    description: "10 minutes per side. Time to think a little.",
  },
  {
    id: "rapid15",
    label: "Rapid · 15+10",
    shortLabel: "15+10",
    initialMs: 900_000,
    incrementMs: 10_000,
    description: "15 minutes + 10s increment. Considered play.",
  },
  {
    id: "classical30",
    label: "Classical · 30+0",
    shortLabel: "30+0",
    initialMs: 1_800_000,
    incrementMs: 0,
    description: "30 minutes per side. Tournament-style.",
  },
];

/** Standard piece values for material-difference calculations. */
export const PIECE_VALUES: Record<string, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
};

/** Unicode chess glyphs for captured-piece displays. */
export const PIECE_GLYPHS: Record<"w" | "b", Record<string, string>> = {
  w: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
  b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" },
};

/** Format milliseconds as M:SS (or H:MM:SS for >1h). */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${r.toString().padStart(2, "0")}`;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

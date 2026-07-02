/**
 * chessPieces.tsx — chess piece renderers for multiple visual styles.
 *
 * Contains:
 *  - The original Grandmaster's Arena SVG pieces (amber/stone Staunton)
 *  - A realistic 3D-style set with gradients and shading
 *
 * Exposes `buildPieces(setId)` which returns a react-chessboard v5
 * `PieceRenderObject` (a map of wK/bQ/... → render functions).
 */
import type { PieceRenderObject } from "react-chessboard";
import type { PieceSetId } from "./chessThemes";

/**
 * The original piece SVG path generators. Each returns a string of SVG path
 * elements for one piece, parameterized by (fill, stroke, isDark, detailFill).
 *
 * CARBON COPY of the original — same paths, same stroke widths, same details.
 */
const PIECE_SVG_PATHS: Record<
  string,
  (fill: string, stroke: string, isDark: boolean, detailFill: string) => string
> = {
  p: (fill, stroke, _dark, detailFill) => `
    <path d="M 22,82 L 78,82 L 74,75 L 26,75 Z" fill="${fill}" stroke="${stroke}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M 30,75 C 38,62 38,50 43,45 C 43,45 35,45 35,38 C 35,30 43,26 50,26 C 57,26 65,30 65,38 C 65,45 57,45 57,45 C 62,50 62,62 70,75 Z" fill="${fill}" stroke="${stroke}" stroke-width="3.5" stroke-linejoin="round"/>
    <circle cx="50" cy="22" r="13" fill="${fill}" stroke="${stroke}" stroke-width="3.5"/>
    <path d="M 43,20 C 45,17 48,15 52,16 C 47,18 45,21 44,25" fill="none" stroke="${detailFill}" stroke-width="2.5" stroke-linecap="round"/>
  `,
  r: (fill, stroke, _dark, detailFill) => `
    <path d="M 22,82 L 78,82 L 75,72 L 25,72 Z" fill="${fill}" stroke="${stroke}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M 28,72 L 72,72 L 66,38 L 34,38 Z" fill="${fill}" stroke="${stroke}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M 30,38 L 70,38 L 72,20 L 62,20 L 62,26 L 56,26 L 56,20 L 44,20 L 44,26 L 38,26 L 38,20 L 28,20 Z" fill="${fill}" stroke="${stroke}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M 26,72 L 74,72 M 31,38 L 69,38" fill="none" stroke="${detailFill}" stroke-width="3" stroke-linecap="round"/>
    <path d="M 32,32 L 34,22 M 32,45 L 36,68" fill="none" stroke="${detailFill}" stroke-width="1.5" stroke-linecap="round"/>
  `,
  n: (fill, stroke, dark, detailFill) => `
    <path d="M 22,82 L 78,82 L 74,74 L 26,74 Z" fill="${fill}" stroke="${stroke}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M 26,74 C 26,74 24,54 30,42 C 34,34 40,30 40,24 C 40,16 32,15 32,15 C 32,15 44,14 54,20 C 60,24 64,30 64,38 C 64,48 60,54 68,58 C 74,62 76,74 76,74 Z" fill="${fill}" stroke="${stroke}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M 54,20 C 58,21 68,23 72,32 C 74,36 71,40 66,40 C 62,40 55,36 52,32 Z" fill="${fill}" stroke="${stroke}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M 31,65 C 29,54 31,45 35,38 M 38,28 C 44,26 48,27 50,30" fill="none" stroke="${detailFill}" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="58" cy="28" r="3.5" fill="${dark ? "#1e293b" : "#f8fafc"}"/>
  `,
  b: (fill, stroke, _dark, detailFill) => `
    <path d="M 22,82 L 78,82 L 74,75 L 26,75 Z" fill="${fill}" stroke="${stroke}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M 28,75 C 36,68 38,62 38,54 C 38,48 35,46 35,42 C 35,38 42,38 50,38 C 58,38 65,38 65,42 C 65,46 62,48 62,54 C 62,62 64,68 72,75 Z" fill="${fill}" stroke="${stroke}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M 36,42 C 36,24 45,16 50,16 C 55,16 64,24 64,42 Z" fill="${fill}" stroke="${stroke}" stroke-width="3.5" stroke-linejoin="round"/>
    <circle cx="50" cy="11" r="4.5" fill="${fill}" stroke="${stroke}" stroke-width="2.5"/>
    <path d="M 45,26 L 55,32" fill="none" stroke="${detailFill}" stroke-width="3.5" stroke-linecap="round"/>
    <path d="M 40,42 C 40,30 46,24 48,20" fill="none" stroke="${detailFill}" stroke-width="2" stroke-linecap="round"/>
  `,
  q: (fill, stroke, _dark, detailFill) => `
    <path d="M 20,82 L 80,82 L 76,74 L 24,74 Z" fill="${fill}" stroke="${stroke}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M 26,74 C 34,64 36,54 34,44 C 34,44 26,38 24,32 C 22,26 32,30 38,34 C 44,22 50,20 50,20 C 50,20 56,22 62,34 C 68,30 78,26 76,32 C 74,38 66,44 66,44 C 64,54 66,64 74,74 Z" fill="${fill}" stroke="${stroke}" stroke-width="3.5" stroke-linejoin="round"/>
    <circle cx="24" cy="27" r="4" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
    <circle cx="38" cy="29" r="4" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
    <circle cx="50" cy="16" r="4.5" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
    <circle cx="62" cy="29" r="4" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
    <circle cx="76" cy="27" r="4" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
    <path d="M 32,70 C 44,72 56,72 68,70" fill="none" stroke="${detailFill}" stroke-width="3" stroke-linecap="round"/>
  `,
  k: (fill, stroke, _dark, detailFill) => `
    <path d="M 20,82 L 80,82 L 76,74 L 24,74 Z" fill="${fill}" stroke="${stroke}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M 26,74 C 34,68 36,56 36,46 C 36,46 28,44 28,34 C 28,24 38,28 50,28 C 62,28 72,24 72,34 C 72,44 64,46 64,46 C 64,56 66,68 74,74 Z" fill="${fill}" stroke="${stroke}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M 36,28 C 36,20 42,18 50,22 C 58,18 64,20 64,28" fill="none" stroke="${detailFill}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M 50,11 L 50,23 M 44,15 L 56,15" fill="none" stroke="${detailFill}" stroke-width="4" stroke-linecap="square"/>
    <circle cx="50" cy="10" r="2.5" fill="${fill === "#fffbeb" ? "#d97706" : "#f59e0b"}"/>
    <path d="M 32,70 C 44,72 56,72 68,70" fill="none" stroke="${detailFill}" stroke-width="3" stroke-linecap="round"/>
  `,
};

/**
 * Build the SVG markup for a single piece.
 * CARBON COPY of the original colors:
 *  - white = fill #fffbeb, stroke rgba(120,53,15,0.6), detail rgba(255,255,255,0.8)
 *  - black = fill #292524, stroke #0c0a09, detail rgba(68,64,60,0.5)
 */
function pieceSvg(color: "w" | "b", type: string): string {
  const isWhite = color === "w";
  const fill = isWhite ? "#fffbeb" : "#292524";
  const stroke = isWhite ? "rgba(120, 53, 15, 0.6)" : "#0c0a09";
  const detailFill = isWhite ? "rgba(255, 255, 255, 0.8)" : "rgba(68, 64, 60, 0.5)";
  const pathGen = PIECE_SVG_PATHS[type];
  const pathStr = pathGen ? pathGen(fill, stroke, !isWhite, detailFill) : "";
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%;display:block">${pathStr}</svg>`;
}

/**
 * Build a react-chessboard v5 `PieceRenderObject` using the original SVG
 * pieces. The library calls each render function and expects a JSX element.
 * We render the SVG via `dangerouslySetInnerHTML` since the paths are
 * trusted (hardcoded, not user input).
 */
export function buildOriginalPieces(): PieceRenderObject {
  const pieces: PieceRenderObject = {};
  const colors: ("w" | "b")[] = ["w", "b"];
  const types = ["k", "q", "r", "b", "n", "p"];
  for (const color of colors) {
    for (const type of types) {
      const code = `${color}${type.toUpperCase()}`;
      const svg = pieceSvg(color, type);
      pieces[code] = () => (
        <div
          style={{
            width: "100%",
            height: "100%",
            // Let clicks pass through the piece SVG to the square below,
            // so clicking a piece selects it (via the square's onClick).
            pointerEvents: "none",
          }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      );
    }
  }
  return pieces;
}

// ============================================================
// REALISTIC 3D-STYLE PIECE SET
// Uses SVG gradients + radial highlights to give pieces a shaded,
// lifelike 3D appearance. White = ivory with warm shadow; black =
// obsidian with cool highlight. Each piece has a base ellipse shadow.
// ============================================================

/**
 * Build the SVG for a realistic 3D-style piece.
 * Uses unique gradient IDs per piece-type+color to avoid collisions.
 */
function realisticPieceSvg(color: "w" | "b", type: string): string {
  const isWhite = color === "w";
  const id = `${color}${type}`;

  // Gradient colors
  const baseLight = isWhite ? "#fffbf0" : "#3a3530";
  const baseDark = isWhite ? "#d4c4a8" : "#0a0908";
  const highlight = isWhite ? "#ffffff" : "#5c5450";
  const stroke = isWhite ? "#6b4a1a" : "#000000";

  // Each piece's body paths — richer, more detailed silhouettes.
  const paths: Record<string, string> = {
    p: `
      <ellipse cx="50" cy="86" rx="30" ry="5" fill="rgba(0,0,0,0.25)"/>
      <path d="M 24,84 L 76,84 L 72,76 L 28,76 Z" fill="url(#base-${id})" stroke="${stroke}" stroke-width="2"/>
      <path d="M 30,76 C 36,66 38,56 42,50 C 38,48 34,44 34,38 C 34,30 41,25 50,25 C 59,25 66,30 66,38 C 66,44 62,48 58,50 C 62,56 64,66 70,76 Z" fill="url(#body-${id})" stroke="${stroke}" stroke-width="2"/>
      <circle cx="50" cy="22" r="13" fill="url(#head-${id})" stroke="${stroke}" stroke-width="2"/>
      <ellipse cx="45" cy="18" rx="5" ry="3.5" fill="${highlight}" opacity="0.6"/>
    `,
    r: `
      <ellipse cx="50" cy="86" rx="30" ry="5" fill="rgba(0,0,0,0.25)"/>
      <path d="M 24,84 L 76,84 L 73,74 L 27,74 Z" fill="url(#base-${id})" stroke="${stroke}" stroke-width="2"/>
      <path d="M 28,74 L 72,74 L 66,40 L 34,40 Z" fill="url(#body-${id})" stroke="${stroke}" stroke-width="2"/>
      <path d="M 30,40 L 70,40 L 72,22 L 62,22 L 62,28 L 56,28 L 56,22 L 44,22 L 44,28 L 38,28 L 38,22 L 28,22 Z" fill="url(#body-${id})" stroke="${stroke}" stroke-width="2"/>
      <path d="M 33,34 L 67,34" stroke="${highlight}" stroke-width="1.5" opacity="0.4"/>
    `,
    n: `
      <ellipse cx="50" cy="86" rx="30" ry="5" fill="rgba(0,0,0,0.25)"/>
      <path d="M 24,84 L 76,84 L 73,76 L 27,76 Z" fill="url(#base-${id})" stroke="${stroke}" stroke-width="2"/>
      <path d="M 27,76 C 27,76 25,54 31,42 C 35,34 41,30 41,24 C 41,16 33,15 33,15 C 33,15 45,14 55,20 C 61,24 65,30 65,38 C 65,48 61,54 69,58 C 75,62 77,76 77,76 Z" fill="url(#body-${id})" stroke="${stroke}" stroke-width="2"/>
      <path d="M 55,20 C 59,21 69,23 73,32 C 75,36 72,40 67,40 C 63,40 56,36 53,32 Z" fill="url(#body-${id})" stroke="${stroke}" stroke-width="2"/>
      <path d="M 48,25 C 52,24 56,26 58,30" stroke="${highlight}" stroke-width="1.5" opacity="0.5" fill="none"/>
      <circle cx="58" cy="28" r="3" fill="${isWhite ? "#1e293b" : "#f8fafc"}"/>
    `,
    b: `
      <ellipse cx="50" cy="86" rx="30" ry="5" fill="rgba(0,0,0,0.25)"/>
      <path d="M 24,84 L 76,84 L 73,76 L 27,76 Z" fill="url(#base-${id})" stroke="${stroke}" stroke-width="2"/>
      <path d="M 28,76 C 36,68 38,62 38,54 C 38,48 35,46 35,42 C 35,38 42,38 50,38 C 58,38 65,38 65,42 C 65,46 62,48 62,54 C 62,62 64,68 72,76 Z" fill="url(#body-${id})" stroke="${stroke}" stroke-width="2"/>
      <path d="M 36,42 C 36,24 45,16 50,16 C 55,16 64,24 64,42 Z" fill="url(#body-${id})" stroke="${stroke}" stroke-width="2"/>
      <circle cx="50" cy="11" r="4.5" fill="url(#head-${id})" stroke="${stroke}" stroke-width="2"/>
      <path d="M 42,30 Q 50,26 58,30" stroke="${highlight}" stroke-width="2" opacity="0.4" fill="none"/>
      <ellipse cx="46" cy="24" rx="4" ry="6" fill="${highlight}" opacity="0.3"/>
    `,
    q: `
      <ellipse cx="50" cy="86" rx="32" ry="5.5" fill="rgba(0,0,0,0.25)"/>
      <path d="M 22,84 L 78,84 L 75,74 L 25,74 Z" fill="url(#base-${id})" stroke="${stroke}" stroke-width="2"/>
      <path d="M 26,74 C 34,64 36,54 34,44 C 34,44 26,38 24,32 C 22,26 32,30 38,34 C 44,22 50,20 50,20 C 50,20 56,22 62,34 C 68,30 78,26 76,32 C 74,38 66,44 66,44 C 64,54 66,64 74,74 Z" fill="url(#body-${id})" stroke="${stroke}" stroke-width="2"/>
      <circle cx="24" cy="27" r="4" fill="url(#head-${id})" stroke="${stroke}" stroke-width="1.5"/>
      <circle cx="38" cy="29" r="4" fill="url(#head-${id})" stroke="${stroke}" stroke-width="1.5"/>
      <circle cx="50" cy="16" r="4.5" fill="url(#head-${id})" stroke="${stroke}" stroke-width="1.5"/>
      <circle cx="62" cy="29" r="4" fill="url(#head-${id})" stroke="${stroke}" stroke-width="1.5"/>
      <circle cx="76" cy="27" r="4" fill="url(#head-${id})" stroke="${stroke}" stroke-width="1.5"/>
      <path d="M 32,66 Q 50,70 68,66" stroke="${highlight}" stroke-width="2" opacity="0.35" fill="none"/>
    `,
    k: `
      <ellipse cx="50" cy="86" rx="32" ry="5.5" fill="rgba(0,0,0,0.25)"/>
      <path d="M 22,84 L 78,84 L 75,74 L 25,74 Z" fill="url(#base-${id})" stroke="${stroke}" stroke-width="2"/>
      <path d="M 26,74 C 34,68 36,56 36,46 C 36,46 28,44 28,34 C 28,24 38,28 50,28 C 62,28 72,24 72,34 C 72,44 64,46 64,46 C 64,56 66,68 74,74 Z" fill="url(#body-${id})" stroke="${stroke}" stroke-width="2"/>
      <path d="M 36,28 C 36,20 42,18 50,22 C 58,18 64,20 64,28" stroke="${stroke}" stroke-width="2" fill="none"/>
      <path d="M 50,8 L 50,24 M 43,14 L 57,14" stroke="${stroke}" stroke-width="3.5" stroke-linecap="round" fill="none"/>
      <circle cx="50" cy="8" r="3" fill="${isWhite ? "#d97706" : "#f59e0b"}"/>
      <path d="M 32,66 Q 50,70 68,66" stroke="${highlight}" stroke-width="2" opacity="0.35" fill="none"/>
    `,
  };

  const bodyPath = paths[type] || paths.p;

  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%;display:block">
    <defs>
      <linearGradient id="base-${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${baseLight}"/>
        <stop offset="100%" stop-color="${baseDark}"/>
      </linearGradient>
      <linearGradient id="body-${id}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${baseLight}"/>
        <stop offset="50%" stop-color="${isWhite ? "#ede0c8" : "#2a2520"}"/>
        <stop offset="100%" stop-color="${baseDark}"/>
      </linearGradient>
      <radialGradient id="head-${id}" cx="0.35" cy="0.3" r="0.8">
        <stop offset="0%" stop-color="${highlight}"/>
        <stop offset="60%" stop-color="${baseLight}"/>
        <stop offset="100%" stop-color="${baseDark}"/>
      </radialGradient>
    </defs>
    ${bodyPath}
  </svg>`;
}

/**
 * Build a realistic 3D-style piece set for react-chessboard.
 */
function buildRealisticPieces(): PieceRenderObject {
  const pieces: PieceRenderObject = {};
  const colors: ("w" | "b")[] = ["w", "b"];
  const types = ["k", "q", "r", "b", "n", "p"];
  for (const color of colors) {
    for (const type of types) {
      const code = `${color}${type.toUpperCase()}`;
      const svg = realisticPieceSvg(color, type);
      pieces[code] = () => (
        <div
          style={{
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            filter: "drop-shadow(0 4px 6px rgba(0,0,0,0.35))",
          }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      );
    }
  }
  return pieces;
}

// ============================================================
// TOURNAMENT PIECE SET — bold, chunky silhouettes with thick
// outlines. Minimalist but highly readable. White = high-contrast
// ivory, black = deep charcoal. Designed for tournament clarity.
// ============================================================

function tournamentPieceSvg(color: "w" | "b", type: string): string {
  const isWhite = color === "w";
  const fill = isWhite ? "#f5f5f4" : "#1c1917";
  const stroke = isWhite ? "#292524" : "#000000";
  const sw = "3"; // thick bold outlines

  const paths: Record<string, string> = {
    p: `
      <path d="M 28,82 L 72,82 L 68,74 L 32,74 Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>
      <path d="M 34,74 C 36,64 38,56 42,50 C 38,48 35,44 35,38 C 35,30 42,26 50,26 C 58,26 65,30 65,38 C 65,44 62,48 58,50 C 62,56 64,64 66,74 Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>
      <circle cx="50" cy="24" r="11" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>
    `,
    r: `
      <path d="M 26,82 L 74,82 L 71,72 L 29,72 Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>
      <path d="M 30,72 L 70,72 L 65,40 L 35,40 Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>
      <path d="M 33,40 L 67,40 L 69,22 L 61,22 L 61,28 L 56,28 L 56,22 L 44,22 L 44,28 L 39,28 L 39,22 L 31,22 Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>
    `,
    n: `
      <path d="M 26,82 L 74,82 L 71,73 L 29,73 Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>
      <path d="M 29,73 C 29,73 27,53 33,41 C 37,33 42,29 42,23 C 42,15 34,14 34,14 C 34,14 45,12 55,19 C 61,23 65,29 65,38 C 65,48 61,54 69,58 C 75,62 76,73 76,73 Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>
      <path d="M 55,19 C 59,20 69,22 73,31 C 75,35 72,39 67,39 C 63,39 56,35 53,31 Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>
      <circle cx="58" cy="27" r="2.5" fill="${isWhite ? "#1c1917" : "#f5f5f4"}"/>
    `,
    b: `
      <path d="M 26,82 L 74,82 L 71,74 L 29,74 Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>
      <path d="M 33,74 C 37,66 39,60 39,53 C 39,47 36,45 36,41 C 36,37 43,37 50,37 C 57,37 64,37 64,41 C 64,45 61,47 61,53 C 61,60 63,66 67,74 Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>
      <path d="M 37,41 C 37,23 45,15 50,15 C 55,15 63,23 63,41 Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>
      <circle cx="50" cy="10" r="4" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>
    `,
    q: `
      <path d="M 24,82 L 76,82 L 73,72 L 27,72 Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>
      <path d="M 28,72 C 35,62 37,52 35,42 C 35,42 27,36 25,30 C 23,24 33,28 39,32 C 45,20 50,18 50,18 C 50,18 55,20 61,32 C 67,28 77,24 75,30 C 73,36 65,42 65,42 C 63,52 65,62 72,72 Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>
      <circle cx="25" cy="26" r="3.5" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
      <circle cx="39" cy="28" r="3.5" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
      <circle cx="50" cy="15" r="4" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
      <circle cx="61" cy="28" r="3.5" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
      <circle cx="75" cy="26" r="3.5" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
    `,
    k: `
      <path d="M 24,82 L 76,82 L 73,72 L 27,72 Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>
      <path d="M 28,72 C 35,66 37,54 37,44 C 37,44 29,42 29,32 C 29,22 39,26 50,26 C 61,26 71,22 71,32 C 71,42 63,44 63,44 C 63,54 65,66 72,72 Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>
      <path d="M 50,7 L 50,23 M 43,14 L 57,14" stroke="${stroke}" stroke-width="3.5" stroke-linecap="round" fill="none"/>
      <circle cx="50" cy="7" r="2.5" fill="${isWhite ? "#d97706" : "#f59e0b"}"/>
    `,
  };

  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%;display:block">${paths[type] || paths.p}</svg>`;
}

function buildTournamentPieces(): PieceRenderObject {
  const pieces: PieceRenderObject = {};
  for (const color of ["w", "b"] as const) {
    for (const type of ["k", "q", "r", "b", "n", "p"]) {
      const code = `${color}${type.toUpperCase()}`;
      const svg = tournamentPieceSvg(color, type);
      pieces[code] = () => (
        <div style={{ width: "100%", height: "100%", pointerEvents: "none" }} dangerouslySetInnerHTML={{ __html: svg }} />
      );
    }
  }
  return pieces;
}

// ============================================================
// MARBLE LUX PIECE SET — polished marble with veined texture
// and gold accents. White = white marble with gray veins; black =
// black marble with gold veins. Luxury aesthetic.
// ============================================================

function marblePieceSvg(color: "w" | "b", type: string): string {
  const isWhite = color === "w";
  const id = `marble-${color}${type}`;
  const baseLight = isWhite ? "#ffffff" : "#3a3a3a";
  const baseDark = isWhite ? "#d1d5db" : "#0a0a0a";
  const veinColor = isWhite ? "#9ca3af" : "#d4af37"; // gray veins for white, gold for black
  const stroke = isWhite ? "#6b7280" : "#d4af37";
  const goldAccent = "#d4af37";

  const paths: Record<string, string> = {
    p: `
      <ellipse cx="50" cy="88" rx="30" ry="4" fill="rgba(0,0,0,0.2)"/>
      <path d="M 24,84 L 76,84 L 72,76 L 28,76 Z" fill="url(#${id})" stroke="${stroke}" stroke-width="1.5"/>
      <path d="M 30,76 C 36,66 38,56 42,50 C 38,48 34,44 34,38 C 34,30 41,25 50,25 C 59,25 66,30 66,38 C 66,44 62,48 58,50 C 62,56 64,66 70,76 Z" fill="url(#${id})" stroke="${stroke}" stroke-width="1.5"/>
      <circle cx="50" cy="22" r="13" fill="url(#${id})" stroke="${stroke}" stroke-width="1.5"/>
      <path d="M 38,35 Q 45,28 52,33 Q 58,38 65,34" stroke="${veinColor}" stroke-width="0.8" fill="none" opacity="0.6"/>
      <path d="M 42,20 Q 48,16 54,22" stroke="${veinColor}" stroke-width="0.6" fill="none" opacity="0.5"/>
    `,
    r: `
      <ellipse cx="50" cy="88" rx="30" ry="4" fill="rgba(0,0,0,0.2)"/>
      <path d="M 24,84 L 76,84 L 73,74 L 27,74 Z" fill="url(#${id})" stroke="${stroke}" stroke-width="1.5"/>
      <path d="M 28,74 L 72,74 L 66,40 L 34,40 Z" fill="url(#${id})" stroke="${stroke}" stroke-width="1.5"/>
      <path d="M 30,40 L 70,40 L 72,22 L 62,22 L 62,28 L 56,28 L 56,22 L 44,22 L 44,28 L 38,28 L 38,22 L 28,22 Z" fill="url(#${id})" stroke="${stroke}" stroke-width="1.5"/>
      <path d="M 35,32 Q 50,28 65,32" stroke="${veinColor}" stroke-width="0.7" fill="none" opacity="0.5"/>
      <path d="M 38,55 Q 50,52 62,55" stroke="${veinColor}" stroke-width="0.6" fill="none" opacity="0.4"/>
    `,
    n: `
      <ellipse cx="50" cy="88" rx="30" ry="4" fill="rgba(0,0,0,0.2)"/>
      <path d="M 24,84 L 76,84 L 73,76 L 27,76 Z" fill="url(#${id})" stroke="${stroke}" stroke-width="1.5"/>
      <path d="M 27,76 C 27,76 25,54 31,42 C 35,34 40,30 40,24 C 40,16 32,15 32,15 C 32,15 44,14 54,20 C 60,24 64,30 64,38 C 64,48 60,54 68,58 C 74,62 76,76 76,76 Z" fill="url(#${id})" stroke="${stroke}" stroke-width="1.5"/>
      <path d="M 54,20 C 58,21 68,23 72,32 C 74,36 71,40 66,40 C 62,40 55,36 52,32 Z" fill="url(#${id})" stroke="${stroke}" stroke-width="1.5"/>
      <path d="M 35,30 Q 45,25 55,30 Q 65,35 70,30" stroke="${veinColor}" stroke-width="0.7" fill="none" opacity="0.5"/>
      <circle cx="58" cy="28" r="2.5" fill="${isWhite ? "#1c1917" : "#f5f5f4"}"/>
    `,
    b: `
      <ellipse cx="50" cy="88" rx="30" ry="4" fill="rgba(0,0,0,0.2)"/>
      <path d="M 24,84 L 76,84 L 73,76 L 27,76 Z" fill="url(#${id})" stroke="${stroke}" stroke-width="1.5"/>
      <path d="M 28,76 C 36,68 38,62 38,54 C 38,48 35,46 35,42 C 35,38 42,38 50,38 C 58,38 65,38 65,42 C 65,46 62,48 62,54 C 62,62 64,68 72,76 Z" fill="url(#${id})" stroke="${stroke}" stroke-width="1.5"/>
      <path d="M 36,42 C 36,24 45,16 50,16 C 55,16 64,24 64,42 Z" fill="url(#${id})" stroke="${stroke}" stroke-width="1.5"/>
      <circle cx="50" cy="11" r="4" fill="url(#${id})" stroke="${goldAccent}" stroke-width="1.5"/>
      <path d="M 40,28 Q 50,24 60,28" stroke="${veinColor}" stroke-width="0.7" fill="none" opacity="0.5"/>
    `,
    q: `
      <ellipse cx="50" cy="88" rx="32" ry="5" fill="rgba(0,0,0,0.2)"/>
      <path d="M 22,84 L 78,84 L 75,74 L 25,74 Z" fill="url(#${id})" stroke="${stroke}" stroke-width="1.5"/>
      <path d="M 26,74 C 34,64 36,54 34,44 C 34,44 26,38 24,32 C 22,26 32,30 38,34 C 44,22 50,20 50,20 C 50,20 56,22 62,34 C 68,30 78,26 76,32 C 74,38 66,44 66,44 C 64,54 66,64 74,74 Z" fill="url(#${id})" stroke="${stroke}" stroke-width="1.5"/>
      <circle cx="24" cy="27" r="3.5" fill="url(#${id})" stroke="${goldAccent}" stroke-width="1"/>
      <circle cx="38" cy="29" r="3.5" fill="url(#${id})" stroke="${goldAccent}" stroke-width="1"/>
      <circle cx="50" cy="16" r="4" fill="url(#${id})" stroke="${goldAccent}" stroke-width="1"/>
      <circle cx="62" cy="29" r="3.5" fill="url(#${id})" stroke="${goldAccent}" stroke-width="1"/>
      <circle cx="76" cy="27" r="3.5" fill="url(#${id})" stroke="${goldAccent}" stroke-width="1"/>
      <path d="M 32,60 Q 50,56 68,60" stroke="${veinColor}" stroke-width="0.7" fill="none" opacity="0.4"/>
    `,
    k: `
      <ellipse cx="50" cy="88" rx="32" ry="5" fill="rgba(0,0,0,0.2)"/>
      <path d="M 22,84 L 78,84 L 75,74 L 25,74 Z" fill="url(#${id})" stroke="${stroke}" stroke-width="1.5"/>
      <path d="M 26,74 C 34,68 36,56 36,46 C 36,46 28,44 28,34 C 28,24 38,28 50,28 C 62,28 72,24 72,34 C 72,44 64,46 64,46 C 64,56 66,68 74,74 Z" fill="url(#${id})" stroke="${stroke}" stroke-width="1.5"/>
      <path d="M 50,8 L 50,24 M 43,14 L 57,14" stroke="${goldAccent}" stroke-width="3" stroke-linecap="round" fill="none"/>
      <circle cx="50" cy="8" r="2.5" fill="${goldAccent}"/>
      <path d="M 32,60 Q 50,56 68,60" stroke="${veinColor}" stroke-width="0.7" fill="none" opacity="0.4"/>
    `,
  };

  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%;display:block">
    <defs>
      <linearGradient id="${id}" x1="0.2" y1="0" x2="0.8" y2="1">
        <stop offset="0%" stop-color="${baseLight}"/>
        <stop offset="50%" stop-color="${isWhite ? "#f3f4f6" : "#1a1a1a"}"/>
        <stop offset="100%" stop-color="${baseDark}"/>
      </linearGradient>
    </defs>
    ${paths[type] || paths.p}
  </svg>`;
}

function buildMarblePieces(): PieceRenderObject {
  const pieces: PieceRenderObject = {};
  for (const color of ["w", "b"] as const) {
    for (const type of ["k", "q", "r", "b", "n", "p"]) {
      const code = `${color}${type.toUpperCase()}`;
      const svg = marblePieceSvg(color, type);
      pieces[code] = () => (
        <div style={{ width: "100%", height: "100%", pointerEvents: "none", filter: "drop-shadow(0 3px 5px rgba(0,0,0,0.3))" }} dangerouslySetInnerHTML={{ __html: svg }} />
      );
    }
  }
  return pieces;
}

// ============================================================
// NEON GLOW PIECE SET — modern, luminous pieces with glowing
// edges. White = cyan glow; black = magenta glow. Futuristic.
// ============================================================

function neonPieceSvg(color: "w" | "b", type: string): string {
  const isWhite = color === "w";
  const id = `neon-${color}${type}`;
  const fill = isWhite ? "#0a0a0a" : "#0a0a0a";
  const glow = isWhite ? "#22d3ee" : "#e879f9"; // cyan for white, magenta for black
  const innerGlow = isWhite ? "#67e8f9" : "#f0abfc";

  const paths: Record<string, string> = {
    p: `
      <path d="M 28,82 L 72,82 L 68,74 L 32,74 Z" fill="${fill}" stroke="${glow}" stroke-width="2" stroke-linejoin="round" filter="url(#glow-${id})"/>
      <path d="M 34,74 C 36,64 38,56 42,50 C 38,48 35,44 35,38 C 35,30 42,26 50,26 C 58,26 65,30 65,38 C 65,44 62,48 58,50 C 62,56 64,64 66,74 Z" fill="${fill}" stroke="${glow}" stroke-width="2" stroke-linejoin="round" filter="url(#glow-${id})"/>
      <circle cx="50" cy="24" r="11" fill="${fill}" stroke="${innerGlow}" stroke-width="2" filter="url(#glow-${id})"/>
    `,
    r: `
      <path d="M 26,82 L 74,82 L 71,72 L 29,72 Z" fill="${fill}" stroke="${glow}" stroke-width="2" stroke-linejoin="round" filter="url(#glow-${id})"/>
      <path d="M 30,72 L 70,72 L 65,40 L 35,40 Z" fill="${fill}" stroke="${glow}" stroke-width="2" stroke-linejoin="round" filter="url(#glow-${id})"/>
      <path d="M 33,40 L 67,40 L 69,22 L 61,22 L 61,28 L 56,28 L 56,22 L 44,22 L 44,28 L 39,28 L 39,22 L 31,22 Z" fill="${fill}" stroke="${glow}" stroke-width="2" stroke-linejoin="round" filter="url(#glow-${id})"/>
    `,
    n: `
      <path d="M 26,82 L 74,82 L 71,73 L 29,73 Z" fill="${fill}" stroke="${glow}" stroke-width="2" stroke-linejoin="round" filter="url(#glow-${id})"/>
      <path d="M 29,73 C 29,73 27,53 33,41 C 37,33 42,29 42,23 C 42,15 34,14 34,14 C 34,14 45,12 55,19 C 61,23 65,29 65,38 C 65,48 61,54 69,58 C 75,62 76,73 76,73 Z" fill="${fill}" stroke="${glow}" stroke-width="2" stroke-linejoin="round" filter="url(#glow-${id})"/>
      <path d="M 55,19 C 59,20 69,22 73,31 C 75,35 72,39 67,39 C 63,39 56,35 53,31 Z" fill="${fill}" stroke="${glow}" stroke-width="2" stroke-linejoin="round" filter="url(#glow-${id})"/>
      <circle cx="58" cy="27" r="2" fill="${innerGlow}" filter="url(#glow-${id})"/>
    `,
    b: `
      <path d="M 26,82 L 74,82 L 71,74 L 29,74 Z" fill="${fill}" stroke="${glow}" stroke-width="2" stroke-linejoin="round" filter="url(#glow-${id})"/>
      <path d="M 33,74 C 37,66 39,60 39,53 C 39,47 36,45 36,41 C 36,37 43,37 50,37 C 57,37 64,37 64,41 C 64,45 61,47 61,53 C 61,60 63,66 67,74 Z" fill="${fill}" stroke="${glow}" stroke-width="2" stroke-linejoin="round" filter="url(#glow-${id})"/>
      <path d="M 37,41 C 37,23 45,15 50,15 C 55,15 63,23 63,41 Z" fill="${fill}" stroke="${glow}" stroke-width="2" stroke-linejoin="round" filter="url(#glow-${id})"/>
      <circle cx="50" cy="10" r="3.5" fill="${fill}" stroke="${innerGlow}" stroke-width="2" filter="url(#glow-${id})"/>
    `,
    q: `
      <path d="M 24,82 L 76,82 L 73,72 L 27,72 Z" fill="${fill}" stroke="${glow}" stroke-width="2" stroke-linejoin="round" filter="url(#glow-${id})"/>
      <path d="M 28,72 C 35,62 37,52 35,42 C 35,42 27,36 25,30 C 23,24 33,28 39,32 C 45,20 50,18 50,18 C 50,18 55,20 61,32 C 67,28 77,24 75,30 C 73,36 65,42 65,42 C 63,52 65,62 72,72 Z" fill="${fill}" stroke="${glow}" stroke-width="2" stroke-linejoin="round" filter="url(#glow-${id})"/>
      <circle cx="25" cy="26" r="3" fill="${fill}" stroke="${innerGlow}" stroke-width="1.5" filter="url(#glow-${id})"/>
      <circle cx="39" cy="28" r="3" fill="${fill}" stroke="${innerGlow}" stroke-width="1.5" filter="url(#glow-${id})"/>
      <circle cx="50" cy="15" r="3.5" fill="${fill}" stroke="${innerGlow}" stroke-width="1.5" filter="url(#glow-${id})"/>
      <circle cx="61" cy="28" r="3" fill="${fill}" stroke="${innerGlow}" stroke-width="1.5" filter="url(#glow-${id})"/>
      <circle cx="75" cy="26" r="3" fill="${fill}" stroke="${innerGlow}" stroke-width="1.5" filter="url(#glow-${id})"/>
    `,
    k: `
      <path d="M 24,82 L 76,82 L 73,72 L 27,72 Z" fill="${fill}" stroke="${glow}" stroke-width="2" stroke-linejoin="round" filter="url(#glow-${id})"/>
      <path d="M 28,72 C 35,66 37,54 37,44 C 37,44 29,42 29,32 C 29,22 39,26 50,26 C 61,26 71,22 71,32 C 71,42 63,44 63,44 C 63,54 65,66 72,72 Z" fill="${fill}" stroke="${glow}" stroke-width="2" stroke-linejoin="round" filter="url(#glow-${id})"/>
      <path d="M 50,7 L 50,23 M 43,14 L 57,14" stroke="${innerGlow}" stroke-width="3" stroke-linecap="round" filter="url(#glow-${id})"/>
      <circle cx="50" cy="7" r="2.5" fill="${innerGlow}" filter="url(#glow-${id})"/>
    `,
  };

  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%;display:block">
    <defs>
      <filter id="glow-${id}" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="1.5" result="blur"/>
        <feMerge>
          <feMergeNode in="blur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
    </defs>
    ${paths[type] || paths.p}
  </svg>`;
}

function buildNeonPieces(): PieceRenderObject {
  const pieces: PieceRenderObject = {};
  for (const color of ["w", "b"] as const) {
    for (const type of ["k", "q", "r", "b", "n", "p"]) {
      const code = `${color}${type.toUpperCase()}`;
      const svg = neonPieceSvg(color, type);
      pieces[code] = () => (
        <div style={{ width: "100%", height: "100%", pointerEvents: "none" }} dangerouslySetInnerHTML={{ __html: svg }} />
      );
    }
  }
  return pieces;
}

/**
 * Build the piece set for the given ID.
 * - "classic"     → original amber/stone Staunton SVGs
 * - "realistic"   → shaded 3D-style SVGs with gradients
 * - "tournament"  → bold, chunky tournament silhouettes
 * - "marble"      → polished marble with veined texture & gold accents
 * - "neon"        → modern glowing pieces with luminous edges
 * - "cburnett"    → undefined (use react-chessboard's built-in default pieces)
 */
export function buildPieces(setId: PieceSetId): PieceRenderObject | undefined {
  switch (setId) {
    case "classic":
      return buildOriginalPieces();
    case "realistic":
      return buildRealisticPieces();
    case "tournament":
      return buildTournamentPieces();
    case "marble":
      return buildMarblePieces();
    case "neon":
      return buildNeonPieces();
    default:
      // cburnett → use the library's built-in default pieces
      return undefined;
  }
}

/**
 * chessStore.ts — Zustand store for chess app settings and view state.
 *
 * Persisted settings (board theme, piece set, sound mute, default
 * difficulty, default time control) survive page reloads via
 * localStorage. Ephemeral view state (current view, last completed
 * game id for the analysis screen) is not persisted.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { BoardThemeId, PieceSetId } from "./chessThemes";
import type { Difficulty } from "./chessAI";

export type AppView = "home" | "game" | "gameover" | "stats" | "history" | "online-lobby" | "online-game" | "online-gameover";

export type GameMode = "ai" | "local" | "ai-vs-ai" | "online";

export interface NewGameConfig {
  mode: GameMode;
  difficulty: Difficulty;       // for AI modes
  playerColor: "white" | "black" | "random"; // human's color (for ai mode); ai-vs-ai uses white
  timeControlId: string;        // matches a TIME_CONTROLS entry
  boardTheme: BoardThemeId;
  pieceSet: PieceSetId;
  showCoordinates: boolean;
  showLegalMoves: boolean;
  highlightLastMove: boolean;
  soundEnabled: boolean;
  allowUndo: boolean;           // allow undo in AI mode (disabled in local for fairness)
}

interface ChessStoreState {
  // --- persisted settings ---
  boardTheme: BoardThemeId;
  pieceSet: PieceSetId;
  boardBorder: boolean;
  soundEnabled: boolean;
  showCoordinates: boolean;
  showLegalMoves: boolean;
  highlightLastMove: boolean;
  defaultDifficulty: Difficulty;
  defaultTimeControlId: string;
  defaultMode: GameMode;

  // --- ephemeral view state ---
  view: AppView;
  /** Config for the game currently being set up / played. */
  activeConfig: NewGameConfig | null;
  /** ID of the last completed game (for the analysis screen). */
  lastGameId: string | null;

  // --- actions ---
  setBoardTheme: (t: BoardThemeId) => void;
  setPieceSet: (p: PieceSetId) => void;
  setBoardBorder: (v: boolean) => void;
  toggleSound: () => void;
  setShowCoordinates: (v: boolean) => void;
  setShowLegalMoves: (v: boolean) => void;
  setHighlightLastMove: (v: boolean) => void;
  setDefaultDifficulty: (d: Difficulty) => void;
  setDefaultTimeControlId: (id: string) => void;
  setDefaultMode: (m: GameMode) => void;

  startGame: (config: NewGameConfig) => void;
  goToView: (v: AppView) => void;
  setLastGameId: (id: string | null) => void;
  backToHome: () => void;
}

export const useChessStore = create<ChessStoreState>()(
  persist(
    (set) => ({
      // --- defaults ---
      boardTheme: "classic",
      pieceSet: "classic",
      boardBorder: false,
      soundEnabled: true,
      showCoordinates: false,
      showLegalMoves: true,
      highlightLastMove: true,
      defaultDifficulty: "medium",
      defaultTimeControlId: "unlimited",
      defaultMode: "ai",

      // --- view state ---
      view: "home",
      activeConfig: null,
      lastGameId: null,

      // --- settings actions ---
      setBoardTheme: (t) => set({ boardTheme: t }),
      setPieceSet: (p) => set({ pieceSet: p }),
      setBoardBorder: (v) => set({ boardBorder: v }),
      toggleSound: () => set((s) => ({ soundEnabled: !s.soundEnabled })),
      setShowCoordinates: (v) => set({ showCoordinates: v }),
      setShowLegalMoves: (v) => set({ showLegalMoves: v }),
      setHighlightLastMove: (v) => set({ highlightLastMove: v }),
      setDefaultDifficulty: (d) => set({ defaultDifficulty: d }),
      setDefaultTimeControlId: (id) => set({ defaultTimeControlId: id }),
      setDefaultMode: (m) => set({ defaultMode: m }),

      // --- view actions ---
      startGame: (config) => set({ activeConfig: config, view: "game" }),
      goToView: (v) => set({ view: v }),
      setLastGameId: (id) => set({ lastGameId: id }),
      backToHome: () => set({ view: "home", activeConfig: null }),
    }),
    {
      name: "grandmasters-arena-settings",
      storage: createJSONStorage(() => {
        // Guard against SSR / non-browser environments.
        if (typeof window === "undefined") {
          return {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {},
          };
        }
        return window.localStorage;
      }),
      // Only persist the settings, not the ephemeral view state.
      partialize: (s) => ({
        boardTheme: s.boardTheme,
        pieceSet: s.pieceSet,
        boardBorder: s.boardBorder,
        soundEnabled: s.soundEnabled,
        showCoordinates: s.showCoordinates,
        showLegalMoves: s.showLegalMoves,
        highlightLastMove: s.highlightLastMove,
        defaultDifficulty: s.defaultDifficulty,
        defaultTimeControlId: s.defaultTimeControlId,
        defaultMode: s.defaultMode,
      }),
    },
  ),
);

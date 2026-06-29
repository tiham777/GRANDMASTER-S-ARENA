"use client";

import { create } from "zustand";
import type { UserProfile, Challenge, GameDoc } from "@/lib/types";

export type AppView =
  | "loading"
  | "login"
  | "lobby"
  | "game"        // online multiplayer focus mode
  | "offline";    // original chess-game.html (AI / local 2P)

interface AppState {
  view: AppView;
  profile: UserProfile | null;
  // active game we're playing online
  activeGameId: string | null;
  activeGame: GameDoc | null;
  myColor: "white" | "black" | null;
  // incoming/outgoing challenges
  incoming: Challenge[];
  outgoing: Challenge[];
  // lobby: search + selection
  searchResults: UserProfile[];
  onlinePlayers: UserProfile[];
  // view transitions
  setView: (v: AppView) => void;
  setProfile: (p: UserProfile | null) => void;
  setActiveGame: (gameId: string | null, game: GameDoc | null, color: "white" | "black" | null) => void;
  setIncoming: (c: Challenge[]) => void;
  setOutgoing: (c: Challenge[]) => void;
  setOnlinePlayers: (p: UserProfile[]) => void;
  setSearchResults: (p: UserProfile[]) => void;
}

export const useChessStore = create<AppState>((set) => ({
  view: "loading",
  profile: null,
  activeGameId: null,
  activeGame: null,
  myColor: null,
  incoming: [],
  outgoing: [],
  onlinePlayers: [],
  searchResults: [],
  setView: (v) => set({ view: v }),
  setProfile: (p) => set({ profile: p }),
  setActiveGame: (gameId, game, color) =>
    set({ activeGameId: gameId, activeGame: game, myColor: color }),
  setIncoming: (c) => set({ incoming: c }),
  setOutgoing: (c) => set({ outgoing: c }),
  setOnlinePlayers: (p) => set({ onlinePlayers: p }),
  setSearchResults: (p) => set({ searchResults: p }),
}));

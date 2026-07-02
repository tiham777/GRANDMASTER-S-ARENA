"use client";

/**
 * OnlineSocketProvider — ensures a single shared socket.io connection
 * across all online views.
 *
 * Problem: `useOnlineChess()` creates a socket on first call. If the
 * OnlineLobbyView and OnlineGameView both call it, they'd each get their
 * OWN socket (and thus their own socket.id), breaking room ownership.
 *
 * Solution: this provider calls `useOnlineChess()` ONCE at the root of
 * the online flow and exposes the result via context. All children share
 * the same connection + room state.
 */
import { createContext, useContext, type ReactNode } from "react";
import { useOnlineChess } from "@/hooks/useOnlineChess";

type OnlineChessValue = ReturnType<typeof useOnlineChess>;

const OnlineSocketContext = createContext<OnlineChessValue | null>(null);

export function OnlineSocketProvider({ children }: { children: ReactNode }) {
  const value = useOnlineChess();
  return (
    <OnlineSocketContext.Provider value={value}>
      {children}
    </OnlineSocketContext.Provider>
  );
}

/** Access the shared online chess socket + state. */
export function useSharedOnlineChess(): OnlineChessValue {
  const ctx = useContext(OnlineSocketContext);
  if (!ctx) {
    throw new Error("useSharedOnlineChess must be used within <OnlineSocketProvider>");
  }
  return ctx;
}

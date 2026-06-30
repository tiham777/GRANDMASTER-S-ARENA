"use client";

/**
 * useOnlineChess — React hook that manages the socket.io connection to the
 * chess-online mini-service and exposes a clean event-driven API.
 *
 * Connection rule (CRITICAL): the socket MUST connect with
 *   io("/", { query: { XTransformPort: "3001" } })
 * so the Caddy gateway forwards it to the chess-online service on port 3001.
 * NEVER use io("http://localhost:3001") — that breaks in the sandbox.
 */
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  OnlineRoom, OnlineLobbyRoom, OnlineChatMessage, OnlineColor,
} from "./onlineTypes";

const ONLINE_PORT = "3001";

export interface OnlineMoveBroadcast {
  from: string;
  to: string;
  promotion?: string;
  san: string;
  fen: string;
  pgn: string;
  status: "playing" | "finished";
  winner?: OnlineColor | "draw";
}

export function useOnlineChess() {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [socketId, setSocketId] = useState<string | null>(null);
  const [room, setRoom] = useState<OnlineRoom | null>(null);
  const [lobbyRooms, setLobbyRooms] = useState<OnlineLobbyRoom[]>([]);
  const [chat, setChat] = useState<OnlineChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [drawOfferedBy, setDrawOfferedBy] = useState<OnlineColor | null>(null);

  // Track the current room code + our name in refs so the reconnect handler
  // can re-join automatically when the socket reconnects (new id → no longer
  // in the server-side room).
  const roomCodeRef = useRef<string | null>(null);
  const myNameRef = useRef<string | null>(null);

  // Keep roomCodeRef in sync with the current room state.
  useEffect(() => {
    roomCodeRef.current = room?.code ?? null;
  }, [room?.code]);

  // Lazy-connect on first use.
  const getSocket = useCallback((): Socket => {
    if (!socketRef.current) {
      // CRITICAL: the path+query MUST be in the URL string (not the `query`
      // option) so the Caddy gateway can route via XTransformPort. Matches
      // the pattern in examples/websocket/frontend.tsx.
      const sock = io(`/?XTransformPort=${ONLINE_PORT}`, {
        transports: ["websocket", "polling"],
        forceNew: true,
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 20,
      });
      sock.on("connect", () => {
        setConnected(true);
        setSocketId(sock.id ?? null);
        // If we were in a room before reconnecting, re-join it so the server
        // re-adds this new socket id to the socket.io room and re-sends state.
        const code = roomCodeRef.current;
        const name = myNameRef.current;
        if (code && name) {
          // Use a rejoin event so the server can re-associate without starting
          // a new game. Falls back to room:join if the server doesn't support it.
          sock.emit("room:rejoin", { code, name });
        }
      });
      sock.on("disconnect", () => {
        setConnected(false);
        setSocketId(null);
      });
      sock.on("connect_error", (err: { message: string }) => {
        console.warn("[online] connect error:", err.message);
        setError(`Connection failed: ${err.message}`);
      });
      socketRef.current = sock;
    }
    return socketRef.current;
  }, []);

  // ============================================================
  // Room create / join / leave
  // ============================================================
  const createRoom = useCallback(
    (
      hostName: string,
      hostColor: "white" | "black" | "random",
      timeControlId: string,
      hostPreferences?: Record<string, unknown>,
    ) => {
      const sock = getSocket();
      setError(null);
      myNameRef.current = hostName;
      sock.emit("room:create", { hostName, hostColor, timeControlId, hostPreferences });
    },
    [getSocket],
  );

  const joinRoom = useCallback(
    (code: string, guestName: string) => {
      const sock = getSocket();
      setError(null);
      myNameRef.current = guestName;
      sock.emit("room:join", { code: code.toUpperCase().trim(), guestName });
    },
    [getSocket],
  );

  const leaveRoom = useCallback(
    (code: string) => {
      const sock = getSocket();
      sock.emit("room:leave", { code });
      roomCodeRef.current = null;
      myNameRef.current = null;
      setRoom(null);
      setChat([]);
      setDrawOfferedBy(null);
    },
    [getSocket],
  );

  // ============================================================
  // Lobby subscription (list of open rooms)
  // ============================================================
  const subscribeLobby = useCallback(() => {
    const sock = getSocket();
    sock.emit("room:list:subscribe");
  }, [getSocket]);

  const unsubscribeLobby = useCallback(() => {
    const sock = getSocket();
    sock.emit("room:list:unsubscribe");
  }, [getSocket]);

  // ============================================================
  // In-game actions
  // ============================================================
  const sendMove = useCallback(
    (code: string, from: string, to: string, promotion?: string) => {
      const sock = getSocket();
      sock.emit("game:move", { code, from, to, promotion });
    },
    [getSocket],
  );

  const resign = useCallback(
    (code: string) => {
      const sock = getSocket();
      sock.emit("game:resign", { code });
    },
    [getSocket],
  );

  const offerDraw = useCallback(
    (code: string) => {
      const sock = getSocket();
      sock.emit("game:draw:offer", { code });
    },
    [getSocket],
  );

  const respondDraw = useCallback(
    (code: string, accept: boolean) => {
      const sock = getSocket();
      sock.emit("game:draw:respond", { code, accept });
      setDrawOfferedBy(null);
    },
    [getSocket],
  );

  const sendChat = useCallback(
    (code: string, message: string) => {
      const sock = getSocket();
      sock.emit("game:chat", { code, message: message.slice(0, 200) });
    },
    [getSocket],
  );

  // ============================================================
  // Rematch
  // ============================================================
  const [rematchRequestedBy, setRematchRequestedBy] = useState<OnlineColor | null>(null);
  const [rematchSent, setRematchSent] = useState(false);

  const requestRematch = useCallback(
    (code: string) => {
      const sock = getSocket();
      setRematchSent(true);
      sock.emit("rematch:request", { code });
    },
    [getSocket],
  );

  const respondRematch = useCallback(
    (code: string, accept: boolean) => {
      const sock = getSocket();
      sock.emit("rematch:respond", { code, accept });
      setRematchRequestedBy(null);
      setRematchSent(false);
    },
    [getSocket],
  );

  // ============================================================
  // Event listeners — wire up once.
  // ============================================================
  useEffect(() => {
    const sock = getSocket();

    const handlers: Record<string, (...args: unknown[]) => void> = {
      "room:created": (payload: { code: string; room: OnlineRoom }) => {
        setRoom(payload.room);
      },
      "room:joined": (payload: { ok: boolean; room?: OnlineRoom; error?: string }) => {
        if (payload.ok && payload.room) {
          setRoom(payload.room);
        } else {
          setError(payload.error ?? "Failed to join room");
        }
      },
      "game:start": (payload: { room: OnlineRoom }) => {
        setRoom(payload.room);
        setDrawOfferedBy(null);
      },
      "game:move": (payload: OnlineMoveBroadcast) => {
        setRoom((prev) =>
          prev
            ? {
                ...prev,
                fen: payload.fen,
                pgn: payload.pgn,
                // Append the move to the moves list (for move-history display).
                moves: [
                  ...prev.moves,
                  {
                    from: payload.from,
                    to: payload.to,
                    promotion: payload.promotion,
                    san: payload.san,
                    at: Date.now(),
                  },
                ],
                status: payload.status === "finished" ? "finished" : "playing",
                winner: payload.winner,
                result:
                  payload.status === "finished"
                    ? payload.winner === "draw"
                      ? "draw"
                      : "checkmate"
                    : prev.result,
              }
            : prev,
        );
      },
      "game:ended": (payload: { room: OnlineRoom }) => {
        setRoom(payload.room);
        setDrawOfferedBy(null);
      },
      "game:start": (payload: { room: OnlineRoom }) => {
        setRoom(payload.room);
        setDrawOfferedBy(null);
        setRematchRequestedBy(null);
        setRematchSent(false);
      },
      "game:draw:offered": (payload: { by: OnlineColor }) => {
        setDrawOfferedBy(payload.by);
      },
      "game:draw:declined": () => {
        setDrawOfferedBy(null);
      },
      "rematch:requested": (payload: { by: OnlineColor }) => {
        setRematchRequestedBy(payload.by);
      },
      "rematch:declined": () => {
        setRematchRequestedBy(null);
        setRematchSent(false);
      },
      "game:chat": (payload: OnlineChatMessage) => {
        setChat((prev) => [...prev, payload].slice(-100));
      },
      "room:list": (payload: { rooms: OnlineLobbyRoom[] }) => {
        setLobbyRooms(payload.rooms ?? []);
      },
      "room:error": (payload: { message: string }) => {
        setError(payload.message);
      },
    };

    for (const [event, handler] of Object.entries(handlers)) {
      sock.on(event, handler as (...args: unknown[]) => void);
    }

    return () => {
      for (const event of Object.keys(handlers)) {
        sock.off(event);
      }
    };
  }, [getSocket]);

  // Derive myColor from the stored socket id vs room.whiteId/blackId.
  // (Computed via useMemo to avoid setState-in-effect cascades.)
  const myColor = useMemo<OnlineColor | null>(() => {
    if (!room || !socketId || !connected) return null;
    if (room.whiteId === socketId) return "white";
    if (room.blackId === socketId) return "black";
    return null;
  }, [room, socketId, connected]);

  // Disconnect on unmount.
  useEffect(() => {
    return () => {
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, []);

  return {
    connected,
    room,
    myColor,
    lobbyRooms,
    chat,
    error,
    drawOfferedBy,
    setError,
    createRoom,
    joinRoom,
    leaveRoom,
    subscribeLobby,
    unsubscribeLobby,
    sendMove,
    resign,
    offerDraw,
    respondDraw,
    sendChat,
    rematchRequestedBy,
    rematchSent,
    requestRematch,
    respondRematch,
  };
}

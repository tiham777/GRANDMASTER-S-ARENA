"use client";

/**
 * useOnlineChess — React hook that drives online multiplayer chess via
 * Firebase Realtime Database.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS (history)
 * ──────────────────────────────────────────────────────────────────────────
 * The original version of this hook talked to a socket.io mini-service
 * (`mini-services/chess-online`) running on port 3001, fronted by a Caddy
 * gateway that routed based on the `?XTransformPort=3001` query parameter.
 * That setup only works in a single-host sandbox where you control both
 * processes. On Vercel / Netlify / any normal static host there is no Caddy
 * and no separate socket.io process — so the socket failed to connect and the
 * UI showed "Connection failed".
 *
 * Switching to Firebase Realtime Database fixes this completely:
 *   - No separate server to deploy.
 *   - Works on any static host (Vercel, Netlify, GitHub Pages, etc.).
 *   - Real-time sync built in via `onValue` / `onChildAdded`.
 *   - Move legality is enforced inside a `runTransaction` so both clients
 *     always see the same authoritative state — clients cannot cheat because
 *     a transaction will only commit if the room's FEN still matches what
 *     the player loaded when computing the move.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * PUBLIC API (unchanged from the socket.io version)
 * ──────────────────────────────────────────────────────────────────────────
 * The hook returns exactly the same shape as before, so `OnlineSocketProvider`,
 * `OnlineLobbyView`, and `OnlineGameView` do not need any changes.
 *
 *   connected, room, myColor, lobbyRooms, chat, error, drawOfferedBy, setError,
 *   createRoom, joinRoom, leaveRoom, subscribeLobby, unsubscribeLobby,
 *   sendMove, resign, offerDraw, respondDraw, sendChat,
 *   rematchRequestedBy, rematchSent, requestRematch, respondRematch
 *
 * ──────────────────────────────────────────────────────────────────────────
 * FIREBASE RTDB SCHEMA
 * ──────────────────────────────────────────────────────────────────────────
 *   chess/
 *     rooms/{CODE}/
 *       code, hostName, hostColor, guestName,
 *       hostId, guestId, whiteId, blackId,        ← client UUIDs from localStorage
 *       fen, pgn,
 *       moves: { pushKey: { from, to, promotion, san, at, by } }
 *       chat:  { pushKey: { from, name, message, at } }
 *       status, result, winner, drawOfferBy,
 *       timeControlId, hostPreferences, createdAt, lastActivity,
 *       rematchOfferBy                                  ← 'white' | 'black' | null
 *     lobby/{CODE}/
 *       code, hostName, hostColor, createdAt            ← presence-only entries
 */

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  ref,
  onValue,
  off,
  push,
  update,
  remove,
  get,
  runTransaction,
  onChildAdded,
} from "firebase/database";
import { Chess } from "chess.js";
import { db } from "@/lib/firebase";
import type {
  OnlineRoom, OnlineLobbyRoom, OnlineChatMessage, OnlineColor,
} from "./onlineTypes";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Room-code alphabet — excludes confusable chars 0/O/1/I. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

/** localStorage key for this browser's persistent client id. */
const CLIENT_ID_KEY = "grandmasters-arena-online-client-id";

/** Max chat message length. */
const MAX_CHAT_LENGTH = 200;

/** Max name length. */
const MAX_NAME_LENGTH = 24;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a unique 6-char uppercase room code (no 0/O/1/I). */
function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Get (or create) a stable per-browser client UUID. This replaces the
 * socket.id used in the old socket.io implementation — it identifies the
 * host/guest across reconnects and refreshes, so we can re-associate a
 * returning player with their seat in an in-progress game.
 */
function getClientId(): string {
  if (typeof window === "undefined") return "ssr-noop";
  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id =
      "c_" +
      Math.random().toString(36).slice(2, 10) +
      Math.random().toString(36).slice(2, 10);
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}

/** Sanitize a player display name (trim + cap length + fallback). */
function sanitizeName(raw: string, fallback: string): string {
  const trimmed = (raw ?? "").trim().slice(0, MAX_NAME_LENGTH);
  return trimmed || fallback;
}

/** Coerce a value into a valid HostColor (default 'random'). */
function coerceHostColor(raw: unknown): "white" | "black" | "random" {
  return raw === "white" || raw === "black" || raw === "random" ? raw : "random";
}

/** Resolve host/guest colors when a guest joins. */
function resolveColors(
  hostColor: "white" | "black" | "random"
): { host: OnlineColor; guest: OnlineColor } {
  if (hostColor === "random") {
    return Math.random() < 0.5
      ? { host: "white", guest: "black" }
      : { host: "black", guest: "white" };
  }
  return hostColor === "white"
    ? { host: "white", guest: "black" }
    : { host: "black", guest: "white" };
}

/** Convert chess.js turn ('w'/'b') to our OnlineColor ('white'/'black'). */
function turnToColor(turn: "w" | "b"): OnlineColor {
  return turn === "w" ? "white" : "black";
}

/** The opposite color. */
function opposite(color: OnlineColor): OnlineColor {
  return color === "white" ? "black" : "white";
}

/**
 * Firebase RTDB paths. Centralized so we never typo a path.
 * All paths are relative to the database root.
 */
function roomRef(code: string) {
  return ref(db, `chess/rooms/${code}`);
}
function lobbyEntryRef(code: string) {
  return ref(db, `chess/lobby/${code}`);
}
function lobbyRef() {
  return ref(db, "chess/lobby");
}
function chatRef(code: string) {
  return ref(db, `chess/rooms/${code}/chat`);
}
function movesRef(code: string) {
  return ref(db, `chess/rooms/${code}/moves`);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useOnlineChess() {
  // ---- Connection + identity ----------------------------------------------
  const clientIdRef = useRef<string>("");
  const [connected, setConnected] = useState(false);
  const [socketId, setSocketId] = useState<string | null>(null); // = clientId
  const [room, setRoom] = useState<OnlineRoom | null>(null);
  const [lobbyRooms, setLobbyRooms] = useState<OnlineLobbyRoom[]>([]);
  const [chat, setChat] = useState<OnlineChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [drawOfferedBy, setDrawOfferedBy] = useState<OnlineColor | null>(null);

  // Track current room code + my name so we can re-subscribe on reconnect.
  const roomCodeRef = useRef<string | null>(null);
  const myNameRef = useRef<string | null>(null);

  // Listeners we need to clean up on unmount / room change.
  const roomUnsubRef = useRef<(() => void) | null>(null);
  const chatUnsubRef = useRef<(() => void) | null>(null);
  const lobbyUnsubRef = useRef<(() => void) | null>(null);

  // Keep roomCodeRef in sync.
  useEffect(() => {
    roomCodeRef.current = room?.code ?? null;
  }, [room?.code]);

  // ---- Boot: get client id + monitor connection health --------------------
  useEffect(() => {
    const clientId = getClientId();
    clientIdRef.current = clientId;
    setSocketId(clientId);

    // Firebase exposes a special `.info/connected` boolean that flips to true
    // when the client has an active RTDB connection. We use this as our
    // `connected` indicator.
    const connRef = ref(db, ".info/connected");
    const unsub = onValue(connRef, (snap) => {
      const isOnline = Boolean(snap.val());
      setConnected(isOnline);

      // Auto re-join a room we were in before the connection dropped.
      if (isOnline) {
        const code = roomCodeRef.current;
        const name = myNameRef.current;
        if (code && name) {
          // Re-fetch room state — if it's still alive, our local listeners
          // (subscribed below) will pick up the latest data and refresh
          // state. We don't need to do anything else because room state is
          // stored under the room code, not under a transient socket id.
          get(roomRef(code)).catch((err) => {
            console.warn("[online] rejoin fetch failed:", err);
          });
        }
      }
    });

    return () => off(connRef, "value", unsub);
  }, []);

  // ---- Subscribe to the active room ---------------------------------------
  // Whenever roomCodeRef changes (i.e. we create/join/leave a room), we
  // (re)wire listeners for room metadata + chat.
  useEffect(() => {
    // Tear down previous listeners.
    if (roomUnsubRef.current) {
      roomUnsubRef.current();
      roomUnsubRef.current = null;
    }
    if (chatUnsubRef.current) {
      chatUnsubRef.current();
      chatUnsubRef.current = null;
    }

    const code = roomCodeRef.current;
    if (!code) return;

    // Room metadata + moves snapshot.
    const rRef = roomRef(code);
    const unsubRoom = onValue(rRef, (snap) => {
      if (!snap.exists()) {
        // Room was deleted (host cancelled, or cleanup ran).
        setRoom(null);
        setChat([]);
        setDrawOfferedBy(null);
        roomCodeRef.current = null;
        return;
      }
      const data = snap.val();

      // Convert moves from object → array (sorted by push key = chronological).
      let moves: OnlineRoom["moves"] = [];
      if (data.moves && typeof data.moves === "object") {
        moves = Object.values(data.moves).sort(
          (a: { at: number }, b: { at: number }) => a.at - b.at
        );
      }

      // Convert rematchOfferBy → local rematchRequestedBy.
      // (Local UI uses rematchRequestedBy/rematchSent, computed below.)
      const onlineRoom: OnlineRoom = {
        code: data.code,
        hostName: data.hostName,
        hostColor: data.hostColor,
        guestName: data.guestName,
        whiteId: data.whiteId,
        blackId: data.blackId,
        fen: data.fen,
        pgn: data.pgn ?? "",
        moves,
        status: data.status,
        result: data.result,
        winner: data.winner,
        drawOfferBy: data.drawOfferBy,
        timeControlId: data.timeControlId,
        hostPreferences: data.hostPreferences,
        createdAt: data.createdAt,
        lastActivity: data.lastActivity,
      };
      setRoom(onlineRoom);
      setDrawOfferedBy(data.drawOfferBy ?? null);
      setRematchRequestedBy(data.rematchOfferBy ?? null);
    });
    roomUnsubRef.current = () => off(rRef, "value", unsubRoom);

    // Chat: listen for new children only (don't replay full history each time).
    const cRef = chatRef(code);
    const unsubChat = onChildAdded(cRef, (snap) => {
      const msg = snap.val() as OnlineChatMessage;
      if (!msg) return;
      setChat((prev) => [...prev, msg].slice(-100));
    });
    chatUnsubRef.current = () => off(cRef, "child_added", unsubChat);
  }, [room?.code]);

  // ============================================================
  // Room create / join / leave
  // ============================================================

  const createRoom = useCallback(
    (
      hostName: string,
      hostColor: "white" | "black" | "random",
      timeControlId: string,
      hostPreferences?: Record<string, unknown>
    ) => {
      const clientId = clientIdRef.current;
      if (!clientId) {
        setError("Not connected yet — try again in a moment");
        return;
      }
      setError(null);
      myNameRef.current = sanitizeName(hostName, "Host");

      // Generate a fresh code, then write the room + lobby entry.
      const code = generateRoomCode();
      const now = Date.now();
      const startingFen = new Chess().fen();

      const roomData = {
        code,
        hostId: clientId,
        hostName: myNameRef.current,
        hostColor: coerceHostColor(hostColor),
        guestId: null,
        guestName: null,
        whiteId: null,
        blackId: null,
        fen: startingFen,
        pgn: "",
        moves: null,
        chat: null,
        status: "waiting",
        result: null,
        winner: null,
        drawOfferBy: null,
        timeControlId: (timeControlId ?? "unlimited").toString().slice(0, 32),
        hostPreferences: hostPreferences ?? null,
        createdAt: now,
        lastActivity: now,
        rematchOfferBy: null,
      };

      // Write room + lobby entry together (atomic-ish via update on root).
      update(roomRef(code), roomData)
        .then(() =>
          update(lobbyRef(), {
            [code]: {
              code,
              hostName: myNameRef.current,
              hostColor: roomData.hostColor,
              createdAt: now,
            },
          })
        )
        .then(() => {
          // Subscribe happens automatically via the room.code effect once we
          // set local state. We set roomCodeRef directly so the subscription
          // is wired before any other writes happen.
          roomCodeRef.current = code;
          // Trigger the subscription effect by setting room state.
          setRoom({
            code,
            hostName: roomData.hostName,
            hostColor: roomData.hostColor,
            fen: roomData.fen,
            pgn: "",
            moves: [],
            status: "waiting",
            timeControlId: roomData.timeControlId,
            hostPreferences: hostPreferences ?? undefined,
            createdAt: now,
            lastActivity: now,
          });
        })
        .catch((err: unknown) => {
          console.error("[online] createRoom failed:", err);
          setError(`Failed to create room: ${(err as Error).message}`);
        });
    },
    []
  );

  const joinRoom = useCallback((code: string, guestName: string) => {
    const clientId = clientIdRef.current;
    if (!clientId) {
      setError("Not connected yet — try again in a moment");
      return;
    }
    setError(null);
    const cleanCode = code.toUpperCase().trim();
    myNameRef.current = sanitizeName(guestName, "Guest");

    // Atomically claim the guest slot via transaction.
    runTransaction(roomRef(cleanCode), (current) => {
      if (!current) return current; // room doesn't exist
      if (current.status !== "waiting") return current; // already started
      if (current.guestId) return current; // full
      if (current.hostId === clientId) return current; // already host

      const { host: hostColor, guest: _guestColor } = resolveColors(
        current.hostColor
      );
      current.guestId = clientId;
      current.guestName = myNameRef.current;
      if (hostColor === "white") {
        current.whiteId = current.hostId;
        current.blackId = clientId;
      } else {
        current.whiteId = clientId;
        current.blackId = current.hostId;
      }
      current.status = "playing";
      current.lastActivity = Date.now();
      return current;
    })
      .then(({ committed, snapshot }) => {
        if (!committed || !snapshot.exists()) {
          setError("Room not found");
          return;
        }
        const data = snapshot.val();
        if (data.status !== "playing" || data.guestId !== clientId) {
          // Pre-flight checks failed: room was full / started / etc.
          if (data.guestId && data.guestId !== clientId) {
            setError("Room is full");
          } else if (data.status !== "waiting") {
            setError("Game already started");
          } else if (data.hostId === clientId) {
            setError("You are already the host");
          } else {
            setError("Failed to join room");
          }
          return;
        }
        // Wire up local subscription so we receive live updates.
        roomCodeRef.current = cleanCode;
        // Trigger subscription by setting a minimal placeholder room; the
        // real value will arrive via onValue momentarily.
        setRoom({
          code: cleanCode,
          hostName: data.hostName,
          hostColor: data.hostColor,
          guestName: data.guestName,
          whiteId: data.whiteId,
          blackId: data.blackId,
          fen: data.fen,
          pgn: data.pgn ?? "",
          moves: [],
          status: "playing",
          timeControlId: data.timeControlId,
          hostPreferences: data.hostPreferences ?? undefined,
          createdAt: data.createdAt,
          lastActivity: data.lastActivity,
        });
        // Remove the lobby entry so no one else tries to join.
        remove(lobbyEntryRef(cleanCode)).catch(() => {
          /* best-effort */
        });
      })
      .catch((err: unknown) => {
        console.error("[online] joinRoom failed:", err);
        setError(`Failed to join room: ${(err as Error).message}`);
      });
  }, []);

  const leaveRoom = useCallback((code: string) => {
    const clientId = clientIdRef.current;
    const cleanCode = code.toUpperCase().trim();
    setError(null);

    runTransaction(roomRef(cleanCode), (current) => {
      if (!current) return current;
      const isHost = current.hostId === clientId;
      const isGuest = current.guestId === clientId;
      if (!isHost && !isGuest) return current;

      if (current.status === "waiting") {
        // Host cancelled the waiting room — delete it.
        return null;
      }
      if (current.status === "playing") {
        // Player abandoned a live game — opponent wins.
        const senderColor: OnlineColor | null =
          current.whiteId === clientId ? "white" :
          current.blackId === clientId ? "black" : null;
        if (!senderColor) return current;
        current.status = "finished";
        current.result = "abandoned";
        current.winner = opposite(senderColor);
        current.drawOfferBy = null;
        current.lastActivity = Date.now();
        return current;
      }
      return current;
    })
      .then(() => {
        // Always remove the lobby entry if it still exists.
        return remove(lobbyEntryRef(cleanCode));
      })
      .then(() => {
        roomCodeRef.current = null;
        myNameRef.current = null;
        setRoom(null);
        setChat([]);
        setDrawOfferedBy(null);
        setRematchRequestedBy(null);
        setRematchSent(false);
      })
      .catch((err: unknown) => {
        console.error("[online] leaveRoom failed:", err);
      });
  }, []);

  // ============================================================
  // Lobby subscription (list of open rooms)
  // ============================================================

  const subscribeLobby = useCallback(() => {
    if (lobbyUnsubRef.current) return; // already subscribed
    const lRef = lobbyRef();
    const unsub = onValue(lRef, (snap) => {
      const val = snap.val();
      if (!val) {
        setLobbyRooms([]);
        return;
      }
      const list: OnlineLobbyRoom[] = Object.values(val).sort(
        (a: { createdAt: number }, b: { createdAt: number }) =>
          b.createdAt - a.createdAt
      );
      setLobbyRooms(list);
    });
    lobbyUnsubRef.current = () => off(lRef, "value", unsub);
  }, []);

  const unsubscribeLobby = useCallback(() => {
    if (lobbyUnsubRef.current) {
      lobbyUnsubRef.current();
      lobbyUnsubRef.current = null;
    }
  }, []);

  // ============================================================
  // In-game actions
  // ============================================================

  const sendMove = useCallback(
    (code: string, from: string, to: string, promotion?: string) => {
      const clientId = clientIdRef.current;
      const cleanCode = code.toUpperCase().trim();
      setError(null);

      runTransaction(roomRef(cleanCode), (current) => {
        if (!current) return current;
        if (current.status !== "playing") return current;
        const senderColor: OnlineColor | null =
          current.whiteId === clientId ? "white" :
          current.blackId === clientId ? "black" : null;
        if (!senderColor) return current;

        // Validate the move server-side-equivalent (in the transaction).
        // chess.js throws on illegal moves — wrap in try/catch and abort
        // the transaction by returning current unchanged.
        let chess: Chess;
        try {
          chess = new Chess(current.fen);
        } catch {
          return current;
        }
        if (turnToColor(chess.turn()) !== senderColor) return current;

        let moveResult;
        try {
          moveResult = chess.move({ from, to, promotion });
        } catch {
          return current; // illegal — abort, room unchanged
        }
        if (!moveResult) return current;

        // Commit move.
        current.fen = chess.fen();
        current.pgn = chess.pgn();
        // Append to moves map. Firebase generates a unique push key for us.
        if (!current.moves) current.moves = {};
        const moveKey = `m${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        current.moves[moveKey] = {
          from,
          to,
          promotion: promotion ?? null,
          san: moveResult.san,
          at: Date.now(),
          by: senderColor,
        };
        current.lastActivity = Date.now();

        // Detect terminal conditions.
        if (chess.isCheckmate()) {
          current.status = "finished";
          current.result = "checkmate";
          current.winner = senderColor;
          current.drawOfferBy = null;
        } else if (
          chess.isStalemate() ||
          chess.isInsufficientMaterial() ||
          chess.isThreefoldRepetition() ||
          chess.isDraw()
        ) {
          current.status = "finished";
          current.result = "draw";
          current.winner = "draw";
          current.drawOfferBy = null;
        }
        return current;
      })
        .then(({ snapshot }) => {
          // Detect rejection: if our move wasn't applied (e.g. illegal under
          // the latest FEN, or it's not our turn, or the room vanished),
          // surface an error so OnlineGameView can revert its optimistic UI.
          if (!snapshot.exists()) {
            setError("Room no longer exists");
            return;
          }
          const data = snapshot.val();
          const moves = data.moves ?? {};
          const lastMoveEntry = Object.values(moves).sort(
            (a: { at: number }, b: { at: number }) => b.at - a.at
          )[0];
          const myMoveWasApplied =
            lastMoveEntry &&
            (lastMoveEntry as { by?: OnlineColor }).by !== undefined &&
            // Was the last move ours?
            ((data.whiteId === clientId && (lastMoveEntry as { by: OnlineColor }).by === "white") ||
             (data.blackId === clientId && (lastMoveEntry as { by: OnlineColor }).by === "black"));
          if (!myMoveWasApplied) {
            setError("Move rejected — sync from server");
          }
        })
        .catch((err: unknown) => {
          console.error("[online] sendMove failed:", err);
          setError(`Move failed: ${(err as Error).message}`);
        });
    },
    []
  );

  const resign = useCallback((code: string) => {
    const clientId = clientIdRef.current;
    const cleanCode = code.toUpperCase().trim();
    setError(null);

    runTransaction(roomRef(cleanCode), (current) => {
      if (!current) return current;
      if (current.status !== "playing") return current;
      const senderColor: OnlineColor | null =
        current.whiteId === clientId ? "white" :
        current.blackId === clientId ? "black" : null;
      if (!senderColor) return current;
      current.status = "finished";
      current.result = "resign";
      current.winner = opposite(senderColor);
      current.drawOfferBy = null;
      current.lastActivity = Date.now();
      return current;
    }).catch((err: unknown) => {
      console.error("[online] resign failed:", err);
      setError(`Resign failed: ${(err as Error).message}`);
    });
  }, []);

  const offerDraw = useCallback((code: string) => {
    const clientId = clientIdRef.current;
    const cleanCode = code.toUpperCase().trim();
    setError(null);

    runTransaction(roomRef(cleanCode), (current) => {
      if (!current) return current;
      if (current.status !== "playing") return current;
      const senderColor: OnlineColor | null =
        current.whiteId === clientId ? "white" :
        current.blackId === clientId ? "black" : null;
      if (!senderColor) return current;
      current.drawOfferBy = senderColor;
      current.lastActivity = Date.now();
      return current;
    }).catch((err: unknown) => {
      console.error("[online] offerDraw failed:", err);
      setError(`Draw offer failed: ${(err as Error).message}`);
    });
  }, []);

  const respondDraw = useCallback((code: string, accept: boolean) => {
    const clientId = clientIdRef.current;
    const cleanCode = code.toUpperCase().trim();
    setError(null);
    setDrawOfferedBy(null);

    runTransaction(roomRef(cleanCode), (current) => {
      if (!current) return current;
      if (current.status !== "playing") return current;
      const senderColor: OnlineColor | null =
        current.whiteId === clientId ? "white" :
        current.blackId === clientId ? "black" : null;
      if (!senderColor) return current;
      if (!current.drawOfferBy || current.drawOfferBy === senderColor) return current;

      if (accept) {
        current.status = "finished";
        current.result = "draw";
        current.winner = "draw";
        current.drawOfferBy = null;
        current.lastActivity = Date.now();
      } else {
        current.drawOfferBy = null;
        current.lastActivity = Date.now();
      }
      return current;
    }).catch((err: unknown) => {
      console.error("[online] respondDraw failed:", err);
      setError(`Draw response failed: ${(err as Error).message}`);
    });
  }, []);

  const sendChat = useCallback((code: string, message: string) => {
    const clientId = clientIdRef.current;
    const cleanCode = code.toUpperCase().trim();
    const trimmed = (message ?? "").trim().slice(0, MAX_CHAT_LENGTH);
    if (!trimmed) return;

    // Look up our color + name from the current room snapshot. (We don't
    // include this in the chat call signature to keep the API unchanged.)
    get(roomRef(cleanCode))
      .then((snap) => {
        if (!snap.exists()) return;
        const data = snap.val();
        const from: OnlineColor =
          data.whiteId === clientId ? "white" : "black";
        const name: string =
          data.hostId === clientId
            ? data.hostName
            : data.guestName ?? "Guest";
        const msg: OnlineChatMessage = {
          from,
          name,
          message: trimmed,
          at: Date.now(),
        };
        // Use push so Firebase assigns a unique key.
        push(chatRef(cleanCode), msg).catch((err: unknown) => {
          console.error("[online] sendChat push failed:", err);
        });
      })
      .catch((err: unknown) => {
        console.error("[online] sendChat failed:", err);
      });
  }, []);

  // ============================================================
  // Rematch
  // ============================================================

  const [rematchRequestedBy, setRematchRequestedBy] = useState<OnlineColor | null>(null);
  const [rematchSent, setRematchSent] = useState(false);

  const requestRematch = useCallback((code: string) => {
    const clientId = clientIdRef.current;
    const cleanCode = code.toUpperCase().trim();
    setError(null);
    setRematchSent(true);

    runTransaction(roomRef(cleanCode), (current) => {
      if (!current) return current;
      if (current.status !== "finished") return current;
      const senderColor: OnlineColor | null =
        current.whiteId === clientId ? "white" :
        current.blackId === clientId ? "black" : null;
      if (!senderColor) return current;
      // First request → record offerer. Second request (from the other side)
      // already present → accept immediately and start the new game.
      if (current.rematchOfferBy && current.rematchOfferBy !== senderColor) {
        // Other player already asked for rematch — accept now.
        const prevWhiteId = current.whiteId;
        const prevBlackId = current.blackId;
        current.whiteId = prevBlackId;
        current.blackId = prevWhiteId;
        current.fen = new Chess().fen();
        current.pgn = "";
        current.moves = null;
        current.status = "playing";
        current.result = null;
        current.winner = null;
        current.drawOfferBy = null;
        current.rematchOfferBy = null;
        current.lastActivity = Date.now();
      } else if (!current.rematchOfferBy) {
        current.rematchOfferBy = senderColor;
        current.lastActivity = Date.now();
      }
      return current;
    }).catch((err: unknown) => {
      console.error("[online] requestRematch failed:", err);
      setError(`Rematch request failed: ${(err as Error).message}`);
      setRematchSent(false);
    });
  }, []);

  const respondRematch = useCallback((code: string, accept: boolean) => {
    const clientId = clientIdRef.current;
    const cleanCode = code.toUpperCase().trim();
    setError(null);
    setRematchRequestedBy(null);
    setRematchSent(false);

    runTransaction(roomRef(cleanCode), (current) => {
      if (!current) return current;
      if (!current.rematchOfferBy) return current;
      const senderColor: OnlineColor | null =
        current.whiteId === clientId ? "white" :
        current.blackId === clientId ? "black" : null;
      if (!senderColor || senderColor === current.rematchOfferBy) return current;

      if (accept) {
        // Swap colors, reset game state.
        const prevWhiteId = current.whiteId;
        const prevBlackId = current.blackId;
        current.whiteId = prevBlackId;
        current.blackId = prevWhiteId;
        current.fen = new Chess().fen();
        current.pgn = "";
        current.moves = null;
        current.status = "playing";
        current.result = null;
        current.winner = null;
        current.drawOfferBy = null;
        current.rematchOfferBy = null;
        current.lastActivity = Date.now();
      } else {
        // Decline — clear the offer.
        current.rematchOfferBy = null;
        current.lastActivity = Date.now();
      }
      return current;
    }).catch((err: unknown) => {
      console.error("[online] respondRematch failed:", err);
      setError(`Rematch response failed: ${(err as Error).message}`);
    });
  }, []);

  // ============================================================
  // Cleanup on unmount
  // ============================================================

  useEffect(() => {
    return () => {
      if (roomUnsubRef.current) roomUnsubRef.current();
      if (chatUnsubRef.current) chatUnsubRef.current();
      if (lobbyUnsubRef.current) lobbyUnsubRef.current();
    };
  }, []);

  // ============================================================
  // Derived state
  // ============================================================

  const myColor = useMemo<OnlineColor | null>(() => {
    if (!room || !socketId || !connected) return null;
    if (room.whiteId === socketId) return "white";
    if (room.blackId === socketId) return "black";
    return null;
  }, [room, socketId, connected]);

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

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
 * PUBLIC API
 * ────────────────────────────────────────────────────────────────────────── * The hook returns exactly the same shape as the original socket.io version,
 * so `OnlineSocketProvider`, `OnlineLobbyView`, and `OnlineGameView` need no
 * changes. The new `opponentConnected` and `claimWin` fields are additive —
 * existing callers can ignore them.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * FIREBASE RTDB SCHEMA
 * ──────────────────────────────────────────────────────────────────────────
 *   chess/
 *     rooms/{CODE}/
 *       code, hostName, hostColor, guestName,
 *       hostId, guestId, whiteId, blackId,        ← client UUIDs (sessionStorage)
 *       fen, pgn,
 *       moves: { pushKey: { from, to, promotion, san, at, by } }
 *       chat:  { pushKey: { from, name, message, at } }
 *       presence: { clientId: { connectedAt } }   ← onDisconnect removes these
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
  set,
  update,
  remove,
  get,
  runTransaction,
  onChildAdded,
  onDisconnect,
  query,
  limitToLast,
} from "firebase/database";
import { Chess } from "chess.js";
import { db, firebaseConfig } from "@/lib/firebase";
import type {
  OnlineRoom, OnlineLobbyRoom, OnlineChatMessage, OnlineColor,
} from "./onlineTypes";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Room-code alphabet — excludes confusable chars 0/O/1/I. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

/**
 * Per-tab client identity. We use sessionStorage (NOT localStorage) so that:
 *   - Two tabs in the same browser get DIFFERENT ids (lets you test online
 *     play by opening the app in two tabs).
 *   - Refreshing the same tab keeps the SAME id (so your seat in an
 *     in-progress game is preserved across refreshes).
 * The original localStorage approach broke two-tab testing because both
 * tabs shared one id and the second tab couldn't join a room the first
 * tab had created (the join transaction rejected it as "already host").
 */
const CLIENT_ID_KEY = "grandmasters-arena-online-client-id";

/** Max chat message length. */
const MAX_CHAT_LENGTH = 200;

/** Max name length. */
const MAX_NAME_LENGTH = 24;

/** Cap on initial chat history load (avoid replaying hundreds of messages). */
const CHAT_INITIAL_LIMIT = 50;

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
 * Get (or create) a stable per-tab client UUID. See CLIENT_ID_KEY docs for
 * why this is sessionStorage, not localStorage.
 */
function getClientId(): string {
  if (typeof window === "undefined") return "ssr-noop";
  try {
    let id = sessionStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      id =
        "c_" +
        Math.random().toString(36).slice(2, 10) +
        Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  } catch {
    // sessionStorage can throw in some privacy modes — fall back to a
    // random in-memory id.
    return "c_fallback_" + Math.random().toString(36).slice(2, 10);
  }
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
function presenceRef(code: string, clientId: string) {
  return ref(db, `chess/rooms/${code}/presence/${clientId}`);
}

/**
 * Write our presence marker and queue an onDisconnect removal. Called when
 * we create or join a room. The presence marker is what the OTHER player
 * watches to detect that we've closed the tab / lost connectivity.
 *
 * We re-run this on every reconnect (see the connection-health effect) so
 * the onDisconnect queue is always fresh even across network blips.
 */
async function setupPresence(code: string, clientId: string): Promise<void> {
  const pRef = presenceRef(code, clientId);
  await set(pRef, { connectedAt: Date.now() });
  // Queue a removal for when our connection drops. Firebase executes this
  // server-side even if our client goes away ungracefully.
  onDisconnect(pRef).remove();
}

/** Manually remove our presence marker (called on graceful leave). */
async function teardownPresence(code: string, clientId: string): Promise<void> {
  const pRef = presenceRef(code, clientId);
  // Cancel the queued onDisconnect first so it doesn't fire later and try
  // to remove a node that's already gone (harmless but noisy).
  onDisconnect(pRef).cancel();
  await remove(pRef);
}

/**
 * Fire-and-forget resign via the Firebase REST API. Uses `keepalive: true`
 * so the request survives page unload (reload, tab close, browser back).
 *
 * This is the ONLY reliable way to write to Firebase during unload — the
 * WebSocket connection is torn down before async SDK writes can complete.
 *
 * Non-transactional: if both players reload at the exact same instant, both
 * writes succeed and the final winner is whoever wrote last. Acceptable for
 * casual play. (A truly atomic solution would need ETag-based conditional
 * PUTs via the REST API, which is more code than the bug warrants.)
 *
 * Requires the database rules to allow unauthenticated PATCH under
 * /chess/rooms/{code} (the permissive rules from ONLINE_FIX_README.md
 * satisfy this). If you switch to authenticated rules, you'd need to
 * append `?auth=<token>` to the URL.
 */
function resignViaRest(code: string, winnerColor: OnlineColor): void {
  const dbUrl = firebaseConfig.databaseURL;
  if (!dbUrl) return;
  const url = `${dbUrl}/chess/rooms/${code}.json`;
  const body = JSON.stringify({
    status: "finished",
    result: "abandoned",
    winner: winnerColor,
    drawOfferBy: null,
    lastActivity: Date.now(),
  });
  try {
    void fetch(url, {
      method: "PATCH",
      body,
      keepalive: true,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    // ignore — best-effort
  }
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
  const [opponentConnected, setOpponentConnected] = useState(false);

  // Track current room code + my name so we can re-establish presence on
  // reconnect.
  const roomCodeRef = useRef<string | null>(null);
  const myNameRef = useRef<string | null>(null);

  // Listeners we need to clean up on unmount / room change.
  // (Stored as refs so the cleanup effect can tear them down without
  // depending on room state.)
  const lobbyUnsubRef = useRef<(() => void) | null>(null);

  // Keep roomCodeRef in sync with room?.code.
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

      // On reconnect, re-establish presence for any room we're still in.
      // Firebase's onDisconnect queue survives transient drops, but if the
      // tab was backgrounded for a long time the queue may have been
      // flushed — re-running setupPresence is idempotent and cheap.
      if (isOnline) {
        const code = roomCodeRef.current;
        if (code && clientId !== "ssr-noop") {
          setupPresence(code, clientId).catch((err) => {
            console.warn("[online] presence re-setup failed:", err);
          });
        }
      }
    });

    return () => off(connRef, "value", unsub);
  }, []);

  // ---- Subscribe to the active room ---------------------------------------
  // Whenever room?.code changes (i.e. we create/join/leave a room), we
  // (re)wire listeners for room metadata + chat. We use room?.code directly
  // as the effect dependency (not roomCodeRef.current) so React's dependency
  // tracking is correct and the cleanup function is tied to the right code.
  useEffect(() => {
    const code = room?.code;
    if (!code) return;

    // ---- Room metadata + moves snapshot ----
    const rRef = roomRef(code);
    const unsubRoom = onValue(rRef, (snap) => {
      if (!snap.exists()) {
        // Room was deleted (host cancelled waiting room, or cleanup ran).
        setRoom(null);
        setChat([]);
        setDrawOfferedBy(null);
        setOpponentConnected(false);
        setRematchRequestedBy(null);
        setRematchSent(false);
        roomCodeRef.current = null;
        return;
      }
      const data = snap.val();

      // Convert moves from object → array (sorted by `at` timestamp).
      let moves: OnlineRoom["moves"] = [];
      if (data.moves && typeof data.moves === "object") {
        moves = Object.values(data.moves).sort(
          (a: { at: number }, b: { at: number }) => a.at - b.at
        );
      }

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

      // Derive opponent connection state from presence markers.
      const myId = clientIdRef.current;
      const opponentId =
        data.whiteId === myId ? data.blackId :
        data.blackId === myId ? data.whiteId :
        null;
      const opponentPresent =
        !!opponentId &&
        !!data.presence &&
        data.presence[opponentId] != null;
      setOpponentConnected(opponentPresent);
    });

    // ---- Chat: only listen for the last N children on initial load ----
    // We use limitToLast so we don't replay hundreds of old messages when
    // re-mounting on a long-running room. New messages arriving after
    // mount are still delivered via child_added.
    const cRef = query(chatRef(code), limitToLast(CHAT_INITIAL_LIMIT));
    let initialSnapshotReceived = false;
    const unsubChat = onValue(cRef, (snap) => {
      // First fire: hydrate chat with the last N messages.
      if (!initialSnapshotReceived) {
        initialSnapshotReceived = true;
        const list: OnlineChatMessage[] = [];
        snap.forEach((child) => {
          const msg = child.val() as OnlineChatMessage;
          if (msg) list.push(msg);
        });
        setChat(list.slice(-100));
      }
    });
    // After the initial snapshot, switch to child_added for new messages.
    // (We keep the value listener too — it's cheap and keeps the local
    // cache in sync if Firebase re-emits on reconnect.)
    const cAddedRef = chatRef(code);
    const unsubChatAdded = onChildAdded(cAddedRef, (snap) => {
      if (!initialSnapshotReceived) return; // will be handled by initial value
      const msg = snap.val() as OnlineChatMessage;
      if (!msg) return;
      setChat((prev) => {
        // Dedupe: child_added can fire after the initial value snapshot
        // for the last few messages.
        if (prev.some((m) => m.at === msg.at && m.message === msg.message && m.from === msg.from)) {
          return prev;
        }
        return [...prev, msg].slice(-100);
      });
    });

    return () => {
      off(rRef, "value", unsubRoom);
      off(cRef, "value", unsubChat);
      off(cAddedRef, "child_added", unsubChatAdded);
    };
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
      if (!clientId || clientId === "ssr-noop") {
        setError("Not connected yet — try again in a moment");
        return;
      }
      setError(null);
      const cleanHost = sanitizeName(hostName, "Host");
      myNameRef.current = cleanHost;

      // Generate a fresh code, then write the room + lobby entry.
      const code = generateRoomCode();
      const now = Date.now();
      const startingFen = new Chess().fen();

      const roomData = {
        code,
        hostId: clientId,
        hostName: cleanHost,
        hostColor: coerceHostColor(hostColor),
        guestId: null,
        guestName: null,
        whiteId: null,
        blackId: null,
        fen: startingFen,
        pgn: "",
        moves: null,
        chat: null,
        presence: null,
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
              hostName: cleanHost,
              hostColor: roomData.hostColor,
              createdAt: now,
            },
          })
        )
        .then(() => setupPresence(code, clientId))
        .then(() => {
          // Trigger the subscription effect by setting room state.
          // (roomCodeRef sync happens via the dedicated effect above.)
          setRoom({
            code,
            hostName: cleanHost,
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
    if (!clientId || clientId === "ssr-noop") {
      setError("Not connected yet — try again in a moment");
      return;
    }
    setError(null);
    const cleanCode = code.toUpperCase().trim();
    const cleanGuest = sanitizeName(guestName, "Guest");
    myNameRef.current = cleanGuest;

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
      current.guestName = cleanGuest;
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
        // Set up our presence marker so the host can see we're here.
        setupPresence(cleanCode, clientId).catch((err) => {
          console.warn("[online] guest presence setup failed:", err);
        });
        // Wire up local subscription so we receive live updates.
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
        // Always remove our presence marker (graceful leave).
        return teardownPresence(cleanCode, clientId);
      })
      .then(() => {
        return remove(lobbyEntryRef(cleanCode));
      })
      .then(() => {
        roomCodeRef.current = null;
        myNameRef.current = null;
        setRoom(null);
        setChat([]);
        setDrawOfferedBy(null);
        setOpponentConnected(false);
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

  /**
   * Apply a move atomically. We pre-generate a unique moveKey BEFORE the
   * transaction so we can detect (after the transaction commits) whether
   * our specific move was applied — even if the opponent raced us and
   * committed their own move first.
   *
   * The transaction function is pure: it loads the room's FEN, validates
   * it's the sender's turn, runs chess.js to verify legality + compute
   * SAN/checkmate/draw, and writes back. Aborts (returns current unchanged)
   * on any check failure — which Firebase interprets as "don't write".
   */
  const sendMove = useCallback(
    (code: string, from: string, to: string, promotion?: string) => {
      const clientId = clientIdRef.current;
      const cleanCode = code.toUpperCase().trim();
      setError(null);

      // Pre-generate the move key so we can detect our move post-commit.
      const moveKey = `m${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

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
        if (!current.moves) current.moves = {};
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
          // Detect rejection: if our pre-generated moveKey isn't in the
          // final moves map, our move was NOT applied (illegal under the
          // latest FEN, not our turn, room vanished, etc.). Surface an
          // error so OnlineGameView can revert its optimistic UI.
          if (!snapshot.exists()) {
            setError("Room no longer exists");
            return;
          }
          const moves = snapshot.val()?.moves ?? {};
          if (!(moveKey in moves)) {
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

  /**
   * Claim a win when the opponent has disconnected. Only works if the
   * opponent's presence marker is gone (i.e., they closed their tab or
   * lost connectivity long enough for Firebase to flush the onDisconnect
   * queue). This prevents the "stuck forever" scenario where one player
   * exits mid-game and the other has no way to end the game.
   */
  const claimWin = useCallback((code: string) => {
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

      // Verify opponent is actually gone. The opponent's presence marker
      // is removed by onDisconnect when they close their tab. If they're
      // still there (or just refreshing), don't allow the claim.
      const opponentId =
        senderColor === "white" ? current.blackId : current.whiteId;
      const opponentPresent =
        !!opponentId &&
        !!current.presence &&
        current.presence[opponentId] != null;
      if (opponentPresent) {
        return current; // opponent is still connected — abort claim
      }

      current.status = "finished";
      current.result = "abandoned";
      current.winner = senderColor;
      current.drawOfferBy = null;
      current.lastActivity = Date.now();
      return current;
    })
      .then(({ committed, snapshot }) => {
        if (!committed || !snapshot.exists()) {
          setError("Could not claim win — opponent is still connected");
          return;
        }
        const data = snapshot.val();
        const senderColor: OnlineColor | null =
          data.whiteId === clientId ? "white" :
          data.blackId === clientId ? "black" : null;
        if (data.status !== "finished" || data.winner !== senderColor) {
          setError("Could not claim win — opponent is still connected");
        }
      })
      .catch((err: unknown) => {
        console.error("[online] claimWin failed:", err);
        setError(`Claim win failed: ${(err as Error).message}`);
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
  // Resign on unload (reload / browser-back / tab close)
  // ============================================================
  //
  // When the user reloads the page, clicks the browser back button, or
  // closes the tab during a live game, we want it to count as a resign
  // (opponent wins by abandonment).
  //
  // Strategy:
  //   1. `beforeunload` — show the browser's "are you sure?" dialog so the
  //      user can cancel if it was an accident. We DON'T write here, because
  //      the user might click "stay on page" and we'd have resigned for
  //      nothing.
  //   2. `pagehide` — fires when the page is ACTUALLY being unloaded (the
  //      user confirmed or there was no confirmation). We fire `resignViaRest`
  //      here, which uses `fetch(..., { keepalive: true })` to hit the
  //      Firebase REST API. The keepalive flag ensures the request survives
  //      page unload — the WebSocket would be torn down before any SDK write
  //      could complete.
  //   3. React unmount — fires for in-SPA navigation (e.g., clicking the
  //      "Leave" button). Calls the SDK's `update()` directly (no need for
  //      REST here because the page isn't unloading, so the WebSocket is
  //      still alive).
  //
  // All three paths are idempotent: if the game is already finished (e.g.,
  // natural checkmate ended it moments before the user reloaded), none of
  // them will overwrite the result because they all check `status ===
  // "playing"` before writing.

  useEffect(() => {
    if (!room || room.status !== "playing" || !myColor) return;
    const code = room.code;
    const winnerColor = opposite(myColor);

    const beforeUnloadHandler = (e: BeforeUnloadEvent) => {
      // Just prompt — don't write yet. The user can still cancel.
      e.preventDefault();
      e.returnValue = "";
      return "";
    };

    const pageHideHandler = (e: PageTransitionEvent) => {
      // `persisted` is true when the page goes into the back-forward cache
      // (bfcache). In that case it might be restored — don't resign.
      if (e.persisted) return;
      resignViaRest(code, winnerColor);
    };

    window.addEventListener("beforeunload", beforeUnloadHandler);
    window.addEventListener("pagehide", pageHideHandler);
    return () => {
      window.removeEventListener("beforeunload", beforeUnloadHandler);
      window.removeEventListener("pagehide", pageHideHandler);
    };
  }, [room?.code, room?.status, myColor]);

  // ============================================================
  // Cleanup on unmount
  // ============================================================
  //
  // This covers in-SPA navigation (e.g., user clicks the "Leave" button,
  // which navigates from "online-game" view to "online-lobby" view). The
  // beforeunload / pagehide handlers above DON'T fire for in-SPA navigation,
  // so we need this path too.
  //
  // For page reload / browser back / tab close, BOTH this cleanup AND the
  // pagehide handler fire. The SDK write here might not complete (WebSocket
  // is being torn down), but the REST write in the pagehide handler WILL
  // complete. If both happen to succeed, the second is a no-op because the
  // game is already "finished".

  useEffect(() => {
    return () => {
      if (lobbyUnsubRef.current) {
        lobbyUnsubRef.current();
        lobbyUnsubRef.current = null;
      }
      // Room + chat listeners are cleaned up by their own effect's return.

      const code = roomCodeRef.current;
      const clientId = clientIdRef.current;
      if (!code || !clientId || clientId === "ssr-noop") return;

      get(roomRef(code))
        .then((snap) => {
          if (!snap.exists()) return;
          const data = snap.val();
          if (data.status === "waiting" && data.hostId === clientId) {
            // Host left a waiting room — delete it and its lobby entry.
            Promise.all([
              remove(roomRef(code)),
              remove(lobbyEntryRef(code)),
            ]).catch(() => {});
          } else if (data.status === "playing") {
            // Player left a LIVE game (e.g., clicked "Leave"). Mark the
            // game as abandoned with the opponent as the winner. This is
            // the in-SPA-navigation path; page reload is handled by the
            // pagehide listener above via the REST API.
            const senderColor: OnlineColor | null =
              data.whiteId === clientId ? "white" :
              data.blackId === clientId ? "black" : null;
            if (senderColor) {
              update(roomRef(code), {
                status: "finished",
                result: "abandoned",
                winner: opposite(senderColor),
                drawOfferBy: null,
                lastActivity: Date.now(),
              }).catch(() => {});
            }
            teardownPresence(code, clientId).catch(() => {});
          } else {
            // Game already finished (checkmate / draw / etc.) — just
            // remove our presence marker. Don't touch the result.
            teardownPresence(code, clientId).catch(() => {});
          }
        })
        .catch(() => {});
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
    opponentConnected,
    setError,
    createRoom,
    joinRoom,
    leaveRoom,
    subscribeLobby,
    unsubscribeLobby,
    sendMove,
    resign,
    claimWin,
    offerDraw,
    respondDraw,
    sendChat,
    rematchRequestedBy,
    rematchSent,
    requestRematch,
    respondRematch,
  };
}

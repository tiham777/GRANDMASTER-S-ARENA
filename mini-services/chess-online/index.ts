/**
 * Chess Online — socket.io mini-service for real-time multiplayer chess.
 *
 * Runs on a FIXED port 3001 (hardcoded, never read from env, per the
 * mini-service rules). The Next.js frontend connects through the Caddy
 * gateway using `io("/?XTransformPort=3001")` — the path MUST be "/" so
 * Caddy can route it; the real port travels in the `XTransformPort` query.
 *
 * All game state is held in-memory (a `Map<code, OnlineRoom>`). When the
 * service restarts, in-progress games are lost — by design. Move legality
 * is enforced server-side with chess.js so clients cannot cheat.
 *
 * @module chess-online
 */

import { createServer, type Server as HttpServer } from 'http'
import { Server, type Socket } from 'socket.io'
import { Chess, type Color } from 'chess.js'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Fixed port — hardcoded, NOT from env (per mini-service rules). */
const PORT = 3001

/** Room-code alphabet — excludes confusable chars 0/O/1/I. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 6

/** Waiting rooms with no activity for this long are purged. */
const WAITING_ROOM_TTL_MS = 30 * 60 * 1000 // 30 minutes

/** Finished rooms are purged after this long (avoids unbounded memory growth). */
const FINISHED_ROOM_TTL_MS = 60 * 60 * 1000 // 1 hour

/** How often the cleanup heartbeat runs. */
const CLEANUP_INTERVAL_MS = 60 * 1000 // 60 seconds

/** Max chat message length (after trim). */
const MAX_CHAT_LENGTH = 200

/** Chat rate-limit: max this many messages per window per socket. */
const CHAT_RATE_LIMIT = 8
const CHAT_RATE_WINDOW_MS = 5000

/** Max player display-name length. */
const MAX_NAME_LENGTH = 24

/** socket.io room used to broadcast the open-room lobby list. */
const LOBBY_ROOM = '__lobby__'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type HostColor = 'white' | 'black' | 'random'
type PlayerColor = 'white' | 'black'
type RoomStatus = 'waiting' | 'playing' | 'finished'
type GameResult = 'checkmate' | 'resign' | 'draw' | 'timeout' | 'abandoned'

interface MoveRecord {
  from: string
  to: string
  promotion?: string
  san: string
  at: number
}

interface OnlineRoom {
  code: string
  hostId: string
  hostName: string
  hostColor: HostColor
  guestId?: string
  guestName?: string
  whiteId?: string
  blackId?: string
  fen: string
  pgn: string
  moves: MoveRecord[]
  status: RoomStatus
  result?: GameResult
  winner?: PlayerColor | 'draw'
  drawOfferBy?: PlayerColor
  timeControlId: string
  hostPreferences?: Record<string, unknown>
  createdAt: number
  lastActivity: number
}

// Client → Server payload types (defensive — validated at runtime).
interface RoomCreatePayload {
  hostName: string
  hostColor: HostColor
  timeControlId: string
  hostPreferences?: Record<string, unknown>
}
interface RoomJoinPayload {
  code: string
  guestName: string
}
interface RoomLeavePayload {
  code: string
}
interface GameMovePayload {
  code: string
  from: string
  to: string
  promotion?: string
}
interface GameResignPayload {
  code: string
}
interface GameDrawOfferPayload {
  code: string
}
interface GameDrawRespondPayload {
  code: string
  accept: boolean
}
interface GameChatPayload {
  code: string
  message: string
}

interface LobbyEntry {
  code: string
  hostName: string
  hostColor: HostColor
  createdAt: number
}

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

const rooms = new Map<string, OnlineRoom>()
/** Per-socket sliding-window chat timestamps for rate limiting. */
const chatTimestamps = new Map<string, number[]>()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a unique 6-char uppercase room code (no 0/O/1/I). */
function generateRoomCode(): string {
  let code: string
  do {
    code = ''
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
    }
  } while (rooms.has(code))
  return code
}

/** Sanitize a player display name (trim + cap length + fallback). */
function sanitizeName(raw: unknown, fallback: string): string {
  const trimmed = (typeof raw === 'string' ? raw : String(raw ?? ''))
    .trim()
    .slice(0, MAX_NAME_LENGTH)
  return trimmed || fallback
}

/** Coerce a value into a valid HostColor (default 'random'). */
function coerceHostColor(raw: unknown): HostColor {
  return raw === 'white' || raw === 'black' || raw === 'random' ? raw : 'random'
}

/** Resolve host/guest colors when a guest joins. */
function resolveColors(
  hostColor: HostColor
): { host: PlayerColor; guest: PlayerColor } {
  if (hostColor === 'random') {
    return Math.random() < 0.5
      ? { host: 'white', guest: 'black' }
      : { host: 'black', guest: 'white' }
  }
  return hostColor === 'white'
    ? { host: 'white', guest: 'black' }
    : { host: 'black', guest: 'white' }
}

/** Convert chess.js turn ('w'/'b') to our PlayerColor ('white'/'black'). */
function turnToColor(turn: Color): PlayerColor {
  return turn === 'w' ? 'white' : 'black'
}

/** Determine a socket's color in a room, or null if not a player. */
function playerColorInRoom(
  room: OnlineRoom,
  socketId: string
): PlayerColor | null {
  if (room.whiteId === socketId) return 'white'
  if (room.blackId === socketId) return 'black'
  return null
}

/** The opposite color. */
function opposite(color: PlayerColor): PlayerColor {
  return color === 'white' ? 'black' : 'white'
}

/** Trim a room down to its public lobby summary. */
function roomToLobbyEntry(room: OnlineRoom): LobbyEntry {
  return {
    code: room.code,
    hostName: room.hostName,
    hostColor: room.hostColor,
    createdAt: room.createdAt,
  }
}

/** Collect current open (waiting) rooms for the lobby list. */
function currentLobbyList(): LobbyEntry[] {
  return Array.from(rooms.values())
    .filter((r) => r.status === 'waiting')
    .map(roomToLobbyEntry)
}

/** Push the current open-room list to every lobby subscriber. */
function broadcastLobby(): void {
  io.to(LOBBY_ROOM).emit('room:list', { rooms: currentLobbyList() })
}

/** Mark a room finished and fill in result/winner; clears draw offers. */
function finishRoom(
  room: OnlineRoom,
  result: GameResult,
  winner: PlayerColor | 'draw'
): void {
  room.status = 'finished'
  room.result = result
  room.winner = winner
  room.drawOfferBy = undefined
  room.lastActivity = Date.now()
}

/**
 * Loose chat rate-limit check. Returns true if the message is allowed,
 * false if the sender is being too chatty.
 */
function chatAllowed(socketId: string): boolean {
  const now = Date.now()
  const cutoff = now - CHAT_RATE_WINDOW_MS
  const stamps = (chatTimestamps.get(socketId) ?? []).filter((t) => t > cutoff)
  if (stamps.length >= CHAT_RATE_LIMIT) {
    chatTimestamps.set(socketId, stamps)
    return false
  }
  stamps.push(now)
  chatTimestamps.set(socketId, stamps)
  return true
}

/**
 * Handle a socket leaving a room (via `room:leave` or `disconnect`).
 *
 * - Waiting room + host leaves → delete room + refresh lobby.
 * - Playing game + player leaves → opponent wins by abandonment, other
 *   player is notified with `game:ended`.
 * - Finished room → nothing to do.
 */
function handleLeave(socket: Socket, room: OnlineRoom, reason: GameResult): void {
  const isHost = room.hostId === socket.id
  const isGuest = room.guestId === socket.id
  if (!isHost && !isGuest) return

  // Best-effort leave of the socket.io room (no-op if already disconnected).
  try {
    socket.leave(room.code)
  } catch {
    /* ignore */
  }

  if (room.status === 'waiting') {
    rooms.delete(room.code)
    broadcastLobby()
    console.log(`[leave] ${room.code} waiting room deleted by ${socket.id}`)
    return
  }

  if (room.status === 'playing') {
    const senderColor = playerColorInRoom(room, socket.id)
    if (!senderColor) return
    finishRoom(room, reason, opposite(senderColor))
    const otherId = senderColor === 'white' ? room.blackId : room.whiteId
    if (otherId) {
      io.to(otherId).emit('game:ended', { room })
    }
    console.log(
      `[leave] ${room.code} ${reason} by ${senderColor} (${socket.id}) → ${opposite(senderColor)} wins`
    )
    return
  }

  // Already finished — nothing meaningful to do.
}

// ---------------------------------------------------------------------------
// Cleanup heartbeat
// ---------------------------------------------------------------------------

/** Periodically purge stale waiting rooms (and very old finished rooms). */
function cleanupStaleRooms(): void {
  const now = Date.now()
  let purged = 0
  let lobbyChanged = false
  for (const [code, room] of rooms) {
    const idle = now - room.lastActivity
    if (room.status === 'waiting' && idle > WAITING_ROOM_TTL_MS) {
      rooms.delete(code)
      purged++
      lobbyChanged = true
    } else if (room.status === 'finished' && idle > FINISHED_ROOM_TTL_MS) {
      rooms.delete(code)
      purged++
    }
  }
  if (lobbyChanged) broadcastLobby()
  if (purged > 0) {
    console.log(`[cleanup] purged ${purged} stale room(s); ${rooms.size} remain`)
  }
}

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

const httpServer: HttpServer = createServer()

/**
 * socket.io server for online multiplayer chess.
 *
 * CORS is wide open (`{ origin: "*" }`) — the Caddy gateway sits in front
 * and handles domain/routing concerns. The socket path is "/" (required by
 * Caddy) and the frontend targets `io("/?XTransformPort=3001")`.
 *
 * `pingTimeout` / `pingInterval` are tuned for the kind of flaky mobile
 * connections online chess tends to attract.
 */
const io = new Server(httpServer, {
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
})

// Log low-level transport errors so they don't disappear silently.
io.engine.on('connection_error', (err: unknown) => {
  console.error('[engine] connection error:', err)
})

/**
 * Connection handler — wires up every client→server event for one socket.
 *
 * Each handler is wrapped in try/catch so a single bad payload can never
 * crash the whole server. The `disconnect` handler cleans up any rooms the
 * socket was part of, marking live games as abandoned with the opponent as
 * the winner.
 */
io.on('connection', (socket: Socket) => {
  console.log(`[connect] ${socket.id}`)

  // ---- Room: create --------------------------------------------------------
  socket.on('room:create', (payload: RoomCreatePayload) => {
    try {
      const hostName = sanitizeName(payload?.hostName, 'Host')
      const hostColor = coerceHostColor(payload?.hostColor)
      const timeControlId = (payload?.timeControlId ?? 'unlimited')
        .toString()
        .slice(0, 32)

      // Store the host's visual preferences (board theme, piece set, etc.)
      // so the joining player's board can auto-match.
      const hostPreferences = payload?.hostPreferences ?? undefined

      const code = generateRoomCode()
      const now = Date.now()
      const startingFen = new Chess().fen()
      const room: OnlineRoom = {
        code,
        hostId: socket.id,
        hostName,
        hostColor,
        fen: startingFen,
        pgn: '',
        moves: [],
        status: 'waiting',
        timeControlId,
        hostPreferences,
        createdAt: now,
        lastActivity: now,
      }
      rooms.set(code, room)
      socket.join(code)
      socket.emit('room:created', { code, room })
      broadcastLobby()
      console.log(
        `[room:create] ${socket.id} created ${code} (host="${hostName}", color=${hostColor}, tc=${timeControlId})`
      )
    } catch (err) {
      console.error('[room:create] error', err)
      socket.emit('room:error', { message: 'Failed to create room' })
    }
  })

  // ---- Room: join ----------------------------------------------------------
  socket.on('room:join', (payload: RoomJoinPayload) => {
    try {
      const code = (payload?.code ?? '').toString().toUpperCase().trim()
      const guestName = sanitizeName(payload?.guestName, 'Guest')
      if (!code) {
        socket.emit('room:joined', { ok: false, error: 'Missing room code' })
        return
      }
      const room = rooms.get(code)
      if (!room) {
        socket.emit('room:joined', { ok: false, error: 'Room not found' })
        return
      }
      if (room.status !== 'waiting') {
        socket.emit('room:joined', { ok: false, error: 'Game already started' })
        return
      }
      if (room.guestId) {
        socket.emit('room:joined', { ok: false, error: 'Room is full' })
        return
      }
      if (room.hostId === socket.id) {
        socket.emit('room:joined', { ok: false, error: 'You are already the host' })
        return
      }

      // Resolve colors and start the game.
      const { host: hostColor, guest: guestColor } = resolveColors(room.hostColor)
      room.guestId = socket.id
      room.guestName = guestName
      if (hostColor === 'white') {
        room.whiteId = room.hostId
        room.blackId = socket.id
      } else {
        room.whiteId = socket.id
        room.blackId = room.hostId
      }
      room.status = 'playing'
      room.lastActivity = Date.now()
      socket.join(code)

      socket.emit('room:joined', { ok: true, room })
      io.to(code).emit('game:start', { room })
      broadcastLobby()
      console.log(
        `[room:join] ${socket.id} joined ${code} as ${guestColor} ("${guestName}"); game started`
      )
    } catch (err) {
      console.error('[room:join] error', err)
      socket.emit('room:joined', { ok: false, error: 'Failed to join room' })
    }
  })

  // ---- Room: leave ---------------------------------------------------------
  socket.on('room:leave', (payload: RoomLeavePayload) => {
    try {
      const code = (payload?.code ?? '').toString().toUpperCase().trim()
      const room = rooms.get(code)
      if (!room) return
      handleLeave(socket, room, 'abandoned')
    } catch (err) {
      console.error('[room:leave] error', err)
    }
  })

  // ---- Room: rejoin (reconnection support) --------------------------------
  // When a client's socket reconnects (new id), it emits room:rejoin with the
  // code + name it had before. We re-associate the new socket id with the
  // player's role and re-add it to the socket.io room, then re-send state.
  socket.on('room:rejoin', (payload: { code?: string; name?: string }) => {
    try {
      const code = (payload?.code ?? '').toString().toUpperCase().trim()
      const name = sanitizeName(payload?.name, 'Player')
      const room = rooms.get(code)
      if (!room) {
        socket.emit('room:joined', { ok: false, error: 'Room not found' })
        return
      }
      // Only allow rejoin if the game is playing or finished (not waiting,
      // where a fresh room:create is the right flow).
      if (room.status === 'waiting') {
        socket.emit('room:joined', { ok: false, error: 'Room is still waiting' })
        return
      }
      // Re-associate by name (the host or guest name).
      const isHost = room.hostName === name
      const isGuest = room.guestName === name
      if (!isHost && !isGuest) {
        socket.emit('room:joined', { ok: false, error: 'Not a player in this room' })
        return
      }
      // Update the socket id for the player's color and re-join the room.
      if (isHost) {
        room.hostId = socket.id
        if (room.whiteId !== room.guestId) room.whiteId = socket.id
        else room.blackId = socket.id
      } else {
        room.guestId = socket.id
        if (room.whiteId !== room.hostId) room.whiteId = socket.id
        else room.blackId = socket.id
      }
      socket.join(code)
      // Re-send the current game state to this socket.
      socket.emit('room:joined', { ok: true, room })
      if (room.status === 'playing') {
        socket.emit('game:start', { room })
      }
      console.log(`[room:rejoin] ${socket.id} re-joined ${code} as ${isHost ? 'host' : 'guest'} ("${name}")`)
    } catch (err) {
      console.error('[room:rejoin] error', err)
      socket.emit('room:joined', { ok: false, error: 'Failed to rejoin room' })
    }
  })

  // ---- Lobby subscribe / unsubscribe --------------------------------------
  socket.on('room:list:subscribe', () => {
    try {
      socket.join(LOBBY_ROOM)
      socket.emit('room:list', { rooms: currentLobbyList() })
    } catch (err) {
      console.error('[room:list:subscribe] error', err)
    }
  })

  socket.on('room:list:unsubscribe', () => {
    try {
      socket.leave(LOBBY_ROOM)
    } catch (err) {
      console.error('[room:list:unsubscribe] error', err)
    }
  })

  // ---- Game: move ----------------------------------------------------------
  socket.on('game:move', (payload: GameMovePayload) => {
    try {
      const code = (payload?.code ?? '').toString().toUpperCase().trim()
      const room = rooms.get(code)
      if (!room) {
        socket.emit('room:error', { message: 'Room not found' })
        return
      }
      if (room.status !== 'playing') {
        socket.emit('room:error', { message: 'Game is not in progress' })
        return
      }
      const senderColor = playerColorInRoom(room, socket.id)
      if (!senderColor) {
        socket.emit('room:error', { message: 'You are not a player in this room' })
        return
      }

      const from = (payload?.from ?? '').toString()
      const to = (payload?.to ?? '').toString()
      const promotion = payload?.promotion
        ? payload.promotion.toString()
        : undefined

      // Server-side move validation (anti-cheat). Load the room's FEN,
      // verify it's the sender's turn, then attempt the move.
      const chess = new Chess(room.fen)
      if (turnToColor(chess.turn()) !== senderColor) {
        socket.emit('room:error', { message: 'Not your turn' })
        return
      }

      let moveResult
      try {
        moveResult = chess.move({ from, to, promotion })
      } catch {
        // chess.js throws on illegal / malformed moves.
        socket.emit('room:error', { message: 'Illegal move' })
        return
      }

      // Commit the move to room state.
      room.fen = chess.fen()
      room.pgn = chess.pgn()
      room.moves.push({
        from,
        to,
        promotion,
        san: moveResult.san,
        at: Date.now(),
      })
      room.lastActivity = Date.now()

      // Detect terminal conditions.
      let status: RoomStatus = 'playing'
      let winner: PlayerColor | 'draw' | undefined
      let result: GameResult | undefined
      if (chess.isCheckmate()) {
        status = 'finished'
        winner = senderColor
        result = 'checkmate'
      } else if (
        chess.isStalemate() ||
        chess.isInsufficientMaterial() ||
        chess.isThreefoldRepetition() ||
        chess.isDraw()
      ) {
        status = 'finished'
        winner = 'draw'
        result = 'draw'
      }

      const moveBroadcast = {
        from,
        to,
        promotion,
        san: moveResult.san,
        fen: room.fen,
        pgn: room.pgn,
        status,
        winner,
      }
      io.to(code).emit('game:move', moveBroadcast)

      if (status === 'finished') {
        finishRoom(room, result as GameResult, winner as PlayerColor | 'draw')
        io.to(code).emit('game:ended', { room })
        console.log(
          `[game:move] ${code} ${moveResult.san} → ended (${result}) winner=${winner}`
        )
      } else {
        console.log(`[game:move] ${code} ${moveResult.san}`)
      }
    } catch (err) {
      console.error('[game:move] error', err)
      socket.emit('room:error', { message: 'Server error processing move' })
    }
  })

  // ---- Game: resign --------------------------------------------------------
  socket.on('game:resign', (payload: GameResignPayload) => {
    try {
      const code = (payload?.code ?? '').toString().toUpperCase().trim()
      const room = rooms.get(code)
      if (!room) return
      if (room.status !== 'playing') {
        socket.emit('room:error', { message: 'Game is not in progress' })
        return
      }
      const senderColor = playerColorInRoom(room, socket.id)
      if (!senderColor) {
        socket.emit('room:error', { message: 'You are not a player in this room' })
        return
      }
      finishRoom(room, 'resign', opposite(senderColor))
      io.to(code).emit('game:ended', { room })
      console.log(
        `[game:resign] ${code} ${senderColor} resigned → ${opposite(senderColor)} wins`
      )
    } catch (err) {
      console.error('[game:resign] error', err)
    }
  })

  // ---- Game: draw offer ----------------------------------------------------
  socket.on('game:draw:offer', (payload: GameDrawOfferPayload) => {
    try {
      const code = (payload?.code ?? '').toString().toUpperCase().trim()
      const room = rooms.get(code)
      if (!room) return
      if (room.status !== 'playing') {
        socket.emit('room:error', { message: 'Game is not in progress' })
        return
      }
      const senderColor = playerColorInRoom(room, socket.id)
      if (!senderColor) {
        socket.emit('room:error', { message: 'You are not a player in this room' })
        return
      }
      room.drawOfferBy = senderColor
      room.lastActivity = Date.now()
      const opponentId =
        senderColor === 'white' ? room.blackId : room.whiteId
      if (opponentId) {
        io.to(opponentId).emit('game:draw:offered', { by: senderColor })
      }
      console.log(`[game:draw:offer] ${code} ${senderColor} offered draw`)
    } catch (err) {
      console.error('[game:draw:offer] error', err)
    }
  })

  // ---- Game: draw respond --------------------------------------------------
  socket.on('game:draw:respond', (payload: GameDrawRespondPayload) => {
    try {
      const code = (payload?.code ?? '').toString().toUpperCase().trim()
      const accept = Boolean(payload?.accept)
      const room = rooms.get(code)
      if (!room) return
      if (room.status !== 'playing') {
        socket.emit('room:error', { message: 'Game is not in progress' })
        return
      }
      const senderColor = playerColorInRoom(room, socket.id)
      if (!senderColor) {
        socket.emit('room:error', { message: 'You are not a player in this room' })
        return
      }
      if (!room.drawOfferBy || room.drawOfferBy === senderColor) {
        socket.emit('room:error', { message: 'No draw offer to respond to' })
        return
      }
      const offererColor = room.drawOfferBy
      const offererId = offererColor === 'white' ? room.whiteId : room.blackId

      if (accept) {
        finishRoom(room, 'draw', 'draw')
        io.to(code).emit('game:ended', { room })
        console.log(`[game:draw:respond] ${code} draw accepted`)
      } else {
        room.drawOfferBy = undefined
        room.lastActivity = Date.now()
        if (offererId) {
          io.to(offererId).emit('game:draw:declined', {})
        }
        console.log(`[game:draw:respond] ${code} draw declined`)
      }
    } catch (err) {
      console.error('[game:draw:respond] error', err)
    }
  })

  // ---- Game: chat ----------------------------------------------------------
  socket.on('game:chat', (payload: GameChatPayload) => {
    try {
      const code = (payload?.code ?? '').toString().toUpperCase().trim()
      const room = rooms.get(code)
      if (!room) return
      const senderColor = playerColorInRoom(room, socket.id)
      if (!senderColor) {
        socket.emit('room:error', { message: 'You are not a player in this room' })
        return
      }
      const message = (payload?.message ?? '')
        .toString()
        .trim()
        .slice(0, MAX_CHAT_LENGTH)
      if (!message) return
      if (!chatAllowed(socket.id)) {
        socket.emit('room:error', { message: 'Slow down — too many messages' })
        return
      }
      const name =
        socket.id === room.hostId
          ? room.hostName
          : room.guestName ?? 'Guest'
      io.to(code).emit('game:chat', {
        from: senderColor,
        name,
        message,
        at: Date.now(),
      })
    } catch (err) {
      console.error('[game:chat] error', err)
    }
  })

  // ---- Game: rematch request -----------------------------------------------
  socket.on('rematch:request', (payload: { code?: string }) => {
    try {
      const code = (payload?.code ?? '').toString().toUpperCase().trim()
      const room = rooms.get(code)
      if (!room) {
        socket.emit('room:error', { message: 'Room not found' })
        return
      }
      if (room.status !== 'finished') {
        socket.emit('room:error', { message: 'Game not finished yet' })
        return
      }
      const isHost = socket.id === room.hostId
      const isGuest = socket.id === room.guestId
      if (!isHost && !isGuest) {
        socket.emit('room:error', { message: 'Not a player in this room' })
        return
      }
      const senderColor: PlayerColor | undefined =
        socket.id === room.whiteId ? 'white' : socket.id === room.blackId ? 'black' : undefined
      // Notify the other player
      io.to(code).emit('rematch:requested', { by: senderColor })
      console.log(`[rematch:request] ${code} ${senderColor} requested rematch`)
    } catch (err) {
      console.error('[rematch:request] error', err)
    }
  })

  // ---- Game: rematch respond -----------------------------------------------
  socket.on('rematch:respond', (payload: { code?: string; accept?: boolean }) => {
    try {
      const code = (payload?.code ?? '').toString().toUpperCase().trim()
      const accept = !!payload?.accept
      const room = rooms.get(code)
      if (!room) return

      if (!accept) {
        io.to(code).emit('rematch:declined', {})
        console.log(`[rematch:respond] ${code} rematch declined`)
        return
      }

      // Accept: start a new game with same players, swapped colors.
      const startingFen = new Chess().fen()
      // Swap colors from the previous game.
      const prevWhiteId = room.whiteId
      const prevBlackId = room.blackId
      room.whiteId = prevBlackId
      room.blackId = prevWhiteId
      room.fen = startingFen
      room.pgn = ''
      room.moves = []
      room.status = 'playing'
      room.result = undefined
      room.winner = undefined
      room.drawOfferBy = undefined
      room.lastActivity = Date.now()

      io.to(code).emit('game:start', { room })
      console.log(`[rematch:respond] ${code} rematch accepted — new game started (colors swapped)`)
    } catch (err) {
      console.error('[rematch:respond] error', err)
    }
  })

  // ---- disconnect ----------------------------------------------------------
  socket.on('disconnect', () => {
    console.log(`[disconnect] ${socket.id}`)
    chatTimestamps.delete(socket.id)
    // Iterate over a snapshot since handleLeave mutates `rooms`.
    for (const room of Array.from(rooms.values())) {
      if (room.hostId !== socket.id && room.guestId !== socket.id) continue
      handleLeave(socket, room, 'abandoned')
    }
  })

  // ---- socket-level error --------------------------------------------------
  socket.on('error', (err: unknown) => {
    console.error(`[socket error] ${socket.id}:`, err)
  })
})

// ---------------------------------------------------------------------------
// Heartbeat + startup
// ---------------------------------------------------------------------------

const cleanupTimer = setInterval(cleanupStaleRooms, CLEANUP_INTERVAL_MS)
// Don't keep the event loop alive solely for the timer.
if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref()

httpServer.listen(PORT, () => {
  console.log(`Chess online server listening on :${PORT}`)
})

// Graceful shutdown — close the HTTP server and socket.io engine cleanly.
function shutdown(signal: string): void {
  console.log(`Received ${signal}, shutting down...`)
  clearInterval(cleanupTimer)
  io.close(() => {
    httpServer.close(() => {
      console.log('Chess online server closed')
      process.exit(0)
    })
  })
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

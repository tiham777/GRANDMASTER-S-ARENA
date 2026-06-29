// Shared types for the chess multiplayer app.

export type AuthProvider = "google" | "guest";

export interface UserProfile {
  uid: string;
  username: string;
  email: string | null;
  photoURL: string | null;
  provider: AuthProvider;
  isOnline: boolean;
  lastSeen: number; // epoch ms
  wins: number;
  losses: number;
  draws: number;
  createdAt: number;
}

export type ChallengeStatus =
  | "pending"   // waiting for opponent to accept
  | "accepted"  // opponent accepted, game created
  | "declined"  // opponent declined
  | "expired"   // 5 min elapsed with no answer
  | "cancelled"; // challenger cancelled

export interface Challenge {
  id: string;
  challengerUid: string;
  challengerName: string;
  challengerPhoto: string | null;
  targetUid: string;
  targetName: string;
  status: ChallengeStatus;
  createdAt: number;
  expiresAt: number; // createdAt + 5 min
  gameId?: string | null; // filled once accepted
  // Color the challenger wants to play. "white" | "black" | "random".
  // Older challenges created before this field will be treated as "white"
  // for backward compatibility.
  challengerColor?: "white" | "black" | "random";
}

export type PieceColor = "white" | "black";

export interface GameMove {
  from: string;
  to: string;
  promotion?: string;
  san: string;
  fenAfter: string;
  by: string; // uid
  at: number;
}

export type GameStatus =
  | "playing"
  | "checkmate"
  | "stalemate"
  | "draw"
  | "resigned"
  | "aborted";

export interface GameDoc {
  id: string;
  whiteUid: string;
  whiteName: string;
  blackUid: string;
  blackName: string;
  fen: string;            // current FEN
  pgn: string;            // running PGN
  turn: PieceColor;       // whose move
  status: GameStatus;
  winnerUid?: string | null;
  moves: GameMove[];
  createdAt: number;
  updatedAt: number;
  lastMoveAt: number;
  drawOfferBy?: string | null; // uid of player offering draw
  // 15-minute chess clock. Each player starts with INITIAL_TIME_MS.
  // These are updated on every move via submitMove (elapsed time is
  // deducted from the player who just moved). 0 = flag falls.
  whiteTimeLeftMs?: number;
  blackTimeLeftMs?: number;
}

export const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const INITIAL_TIME_MS = 15 * 60 * 1000;  // 15-minute rapid clock

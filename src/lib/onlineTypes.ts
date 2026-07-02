/**
 * onlineTypes.ts — shared types for the online multiplayer mode.
 *
 * Mirrors the server's `OnlineRoom` shape (minus server-only fields like
 * socket ids, which the client doesn't need). The client learns its own
 * color by comparing `socket.id` to `room.whiteId` / `room.blackId`.
 */

export type OnlineColor = "white" | "black";

export interface OnlineMove {
  from: string;
  to: string;
  promotion?: string;
  san: string;
  at: number;
}

export interface OnlineRoom {
  code: string;
  hostName: string;
  hostColor: "white" | "black" | "random";
  guestName?: string;
  whiteId?: string;
  blackId?: string;
  fen: string;
  pgn: string;
  moves: OnlineMove[];
  status: "waiting" | "playing" | "finished";
  result?: "checkmate" | "resign" | "draw" | "timeout" | "abandoned";
  winner?: OnlineColor | "draw";
  drawOfferBy?: OnlineColor;
  timeControlId: string;
  hostPreferences?: {
    boardTheme?: string;
    pieceSet?: string;
    boardBorder?: boolean;
    showCoordinates?: boolean;
    showLegalMoves?: boolean;
    highlightLastMove?: boolean;
  };
  createdAt: number;
  lastActivity: number;
}

export interface OnlineLobbyRoom {
  code: string;
  hostName: string;
  hostColor: "white" | "black" | "random";
  createdAt: number;
}

export interface OnlineChatMessage {
  from: OnlineColor;
  name: string;
  message: string;
  at: number;
}

/** Result of attempting to create or join a room. */
export interface OnlineRoomResult {
  ok: boolean;
  room?: OnlineRoom;
  error?: string;
}

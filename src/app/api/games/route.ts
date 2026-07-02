/**
 * /api/games — CRUD for completed chess games.
 *
 * GET    /api/games          → list recent games (query: ?limit=20)
 * POST   /api/games          → save a completed game, returns { id }
 *
 * All routes use Prisma (SQLite). No auth — this is a single-user
 * local app.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/games?limit=20 — list recent games, newest first. */
export async function GET(req: NextRequest) {
  try {
    const limitParam = req.nextUrl.searchParams.get("limit");
    const limit = Math.min(100, Math.max(1, Number(limitParam) || 20));

    const games = await db.game.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        mode: true,
        playerColor: true,
        difficulty: true,
        result: true,
        winner: true,
        moveCount: true,
        durationSec: true,
        opening: true,
        createdAt: true,
      },
    });
    return NextResponse.json({ games });
  } catch (err) {
    console.error("[GET /api/games] error:", err);
    return NextResponse.json({ error: "Failed to list games" }, { status: 500 });
  }
}

/** POST /api/games — save a completed game. Returns { id }. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      mode,
      playerColor,
      difficulty,
      result,
      winner,
      pgn,
      fen,
      moveCount,
      durationSec,
      opening,
    } = body ?? {};

    // Basic validation.
    if (typeof pgn !== "string" || typeof result !== "string" || typeof mode !== "string") {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const game = await db.game.create({
      data: {
        mode: String(mode),
        playerColor: playerColor ?? null,
        difficulty: difficulty ?? null,
        result: String(result),
        winner: winner ?? null,
        pgn: String(pgn),
        fen: String(fen ?? ""),
        moveCount: Number(moveCount) || 0,
        durationSec: Number(durationSec) || 0,
        opening: opening ?? null,
      },
    });

    // Update aggregate stats. "main" is the single-row stats record.
    const stats = await db.playerStats.upsert({
      where: { id: "main" },
      update: {},
      create: { id: "main" },
    });

    const isHumanWin =
      mode === "ai" &&
      playerColor &&
      winner &&
      winner === playerColor;
    const isHumanLoss =
      mode === "ai" &&
      playerColor &&
      winner &&
      winner !== playerColor &&
      winner !== "draw";
    const isDraw = winner === "draw" || result === "draw" || result === "stalemate";

    const newStreak = isHumanWin
      ? Math.max(1, stats.currentStreak + 1)
      : isHumanLoss
        ? Math.min(-1, stats.currentStreak - 1)
        : stats.currentStreak;
    const bestStreak = Math.max(stats.bestStreak, Math.max(0, newStreak));

    const newGamesPlayed = stats.gamesPlayed + 1;
    const newWins = stats.wins + (isHumanWin ? 1 : 0);
    const newLosses = stats.losses + (isHumanLoss ? 1 : 0);
    const newDraws = stats.draws + (isDraw ? 1 : 0);
    // Running average of moves per game.
    const newAvg =
      (stats.avgMovesPerGame * stats.gamesPlayed + (Number(moveCount) || 0)) /
      newGamesPlayed;

    await db.playerStats.update({
      where: { id: "main" },
      data: {
        gamesPlayed: newGamesPlayed,
        wins: newWins,
        losses: newLosses,
        draws: newDraws,
        currentStreak: newStreak,
        bestStreak: bestStreak,
        avgMovesPerGame: newAvg,
      },
    });

    return NextResponse.json({ id: game.id });
  } catch (err) {
    console.error("[POST /api/games] error:", err);
    return NextResponse.json({ error: "Failed to save game" }, { status: 500 });
  }
}

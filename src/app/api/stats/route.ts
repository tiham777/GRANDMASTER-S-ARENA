/**
 * /api/stats — aggregate player stats (single-row record).
 *
 * GET  /api/stats  → { gamesPlayed, wins, losses, draws, currentStreak, bestStreak, avgMovesPerGame }
 * POST /api/stats  → reset stats to zero (admin/debug).
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const stats = await db.playerStats.upsert({
      where: { id: "main" },
      update: {},
      create: { id: "main" },
    });
    return NextResponse.json({ stats });
  } catch (err) {
    console.error("[GET /api/stats] error:", err);
    return NextResponse.json({ error: "Failed to load stats" }, { status: 500 });
  }
}

export async function POST() {
  try {
    await db.playerStats.upsert({
      where: { id: "main" },
      update: {
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        currentStreak: 0,
        bestStreak: 0,
        avgMovesPerGame: 0,
      },
      create: { id: "main" },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[POST /api/stats] error:", err);
    return NextResponse.json({ error: "Failed to reset stats" }, { status: 500 });
  }
}

/**
 * /api/games/[id] — fetch a single saved game by id.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const game = await db.game.findUnique({ where: { id } });
    if (!game) {
      return NextResponse.json({ error: "Game not found" }, { status: 404 });
    }
    return NextResponse.json({ game });
  } catch (err) {
    console.error("[GET /api/games/:id] error:", err);
    return NextResponse.json({ error: "Failed to fetch game" }, { status: 500 });
  }
}

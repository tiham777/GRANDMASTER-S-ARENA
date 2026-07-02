"use client";

/**
 * MoveHistory — scrollable two-column SAN move list with auto-scroll
 * to the latest move and click-to-preview (future feature).
 */
import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface MoveHistoryProps {
  /** Flat list of SAN move strings, e.g. ["e4", "e5", "Nf3", ...]. */
  moves: string[];
  /** Index of the "current" position (for highlight). -1 = live. */
  currentIndex?: number;
  onSelect?: (plyIndex: number) => void;
}

export function MoveHistory({ moves, currentIndex = -1, onSelect }: MoveHistoryProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the latest move.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [moves.length]);

  // Group into pairs: [whiteMove, blackMove?]
  const rows: { num: number; white?: string; whitePly: number; black?: string; blackPly: number }[] = [];
  for (let i = 0; i < moves.length; i += 2) {
    rows.push({
      num: i / 2 + 1,
      white: moves[i],
      whitePly: i,
      black: moves[i + 1],
      blackPly: i + 1,
    });
  }

  if (moves.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        No moves yet — make your first move.
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="scroll-thin h-full overflow-y-auto pr-1">
      <table className="w-full text-sm">
        <tbody>
          {rows.map((row) => {
            const whiteActive = currentIndex === row.whitePly;
            const blackActive = currentIndex === row.blackPly;
            return (
              <tr key={row.num} className="border-b border-border/40 last:border-0">
                <td className="w-8 py-1 pr-2 text-right font-mono text-xs text-muted-foreground">
                  {row.num}.
                </td>
                <td className="py-1 pr-1">
                  <button
                    type="button"
                    disabled={!onSelect}
                    onClick={() => onSelect?.(row.whitePly)}
                    className={`block w-full rounded px-1 py-0.5 text-left font-mono text-sm transition-colors ${
                      whiteActive
                        ? "bg-primary/20 text-primary-foreground"
                        : "hover:bg-accent/60"
                    } ${onSelect ? "cursor-pointer" : "cursor-default"}`}
                  >
                    {row.white ?? ""}
                  </button>
                </td>
                <td className="py-1">
                  {row.black ? (
                    <button
                      type="button"
                      disabled={!onSelect}
                      onClick={() => onSelect?.(row.blackPly)}
                      className={`block w-full rounded px-1 py-0.5 text-left font-mono text-sm transition-colors ${
                        blackActive
                          ? "bg-primary/20 text-primary-foreground"
                          : "hover:bg-accent/60"
                      } ${onSelect ? "cursor-pointer" : "cursor-default"}`}
                    >
                      {row.black}
                    </button>
                  ) : (
                    <span className="block px-1 py-0.5 text-transparent">·</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

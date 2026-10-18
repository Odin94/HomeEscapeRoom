import type { Game } from "./game-store";
import { prerequisites } from "./challenge-progress";

export function challengeGraph(game: Pick<Game, "areas">) {
  const depths = new Map<number, number>();
  const unresolved = new Set(game.areas.map((_, i) => i));
  const edges = game.areas.flatMap((area, to) =>
    prerequisites(game, to).flatMap((id) => {
      const from = game.areas.findIndex((a) => a.id === id);
      return from < 0 ? [] : [{ from, to }];
    }),
  );
  for (let round = 0; round < game.areas.length; round++) {
    let advanced = false;
    for (const index of unresolved) {
      const required = prerequisites(game, index);
      const parents = required.map((id) =>
        game.areas.findIndex((a) => a.id === id),
      );
      if (parents.every((parent) => depths.has(parent))) {
        depths.set(
          index,
          parents.length
            ? Math.max(...parents.map((p) => depths.get(p)!)) + 1
            : 0,
        );
        unresolved.delete(index);
        advanced = true;
      }
    }
    if (!advanced) break;
  }
  const fallback = Math.max(-1, ...depths.values()) + 1;
  const rows = new Map<number, number>();
  const nodes = game.areas.map((area, index) => {
    const depth = depths.get(index) ?? fallback;
    const row = rows.get(depth) || 0;
    rows.set(depth, row + 1);
    return {
      id: area.id,
      index,
      depth,
      x: 24 + depth * 250,
      y: 24 + row * 120,
      invalid: unresolved.has(index),
    };
  });
  return {
    nodes,
    edges,
    width: Math.max(260, ...nodes.map((n) => n.x + 236)),
    height: Math.max(130, ...nodes.map((n) => n.y + 110)),
    invalid: unresolved.size > 0,
  };
}

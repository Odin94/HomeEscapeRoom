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
      x: area.flowPosition?.x ?? 24 + depth * 250,
      y: area.flowPosition?.y ?? 24 + row * 120,
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

// Materialize implicit sequential links before editing so untouched links stay intact.
export function explicitFlow<T extends Pick<Game, "areas">>(game: T): T {
  return {
    ...game,
    areas: game.areas.map((area, index) => ({
      ...area,
      requires: [...prerequisites(game, index)],
    })),
  };
}
export function connectChallenges<T extends Pick<Game, "areas">>(
  game: T,
  from: number,
  to: number,
  previousTo?: number,
): T {
  if (!game.areas[from] || !game.areas[to] || from === to)
    throw new Error("Connect two different challenges.");
  const next = explicitFlow(game);
  if (previousTo !== undefined && previousTo !== to)
    next.areas[previousTo].requires = next.areas[previousTo].requires!.filter(
      (id) => id !== game.areas[from].id,
    );
  next.areas[to].requires = [
    ...new Set([...next.areas[to].requires!, game.areas[from].id]),
  ];
  if (challengeGraph(next).invalid)
    throw new Error(
      "That connection would create a cycle. Choose a later challenge.",
    );
  return next;
}
export function removeConnection<T extends Pick<Game, "areas">>(
  game: T,
  from: number,
  to: number,
): T {
  const next = explicitFlow(game);
  next.areas[to].requires = next.areas[to].requires!.filter(
    (id) => id !== game.areas[from].id,
  );
  return next;
}

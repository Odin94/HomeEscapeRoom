import type { Game } from "./game-store";

// Missing prerequisites retain the original sequential behavior. [] starts immediately.
export function prerequisites(game: Pick<Game, "areas">, index: number) {
  return (
    game.areas[index].requires ?? (index ? [game.areas[index - 1].id] : [])
  );
}
export function availableChallenges<T extends Game["areas"][number]>(
  game: { areas: T[] },
  solved: string[],
) {
  return game.areas.filter(
    (area, index) =>
      !solved.includes(area.id) &&
      prerequisites(game, index).every((id) => solved.includes(id)),
  );
}
export function revealedClues(game: Game, solved: string[]) {
  const revealed = new Set(
    game.areas
      .filter((a) => solved.includes(a.id))
      .flatMap((a) => a.revealClues || []),
  );
  return (game.clues || []).filter((c) => revealed.has(c.id));
}

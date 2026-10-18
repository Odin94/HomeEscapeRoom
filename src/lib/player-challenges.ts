import type { Area } from "./game-store";

// Discovery clues belong to the same accordion as other puzzles. A hidden
// marker without a clue remains absent until players find its physical code.
export function playerChallenges(areas: Area[]) {
  return areas.filter(
    (area) =>
      (area.kind !== "hidden" &&
        !(area.kind === "qr" && area.qrMode !== "prompted")) ||
      !!area.hint.trim(),
  );
}

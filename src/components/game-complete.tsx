export function completionStars(elapsedMs: number | null | undefined) {
  if (elapsedMs == null || !Number.isFinite(elapsedMs) || elapsedMs < 0)
    return 1;
  if (elapsedMs <= 5 * 60000) return 5;
  if (elapsedMs <= 10 * 60000) return 4;
  if (elapsedMs <= 15 * 60000) return 3;
  if (elapsedMs <= 20 * 60000) return 2;
  return 1;
}

export function GameComplete({ elapsedMs }: { elapsedMs?: number | null }) {
  const stars = completionStars(elapsedMs);
  return (
    <div className="game-complete" role="status">
      <p>Game complete!</p>
      <div
        className="completion-stars"
        role="img"
        aria-label={`${stars} out of 5 stars`}
      >
        <span aria-hidden="true">
          {"★".repeat(stars)}
          {"☆".repeat(5 - stars)}
        </span>
      </div>
    </div>
  );
}

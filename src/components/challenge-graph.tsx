import { useId } from "react";
import type { Game } from "../lib/game-store";
import { challengeGraph } from "../lib/challenge-graph";
import { prerequisites } from "../lib/challenge-progress";
import { GameMarkdown } from "./game-markdown";

export function ChallengeGraph({
  game,
  select,
}: {
  game: Pick<Game, "areas">;
  select: (index: number) => void;
}) {
  const graph = challengeGraph(game);
  const arrow = useId().replaceAll(":", "");
  return (
    <section className="challenge-graph" aria-label="Challenge flow">
      <h2>Challenge flow</h2>
      <p>
        Arrows show what unlocks next. Challenges in the same column can run in
        parallel. A challenge with several incoming arrows requires all of them.
        Select a challenge to edit it.
      </p>
      {graph.invalid && (
        <p role="alert">
          Some prerequisites are missing or form a cycle. Fix them before
          saving.
        </p>
      )}
      <div
        className="challenge-graph-scroll"
        tabIndex={0}
        aria-label="Scrollable challenge graph"
      >
        <div
          className="challenge-graph-canvas"
          style={{ width: graph.width, height: graph.height }}
        >
          <svg width={graph.width} height={graph.height} aria-hidden="true">
            <defs>
              <marker
                id={arrow}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
              </marker>
            </defs>
            {graph.edges.map(({ from, to }) => {
              const a = graph.nodes[from],
                b = graph.nodes[to];
              const x = a.x + 200,
                y = a.y + 42,
                endX = b.x - 4,
                endY = b.y + 42;
              return (
                <path
                  key={`${from}-${to}`}
                  d={`M ${x} ${y} C ${x + 26} ${y}, ${endX - 26} ${endY}, ${endX} ${endY}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  markerEnd={`url(#${arrow})`}
                />
              );
            })}
          </svg>
          {graph.nodes.map((node) => (
            <button
              type="button"
              className="challenge-graph-node"
              key={node.index}
              style={{ left: node.x, top: node.y }}
              onClick={() => select(node.index)}
              aria-label={`Edit challenge ${node.index + 1}: ${game.areas[node.index].name}`}
            >
              <span>
                <GameMarkdown inline>
                  {game.areas[node.index].name || "Unnamed challenge"}
                </GameMarkdown>
              </span>
              <small>
                {node.invalid
                  ? "Fix prerequisites"
                  : prerequisites(game, node.index).length
                    ? `After ${prerequisites(game, node.index).length} challenge${prerequisites(game, node.index).length === 1 ? "" : "s"}`
                    : "Active from start"}
              </small>
            </button>
          ))}
        </div>
      </div>
      <ol className="sr-only" aria-label="Challenge prerequisites">
        {game.areas.map((area, index) => (
          <li key={index}>
            {area.name}:{" "}
            {prerequisites(game, index)
              .map((id) => game.areas.find((a) => a.id === id)?.name || id)
              .join(", ") || "active from start"}
          </li>
        ))}
      </ol>
    </section>
  );
}

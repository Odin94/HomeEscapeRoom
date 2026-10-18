import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import type { Game } from "../lib/game-store";
import {
  challengeGraph,
  connectChallenges,
  removeConnection,
} from "../lib/challenge-graph";
import { prerequisites } from "../lib/challenge-progress";
import { GameMarkdown } from "./game-markdown";
import { Button } from "./ui";

type FlowGame = Pick<Game, "areas">;
type Drag =
  | {
      kind: "move";
      index: number;
      x: number;
      y: number;
      offsetX: number;
      offsetY: number;
    }
  | {
      kind: "connect";
      from: number;
      previousTo?: number;
      x: number;
      y: number;
    };
export function ChallengeGraph({
  game,
  select,
  change,
}: {
  game: FlowGame;
  select: (index: number) => void;
  change?: (game: FlowGame) => void;
}) {
  const graph = challengeGraph(game);
  const arrow = useId().replaceAll(":", "");
  const canvas = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [source, setSource] = useState<number | null>(null);
  const [selected, setSelected] = useState<{ from: number; to: number } | null>(
    null,
  );
  const [message, setMessage] = useState("");
  const identity = JSON.stringify(game.areas.map((area) => area.id));
  useEffect(() => {
    setDrag(null);
    setSource(null);
    setSelected(null);
  }, [identity]);
  const nodes = graph.nodes.map((node) =>
    drag?.kind === "move" && drag.index === node.index
      ? { ...node, x: drag.x, y: drag.y }
      : node,
  );
  const selectedEdge =
    selected &&
    graph.edges.some(
      (edge) => edge.from === selected.from && edge.to === selected.to,
    )
      ? selected
      : null;
  const width = Math.max(graph.width, ...nodes.map((n) => n.x + 260));
  const height = Math.max(graph.height, ...nodes.map((n) => n.y + 140));
  const point = (event: PointerEvent) => {
    const rect = canvas.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  function connect(from: number, to: number, previousTo?: number) {
    try {
      change?.(connectChallenges(game, from, to, previousTo));
      setSource(null);
      setSelected(null);
      setMessage("Connection saved in this draft.");
    } catch (error) {
      setMessage((error as Error).message);
    }
  }
  function begin(event: PointerEvent, value: Drag) {
    if (!change || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    canvas.current!.setPointerCapture(event.pointerId);
    if (value.kind === "connect")
      setSource(value.previousTo === undefined ? value.from : null);
    setDrag(value);
    setMessage("");
  }
  function finish(event: PointerEvent) {
    if (!drag) return;
    if (drag.kind === "move") {
      const p = point(event);
      change?.({
        ...game,
        areas: game.areas.map((a, i) =>
          i === drag.index
            ? {
                ...a,
                flowPosition: {
                  x: Math.round(
                    Math.max(24, Math.min(10000, p.x - drag.offsetX)),
                  ),
                  y: Math.round(
                    Math.max(24, Math.min(10000, p.y - drag.offsetY)),
                  ),
                },
              }
            : a,
        ),
      });
    } else {
      const target = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-flow-node]");
      if (
        target &&
        canvas.current?.contains(target) &&
        Number(target.dataset.flowNode) !== drag.from
      )
        connect(drag.from, Number(target.dataset.flowNode), drag.previousTo);
    }
    setDrag(null);
    if (canvas.current?.hasPointerCapture(event.pointerId))
      canvas.current.releasePointerCapture(event.pointerId);
  }
  const cancel = () => {
    setDrag(null);
    setSource(null);
  };
  return (
    <section className="challenge-graph" aria-label="Challenge flow">
      <h2>Challenge flow</h2>
      <p>
        Drag boxes to arrange the layout. Drag from an output dot to another
        challenge to add an arrow. Drag an arrow tip to reconnect it. Select an
        arrow to remove it. Arrows control unlock order; several incoming arrows
        require all of them.
      </p>
      <div className="actions">
        <Button
          type="button"
          variant="outline"
          disabled={!change}
          onClick={() => {
            cancel();
            change?.({
              ...game,
              areas: game.areas.map((a) => ({ ...a, flowPosition: undefined })),
            });
          }}
        >
          Auto arrange
        </Button>
        {source !== null && (
          <>
            <span>Connect {game.areas[source]?.name} to an input dot.</span>
            <Button type="button" variant="ghost" onClick={cancel}>
              Cancel connection
            </Button>
          </>
        )}
        {selectedEdge && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              change?.(
                removeConnection(game, selectedEdge!.from, selectedEdge!.to),
              );
              setSelected(null);
              setMessage("Connection removed from this draft.");
            }}
          >
            Remove selected arrow
          </Button>
        )}
      </div>
      {message && <p role="status">{message}</p>}
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
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            cancel();
            setSelected(null);
          }
        }}
      >
        <div
          ref={canvas}
          className="challenge-graph-canvas"
          style={{ width, height }}
          onPointerMove={(event) => {
            if (!drag) return;
            const p = point(event);
            setDrag(
              drag.kind === "move"
                ? {
                    ...drag,
                    x: Math.max(24, Math.min(10000, p.x - drag.offsetX)),
                    y: Math.max(24, Math.min(10000, p.y - drag.offsetY)),
                  }
                : { ...drag, ...p },
            );
          }}
          onPointerUp={finish}
          onPointerCancel={cancel}
          onLostPointerCapture={() => setDrag(null)}
        >
          <svg width={width} height={height} aria-label="Challenge connections">
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
              const a = nodes[from],
                b = nodes[to];
              const x = a.x + 200,
                y = a.y + 42,
                endX = b.x - 6,
                endY = b.y + 42;
              const path = `M ${x} ${y} C ${x + 35} ${y}, ${endX - 35} ${endY}, ${endX} ${endY}`;
              return (
                <g
                  key={`${from}-${to}`}
                  className={
                    selected?.from === from && selected.to === to
                      ? "flow-edge selected"
                      : "flow-edge"
                  }
                >
                  <path
                    d={path}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    markerEnd={`url(#${arrow})`}
                  />
                  <path
                    d={path}
                    fill="none"
                    stroke="transparent"
                    strokeWidth="18"
                    className="flow-edge-hit"
                    role="button"
                    tabIndex={0}
                    aria-label={`Select arrow from ${game.areas[from].name} to ${game.areas[to].name}`}
                    onClick={() => setSelected({ from, to })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelected({ from, to });
                      }
                      if (
                        (e.key === "Delete" || e.key === "Backspace") &&
                        change
                      ) {
                        e.preventDefault();
                        change(removeConnection(game, from, to));
                        setSelected(null);
                      }
                    }}
                  />
                  {change && (
                    <circle
                      cx={endX - 10}
                      cy={endY}
                      r="7"
                      className="flow-arrow-tip"
                      aria-label={`Reconnect arrow from ${game.areas[from].name} to ${game.areas[to].name}`}
                      onPointerDown={(e) =>
                        begin(e, {
                          kind: "connect",
                          from,
                          previousTo: to,
                          ...point(e),
                        })
                      }
                    />
                  )}
                </g>
              );
            })}
            {drag?.kind === "connect" && (
              <path
                className="flow-connection-preview"
                d={`M ${nodes[drag.from].x + 200} ${nodes[drag.from].y + 42} L ${drag.x} ${drag.y}`}
                fill="none"
                stroke="currentColor"
                strokeDasharray="6 4"
                strokeWidth="2"
              />
            )}
          </svg>
          {nodes.map((node) => (
            <div
              className="challenge-graph-node"
              data-flow-node={node.index}
              key={node.index}
              style={{ left: node.x, top: node.y }}
            >
              <button
                type="button"
                className="flow-move"
                disabled={!change}
                aria-label={`Move challenge ${node.index + 1}: ${game.areas[node.index].name}`}
                onPointerDown={(e) => {
                  const p = point(e);
                  begin(e, {
                    kind: "move",
                    index: node.index,
                    x: node.x,
                    y: node.y,
                    offsetX: p.x - node.x,
                    offsetY: p.y - node.y,
                  });
                }}
                onKeyDown={(e) => {
                  const offset = {
                    ArrowLeft: [-20, 0],
                    ArrowRight: [20, 0],
                    ArrowUp: [0, -20],
                    ArrowDown: [0, 20],
                  }[e.key];
                  if (!offset || !change) return;
                  e.preventDefault();
                  change({
                    ...game,
                    areas: game.areas.map((a, i) =>
                      i === node.index
                        ? {
                            ...a,
                            flowPosition: {
                              x: Math.max(
                                24,
                                Math.min(10000, node.x + offset[0]),
                              ),
                              y: Math.max(
                                24,
                                Math.min(10000, node.y + offset[1]),
                              ),
                            },
                          }
                        : a,
                    ),
                  });
                }}
              >
                ⠿ <span>Drag to move</span>
              </button>
              <button
                type="button"
                className="flow-edit"
                onClick={() => select(node.index)}
                aria-label={`Edit challenge ${node.index + 1}: ${game.areas[node.index].name}`}
              >
                <GameMarkdown inline>
                  {game.areas[node.index].name || "Unnamed challenge"}
                </GameMarkdown>
              </button>
              <small>
                {node.invalid
                  ? "Fix prerequisites"
                  : prerequisites(game, node.index).length
                    ? `After ${prerequisites(game, node.index).length} challenge${prerequisites(game, node.index).length === 1 ? "" : "s"}`
                    : "Active from start"}
              </small>
              <button
                type="button"
                className="flow-port flow-input"
                disabled={!change}
                aria-label={`Connect to ${game.areas[node.index].name}`}
                onClick={() => {
                  if (source !== null) connect(source, node.index);
                  else setMessage("Choose an output dot first.");
                }}
              />
              <button
                type="button"
                className={`flow-port flow-output ${source === node.index ? "active" : ""}`}
                disabled={!change}
                aria-label={`Connect from ${game.areas[node.index].name}`}
                onPointerDown={(e) =>
                  begin(e, { kind: "connect", from: node.index, ...point(e) })
                }
                onClick={() => {
                  setSource(node.index);
                  setMessage("");
                }}
              />
            </div>
          ))}
        </div>
      </div>
      <details>
        <summary>Connections (keyboard controls)</summary>
        {graph.edges.map(({ from, to }) => (
          <div className="flow-connection-row" key={`${from}-${to}`}>
            <span>
              {game.areas[from].name} → {game.areas[to].name}
            </span>
            <Button
              type="button"
              variant="ghost"
              disabled={!change}
              aria-label={`Remove arrow from ${game.areas[from].name} to ${game.areas[to].name}`}
              onClick={() => {
                change?.(removeConnection(game, from, to));
                setSelected(null);
              }}
            >
              Remove arrow
            </Button>
          </div>
        ))}
      </details>
    </section>
  );
}

import { useEffect, useRef, useState } from "react";
import type { Area } from "../lib/game-store";
import { GameMarkdown } from "./game-markdown";
import { Listen } from "./voice-controls";

type Direction = -1 | 1;

export function SwipeTransmission({
  story,
  previous,
  next,
  voiceEnabled,
  onNavigate,
}: {
  story: Area;
  previous?: Area;
  next?: Area;
  voiceEnabled?: boolean;
  onNavigate: (direction: Direction) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const touchStart = useRef<{
    x: number;
    y: number;
    id: number;
    axis?: "x" | "y";
  } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [offset, setOffset] = useState(0);
  const [settling, setSettling] = useState(false);
  useEffect(() => () => clearTimeout(timer.current), []);

  function settle(direction?: Direction) {
    touchStart.current = null;
    setSettling(true);
    setOffset(
      direction ? -direction * (viewport.current?.clientWidth || 0) : 0,
    );
    timer.current = setTimeout(() => {
      if (direction) onNavigate(direction);
      setOffset(0);
      setSettling(false);
    }, 220);
  }

  return (
    <div
      ref={viewport}
      className="transmission-viewport"
      onTouchStart={(event) => {
        if (
          settling ||
          event.touches.length !== 1 ||
          (event.target as Element).closest(
            "button, a, input, select, textarea, audio, video",
          )
        )
          return;
        const touch = event.touches[0];
        touchStart.current = {
          x: touch.clientX,
          y: touch.clientY,
          id: touch.identifier,
        };
      }}
      onTouchMove={(event) => {
        const start = touchStart.current;
        if (!start) return;
        if (event.touches.length !== 1) {
          settle();
          return;
        }
        const touch = Array.from(event.touches).find(
          (item) => item.identifier === start.id,
        );
        if (!touch) {
          settle();
          return;
        }
        const dx = touch.clientX - start.x;
        const dy = touch.clientY - start.y;
        if (!start.axis && Math.max(Math.abs(dx), Math.abs(dy)) > 8)
          start.axis = Math.abs(dx) > Math.abs(dy) * 1.5 ? "x" : "y";
        if (start.axis !== "x") return;
        const width = viewport.current?.clientWidth || 1;
        const atEdge = dx > 0 ? !previous : !next;
        setOffset(atEdge ? dx * 0.2 : Math.max(-width, Math.min(width, dx)));
      }}
      onTouchCancel={() => {
        if (touchStart.current) settle();
      }}
      onTouchEnd={(event) => {
        const start = touchStart.current;
        if (!start) return;
        const touch = Array.from(event.changedTouches).find(
          (item) => item.identifier === start.id,
        );
        if (!touch || event.touches.length || start.axis === "y") {
          settle();
          return;
        }
        const dx = touch.clientX - start.x;
        const dy = touch.clientY - start.y;
        const threshold = Math.min(
          60,
          (viewport.current?.clientWidth || 300) * 0.2,
        );
        const direction: Direction = dx < 0 ? 1 : -1;
        if (
          Math.abs(dx) >= threshold &&
          Math.abs(dx) > Math.abs(dy) * 1.5 &&
          (direction === 1 ? next : previous)
        )
          settle(direction);
        else settle();
      }}
    >
      <div
        className={`transmission-track${settling ? " is-settling" : ""}`}
        style={{ transform: `translate3d(${offset}px, 0, 0)` }}
      >
        {previous && (
          <div
            className="transmission-neighbor transmission-previous"
            aria-hidden="true"
            inert
          >
            <GameMarkdown>{previous.description}</GameMarkdown>
          </div>
        )}
        <div className="transmission-current">
          <GameMarkdown>{story.description}</GameMarkdown>
          {voiceEnabled && <Listen source="story" contentId={story.id} />}
        </div>
        {next && (
          <div
            className="transmission-neighbor transmission-next"
            aria-hidden="true"
            inert
          >
            <GameMarkdown>{next.description}</GameMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import type { State } from "../lib/game-store";
type Timer = NonNullable<State["player"]>["session"]["timer"];
export function GameTimer({ timer }: { timer: Timer }) {
  return timer ? <Countdown key={timer.measuredAt} timer={timer} /> : null;
}
function Countdown({ timer }: { timer: NonNullable<Timer> }) {
  const [started] = useState(Date.now);
  const [now, setNow] = useState(started);
  useEffect(() => {
    if (!timer?.running) return;
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, [timer?.running]);
  if (!timer) return null;
  const seconds = Math.ceil(
    Math.max(
      0,
      timer.remainingMs - (timer.running ? Math.max(0, now - started) : 0),
    ) / 1000,
  );
  return (
    <p className="game-timer" aria-label="Time remaining">
      {seconds === 0
        ? "Time's up"
        : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`}
    </p>
  );
}

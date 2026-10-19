import type { State } from "./game-store";

export function resolveJoinSession(
  sessions: Pick<State["sessions"][number], "id" | "acceptingPlayers">[],
  linkedSession: string,
  selectedSession: string,
) {
  if (linkedSession) return linkedSession;
  const open = sessions.filter((session) => session.acceptingPlayers);
  return open.length === 1 ? open[0].id : selectedSession;
}

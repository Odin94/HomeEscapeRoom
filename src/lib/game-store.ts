import { createStore } from "zustand/vanilla";

export type Game = {
  id: string;
  name: string;
  areas: Area[];
  controls: { id: string; name: string; entity: string }[];
};
type Area = {
  id: string;
  name: string;
  kind: string;
  hint: string;
  description: string;
  unlockCode?: string;
  playerView?: string;
};
type Session = {
  id: string;
  name: string;
  status: string;
  progress: number;
  players?: number;
};
export type State = {
  admin: boolean;
  adminConfigured: boolean;
  shareOrigin?: string | null;
  demo: boolean;
  sessions: Session[];
  games?: Game[];
  areas: Area[];
  settings?: { haUrl: string; tokenConfigured: boolean; publicUrl: string };
  player: { name: string; session_id: string; session: Session } | null;
  events?: { id: number; message: string; created: string }[];
};

// One in-memory store per mounted app; the server and HttpOnly cookie own persistence.
export function createGameStore() {
  return createStore<{
    state: State | undefined;
    setState: (state: State) => void;
  }>()((set) => ({
    state: undefined,
    setState: (state) => set({ state }),
  }));
}

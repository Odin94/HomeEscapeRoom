import { createStore } from "zustand/vanilla";
import type { LightTransition } from "./light-transition";

export type Game = {
  id: string;
  name: string;
  areas: Area[];
  autoStart?: boolean;
  controls: { id: string; name: string; entity: string }[];
};
export type Area = {
  id: string;
  name: string;
  kind: string;
  onComplete?: (
    | LightTransition
    | { type: "control"; controlId: string; on?: boolean }
    | { type: "speech"; entity: string; message: string }
  )[];
  qrMode?: "prompted" | "hidden";
  choices?: string[];
  hint: string;
  description: string;
  unlockCode?: string;
  caseSensitive?: boolean;
  playerView?: string;
};
type Session = {
  id: string;
  name: string;
  status: string;
  progress: number;
  players?: number;
  acceptingPlayers?: boolean;
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
  automationPending?: boolean;
  automation?: {
    id: string;
    session_id: string;
    status: string;
    error: string | null;
  }[];
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

import type { Clue } from "./clue";
import type { DesignScheme } from "./design-scheme";
import { createStore } from "zustand/vanilla";
import type { VacuumAction } from "./vacuum";
import type { LightTransition } from "./light-transition";

export type Game = {
  id: string;
  name: string;
  areas: Area[];
  clues?: Clue[];
  designScheme?: DesignScheme;
  autoStart?: boolean;
  timeLimitMinutes?: number;
  controls: { id: string; name: string; entity: string }[];
};
export type Area = {
  id: string;
  name: string;
  kind: string;
  requires?: string[];
  completesGame?: boolean;
  flowPosition?: { x: number; y: number };
  revealClues?: string[];
  available?: boolean;
  solved?: boolean;
  onComplete?: (
    | { type: "timer"; mode: "start" | "extend"; minutes: number }
    | VacuumAction
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
  timer?: { remainingMs: number; measuredAt: number; running: boolean } | null;
};
export type State = {
  voice?: { enabled: boolean; output: "phone" | "room" };
  designScheme?: DesignScheme;
  admin: boolean;
  adminConfigured: boolean;
  shareOrigin?: string | null;
  demo: boolean;
  sessions: Session[];
  games?: Game[];
  areas: Area[];
  clues?: Clue[];
  settings?: {
    haUrl: string;
    tokenConfigured: boolean;
    publicUrl: string;
    voiceEnabled: boolean;
    voiceLanguage: "en" | "de";
    voiceOutput: "phone" | "room";
  };
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

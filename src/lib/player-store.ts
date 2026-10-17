import { create } from "zustand";
import { persist } from "zustand/middleware";

export type PlayerSnapshot = {
  player: {
    name: string;
    session_id: string;
    session: { id: string; name: string; status: string; progress: number };
  };
  areas: {
    id: string;
    name: string;
    kind: string;
    hint: string;
    description: string;
    playerView?: string;
  }[];
};

type PlayerStore = {
  snapshot: PlayerSnapshot | null;
  sync: (snapshot: PlayerSnapshot | null) => void;
};

// Only cache the player view. Credentials remain in the HttpOnly cookie;
// cached progress never grants access or overrides the server.
export const usePlayerStore = create<PlayerStore>()(
  persist(
    (set) => ({
      snapshot: null,
      sync: (snapshot) =>
        set({
          snapshot:
            snapshot?.player.session.status === "closed" ? null : snapshot,
        }),
    }),
    {
      name: "threshold-player",
      version: 1,
      partialize: ({ snapshot }) => ({ snapshot }),
      skipHydration: true,
    },
  ),
);

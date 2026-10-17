import { test } from "node:test";
import assert from "node:assert/strict";

const values = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  },
  configurable: true,
});
const { usePlayerStore } = await import("../src/lib/player-store");
test("player cache persists, restores, replaces sessions and deactivates", async () => {
  const snapshot = {
    player: {
      name: "Ada",
      session_id: "one",
      session: { id: "one", name: "First", status: "running", progress: 2 },
    },
    areas: [],
  };
  usePlayerStore.getState().sync(snapshot);
  const saved = values.get("threshold-player")!;
  assert.equal(JSON.parse(saved).state.snapshot.player.session.progress, 2);
  usePlayerStore.setState({ snapshot: null });
  values.set("threshold-player", saved);
  await usePlayerStore.persist.rehydrate();
  assert.deepEqual(usePlayerStore.getState().snapshot, snapshot);
  usePlayerStore.getState().sync({
    ...snapshot,
    player: {
      ...snapshot.player,
      session_id: "two",
      session: { ...snapshot.player.session, id: "two", progress: 0 },
    },
  });
  assert.equal(usePlayerStore.getState().snapshot!.player.session.progress, 0);
  usePlayerStore.getState().sync({
    ...snapshot,
    player: {
      ...snapshot.player,
      session: { ...snapshot.player.session, status: "closed" },
    },
  });
  assert.equal(
    JSON.parse(values.get("threshold-player")!).state.snapshot,
    null,
  );
  usePlayerStore.getState().sync(snapshot);
  usePlayerStore.getState().sync(null);
  assert.equal(usePlayerStore.getState().snapshot, null);
});

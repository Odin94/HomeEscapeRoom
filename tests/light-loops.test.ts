import { test } from "node:test";
import assert from "node:assert/strict";
import { LightLoops } from "../src/lib/light-loops.server";
import type { LightTransition } from "../src/lib/light-transition";

const group: LightTransition["groups"][number] = {
  loop: "next-challenge",
  entities: ["light.one", "light.two"],
  steps: [{ mode: "off", seconds: 3600 }],
};
test("continuous playback repeats beyond one cycle until cancelled", async () => {
  const loops = new LightLoops();
  let repeated!: () => void;
  const secondCycle = new Promise<void>((resolve) => {
    repeated = resolve;
  });
  let calls = 0;
  try {
    await loops.start(
      "a",
      "repeat",
      { ...group, steps: [{ mode: "off", seconds: 0.1 }] },
      async () => {
        calls++;
        if (calls === 2) repeated();
      },
      () => assert.fail("unexpected failure"),
      () => {},
    );
    await secondCycle;
    await loops.stopSession("a", true);
    assert.equal(calls, 2);
    assert.equal(loops.hasAction("repeat"), false);
  } finally {
    await loops.close();
  }
});
test("background loops start without waiting for durations and next challenge stops only its matching session and mode", async () => {
  const loops = new LightLoops();
  const errors: unknown[] = [];
  const send = async () => {};
  try {
    await loops.start(
      "a",
      "a1",
      group,
      send,
      (e) => errors.push(e),
      () => {},
    );
    await loops.start(
      "a",
      "a2",
      { ...group, loop: "replaced", entities: ["light.three"] },
      send,
      (e) => errors.push(e),
      () => {},
    );
    await loops.start(
      "b",
      "b1",
      { ...group, entities: ["light.four"] },
      send,
      (e) => errors.push(e),
      () => {},
    );
    await loops.stopSession("a", true);
    assert.equal(loops.hasAction("a1"), false);
    assert.equal(loops.hasAction("a2"), true);
    assert.equal(loops.hasAction("b1"), true);
    await loops.stopSession("a");
    assert.equal(loops.hasAction("a2"), false);
    assert.equal(loops.hasAction("b1"), true);
    assert.deepEqual(errors, []);
  } finally {
    await loops.close();
  }
});
test("a takeover stops the entire overlapping group and drains an in-flight request before returning", async () => {
  const loops = new LightLoops();
  let release!: () => void;
  let entered!: () => void;
  const sending = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const start = loops.start(
    "a",
    "one",
    group,
    async () => {
      entered();
      await blocked;
    },
    () => assert.fail("cancellation is not failure"),
    () => {},
  );
  await sending;
  let taken = false;
  const stop = loops.takeOver(["light.two"]).then(() => {
    taken = true;
  });
  await Promise.resolve();
  assert.equal(taken, false);
  release();
  await Promise.all([start, stop]);
  assert.equal(taken, true);
  assert.equal(loops.hasAction("one"), false);
  await loops.close();
});
test("finite groups are drained when a sibling fails, before retry can begin", async () => {
  const loops = new LightLoops();
  let entered!: () => void;
  const sending = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let calls = 0;
  const first = loops.start(
    "a",
    "same-action",
    {
      ...group,
      loop: undefined,
      steps: [...group.steps, { mode: "off", seconds: 1 }],
    },
    async () => {
      calls++;
      entered();
    },
    () => {},
    () => {},
  );
  await sending;
  const second = loops.start(
    "a",
    "same-action",
    { ...group, loop: undefined, entities: ["light.other"] },
    async () => {
      throw new Error("device failed");
    },
    () => {
      void loops.stopAction("same-action");
    },
    () => {},
  );
  await assert.rejects(second, /device failed/);
  await first;
  assert.equal(loops.hasAction("same-action"), false);
  assert.equal(calls, 1);
  await loops.close();
});
test("takeover also respects lights affected by a scene outside the declared group", async () => {
  const loops = new LightLoops();
  let entered!: () => void;
  const sending = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const first = loops.start(
    "a",
    "scene",
    { ...group, loop: undefined, entities: ["light.declared"] },
    async () => {
      entered();
    },
    () => assert.fail("takeover is normal cancellation"),
    () => {},
    ["light.declared", "light.scene_member"],
  );
  await sending;
  await loops.takeOver(["light.scene_member"]);
  await first;
  assert.equal(loops.hasAction("scene"), false);
  await loops.close();
});

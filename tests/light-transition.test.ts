import { test } from "node:test";
import assert from "node:assert/strict";
import {
  lightTransitionSchema,
  runLightTransition,
  type LightTransition,
} from "../src/lib/light-transition";
import { gameSchema, loadGames } from "../src/lib/game.server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LightTransitionEditor } from "../src/components/light-transition-editor";

const action: LightTransition = {
  type: "lights",
  groups: [
    {
      entities: ["light.one", "light.two"],
      steps: [
        { mode: "color", color: "#ff8000", brightness: 75, seconds: 2 },
        { mode: "off", seconds: 1 },
      ],
    },
    {
      entities: ["light.three"],
      steps: [{ mode: "scene", entity: "scene.blue", seconds: 3 }],
    },
  ],
};
test("transition editor exposes selected lights, timed steps and scene scope", () => {
  const html = renderToStaticMarkup(
    createElement(LightTransitionEditor, {
      value: action,
      controls: [],
      onChange: () => {},
    }),
  );
  for (const text of [
    "Filter by name or entity",
    "2 lights selected",
    "Duration (seconds)",
    "Brightness (%)",
    "scene.blue",
    "all devices configured",
    "Add another light group",
  ])
    assert.ok(html.includes(text), text);
});
test("transitions validate targets, timing and unique group ownership and round-trip through games", () => {
  const game = structuredClone(loadGames()[0]);
  game.areas[0].onComplete = [action];
  assert.deepEqual(gameSchema.parse(game).areas[0].onComplete, [action]);
  for (const mutate of [
    (a: LightTransition) => {
      a.groups[0].entities = [];
    },
    (a: LightTransition) => {
      a.groups[0].entities = ["script.bad"];
    },
    (a: LightTransition) => {
      a.groups[1].entities = ["light.one"];
    },
    (a: LightTransition) => {
      a.groups[0].steps[0].seconds = -1;
    },
  ]) {
    const invalid = structuredClone(action);
    mutate(invalid);
    assert.equal(lightTransitionSchema.safeParse(invalid).success, false);
  }
});
test("groups start together, apply RGB and brightness to all targets, and hold each step", async () => {
  const calls: unknown[] = [];
  const waits: number[] = [];
  await runLightTransition(
    action,
    async (...args) => {
      calls.push(args);
    },
    async (ms) => {
      waits.push(ms);
    },
  );
  assert.deepEqual(calls, [
    [
      "light",
      "turn_on",
      {
        entity_id: ["light.one", "light.two"],
        brightness_pct: 75,
        rgb_color: [255, 128, 0],
      },
    ],
    ["scene", "turn_on", { entity_id: "scene.blue" }],
    ["light", "turn_off", { entity_id: ["light.one", "light.two"] }],
  ]);
  assert.deepEqual(waits, [2000, 3000, 1000]);
});
test("failures stop subsequent steps and interruption prevents sending", async () => {
  let calls = 0;
  await assert.rejects(
    runLightTransition(
      action,
      async () => {
        calls++;
        throw new Error("unavailable");
      },
      async () => {},
    ),
    /unavailable/,
  );
  assert.equal(calls, 2);
  await assert.rejects(
    runLightTransition(
      action,
      async () => {
        assert.fail("must not send");
      },
      async () => {},
      () => false,
    ),
    /interrupted/,
  );
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { nextUnlock } from "../src/lib/game.server";
test("team progresses through QR, password, QR in order", () => {
  assert.equal(nextUnlock(0, "study-marker-7c92"), 1);
  assert.equal(nextUnlock(1, " RAVEN "), 2);
  assert.equal(nextUnlock(2, "observatory-marker-a83f"), 3);
});
test("wrong and out-of-order clues never advance progression", () => {
  assert.throws(() => nextUnlock(0, "raven"));
  assert.throws(() => nextUnlock(1, "wrong"));
  assert.throws(() => nextUnlock(3, "study-marker-7c92"));
});

import { gameSchema, loadGames, saveGame } from "../src/lib/game.server";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";

const makeGame = (area: Record<string, unknown>) => ({
  id: "test-game",
  name: "Test game",
  controls: [],
  areas: [
    {
      id: "first",
      name: "First",
      hint: "",
      description: "Revealed",
      playerView: "narrative",
      ...area,
    },
  ],
});
test("fixed challenge types validate and match according to their rules", () => {
  for (const [kind, unlockCode, choices] of [
    ["text", "Raven", undefined],
    ["numbers", "0042", undefined],
    ["colors", "#ff0000|#0000ff|#ff0000", ["#ff0000", "#0000ff"]],
    ["symbols", "star|moon|star", ["star", "moon"]],
    ["qr", "Marker-A", undefined],
  ] as const) {
    const game = gameSchema.parse(
      makeGame({ kind, unlockCode, ...(choices ? { choices } : {}) }),
    );
    assert.equal(nextUnlock(0, unlockCode, game), 1);
    assert.throws(() => nextUnlock(0, "wrong", game));
    if (kind === "text") assert.equal(nextUnlock(0, " raven ", game), 1);
    if (kind === "numbers") assert.throws(() => nextUnlock(0, "42", game));
    if (kind === "symbols")
      assert.throws(() => nextUnlock(0, "moon|star|star", game));
    if (kind === "qr") assert.throws(() => nextUnlock(0, "marker-a", game));
  }
});
test("creation rejects unknown fields, invalid combinations and malformed sequences", () => {
  for (const area of [
    { kind: "arbitrary", unlockCode: "x" },
    { kind: "numbers", unlockCode: "4.2" },
    { kind: "text", unlockCode: "x", choices: ["a", "b"] },
    { kind: "text", unlockCode: "x", qrMode: "hidden" },
    { kind: "qr", unlockCode: "x", qrMode: "hidden", hint: "Scan me" },
    { kind: "symbols", unlockCode: "a|c", choices: ["a", "b"] },
    { kind: "symbols", unlockCode: "a|a", choices: ["a", "a"] },
    { kind: "colors", unlockCode: "red|blue", choices: ["red", "blue"] },
    { kind: "text", unlockCode: "x", script: "evil" },
  ])
    assert.equal(
      gameSchema.safeParse(makeGame(area)).success,
      false,
      JSON.stringify(area),
    );
  const valid = makeGame({ kind: "text", unlockCode: "answer" });
  assert.equal(
    gameSchema.safeParse({ ...valid, areas: [valid.areas[0], valid.areas[0]] })
      .success,
    false,
  );
  assert.equal(
    gameSchema.safeParse({ ...valid, id: "../escape" }).success,
    false,
  );
});
test("game saves round-trip through readable JSON files", () => {
  const previous = process.env.GAMES_PATH;
  const directory = mkdtempSync(resolve("artifacts/game-json-"));
  try {
    process.env.GAMES_PATH = directory;
    const game = saveGame(
      makeGame({
        kind: "qr",
        qrMode: "prompted",
        hint: "Scan marker",
        unlockCode: "unique-marker",
      }),
    );
    assert.deepEqual(loadGames(), [game]);
    assert.equal(
      JSON.parse(readFileSync(join(directory, "test-game.json"), "utf8"))
        .areas[0].qrMode,
      "prompted",
    );
  } finally {
    if (previous === undefined) delete process.env.GAMES_PATH;
    else process.env.GAMES_PATH = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("completion actions reject dangling controls and arbitrary services", () => {
  for (const onComplete of [
    [{ type: "control", controlId: "missing" }],
    [{ type: "speech", entity: "light.test", message: "hi" }],
    [{ type: "speech", entity: "notify.study_speak", message: " " }],
    [{ type: "service", domain: "shell_command", service: "run" }],
  ])
    assert.equal(
      gameSchema.safeParse(
        makeGame({ kind: "text", unlockCode: "answer", onComplete }),
      ).success,
      false,
    );
});

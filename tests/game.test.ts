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

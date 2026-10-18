import { test } from "node:test";
import assert from "node:assert/strict";
import { playerChallenges } from "../src/lib/player-challenges";
import type { Area } from "../src/lib/game-store";

const stomp: Area = {
  id: "stomp",
  name: "Emergency power",
  kind: "hidden",
  available: true,
  hint: "Emergency power comes from a great stomp.",
  description: "",
};
test("discovery clues appear as challenges for player and admin representations", () => {
  for (const area of [
    stomp,
    { ...stomp, kind: "qr", qrMode: "hidden" as const },
  ]) {
    assert.deepEqual(playerChallenges([area]), [area]);
  }
});
test("unprompted markers without clues stay hidden while visible QR and normal puzzles remain", () => {
  const text = { ...stomp, id: "text", kind: "text", hint: "" };
  const visible = {
    ...stomp,
    id: "visible",
    kind: "qr",
    qrMode: "prompted" as const,
    hint: "",
  };
  assert.deepEqual(
    playerChallenges([
      { ...stomp, hint: "" },
      { ...stomp, kind: "qr", hint: " " },
      text,
      visible,
    ]),
    [text, visible],
  );
});

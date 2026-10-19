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

test("player text and number inputs and submission remain enabled during play", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { ChallengeInput } = await import("../src/components/game-editor");
  for (const kind of ["text", "numbers"]) {
    const html = renderToStaticMarkup(
      createElement(ChallengeInput, {
        area: { ...stomp, kind },
        code: "123",
        setCode: () => {},
        disabled: false,
      }),
    );
    const input = html.match(/<input\b[^>]*>/)?.[0];
    assert.ok(input);
    assert.doesNotMatch(input, /disabled|readonly/i);
    assert.doesNotMatch(html, /<button[^>]*disabled/);
  }
});

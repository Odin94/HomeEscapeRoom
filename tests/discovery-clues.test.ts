import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DiscoveryClues } from "../src/components/discovery-clues";
import type { Area } from "../src/lib/game-store";

const stomp: Area = {
  id: "stomp",
  name: "Emergency power",
  kind: "hidden",
  available: true,
  hint: "Emergency power comes from a great stomp.",
  description: "",
};

test("hidden QR discovery clues remain visible without revealing scan controls", () => {
  for (const area of [
    stomp,
    { ...stomp, kind: "qr", qrMode: "hidden" as const },
  ]) {
    const html = renderToStaticMarkup(
      createElement(DiscoveryClues, { areas: [area] }),
    );
    assert.ok(html.includes(stomp.hint));
    assert.ok(!/<(form|button|input)\b/.test(html));
    assert.ok(!html.includes("Scan"));
  }
});

test("discovery clues hide after completion and do not expose locked or normal puzzle hints", () => {
  const html = renderToStaticMarkup(
    createElement(DiscoveryClues, {
      areas: [
        { ...stomp, solved: true, available: false },
        { ...stomp, id: "locked", available: false },
        { ...stomp, id: "normal", kind: "text" },
        { ...stomp, id: "silent", hint: "" },
      ],
    }),
  );
  assert.equal(html, "");
});

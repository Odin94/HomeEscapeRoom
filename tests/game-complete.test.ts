import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { completionStars, GameComplete } from "../src/components/game-complete";

test("completion stars use inclusive five-minute thresholds", () => {
  for (const [minutes, stars] of [
    [5, 5],
    [10, 4],
    [15, 3],
    [20, 2],
  ]) {
    assert.equal(completionStars(minutes * 60000), stars);
    assert.equal(completionStars(minutes * 60000 + 1), stars - 1);
  }
  assert.equal(completionStars(0), 5);
  assert.equal(completionStars(60 * 60000), 1);
  assert.equal(completionStars(null), 1);
  assert.equal(completionStars(undefined), 1);
});

test("game completion displays five star positions with an accessible rating", () => {
  const html = renderToStaticMarkup(
    createElement(GameComplete, { elapsedMs: 10 * 60000 }),
  );
  assert.match(html, /Game complete!/);
  assert.match(html, /aria-label="4 out of 5 stars"/);
  assert.match(html, /★★★★☆/);
});

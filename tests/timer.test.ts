import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GameTimer } from "../src/components/game-timer";
import { actionSchema, gameSchema, loadGames } from "../src/lib/game.server";

test("timer configuration accepts optional bounded whole minutes", () => {
  const game = loadGames()[0];
  assert.equal(
    gameSchema.safeParse({ ...game, timeLimitMinutes: undefined }).success,
    true,
  );
  for (const minutes of [0, -1, 1.5, 10081, Infinity]) {
    assert.equal(
      gameSchema.safeParse({ ...game, timeLimitMinutes: minutes }).success,
      false,
    );
    assert.equal(
      actionSchema.safeParse({ type: "timer", mode: "extend", minutes })
        .success,
      false,
    );
  }
  for (const mode of ["start", "extend"])
    assert.equal(
      actionSchema.safeParse({ type: "timer", mode, minutes: 5 }).success,
      true,
    );
});
test("players see remaining time only when a timer exists", () => {
  assert.equal(
    renderToStaticMarkup(createElement(GameTimer, { timer: null })),
    "",
  );
  const render = (remainingMs: number) =>
    renderToStaticMarkup(
      createElement(GameTimer, {
        timer: { remainingMs, measuredAt: 0, running: false },
      }),
    );
  assert.match(render(61000), /1:01/);
  assert.match(render(0), /Time&#x27;s up/);
});

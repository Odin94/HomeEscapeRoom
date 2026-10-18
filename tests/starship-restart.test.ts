import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gameSchema, nextUnlock } from "../src/lib/game.server";
import { availableChallenges } from "../src/lib/challenge-progress";
import { ChallengeInput } from "../src/components/game-editor";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const game = gameSchema.parse(
  JSON.parse(readFileSync("games/starship-restart.json", "utf8")),
);

test("the SOS fragment is an independent text challenge unlocked by communications", () => {
  const index = game.areas.findIndex((area) => area.id === "distress");
  const challenge = game.areas[index];
  assert.equal(challenge.kind, "text");
  assert.match(challenge.hint, /second part.*emergencies/);
  assert.doesNotMatch(challenge.hint, /lamp|light|signal|morse|sos/i);
  assert.ok(
    !availableChallenges(game, []).some((area) => area.id === challenge.id),
  );
  const available = availableChallenges(game, ["comms"]);
  assert.ok(available.some((area) => area.id === challenge.id));
  assert.ok(available.some((area) => area.id === "maintenance-access"));
  assert.equal(nextUnlock(index, " SOS ", game), index + 1);
  assert.throws(() => nextUnlock(index, "help", game));
  const html = renderToStaticMarkup(
    createElement(ChallengeInput, {
      area: challenge,
      code: "",
      setCode: () => {},
      disabled: false,
    }),
  );
  assert.match(html, /<input/);
  assert.match(html, /Unlock/);
  assert.ok(
    !availableChallenges(game, ["comms", "distress"]).some(
      (area) => area.id === challenge.id,
    ),
  );
  assert.equal(
    game.areas.find((area) => area.id === "engine")!.unlockCode,
    "hanasosword",
  );
});

test("the distress lamp flashes SOS in red with its Morse timing intact", () => {
  const comms = game.areas.find((area) => area.id === "comms")!;
  const group = comms.onComplete
    ?.flatMap((action) => (action.type === "lights" ? action.groups : []))
    .find((group) => group.entities.includes("light.bedroom_desk_lamp"));
  assert.ok(group);
  assert.equal(group.loop, "replaced");
  const pulses = group.steps.filter((step) => step.mode === "color");
  assert.deepEqual(
    pulses.map((step) => step.seconds),
    [0.3, 0.3, 0.3, 0.9, 0.9, 0.9, 0.3, 0.3, 0.3],
  );
  assert.ok(pulses.every((step) => step.color === "#ff0000"));
});

test("the opening is a briefing and start effects, not a challenge or QR marker", () => {
  assert.equal(game.joinChallengeId, undefined);
  assert.ok(
    !game.areas.some(
      (area) =>
        area.id === "boot" ||
        area.unlockCode === "87073809-4f0d-4aa2-91a3-7c126bfe8346",
    ),
  );
  assert.match(game.briefing!, /dark engine room/);
  assert.deepEqual(
    availableChallenges(game, []).map((area) => area.id),
    ["flower", "stomp", "comms"],
  );
  assert.deepEqual(
    game.onStart?.map((action) => action.type),
    ["lights", "speech"],
  );
});

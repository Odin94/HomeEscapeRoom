import { test } from "node:test";
import assert from "node:assert/strict";
import { gameSchema } from "../src/lib/game.server";
import {
  availableChallenges,
  revealedClues,
} from "../src/lib/challenge-progress";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { ClueView } from "../src/components/clue-view";

const base = {
  id: "parallel",
  name: "Parallel",
  controls: [],
  clues: [
    { id: "note", name: "Note", kind: "markdown", content: "**Secret**" },
  ],
  areas: [
    {
      id: "a",
      name: "A",
      kind: "text",
      hint: "A",
      description: "A solved",
      unlockCode: "a",
      requires: [],
      revealClues: ["note"],
    },
    {
      id: "b",
      name: "B",
      kind: "text",
      hint: "B",
      description: "B solved",
      unlockCode: "b",
      requires: [],
    },
    {
      id: "c",
      name: "C",
      kind: "text",
      hint: "C",
      description: "C solved",
      unlockCode: "c",
      requires: ["a", "b"],
    },
  ],
};
test("parallel roots, joins, legacy order and deduplicated clue rewards", () => {
  const game = gameSchema.parse(base);
  const ids = (solved: string[]) =>
    availableChallenges(game, solved).map((a) => a.id);
  assert.deepEqual(ids([]), ["a", "b"]);
  assert.deepEqual(ids(["b"]), ["a"]);
  assert.deepEqual(ids(["b", "a"]), ["c"]);
  assert.deepEqual(ids(["a", "b", "c"]), []);
  assert.deepEqual(revealedClues(game, ["b"]), []);
  assert.deepEqual(revealedClues(game, ["a"]), game.clues);
  const legacy = gameSchema.parse({
    ...base,
    areas: base.areas.map((area) => ({ ...area, requires: undefined })),
  });
  assert.deepEqual(
    availableChallenges(legacy, []).map((a) => a.id),
    ["a"],
  );
});
test("invalid prerequisite graphs and clue references cannot be saved", () => {
  for (const requires of [["missing"], ["a"], ["c"]]) {
    const value = structuredClone(base);
    value.areas[0].requires = requires;
    assert.equal(gameSchema.safeParse(value).success, false);
  }
  const value = structuredClone(base);
  value.areas[0].revealClues = ["missing"];
  assert.equal(gameSchema.safeParse(value).success, false);
  assert.equal(
    gameSchema.safeParse({ ...base, clues: [...base.clues, ...base.clues] })
      .success,
    false,
  );
});
test("clues render Markdown safely and use native media controls", () => {
  const html = renderToStaticMarkup(
    createElement(ClueView, {
      clue: {
        id: "note",
        name: "Note",
        kind: "markdown",
        content: "**Secret**<script>alert(1)</script>",
      },
    }),
  );
  assert.match(html, /<strong>Secret<\/strong>/);
  assert.doesNotMatch(html, /<script/);
  for (const kind of ["image", "audio", "video"] as const) {
    const content = `data:${kind}/${kind === "image" ? "png" : kind === "audio" ? "mpeg" : "mp4"};base64,YQ==`;
    assert.equal(
      gameSchema.safeParse({
        ...base,
        clues: [{ id: "note", name: "Note", kind, content }],
      }).success,
      true,
    );
    const rendered = renderToStaticMarkup(
      createElement(ClueView, {
        clue: { id: "note", name: "Note", kind, content },
      }),
    );
    assert.match(rendered, kind === "image" ? /<img/ : /controls=""/);
  }
  assert.equal(
    gameSchema.safeParse({
      ...base,
      clues: [
        {
          id: "note",
          name: "Note",
          kind: "image",
          content: "data:text/html;base64,YQ==",
        },
      ],
    }).success,
    false,
  );
});

import { challengeGraph } from "../src/lib/challenge-graph";
import { ChallengeGraph } from "../src/components/challenge-graph";
test("independent branches unlock different successors and graph shows their edges", () => {
  const game = gameSchema.parse({
    ...base,
    areas: [
      { ...base.areas[0], requires: [] },
      { ...base.areas[1], requires: [] },
      { ...base.areas[2], requires: ["a"] },
      { ...base.areas[2], id: "d", name: "D", requires: ["b"] },
      { ...base.areas[2], id: "e", name: "Final join", requires: ["c", "d"] },
    ],
  });
  const active = (solved: string[]) =>
    availableChallenges(game, solved).map((a) => a.id);
  assert.deepEqual(active(["a"]), ["b", "c"]);
  assert.deepEqual(active(["b"]), ["a", "d"]);
  assert.deepEqual(active(["a", "c"]), ["b"]);
  assert.deepEqual(active(["a", "b", "c", "d"]), ["e"]);
  const graph = challengeGraph(game);
  assert.deepEqual(graph.edges, [
    { from: 0, to: 2 },
    { from: 1, to: 3 },
    { from: 2, to: 4 },
    { from: 3, to: 4 },
  ]);
  assert.deepEqual(
    graph.nodes.map((n) => n.depth),
    [0, 0, 1, 1, 2],
  );
  assert.equal(graph.invalid, false);
  const html = renderToStaticMarkup(
    createElement(ChallengeGraph, { game, select: () => {} }),
  );
  assert.match(html, /Challenge flow/);
  assert.match(html, /Edit challenge 5: Final join/);
  assert.match(html, /After 2 challenges/);
  assert.equal(
    challengeGraph({ areas: [{ ...game.areas[0], requires: ["a"] }] }).invalid,
    true,
  );
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GameMarkdown } from "../src/components/game-markdown";

test("player Markdown renders stories and keeps names inline", () => {
  const story = renderToStaticMarkup(
    createElement(GameMarkdown, {
      children: "# A room\n\n**Look** closely.\n\n- First clue\n- Second clue",
    }),
  );
  assert.ok(story.includes("<h1>A room</h1>"));
  assert.ok(story.includes("<strong>Look</strong>"));
  assert.ok(story.includes("<li>First clue</li>"));
  const name = renderToStaticMarkup(
    createElement(GameMarkdown, {
      inline: true,
      children: "# The **room** [name](https://example.com)",
    }),
  );
  assert.ok(name.includes("<strong>room</strong>"));
  assert.ok(!/<(p|h1|a)[ >]/.test(name));
});

test("player Markdown rejects executable HTML and unsafe links", () => {
  const html = renderToStaticMarkup(
    createElement(GameMarkdown, {
      children:
        '<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[Open](javascript:alert%281%29)',
    }),
  );
  assert.ok(!html.includes("<script"));
  assert.ok(!html.includes("onerror"));
  assert.ok(!html.includes("javascript:"));
});

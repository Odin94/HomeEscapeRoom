import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkerContent } from "../src/components/marker-print";

test("marker renders Markdown above and below its QR without default text", () => {
  const qr = "data:image/png;base64,marker";
  const empty = renderToStaticMarkup(
    createElement(MarkerContent, { qr, above: "", below: "" }),
  );
  assert.equal(empty.replace(/<[^>]*>/g, ""), "");
  assert.equal((empty.match(/<img /g) || []).length, 1);

  const html = renderToStaticMarkup(
    createElement(MarkerContent, {
      qr,
      above: "# Find the key\n\nA **hidden** clue.",
      below: "*Scan here*\n\n- Open the door\n- Enter together",
    }),
  );
  assert.ok(html.includes("<h1>Find the key</h1>"));
  assert.ok(html.includes("<strong>hidden</strong>"));
  assert.ok(html.includes("<em>Scan here</em>"));
  assert.ok(html.includes("<li>Open the door</li>"));
  assert.ok(html.indexOf("Find the key") < html.indexOf("<img "));
  assert.ok(html.indexOf("<img ") < html.indexOf("Scan here"));
});

test("marker Markdown does not render raw HTML or unsafe link protocols", () => {
  const html = renderToStaticMarkup(
    createElement(MarkerContent, {
      qr: "data:image/png;base64,marker",
      above: '<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">',
      below: "[click](javascript:alert%281%29)",
    }),
  );
  assert.ok(!html.includes("<script"));
  assert.ok(!html.includes("onerror"));
  assert.ok(!html.includes("javascript:"));
});

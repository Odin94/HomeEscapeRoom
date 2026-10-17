import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChallengeInput, GameEditor } from "../src/components/game-editor";
import { loadGames } from "../src/lib/game.server";
import QRCode from "qrcode";
import decode from "jsqr";

test("creator offers every configured type and retains device authoring", () => {
  const html = renderToStaticMarkup(
    createElement(GameEditor, {
      initial: loadGames()[0],
      busy: false,
      save: async () => true,
    }),
  );
  for (const label of [
    "Enter text",
    "Enter numbers",
    "Select colors in order",
    "Select symbols in order",
    "Scan QR code",
    "Alexa / external answer",
    "Add scene / script / light action",
    "Add Alexa speech",
    "Add control",
    "Add challenge",
    "Save game",
  ])
    assert.ok(html.includes(label), label);
});
test("hidden QR has no visible scanner or input for either player or admin representation", () => {
  for (const area of [
    { kind: "hidden" },
    { kind: "qr", qrMode: "hidden" as const },
    { kind: "qr" },
  ]) {
    const html = renderToStaticMarkup(
      createElement(ChallengeInput, {
        area: {
          id: "marker",
          name: "Room",
          hint: "",
          description: "",
          ...area,
        },
        code: "",
        setCode: () => {},
        disabled: false,
      }),
    );
    assert.equal(html, "");
  }
  const prompted = renderToStaticMarkup(
    createElement(ChallengeInput, {
      area: {
        id: "marker",
        name: "Room",
        hint: "Scan",
        description: "",
        kind: "qr",
        qrMode: "prompted",
      },
      code: "",
      setCode: () => {},
      disabled: false,
    }),
  );
  assert.ok(prompted.includes('type="file"'));
});
test("portable decoder reads the actual generated marker format", () => {
  const url = "http://192.168.1.4:3000/?code=tutorial-prompted-marker";
  const qr = QRCode.create(url);
  const scale = 8,
    margin = 4;
  const size = (qr.modules.size + margin * 2) * scale;
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const mx = Math.floor(x / scale) - margin,
        my = Math.floor(y / scale) - margin;
      const dark =
        mx >= 0 &&
        my >= 0 &&
        mx < qr.modules.size &&
        my < qr.modules.size &&
        qr.modules.get(my, mx);
      const index = (y * size + x) * 4;
      pixels[index] = pixels[index + 1] = pixels[index + 2] = dark ? 0 : 255;
      pixels[index + 3] = 255;
    }
  assert.equal(decode(pixels, size, size)?.data, url);
});

test("external answers show a waiting state without a phone answer field", () => {
  const html = renderToStaticMarkup(
    createElement(ChallengeInput, {
      area: {
        id: "voice",
        name: "Voice",
        kind: "external",
        hint: "",
        description: "",
      },
      code: "",
      setCode: () => {},
      disabled: false,
    }),
  );
  assert.ok(html.includes("Waiting for your answer"));
  assert.ok(!html.includes("<input"));
  assert.ok(!html.includes("Unlock"));
});

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const directory = mkdtempSync(join(tmpdir(), "threshold-automation-"));
process.env.DATABASE_PATH = join(directory, "test.sqlite");
process.env.SETTINGS_PATH = join(directory, "settings.json");
process.env.GAMES_PATH = join(directory, "games");
process.env.ADMIN_KEY = "automation-test-key";
delete process.env.HA_URL;
cpSync("games", process.env.GAMES_PATH, { recursive: true });
const { handle, handleCallback, closeStore } =
  await import("../src/lib/db.server");
const { saveSettings } = await import("../src/lib/settings.server");
after(() => {
  closeStore();
  rmSync(directory, { recursive: true, force: true });
});
const origin = "http://localhost:3000";
function call(body?: Record<string, unknown>, cookie = "") {
  return handle(
    new Request(`${origin}/api/game`, {
      method: body ? "POST" : "GET",
      headers: { origin, cookie, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  );
}
function callback(
  sessionId: string,
  token: string,
  challengeId = "spoken-answer",
  answer = "five",
) {
  return handleCallback(
    new Request(`${origin}/api/callback`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ sessionId, challengeId, answer }),
    }),
  );
}
test("QR to scene to colors to Alexa callback is shared, authenticated, retryable and snapshot isolated", async () => {
  const gm = (
    await call({ action: "login", key: "automation-test-key" })
  ).headers
    .get("set-cookie")!
    .split(";")[0];
  const { id } = await (
    await call(
      { action: "create", gameId: "the-color-riddle", name: "Color team" },
      gm,
    )
  ).json();
  assert.equal((await call({ action: "callback-config", id })).status, 401);
  const config = await (
    await call({ action: "callback-config", id }, gm)
  ).json();
  assert.equal(config.challenges[0].id, "spoken-answer");
  assert.equal((await callback(id, config.token)).status, 400); // not running
  const player = (await call({ action: "join", id, name: "Ada" })).headers
    .get("set-cookie")!
    .split(";")[0];
  const teammateResponse = await call({ action: "join", id, name: "Sam" });
  assert.equal(teammateResponse.status, 200); // joining remains open after automatic start
  const teammate = teammateResponse.headers.get("set-cookie")!.split(";")[0];
  assert.equal(
    (await (await call(undefined, player)).json()).player.session.status,
    "running",
  );
  assert.equal((await callback(id, "bad-token")).status, 401);
  assert.equal((await callback("other-session", config.token)).status, 401);
  assert.equal((await callback(id, config.token)).status, 400); // wrong stage
  const game = (await (await call(undefined, gm)).json()).games.find(
    (g: any) => g.id === "the-color-riddle",
  );
  await call(
    {
      action: "save-game",
      game: {
        ...game,
        controls: [{ ...game.controls[0], entity: "scene.changed" }],
      },
    },
    gm,
  );
  const originalFetch = globalThis.fetch;
  const sent: { url: string; body: any }[] = [];
  let failScene = true;
  try {
    saveSettings({
      haUrl: "http://ha.test",
      haToken: "ha-secret",
      adminKey: "automation-test-key",
    });
    globalThis.fetch = async (url, init) => {
      if (String(url).endsWith("/api/states"))
        return Response.json([
          {
            entity_id: "notify.living_room_speak",
            state: "unknown",
            attributes: {},
          },
        ]);
      sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      if (failScene) return new Response("", { status: 503 });
      return Response.json([]);
    };
    const scan = {
      action: "unlock",
      challengeId: "find-the-lights",
      code: "color-riddle-lights-9b37",
    };
    const scans = await Promise.all([call(scan, player), call(scan, teammate)]);
    assert.deepEqual(
      scans.map((r) => r.status),
      [200, 400],
    );
    assert.equal(sent.length, 1);
    assert.equal(sent[0].body.entity_id, "scene.escape_room_colors"); // snapshot
    let state = await (await call(undefined, player)).json();
    assert.equal(state.automationPending, true);
    assert.equal(state.player.session.progress, 1);
    assert.equal(state.automation, undefined);
    assert.ok(!JSON.stringify(state).includes(config.token));
    assert.ok(!JSON.stringify(state).includes("one hand"));
    const colors = {
      action: "unlock",
      challengeId: "light-colors",
      code: "#ff0000|#0000ff|#00ff00|#ffff00",
    };
    assert.equal((await call(colors, player)).status, 400);
    assert.equal(
      (await call({ action: "retry-actions", id }, player)).status,
      401,
    );
    failScene = false;
    assert.equal((await call({ action: "retry-actions", id }, gm)).status, 200);
    assert.equal(sent.length, 2);
    await call({ action: "retry-actions", id }, gm);
    assert.equal(sent.length, 2); // successful action is not repeated
    assert.equal(
      (await call({ ...colors, code: "#0000ff|#ff0000" }, player)).status,
      400,
    );
    assert.equal((await call(colors, player)).status, 200);
    assert.equal(sent.length, 3);
    assert.ok(sent[2].url.endsWith("/services/notify/send_message"));
    assert.ok(sent[2].body.message.includes("one hand"));
    assert.equal(
      (await call({ action: "unlock", code: "five" }, player)).status,
      400,
    ); // no phone bypass
    assert.equal(
      (await callback(id, config.token, "light-colors")).status,
      400,
    );
    assert.equal(
      (await callback(id, config.token, "spoken-answer", "four")).status,
      400,
    );
    await call({ action: "status", id, status: "paused" }, gm);
    assert.equal((await callback(id, config.token)).status, 400);
    await call({ action: "status", id, status: "running" }, gm);
    assert.equal(
      (await callback(id, config.token, "spoken-answer", " FIVE ")).status,
      200,
    );
    assert.equal((await callback(id, config.token)).status, 400); // replay
    state = await (await call(undefined, teammate)).json();
    assert.equal(state.player.session.progress, 3);
    assert.ok(state.areas[2].description.includes("Success!"));
    assert.equal(state.automationPending, false);
    await call({ action: "status", id, status: "closed" }, gm);
    assert.equal((await callback(id, config.token)).status, 400);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

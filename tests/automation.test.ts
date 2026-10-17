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
test("continuous light groups do not block answers and stop on next completion or overlapping manual controls", async () => {
  const gm = (
    await call({ action: "login", key: "automation-test-key" })
  ).headers
    .get("set-cookie")!
    .split(";")[0];
  const previousFetch = globalThis.fetch;
  const sent: { entity_id: string | string[] }[] = [];
  try {
    saveSettings({
      haUrl: "http://ha.test",
      haToken: "test-token",
      adminKey: "automation-test-key",
      publicUrl: "",
    });
    globalThis.fetch = async (_url, init) => {
      sent.push(JSON.parse(String(init?.body)));
      return Response.json([]);
    };
    for (const mode of ["next-challenge", "replaced"] as const) {
      const game = {
        id: `loop-${mode}`,
        name: "Loop test",
        autoStart: true,
        controls: [{ id: "lamp", name: "Lamp", entity: "light.one" }],
        areas: [0, 1, 2].map((n) => ({
          id: `area-${n}`,
          name: `Area ${n}`,
          kind: "text",
          hint: "",
          description: "",
          unlockCode: "yes",
          onComplete:
            n === 0
              ? [
                  {
                    type: "lights",
                    groups: [
                      {
                        loop: mode,
                        entities: ["light.one", "light.two"],
                        steps: [{ mode: "off", seconds: 3600 }],
                      },
                    ],
                  },
                ]
              : [],
        })),
      };
      assert.equal((await call({ action: "save-game", game }, gm)).status, 200);
      const { id } = await (
        await call({ action: "create", gameId: game.id, name: "Loop team" }, gm)
      ).json();
      const player = (await call({ action: "join", id, name: "Ada" })).headers
        .get("set-cookie")!
        .split(";")[0];
      assert.equal(
        (
          await call(
            { action: "unlock", challengeId: "area-0", code: "yes" },
            player,
          )
        ).status,
        200,
      );
      let state = await (await call(undefined, player)).json();
      assert.equal(state.automationPending, false);
      assert.equal(
        (await (await call(undefined, gm)).json()).automation.filter(
          (r: { session_id: string; status: string }) =>
            r.session_id === id && r.status === "looping",
        ).length,
        1,
      );
      assert.equal(
        (
          await call(
            { action: "unlock", challengeId: "area-1", code: "yes" },
            player,
          )
        ).status,
        200,
      );
      if (mode === "replaced") {
        assert.equal(
          (await call({ action: "device", id, device: "lamp", on: true }, gm))
            .status,
          200,
        );
      }
      state = await (await call(undefined, gm)).json();
      assert.equal(
        state.automation.filter(
          (r: { session_id: string }) => r.session_id === id,
        ).length,
        0,
      );
      await call({ action: "status", id, status: "closed" }, gm);
    }
    assert.equal(sent.length, 3);
  } finally {
    globalThis.fetch = previousFetch;
  }
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
  for (const action of ["alexa-setup", "alexa-status", "alexa-test"]) {
    assert.equal(
      (await call({ action, id, challengeId: "spoken-answer" })).status,
      401,
    );
    assert.equal(
      (await call({ action, id, challengeId: "missing" }, gm)).status,
      400,
    );
  }
  assert.deepEqual(
    await (
      await call(
        { action: "alexa-status", id, challengeId: "spoken-answer" },
        gm,
      )
    ).json(),
    { setup: null },
  );
  assert.equal(
    (await call({ action: "alexa-test", id, challengeId: "spoken-answer" }, gm))
      .status,
    400,
  );
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

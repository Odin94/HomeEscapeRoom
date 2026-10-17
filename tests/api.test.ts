import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const directory = mkdtempSync(join(tmpdir(), "threshold-test-"));
process.env.DATABASE_PATH = join(directory, "test.sqlite");
process.env.ADMIN_KEY = "test-key";
process.env.SETTINGS_PATH = join(directory, "settings.json");
process.env.GAMES_PATH = join(directory, "games");
cpSync("games", process.env.GAMES_PATH, { recursive: true });
delete process.env.HA_URL;
const { handle, closeStore } = await import("../src/lib/db.server");
after(() => {
  closeStore();
  rmSync(directory, { recursive: true, force: true });
});
const origin = "http://localhost:3000";
async function call(
  body?: Record<string, unknown>,
  cookie = "",
  requestOrigin = origin,
) {
  return handle(
    new Request(`${origin}/api/game`, {
      method: body ? "POST" : "GET",
      headers: {
        origin: requestOrigin,
        "Content-Type": "application/json",
        cookie,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  );
}
test("authenticated game lifecycle persists shared, isolated progression", async () => {
  assert.equal(
    (await call({ action: "create", name: "Unauthorized" })).status,
    401,
  );
  assert.equal((await call({ action: "login", key: "wrong" })).status, 400);
  assert.equal(
    (
      await call(
        { action: "login", key: "test-key" },
        "",
        "https://other.example",
      )
    ).status,
    403,
  );
  const login = await call({ action: "login", key: "test-key" });
  assert.equal(login.status, 200);
  const gm = login.headers.get("set-cookie")!.split(";")[0];
  const created = await (
    await call({ action: "create", name: "Test mystery" }, gm)
  ).json();
  const id = created.id;
  const join1 = await call({ action: "join", id, name: "Ada" });
  const player = join1.headers.get("set-cookie")!.split(";")[0];
  const join2 = await call({ action: "join", id, name: "Sam" });
  const teammate = join2.headers.get("set-cookie")!.split(";")[0];
  assert.equal(
    (await call({ action: "unlock", code: "study-marker-7c92" }, player))
      .status,
    400,
  );
  await call({ action: "status", id, status: "running" }, gm);
  assert.ok(
    !(await (await call()).json()).sessions.some((s: any) => s.id === id),
  );
  assert.ok(
    (await (await call(undefined, player)).json()).sessions.some(
      (s: any) => s.id === id,
    ),
  );
  assert.equal((await call({ action: "join", id, name: "Late" })).status, 400);
  assert.equal(
    (await call({ action: "device", device: "lights", on: true }, player))
      .status,
    401,
  );
  assert.equal(
    (await call({ action: "unlock", code: "observatory-marker-a83f" }, player))
      .status,
    400,
  );
  assert.equal(
    (await call({ action: "unlock", code: "study-marker-7c92" }, player))
      .status,
    200,
  );
  let state = await (await call(undefined, teammate)).json();
  assert.equal(state.player.session.progress, 1);
  assert.equal(state.events, undefined);
  assert.equal(state.player.token, undefined);
  assert.equal(state.areas[0].description.includes("five letters"), true);
  assert.equal(state.areas[1].description, "");
  assert.equal(state.areas[2].hint, "");
  assert.equal(
    JSON.stringify(state).includes("observatory-marker-a83f"),
    false,
  );
  assert.ok(state.areas.every((area: any) => area.unlockCode === undefined));
  assert.equal((await call()).headers.get("cache-control"), "no-store");
  await call({ action: "status", id, status: "paused" }, gm);
  assert.equal(
    (await call({ action: "unlock", code: "raven" }, player)).status,
    400,
  );
  await call({ action: "status", id, status: "running" }, gm);
  assert.equal(
    (await call({ action: "unlock", code: " RAVEN " }, teammate)).status,
    200,
  );
  assert.equal(
    (await call({ action: "unlock", code: "observatory-marker-a83f" }, player))
      .status,
    200,
  );
  assert.equal(
    (await call({ action: "unlock", code: "observatory-marker-a83f" }, player))
      .status,
    400,
  );
  assert.equal(
    (await call({ action: "device", device: "lights", on: true }, gm)).status,
    200,
  );
  state = await (await call(undefined, gm)).json();
  assert.equal(state.sessions.find((s: any) => s.id === id).progress, 3);
  assert.equal(
    state.sessions.find((s: any) => s.id === "signal-house").progress,
    0,
  );
  assert.ok(
    state.events.some((e: any) => e.message.includes("Demo: lights on")),
  );
  assert.equal(state.areas[1].unlockCode, "raven");
  assert.equal(
    (await call({ action: "device", device: "lights", on: "false" }, gm))
      .status,
    400,
  );
  assert.equal(
    (await call({ action: "device", device: "toString" }, gm)).status,
    400,
  );
  assert.equal((await call({ action: "leave" }, player)).status, 200);
  assert.equal((await (await call(undefined, player)).json()).player, null);
  const logout = await call({ action: "logout" }, gm);
  assert.equal(logout.status, 200);
  assert.equal(
    (await call({ action: "create", name: "Revoked" }, gm)).status,
    401,
  );
});
test("ending revokes returning players even when the session is reopened", async () => {
  const login = await call({ action: "login", key: "test-key" });
  const gm = login.headers.get("set-cookie")!.split(";")[0];
  const { id } = await (
    await call({ action: "create", name: "End test" }, gm)
  ).json();
  const joined = await call({ action: "join", id, name: "Ada" });
  assert.match(joined.headers.get("set-cookie")!, /Max-Age=31536000/);
  const player = joined.headers.get("set-cookie")!.split(";")[0];
  assert.equal(
    (await (await call(undefined, player)).json()).player.name,
    "Ada",
  );
  await call({ action: "status", id, status: "closed" }, gm);
  assert.equal((await (await call(undefined, player)).json()).player, null);
  await call({ action: "status", id, status: "open" }, gm);
  assert.equal((await (await call(undefined, player)).json()).player, null);
});

test("changing games revokes the previous player credential", async () => {
  const a = await call({
    action: "join",
    id: "signal-house",
    name: "Returning player",
  });
  const previous = a.headers.get("set-cookie")!.split(";")[0];
  const b = await call(
    { action: "join", id: "signal-house", name: "Returning player" },
    previous,
  );
  assert.equal(b.status, 200);
  assert.equal((await (await call(undefined, previous)).json()).player, null);
  const current = b.headers.get("set-cookie")!.split(";")[0];
  assert.equal(
    (await (await call(undefined, current)).json()).player.name,
    "Returning player",
  );
});
test("real devices cannot be controlled through the default demo key", async () => {
  process.env.HA_URL = "http://homeassistant.invalid";
  delete process.env.ADMIN_KEY;
  try {
    assert.equal((await call({ action: "login", key: "demo" })).status, 400);
  } finally {
    delete process.env.HA_URL;
    process.env.ADMIN_KEY = "test-key";
  }
});

test("game snapshots isolate sessions and settings remain private", async () => {
  const login = await call({ action: "login", key: "test-key" });
  const gm = login.headers.get("set-cookie")!.split(";")[0];
  const game = {
    id: "test-room",
    name: "Different room",
    areas: [
      {
        id: "one",
        name: "One",
        kind: "password",
        hint: "",
        description: "Original ending",
        unlockCode: "first-answer",
        playerView: "narrative",
      },
    ],
    controls: [{ id: "lamp", name: "Lamp", entity: "light.test" }],
  };
  assert.equal((await call({ action: "save-game", game }, gm)).status, 200);
  const created = await (
    await call({ action: "create", gameId: game.id, name: "Snapshot" }, gm)
  ).json();
  const joined = await call({ action: "join", id: created.id, name: "Tester" });
  const player = joined.headers.get("set-cookie")!.split(";")[0];
  await call({ action: "status", id: created.id, status: "running" }, gm);
  await call(
    {
      action: "save-game",
      game: { ...game, areas: [{ ...game.areas[0], unlockCode: "changed" }] },
    },
    gm,
  );
  assert.equal(
    (await call({ action: "unlock", code: "changed" }, player)).status,
    400,
  );
  assert.equal(
    (await call({ action: "unlock", code: "first-answer" }, player)).status,
    200,
  );
  const state = await (await call(undefined, player)).json();
  assert.equal(state.areas.length, 1);
  assert.equal(state.areas[0].description, "Original ending");
  assert.equal(state.areas[0].playerView, "narrative");
  assert.equal(state.games, undefined);
  assert.equal(state.settings, undefined);
  assert.equal(
    (await call({ action: "session-definition", id: created.id }, player))
      .status,
    401,
  );
  assert.equal(
    (await call({ action: "save-game", game: { ...game, id: "../bad" } }, gm))
      .status,
    400,
  );
  assert.equal(
    (
      await call(
        {
          action: "save-game",
          game: {
            ...game,
            areas: [{ ...game.areas[0], playerView: "arbitrary-code" }],
          },
        },
        gm,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await call(
        {
          action: "save-settings",
          haUrl: "",
          haToken: "private-token",
          adminKey: "new-admin-key",
        },
        gm,
      )
    ).status,
    200,
  );
  const adminState = await (await call(undefined, gm)).json();
  assert.equal(adminState.settings.tokenConfigured, true);
  assert.equal(JSON.stringify(adminState).includes("private-token"), false);
  assert.equal(JSON.stringify(adminState).includes("new-admin-key"), false);
  for (const publicUrl of [
    "javascript:alert(1)",
    "http://example.com/path",
    "http://user:pass@example.com",
  ]) {
    assert.equal(
      (await call({ action: "save-settings", haUrl: "", publicUrl }, gm))
        .status,
      400,
    );
  }
  assert.equal(
    (
      await call(
        {
          action: "save-settings",
          haUrl: "",
          publicUrl: "http://threshold.home.arpa:3000/",
        },
        gm,
      )
    ).status,
    200,
  );
  assert.equal(
    (await (await call(undefined, gm)).json()).shareOrigin,
    "http://threshold.home.arpa:3000",
  );
});

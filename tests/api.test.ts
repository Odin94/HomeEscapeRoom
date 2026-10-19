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
const { settings, saveSettings } = await import("../src/lib/settings.server");
after(() => {
  closeStore();
  rmSync(directory, { recursive: true, force: true });
});
test("dynamic speech requires GM access and sends only to an available notification target", async () => {
  for (const action of [
    "speech-targets",
    "speak",
    "light-targets",
    "control-targets",
  ]) {
    assert.equal((await call({ action })).status, 401);
  }
  const previous = settings();
  const login = await call({ action: "login", key: previous.adminKey });
  const gm = login.headers.get("set-cookie")!.split(";")[0];
  const originalFetch = globalThis.fetch;
  const sent: { url: string; body: unknown }[] = [];
  let fail = false;
  try {
    saveSettings({
      ...previous,
      haUrl: "http://ha.test",
      haToken: "test-token",
    });
    globalThis.fetch = async (url, init) => {
      assert.equal(
        (init?.headers as Record<string, string>).Authorization,
        "Bearer test-token",
      );
      if (fail) return new Response("", { status: 503 });
      if (String(url).endsWith("/api/states"))
        return Response.json([
          {
            entity_id: "notify.study_speak",
            state: "unknown",
            attributes: { friendly_name: "Study Speak" },
          },
          {
            entity_id: "notify.study_announce",
            state: "unavailable",
            attributes: {},
          },
          { entity_id: "notify.mobile_app", state: "idle", attributes: {} },
          { entity_id: "light.study", state: "on", attributes: {} },
          {
            entity_id: "script.riddle",
            state: "off",
            attributes: { friendly_name: "Riddle" },
          },
          { entity_id: "scene.dusk", state: "unavailable", attributes: {} },
        ]);
      sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return Response.json([]);
    };
    const discovered = await (
      await call({ action: "speech-targets" }, gm)
    ).json();
    assert.equal(discovered.targets.length, 2);
    const lights = await (await call({ action: "light-targets" }, gm)).json();
    assert.deepEqual(lights.targets, [
      { entity: "light.study", name: "light.study", available: true },
      { entity: "scene.dusk", name: "scene.dusk", available: false },
    ]);
    const controls = await (
      await call({ action: "control-targets" }, gm)
    ).json();
    assert.deepEqual(controls.targets, [
      { entity: "light.study", name: "light.study", available: true },
      { entity: "script.riddle", name: "Riddle", available: true },
      { entity: "scene.dusk", name: "scene.dusk", available: false },
    ]);
    assert.equal(
      discovered.targets.find(
        (t: { entity: string }) => t.entity === "notify.study_announce",
      ).available,
      false,
    );
    const base = {
      action: "speak",
      id: "signal-house",
      entity: "notify.study_speak",
      message: "Your next clue is abc",
    };
    for (const change of [
      { message: " " },
      { message: "x".repeat(1001) },
      { entity: "light.study" },
      { entity: "notify.mobile_app" },
      { entity: "notify.study_announce" },
      { id: "missing" },
    ]) {
      assert.equal((await call({ ...base, ...change }, gm)).status, 400);
    }
    assert.equal(sent.length, 0);
    assert.equal(
      (await call({ ...base, message: "  Watermelon & <clue>  " }, gm)).status,
      200,
    );
    assert.deepEqual(sent, [
      {
        url: "http://ha.test/api/services/notify/send_message",
        body: {
          entity_id: "notify.study_speak",
          message: "Watermelon &amp; &lt;clue&gt;",
        },
      },
    ]);
    fail = true;
    const failure = await call(base, gm);
    assert.equal(failure.status, 400);
    assert.match((await failure.json()).error, /503/);
    assert.equal(sent.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    saveSettings(previous);
  }
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
    designScheme: "terminal",
    name: "Different room",
    areas: [
      {
        id: "one",
        name: "One",
        kind: "text",
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
      game: {
        ...game,
        designScheme: "warm",
        areas: [{ ...game.areas[0], unlockCode: "changed" }],
      },
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
  assert.equal(state.designScheme, "terminal");
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

test("a winning challenge stops the timer and closes remaining challenges without marking them solved", async () => {
  const login = await call({ action: "login", key: settings().adminKey });
  const gm = login.headers.get("set-cookie")!.split(";")[0];
  const areas = [
    { id: "flower", requires: [], unlockCode: "hana" },
    { id: "other", requires: [], unlockCode: "other" },
    {
      id: "engine",
      requires: ["flower"],
      unlockCode: "hanasosword",
      completesGame: true,
    },
  ].map((area) => ({
    ...area,
    name: area.id,
    kind: "text",
    hint: "",
    description: "",
  }));
  assert.equal(
    (
      await call(
        {
          action: "save-game",
          game: {
            id: "terminal-test",
            name: "Terminal",
            autoStart: true,
            timeLimitMinutes: 30,
            controls: [],
            areas,
          },
        },
        gm,
      )
    ).status,
    200,
  );
  const created = await (
    await call(
      { action: "create", gameId: "terminal-test", name: "Terminal" },
      gm,
    )
  ).json();
  await call({ action: "status", id: created.id, status: "open" }, gm);
  const joined = await call({ action: "join", id: created.id, name: "Crew" });
  const player = joined.headers.get("set-cookie")!.split(";")[0];
  assert.equal(
    (await call({ action: "unlock", code: "hanasosword" }, player)).status,
    400,
  );
  assert.equal(
    (await call({ action: "unlock", code: "hana" }, player)).status,
    200,
  );
  assert.equal(
    (await call({ action: "unlock", code: "hanasosword" }, player)).status,
    200,
  );
  const state = await (await call(undefined, player)).json();
  assert.equal(state.player.session.progress, 3);
  assert.equal(state.player.session.timer.running, false);
  assert.equal(
    state.areas.find((a: { id: string }) => a.id === "other").solved,
    false,
  );
  assert.ok(state.areas.every((a: { available: boolean }) => !a.available));
  assert.equal(
    (await call({ action: "unlock", code: "other" }, player)).status,
    400,
  );
});

test("all challenge types progress through API without exposing answers or hidden QR prompts", async () => {
  const login = await call({ action: "login", key: settings().adminKey });
  const gm = login.headers.get("set-cookie")!.split(";")[0];
  const created = await (
    await call(
      { action: "create", gameId: "tutorial-challenges", name: "Workshop" },
      gm,
    )
  ).json();
  const joined = await call({ action: "join", id: created.id, name: "Solver" });
  const player = joined.headers.get("set-cookie")!.split(";")[0];
  await call({ action: "status", id: created.id, status: "running" }, gm);
  const answers = [
    "raven",
    "0042",
    "#ff0000|#0000ff|#ff0000",
    "star|moon|star",
    "tutorial-prompted-marker",
    "tutorial-hidden-marker",
  ];
  for (let i = 0; i < answers.length; i++) {
    const state = await (await call(undefined, player)).json();
    assert.equal(state.player.session.progress, i);
    assert.ok(
      state.areas.every(
        (a: Record<string, unknown>) => a.unlockCode === undefined,
      ),
    );
    assert.ok(!JSON.stringify(state).includes("tutorial-hidden-marker"));
    if (i === 2 || i === 3) assert.equal(state.areas[i].choices.length, 2);
    if (i === 4) {
      assert.equal(state.areas[i].kind, "qr");
      assert.equal(state.areas[i].qrMode, "prompted");
    }
    if (i === 5) {
      assert.equal(state.areas[i].kind, "hidden");
      assert.equal(state.areas[i].hint, "");
    }
    assert.equal(
      (await call({ action: "unlock", code: "wrong" }, player)).status,
      400,
    );
    assert.equal(
      (await call({ action: "unlock", code: answers[i] }, player)).status,
      200,
    );
  }
});

test("hidden QR finding clues appear only at the current challenge", async () => {
  const login = await call({ action: "login", key: settings().adminKey });
  const gm = login.headers.get("set-cookie")!.split(";")[0];
  const game = {
    id: "hidden-clues",
    name: "Hidden clues",
    controls: [],
    areas: ["first", "second"].map((id) => ({
      id,
      name: id,
      kind: "qr",
      qrMode: "hidden",
      hint: `Find the ${id} marker beneath the lamp.`,
      description: "Discovered",
      unlockCode: `secret-${id}`,
    })),
  };
  assert.equal((await call({ action: "save-game", game }, gm)).status, 200);
  const created = await (
    await call({ action: "create", gameId: game.id, name: "Clue seekers" }, gm)
  ).json();
  const joined = await call({ action: "join", id: created.id, name: "Seeker" });
  const player = joined.headers.get("set-cookie")!.split(";")[0];
  await call({ action: "status", id: created.id, status: "running" }, gm);
  for (let progress = 0; progress <= 2; progress++) {
    const state = await (await call(undefined, player)).json();
    for (let index = 0; index < 2; index++) {
      assert.equal(
        state.areas[index].hint,
        index === progress ? game.areas[index].hint : "",
      );
      assert.equal(state.areas[index].kind, "hidden");
      assert.equal(state.areas[index].unlockCode, undefined);
      assert.equal(state.areas[index].qrMode, undefined);
    }
    if (progress < 2)
      assert.equal(
        (
          await call(
            { action: "unlock", code: game.areas[progress].unlockCode },
            player,
          )
        ).status,
        200,
      );
  }
});

test("parallel challenges share out-of-order completions and protect revealed clue files", async () => {
  const gm = (await call({ action: "login", key: settings().adminKey })).headers
    .get("set-cookie")!
    .split(";")[0];
  const game = {
    id: "parallel-api",
    name: "Parallel API",
    controls: [],
    clues: [
      {
        id: "note",
        name: "Note",
        kind: "markdown",
        content: "**Secret note**",
      },
      {
        id: "photo",
        name: "Photo",
        kind: "image",
        content: "data:image/png;base64,YQ==",
      },
    ],
    areas: [
      {
        id: "a",
        name: "Alpha",
        kind: "text",
        hint: "Alpha hint",
        description: "Alpha solved",
        unlockCode: "alpha",
        requires: [],
        revealClues: ["note", "photo"],
      },
      {
        id: "b",
        name: "Beta",
        kind: "text",
        hint: "Beta hint",
        description: "Beta solved",
        unlockCode: "beta",
        requires: [],
      },
      {
        id: "c",
        name: "Final",
        kind: "text",
        hint: "Final hint",
        description: "Final solved",
        unlockCode: "final",
        requires: ["a", "b"],
      },
    ],
  };
  assert.equal((await call({ action: "save-game", game }, gm)).status, 200);
  const { id } = await (
    await call({ action: "create", name: "Parallel", gameId: game.id }, gm)
  ).json();
  const p = (await call({ action: "join", id, name: "One" })).headers
    .get("set-cookie")!
    .split(";")[0];
  const q = (await call({ action: "join", id, name: "Two" })).headers
    .get("set-cookie")!
    .split(";")[0];
  const media = (cookie: string) =>
    handle(
      new Request(`${origin}/api/game?clue=photo`, { headers: { cookie } }),
    );
  assert.equal((await media(p)).status, 404);
  assert.equal((await media(gm)).status, 404);
  await call({ action: "status", id, status: "running" }, gm);
  let state = await (await call(undefined, p)).json();
  assert.deepEqual(
    state.areas
      .filter((a: { available: boolean }) => a.available)
      .map((a: { id: string }) => a.id),
    ["a", "b"],
  );
  assert.deepEqual(state.clues, []);
  assert.equal(state.areas[2].hint, "");
  assert.equal(
    (await call({ action: "unlock", challengeId: "c", code: "final" }, p))
      .status,
    400,
  );
  assert.equal(
    (await call({ action: "unlock", challengeId: "b", code: "beta" }, p))
      .status,
    200,
  );
  assert.equal(
    (await call({ action: "unlock", challengeId: "b", code: "beta" }, q))
      .status,
    400,
  );
  state = await (await call(undefined, q)).json();
  assert.equal(state.areas[1].solved, true);
  assert.equal(state.areas[0].solved, false);
  assert.equal(state.player.session.progress, 1);
  assert.deepEqual(state.clues, []);
  assert.equal(
    (await call({ action: "unlock", challengeId: "a", code: "alpha" }, q))
      .status,
    200,
  );
  state = await (await call(undefined, p)).json();
  assert.equal(state.areas[2].available, true);
  assert.equal(state.clues[0].content, "**Secret note**");
  assert.equal(state.clues[1].content, "/api/game?clue=photo");
  assert.equal((await media(p)).headers.get("content-type"), "image/png");
  assert.equal(await (await media(q)).text(), "a");
  assert.equal((await media("")).status, 404);
  // Changing the template cannot alter clues or prerequisites in this session.
  game.clues[0].content = "Changed";
  await call({ action: "save-game", game }, gm);
  assert.equal(
    (await (await call(undefined, p)).json()).clues[0].content,
    "**Secret note**",
  );
  assert.equal(
    (await call({ action: "unlock", challengeId: "c", code: "final" }, p))
      .status,
    200,
  );
  assert.equal(
    (await (await call(undefined, q)).json()).player.session.progress,
    3,
  );
});

test("persistent timers start, pause, extend once, replace, expire and stop on completion", async () => {
  const gm = (await call({ action: "login", key: settings().adminKey })).headers
    .get("set-cookie")!
    .split(";")[0];
  for (const initial of [undefined, 10]) {
    const game = {
      id: initial ? "timed-game" : "untimed-game",
      name: "Timer",
      autoStart: true,
      timeLimitMinutes: initial,
      controls: [],
      areas: [
        {
          id: "a",
          name: "A",
          kind: "text",
          unlockCode: "a",
          hint: "",
          description: "",
          onComplete: [{ type: "timer", mode: "extend", minutes: 5 }],
        },
        {
          id: "b",
          name: "B",
          kind: "text",
          unlockCode: "b",
          hint: "",
          description: "",
          onComplete: [{ type: "timer", mode: "start", minutes: 2 }],
        },
        {
          id: "c",
          name: "C",
          kind: "text",
          unlockCode: "c",
          hint: "",
          description: "",
        },
      ],
    };
    assert.equal((await call({ action: "save-game", game }, gm)).status, 200);
    const { id } = await (
      await call({ action: "create", name: "Timer", gameId: game.id }, gm)
    ).json();
    const p = (await call({ action: "join", id, name: "Player" })).headers
      .get("set-cookie")!
      .split(";")[0];
    const current = async () =>
      (await (await call(undefined, p)).json()).player.session.timer;
    let timer = await current();
    if (initial) {
      assert.ok(timer.remainingMs <= 600000 && timer.remainingMs > 590000);
      assert.equal(timer.running, true);
    } else assert.equal(timer, null);
    assert.equal(
      (await call({ action: "unlock", code: "a", challengeId: "a" }, p)).status,
      200,
    );
    timer = await current();
    assert.ok(timer.remainingMs > (initial ? 890000 : 290000));
    assert.equal(
      (await call({ action: "unlock", code: "a", challengeId: "a" }, p)).status,
      400,
    );
    assert.ok((await current()).remainingMs <= timer.remainingMs);
    await call({ action: "status", id, status: "paused" }, gm);
    timer = await current();
    assert.equal(timer.running, false);
    assert.equal((await current()).remainingMs, timer.remainingMs);
    await call({ action: "status", id, status: "running" }, gm);
    assert.equal((await current()).running, true);
    assert.equal(
      (await call({ action: "unlock", code: "b", challengeId: "b" }, p)).status,
      200,
    );
    timer = await current();
    assert.ok(timer.remainingMs <= 120000 && timer.remainingMs > 110000);
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 180000;
      assert.equal((await current()).remainingMs, 0);
      assert.equal(
        (await call({ action: "unlock", code: "c", challengeId: "c" }, p))
          .status,
        200,
      );
      assert.equal((await current()).running, false);
    } finally {
      Date.now = realNow;
    }
    await call({ action: "status", id, status: "paused" }, gm);
    await call({ action: "status", id, status: "running" }, gm);
    assert.equal((await current()).running, false);
  }
});

test("joining Restart Ship starts without an opening challenge and exposes themed session metadata", async () => {
  const login = await call({ action: "login", key: settings().adminKey });
  const gm = login.headers.get("set-cookie")!.split(";")[0];
  const { id } = await (
    await call(
      { action: "create", name: "Ship", gameId: "starship-restart" },
      gm,
    )
  ).json();
  const lobby = await (await call()).json();
  assert.equal(
    lobby.sessions.find((s: { id: string }) => s.id === id).designScheme,
    "terminal",
  );
  const joined = await call({ action: "join", id, name: "Crew" });
  assert.equal(joined.status, 200);
  const p = joined.headers.get("set-cookie")!.split(";")[0];
  const current = await (await call(undefined, p)).json();
  assert.equal(current.player.session.progress, 0);
  assert.deepEqual(current.storyOrder, []);
  assert.match(current.briefing, /dark engine room/);
  assert.ok(!current.areas.some((a: { id: string }) => a.id === "boot"));
  for (const id of ["flower", "stomp", "comms"])
    assert.ok(current.areas.find((a: { id: string }) => a.id === id).available);
  assert.ok(
    current.areas.filter((a: { kind: string }) => a.kind === "qr").length === 0,
  );
  assert.equal(
    (await call({ action: "join", id, name: "Crew two" })).status,
    200,
  );
  assert.equal(
    (await (await call(undefined, p)).json()).player.session.progress,
    0,
  );
  for (const [code, message] of [
    ["87073809-4f0d-4aa2-91a3-7c126bfe8346", "not valid"],
    ["invalid-marker", "not valid"],
  ]) {
    const result = await call({ action: "unlock", code }, p);
    assert.equal(result.status, 400);
    assert.match((await result.json()).error, new RegExp(message));
  }
});

test("Restart Ship accepts the physical stomp marker regardless of selected challenge", async () => {
  const login = await call({ action: "login", key: settings().adminKey });
  const gm = login.headers.get("set-cookie")!.split(";")[0];
  const { id } = await (
    await call(
      {
        action: "create",
        name: "Stomp regression",
        gameId: "starship-restart",
      },
      gm,
    )
  ).json();
  const joined = await call({ action: "join", id, name: "Crew" });
  const p = joined.headers.get("set-cookie")!.split(";")[0];
  const scanned = await call(
    { action: "unlock", code: "4b4a0185-b358-4183-a2cb-0f6df14e439f" },
    p,
  );
  assert.equal(scanned.status, 200);
  const state = await (await call(undefined, p)).json();
  assert.ok(state.storyOrder.includes("stomp"));
  assert.equal(
    state.areas.find((a: { id: string }) => a.id === "stomp").solved,
    true,
  );
  const repeated = await call(
    { action: "unlock", code: "4b4a0185-b358-4183-a2cb-0f6df14e439f" },
    p,
  );
  assert.equal(repeated.status, 400);
  assert.match((await repeated.json()).error, /already been used/);
});

test("wrong color answers enforce a persistent five-second cooldown scoped to the player and challenge", async () => {
  const login = await call({ action: "login", key: settings().adminKey });
  const gm = login.headers.get("set-cookie")!.split(";")[0];
  const game = {
    id: "color-cooldown",
    name: "Color cooldown",
    controls: [],
    areas: [
      {
        id: "colors",
        name: "Colors",
        kind: "colors",
        hint: "Colors",
        description: "Solved",
        requires: [],
        choices: ["#ff0000", "#0000ff"],
        unlockCode: "#ff0000|#0000ff",
      },
      {
        id: "text",
        name: "Text",
        kind: "text",
        hint: "Text",
        description: "Solved",
        requires: [],
        unlockCode: "text",
      },
    ],
  };
  assert.equal((await call({ action: "save-game", game }, gm)).status, 200);
  const { id } = await (
    await call({ action: "create", name: "Cooldown", gameId: game.id }, gm)
  ).json();
  const p = (await call({ action: "join", id, name: "One" })).headers
    .get("set-cookie")!
    .split(";")[0];
  const q = (await call({ action: "join", id, name: "Two" })).headers
    .get("set-cookie")!
    .split(";")[0];
  await call({ action: "status", id, status: "running" }, gm);
  const originalNow = Date.now;
  const start = originalNow();
  let now = start;
  Date.now = () => now;
  try {
    assert.equal(
      (
        await call(
          { action: "unlock", challengeId: "colors", code: "#0000ff|#ff0000" },
          p,
        )
      ).status,
      400,
    );
    const state = await (await call(undefined, p)).json();
    assert.equal(
      state.areas.find((area: any) => area.id === "colors").retryAt,
      start + 5000,
    );
    const teammate = await (await call(undefined, q)).json();
    assert.equal(
      teammate.areas.find((area: any) => area.id === "colors").retryAt,
      undefined,
    );
    const attempt = {
      action: "unlock",
      challengeId: "colors",
      code: "#ff0000|#0000ff",
    };
    let blocked = await call(attempt, p);
    assert.match((await blocked.json()).error, /wait 5 seconds/);
    now = start + 4999;
    blocked = await call(attempt, p);
    assert.match((await blocked.json()).error, /wait 1 seconds/);
    assert.equal(
      (await call({ action: "unlock", challengeId: "text", code: "wrong" }, p))
        .status,
      400,
    );
    assert.equal(
      (await call({ action: "unlock", challengeId: "text", code: "text" }, p))
        .status,
      200,
    );
    now = start + 5000;
    assert.equal((await call(attempt, p)).status, 200);
  } finally {
    Date.now = originalNow;
  }
});

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const directory = mkdtempSync(join(tmpdir(), "threshold-test-"));
process.env.DATABASE_PATH = join(directory, "test.sqlite");
process.env.ADMIN_KEY = "test-key";
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
});

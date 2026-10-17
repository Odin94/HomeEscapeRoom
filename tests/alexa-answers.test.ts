import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AlexaAnswers } from "../src/lib/alexa-answers.server";

test("provisioning, dry-run tests, session gating and restart recovery", async () => {
  const directory = mkdtempSync(join(tmpdir(), "threshold-alexa-"));
  const original = {
    fetch: globalThis.fetch,
    WebSocket: globalThis.WebSocket,
    haUrl: process.env.HA_URL,
    haToken: process.env.HA_TOKEN,
    settings: process.env.SETTINGS_PATH,
    now: Date.now,
  };
  process.env.HA_URL = "http://ha.test";
  process.env.HA_TOKEN = "private-ha-token";
  process.env.SETTINGS_PATH = join(directory, "settings.json");
  const helpers = new Map<string, string>();
  const commands: Record<string, unknown>[] = [];
  let creates = 0;
  let failReset = false;
  let failAuth = true;
  let failExpose = false;
  class FakeSocket extends EventTarget {
    constructor() {
      super();
      queueMicrotask(() => this.message({ type: "auth_required" }));
    }
    message(value: unknown) {
      this.dispatchEvent(
        new MessageEvent("message", { data: JSON.stringify(value) }),
      );
    }
    send(value: string) {
      const command = JSON.parse(value);
      if (command.type === "auth") {
        assert.equal(command.access_token, "private-ha-token");
        queueMicrotask(() =>
          this.message({ type: failAuth ? "auth_invalid" : "auth_ok" }),
        );
        return;
      }
      commands.push(command);
      if (failExpose && command.type === "homeassistant/expose_entity") {
        queueMicrotask(() =>
          this.message({ id: command.id, type: "result", success: false }),
        );
        return;
      }
      let result: unknown;
      if (command.type === "input_boolean/list")
        result = [...helpers.keys()].map((entity) => ({
          id: entity.split(".")[1],
        }));
      if (command.type === "input_boolean/create") {
        creates++;
        const id = command.name.toLowerCase().replaceAll(" ", "_");
        helpers.set(`input_boolean.${id}`, "off");
        result = { id };
      }
      queueMicrotask(() =>
        this.message({ id: command.id, type: "result", success: true, result }),
      );
    }
    close() {
      this.dispatchEvent(new Event("close"));
    }
  }
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  globalThis.fetch = async (url, init) => {
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer private-ha-token",
    );
    if (String(url).endsWith("/states"))
      return Response.json(
        [...helpers].map(([entity_id, state]) => ({ entity_id, state })),
      );
    assert.ok(String(url).endsWith("/services/input_boolean/turn_off"));
    if (failReset) return new Response("failure", { status: 503 });
    helpers.set(JSON.parse(String(init?.body)).entity_id, "off");
    return Response.json([]);
  };
  let eligible: string | undefined;
  let solved = 0;
  const path = join(directory, "bindings.json");
  let bridge = new AlexaAnswers(
    path,
    () => eligible,
    async () => {
      solved++;
    },
  );
  try {
    await assert.rejects(
      bridge.setup("team-1", "challenge-1", "Team 1", "Room"),
      /rejected the token/,
    );
    assert.equal(creates, 0);
    failAuth = false;
    const first = await bridge.setup("team-1", "challenge-1", "Team 1", "Room");
    const again = await bridge.setup("team-1", "challenge-1", "Team 1", "Room");
    assert.equal(first.entity, again.entity);
    assert.equal(creates, 1, "retry must reuse the existing helper");
    const second = await bridge.setup(
      "team-2",
      "challenge-1",
      "Team 2",
      "Room",
    );
    assert.notEqual(first.entity, second.entity);
    assert.ok(
      commands.some(
        (c) =>
          c.type === "homeassistant/expose_entity" && c.should_expose === true,
      ),
    );
    assert.equal(bridge.get("unknown", "challenge-1"), null);

    // A paused/future challenge signal is reset and discarded.
    helpers.set(first.entity, "on");
    await bridge.poll();
    assert.equal(solved, 0);
    assert.equal(helpers.get(first.entity), "off");
    eligible = "stage-1";
    await bridge.poll();
    helpers.set(first.entity, "on");
    await bridge.poll();
    assert.equal(solved, 1);
    await bridge.poll();
    assert.equal(solved, 1, "held/reset helper cannot replay completion");

    // A dry-run on the active stage receives real signals without advancing it.
    await bridge.test("team-1", "challenge-1");
    await bridge.poll();
    assert.equal(bridge.get("team-1", "challenge-1")?.readyToTest, true);
    helpers.set(first.entity, "on");
    await bridge.poll();
    assert.equal(solved, 1);
    assert.equal(bridge.get("team-1", "challenge-1")?.tested, true);
    await bridge.test("team-1", "challenge-1");
    await bridge.poll();
    Date.now = () => original.now() + 61000;
    await bridge.poll();
    assert.equal(bridge.get("team-1", "challenge-1")?.testing, false);
    assert.match(
      bridge.get("team-1", "challenge-1")?.error || "",
      /60 seconds/,
    );
    await bridge.poll();
    assert.match(
      bridge.get("team-1", "challenge-1")?.error || "",
      /60 seconds/,
    );
    assert.equal(solved, 1);
    Date.now = original.now;

    // Recover mappings, but discard a signal left on during downtime.
    bridge.close();
    helpers.set(first.entity, "on");
    bridge = new AlexaAnswers(
      path,
      () => eligible,
      async () => {
        solved++;
      },
    );
    await bridge.poll();
    assert.equal(solved, 1);
    await bridge.poll();
    helpers.set(first.entity, "on");
    failReset = true;
    await bridge.poll();
    assert.equal(solved, 1, "failed reset must not advance the game");
    assert.ok(bridge.get("team-1", "challenge-1")?.error);
    failReset = false;
    await bridge.poll();
    assert.equal(solved, 1, "recovery discards the stale on value");
    await bridge.poll();
    helpers.set(first.entity, "on");
    await bridge.poll();
    assert.equal(solved, 2);

    failExpose = true;
    const manualExposure = await bridge.setup(
      "team-3",
      "challenge-1",
      "Team 3",
      "Room",
    );
    assert.match(
      manualExposure.warning,
      /Expose this helper to Alexa manually/,
    );
    assert.ok(bridge.get("team-3", "challenge-1"));

    process.env.HA_URL = "http://other-ha.test";
    assert.equal(
      bridge.get("team-1", "challenge-1"),
      null,
      "bindings must not move to another HA server",
    );
  } finally {
    bridge.close();
    globalThis.fetch = original.fetch;
    globalThis.WebSocket = original.WebSocket;
    Date.now = original.now;
    for (const [key, value] of [
      ["HA_URL", original.haUrl],
      ["HA_TOKEN", original.haToken],
      ["SETTINGS_PATH", original.settings],
    ]) {
      if (value === undefined) delete process.env[key!];
      else process.env[key!] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

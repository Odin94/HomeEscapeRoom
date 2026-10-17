import { test } from "node:test";
import assert from "node:assert/strict";
import { vacuumSchema } from "../src/lib/vacuum";
import { moveVacuum } from "../src/lib/vacuum.server";
import { saveSettings } from "../src/lib/settings.server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("vacuum actions validate destinations, entity domains and short durations", () => {
  const base = { type: "vacuum", entity: "vacuum.roborock", movement: "goto" };
  assert.equal(vacuumSchema.safeParse(base).success, false);
  assert.equal(
    vacuumSchema.safeParse({ ...base, x: 25000, y: 27000 }).success,
    true,
  );
  assert.equal(
    vacuumSchema.safeParse({ ...base, entity: "light.lamp", x: 1, y: 2 })
      .success,
    false,
  );
  assert.equal(
    vacuumSchema.safeParse({ ...base, movement: "forward", seconds: 6 })
      .success,
    false,
  );
});

test("go-to never cleans; remote failure still stops and exits remote mode", async () => {
  const directory = mkdtempSync(join(tmpdir(), "vacuum-test-"));
  const previousPath = process.env.SETTINGS_PATH;
  process.env.SETTINGS_PATH = join(directory, "settings.json");
  const original = globalThis.fetch;
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  try {
    saveSettings({
      haUrl: "http://ha.test",
      haToken: "test",
      adminKey: "test-password",
      publicUrl: "",
    });
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(String(init?.body));
      sent.push({ url: String(url), body });
      return new Response("{}", {
        status: body.command === "app_rc_move" ? 500 : 200,
      });
    };
    await moveVacuum({
      type: "vacuum",
      entity: "vacuum.robot",
      movement: "goto",
      x: 25000,
      y: 27000,
    });
    assert.ok(sent[0].url.endsWith("/roborock/set_vacuum_goto_position"));
    assert.deepEqual(sent[0].body, {
      entity_id: "vacuum.robot",
      x: 25000,
      y: 27000,
    });
    await assert.rejects(
      moveVacuum({
        type: "vacuum",
        entity: "vacuum.robot",
        movement: "spin-left",
        seconds: 1,
      }),
    );
    assert.deepEqual(
      sent.slice(1).map((item) => item.body.command),
      ["app_rc_start", "app_rc_move", "app_rc_stop", "app_rc_end"],
    );
    assert.deepEqual(sent[2].body.params, [
      { velocity: 0, omega: 0.5, duration: 1000, seqnum: 1 },
    ]);
  } finally {
    globalThis.fetch = original;
    if (previousPath === undefined) delete process.env.SETTINGS_PATH;
    else process.env.SETTINGS_PATH = previousPath;
    rmSync(directory, { recursive: true, force: true });
  }
});

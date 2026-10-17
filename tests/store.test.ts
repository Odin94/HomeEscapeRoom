import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/lib/store.server";
import { sessions } from "../src/lib/schema.server";

test("adopting an existing raw-SQL database preserves all rows and constraints", () => {
  const directory = mkdtempSync(join(tmpdir(), "threshold-legacy-"));
  const path = join(directory, "legacy.sqlite");
  try {
    const legacy = new DatabaseSync(path);
    legacy.exec(`PRAGMA foreign_keys=ON;
CREATE TABLE sessions(id TEXT PRIMARY KEY,name TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',progress INTEGER NOT NULL DEFAULT 0,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE players(token TEXT PRIMARY KEY,name TEXT NOT NULL,session_id TEXT NOT NULL REFERENCES sessions(id));
CREATE TABLE events(id INTEGER PRIMARY KEY AUTOINCREMENT,session_id TEXT,message TEXT NOT NULL,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE admins(token TEXT PRIMARY KEY);
INSERT INTO sessions VALUES ('legacy','Existing adventure','paused',2,'2026-10-15 20:00:00');
INSERT INTO players VALUES ('player-token','Ada','legacy');
INSERT INTO events VALUES (17,'legacy','An earlier discovery','2026-10-15 20:01:00');
INSERT INTO admins VALUES ('gm-token');`);
    const tables = ["sessions", "players", "events", "admins"];
    const before = tables.map((t) =>
      legacy.prepare(`SELECT * FROM ${t}`).all(),
    );
    legacy.close();
    const db = openStore(path);
    try {
      assert.deepEqual(db.select().from(sessions).get(), { ...before[0][0] });
      assert.deepEqual(
        tables.map((t) => db.$client.prepare(`SELECT * FROM ${t}`).all()),
        before,
      );
      assert.deepEqual(
        db.$client.prepare("PRAGMA foreign_key_check").all(),
        [],
      );
      assert.equal(
        db.$client.prepare("PRAGMA integrity_check").get()!.integrity_check,
        "ok",
      );
      assert.equal(
        db.$client
          .prepare("SELECT count(*) AS count FROM __drizzle_migrations")
          .get()!.count,
        3,
      );
    } finally {
      db.$client.close();
    }
    const reopened = openStore(path);
    try {
      assert.equal(reopened.select().from(sessions).get()!.progress, 2);
      assert.equal(
        reopened.$client
          .prepare("SELECT count(*) AS count FROM __drizzle_migrations")
          .get()!.count,
        3,
      );
    } finally {
      reopened.$client.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test("incompatible legacy schemas fail before migration history is recorded", () => {
  const directory = mkdtempSync(join(tmpdir(), "threshold-drift-"));
  const path = join(directory, "drift.sqlite");
  try {
    const legacy = new DatabaseSync(path);
    legacy.exec(
      "CREATE TABLE sessions(id TEXT PRIMARY KEY, name TEXT NOT NULL)",
    );
    legacy.close();
    assert.throws(() => openStore(path), /schema mismatch/);
    const check = new DatabaseSync(path);
    try {
      assert.equal(
        check
          .prepare(
            "SELECT name FROM sqlite_master WHERE name='__drizzle_migrations'",
          )
          .get(),
        undefined,
      );
    } finally {
      check.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

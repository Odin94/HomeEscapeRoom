import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/lib/store.server";
import { sessionTimers, sessions } from "../src/lib/schema.server";
import { gameSchema, loadGames } from "../src/lib/game.server";

test("retired password challenges migrate in saved snapshots without losing session data", () => {
  const directory = mkdtempSync(
    join(tmpdir(), "threshold-challenge-migration-"),
  );
  const path = join(directory, "game.sqlite");
  const game = loadGames().find((game) => game.id === "signal-house")!;
  const retired = structuredClone(game);
  // Simulate data saved before the password type was removed.
  const definition = JSON.stringify(retired).replace(
    '"kind":"text"',
    '"kind":"password"',
  );
  try {
    const db = openStore(path);
    db.$client.exec(
      "DELETE FROM __drizzle_migrations WHERE id >= (SELECT id FROM __drizzle_migrations ORDER BY id DESC LIMIT 1 OFFSET 3)",
    );
    db.$client
      .prepare(
        "INSERT INTO sessions(id,name,status,progress) VALUES ('room','In progress','paused',2)",
      )
      .run();
    db.$client
      .prepare(
        "INSERT INTO session_games(session_id,definition) VALUES ('room',?)",
      )
      .run(definition);
    db.$client
      .prepare(
        "INSERT INTO players(token,name,session_id) VALUES ('player','Ada','room')",
      )
      .run();
    db.$client.exec(
      "DROP TABLE color_attempts; DROP TABLE session_timers; DROP TABLE challenge_completions",
    );
    db.$client.close();

    for (let attempt = 0; attempt < 2; attempt++) {
      const migrated = openStore(path);
      try {
        const saved = migrated.$client
          .prepare(
            "SELECT definition FROM session_games WHERE session_id='room'",
          )
          .get()!;
        assert.deepEqual(
          gameSchema.parse(JSON.parse(saved.definition as string)),
          game,
        );
        assert.equal(migrated.select().from(sessions).get()!.progress, 2);
        assert.deepEqual(
          migrated.$client
            .prepare(
              "SELECT challenge_id FROM challenge_completions WHERE session_id='room' ORDER BY rowid",
            )
            .all()
            .map((r) => r.challenge_id),
          game.areas.slice(0, 2).map((a) => a.id),
        );
        assert.equal(migrated.select().from(sessions).get()!.status, "paused");
        assert.equal(
          migrated.$client
            .prepare("SELECT count(*) AS count FROM players")
            .get()!.count,
          1,
        );
        assert.deepEqual(
          migrated.$client.prepare("PRAGMA foreign_key_check").all(),
          [],
        );
        assert.equal(
          migrated.$client.prepare("PRAGMA integrity_check").get()!
            .integrity_check,
          "ok",
        );
      } finally {
        migrated.$client.close();
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

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
        7,
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
        7,
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

test("session countdown survives reopening the database", () => {
  const directory = mkdtempSync(join(tmpdir(), "threshold-timer-"));
  const path = join(directory, "timer.sqlite");
  try {
    const db = openStore(path);
    db.insert(sessions).values({ id: "timer", name: "Timer" }).run();
    db.insert(sessionTimers)
      .values({ session_id: "timer", remaining_ms: 90000, resumed_at: 123456 })
      .run();
    db.$client.close();
    const reopened = openStore(path);
    try {
      assert.deepEqual(reopened.select().from(sessionTimers).get(), {
        session_id: "timer",
        remaining_ms: 90000,
        resumed_at: 123456,
      });
      assert.equal(
        reopened.$client.prepare("PRAGMA integrity_check").get()!
          .integrity_check,
        "ok",
      );
      assert.deepEqual(
        reopened.$client.prepare("PRAGMA foreign_key_check").all(),
        [],
      );
    } finally {
      reopened.$client.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

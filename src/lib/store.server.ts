import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import * as schema from "./schema.server";

export function openStore(path: string) {
  mkdirSync(dirname(path), { recursive: true });
  const client = new DatabaseSync(path);
  try {
    client.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
    );
    // Adopt the original schema only when its columns still match. Never hide drift
    // by recording an unapplied baseline against incompatible existing tables.
    const history = client
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'",
      )
      .get();
    if (!history) {
      const reference = new DatabaseSync(":memory:");
      try {
        reference.exec(
          readFileSync(
            resolve("drizzle/20261016143805_elite_overlord/migration.sql"),
            "utf8",
          ),
        );
        for (const table of Object.values(schema)) {
          const name = getTableConfig(table).name;
          const existing = client.prepare(`PRAGMA table_info("${name}")`).all();
          if (!existing.length) continue;
          for (const pragma of ["table_info", "foreign_key_list"]) {
            const statement = `PRAGMA ${pragma}("${name}")`;
            if (
              JSON.stringify(client.prepare(statement).all()) !==
              JSON.stringify(reference.prepare(statement).all())
            )
              throw new Error(
                `Database schema mismatch in ${name}. Back up the database and resolve the drift before starting.`,
              );
          }
        }
      } finally {
        reference.close();
      }
    }
    const db = drizzle({ client });
    migrate(db, { migrationsFolder: resolve("drizzle") });
    return db;
  } catch (error) {
    client.close();
    throw error;
  }
}

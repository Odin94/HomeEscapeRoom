import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status").notNull().default("open"),
  progress: integer("progress").notNull().default(0),
  created: text("created")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});
export const players = sqliteTable("players", {
  token: text("token").primaryKey(),
  name: text("name").notNull(),
  session_id: text("session_id")
    .notNull()
    .references(() => sessions.id),
});
export const events = sqliteTable("events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  session_id: text("session_id"),
  message: text("message").notNull(),
  created: text("created")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});
export const admins = sqliteTable("admins", {
  token: text("token").primaryKey(),
});

export const sessionGames = sqliteTable("session_games", {
  session_id: text("session_id")
    .primaryKey()
    .references(() => sessions.id),
  definition: text("definition").notNull(),
});

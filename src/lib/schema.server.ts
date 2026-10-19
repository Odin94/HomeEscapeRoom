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

export const sessionAutomation = sqliteTable("session_automation", {
  session_id: text("session_id")
    .primaryKey()
    .references(() => sessions.id),
  token: text("token").notNull(),
});
export const actionRuns = sqliteTable("action_runs", {
  id: text("id").primaryKey(),
  session_id: text("session_id")
    .notNull()
    .references(() => sessions.id),
  payload: text("payload").notNull(),
  status: text("status").notNull().default("pending"),
  error: text("error"),
});

export const challengeCompletions = sqliteTable("challenge_completions", {
  id: text("id").primaryKey(),
  session_id: text("session_id")
    .notNull()
    .references(() => sessions.id),
  challenge_id: text("challenge_id").notNull(),
});

export const sessionTimers = sqliteTable("session_timers", {
  session_id: text("session_id")
    .primaryKey()
    .references(() => sessions.id),
  remaining_ms: integer("remaining_ms").notNull(),
  resumed_at: integer("resumed_at"),
});

export const colorAttempts = sqliteTable("color_attempts", {
  id: text("id").primaryKey(),
  retry_at: integer("retry_at").notNull(),
});

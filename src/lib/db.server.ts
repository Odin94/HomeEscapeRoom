import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { dirname } from "node:path";
import { nextUnlock } from "./game";
const databasePath = process.env.DATABASE_PATH || "data/threshold.sqlite";
mkdirSync(dirname(databasePath), { recursive: true });
const db = new DatabaseSync(databasePath);
export function closeStore() {
  db.close();
}
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,name TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',progress INTEGER NOT NULL DEFAULT 0,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS players(token TEXT PRIMARY KEY,name TEXT NOT NULL,session_id TEXT NOT NULL REFERENCES sessions(id));
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,session_id TEXT,message TEXT NOT NULL,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS admins(token TEXT PRIMARY KEY);
`);
if (!db.prepare("SELECT id FROM sessions LIMIT 1").get())
  db.prepare("INSERT INTO sessions(id,name) VALUES (?,?)").run(
    "signal-house",
    "The Signal House",
  );
function event(id: string | null, message: string) {
  db.prepare("INSERT INTO events(session_id,message) VALUES (?,?)").run(
    id,
    message,
  );
}
function cookie(request: Request, name: string) {
  return (
    request.headers
      .get("cookie")
      ?.split("; ")
      .find((x) => x.startsWith(name + "="))
      ?.slice(name.length + 1) || ""
  );
}
function admin(request: Request) {
  return !!db
    .prepare("SELECT token FROM admins WHERE token=?")
    .get(cookie(request, "gm"));
}
function player(request: Request) {
  return db
    .prepare("SELECT name,session_id FROM players WHERE token=?")
    .get(cookie(request, "player")) as
    { name: string; session_id: string } | undefined;
}
function secret(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function session(id: string) {
  const s = db.prepare("SELECT * FROM sessions WHERE id=?").get(id) as any;
  if (!s) throw new Error("Game not found.");
  return s;
}
const headers = { "content-type": "application/json" };
const reply = (data: unknown, setCookie?: string) =>
  new Response(JSON.stringify(data), {
    headers: { ...headers, ...(setCookie ? { "set-cookie": setCookie } : {}) },
  });
export async function handle(request: Request) {
  try {
    const isAdmin = admin(request),
      p = player(request);
    if (request.method === "GET")
      return reply({
        admin: isAdmin,
        demo: !process.env.HA_URL,
        adminConfigured: !!process.env.ADMIN_KEY,
        sessions: db
          .prepare(
            "SELECT id,name,status,progress,(SELECT count(*) FROM players WHERE session_id=sessions.id) players FROM sessions ORDER BY created DESC LIMIT 100",
          )
          .all(),
        player: p ? { ...p, session: session(p.session_id) } : null,
        ...(isAdmin
          ? {
              events: db
                .prepare("SELECT * FROM events ORDER BY id DESC LIMIT 60")
                .all(),
              players: db.prepare("SELECT name,session_id FROM players").all(),
            }
          : {}),
      });
    if (request.method !== "POST")
      return new Response("Method not allowed", { status: 405 });
    if (request.headers.get("origin") !== new URL(request.url).origin)
      return new Response("Invalid origin", { status: 403 });
    const body = await request.json();
    const { action } = body;
    if (action === "login") {
      if (!secret(String(body.key || ""), process.env.ADMIN_KEY || "demo"))
        throw new Error("Incorrect game master key.");
      const token = randomUUID();
      db.prepare("INSERT INTO admins VALUES (?)").run(token);
      return reply(
        { ok: true },
        `gm=${token}; HttpOnly; SameSite=Strict; Path=/`,
      );
    }
    if (action === "join") {
      const name = String(body.name || "").trim();
      if (!name || name.length > 40)
        throw new Error("Enter a name between 1 and 40 characters.");
      const s = session(body.id);
      if (s.status !== "open")
        throw new Error("This game is not accepting players.");
      const token = randomUUID();
      db.prepare("INSERT INTO players VALUES (?,?,?)").run(token, name, s.id);
      event(s.id, `${name} joined the game`);
      return reply(
        { ok: true },
        `player=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`,
      );
    }
    if (action === "leave")
      return reply(
        { ok: true },
        "player=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
      );
    if (action === "unlock") {
      if (!p) throw new Error("Join a game first.");
      const s = session(p.session_id);
      if (s.status !== "running")
        throw new Error("Your game master needs to start or resume the game.");
      const progress = nextUnlock(s.progress, String(body.code || ""));
      db.prepare(
        "UPDATE sessions SET progress=? WHERE id=? AND progress=?",
      ).run(progress, s.id, s.progress);
      event(
        s.id,
        `${p.name} unlocked ${["the study", "the archive", "the observatory"][progress - 1]}`,
      );
      return reply({ ok: true });
    }
    if (!isAdmin)
      return new Response(
        JSON.stringify({ error: "Game master access required." }),
        { status: 401, headers },
      );
    if (action === "logout") {
      db.prepare("DELETE FROM admins WHERE token=?").run(cookie(request, "gm"));
      return reply(
        { ok: true },
        "gm=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
      );
    }
    if (action === "create") {
      const name = String(body.name || "").trim();
      if (!name || name.length > 80)
        throw new Error("Enter a session name (1–80 characters).");
      const id = randomUUID();
      db.prepare("INSERT INTO sessions(id,name) VALUES (?,?)").run(id, name);
      event(id, "Session created");
      return reply({ ok: true, id });
    }
    if (action === "status") {
      session(body.id);
      if (!["open", "running", "paused", "closed"].includes(body.status))
        throw new Error("Invalid status");
      db.prepare("UPDATE sessions SET status=? WHERE id=?").run(
        body.status,
        body.id,
      );
      event(body.id, `Session ${body.status}`);
      return reply({ ok: true });
    }
    if (action === "advance") {
      const s = session(body.id);
      if (s.progress >= 3) throw new Error("All areas are unlocked.");
      db.prepare("UPDATE sessions SET progress=progress+1 WHERE id=?").run(
        s.id,
      );
      event(s.id, "Game master unlocked the next area");
      return reply({ ok: true });
    }
    if (action === "device") {
      const devices: Record<
        string,
        { domain: string; service: string; entity: string | undefined }
      > = {
        lights: {
          domain: "light",
          service: body.on ? "turn_on" : "turn_off",
          entity: process.env.HA_LIGHT_ENTITY,
        },
        scene: {
          domain: "scene",
          service: "turn_on",
          entity: process.env.HA_SCENE_ENTITY,
        },
        voice: {
          domain: "script",
          service: "turn_on",
          entity: process.env.HA_VOICE_SCRIPT,
        },
      };
      const d = devices[body.device];
      if (!d) throw new Error("Unknown control");
      if (process.env.HA_URL) {
        if (!process.env.HA_TOKEN || !d.entity)
          throw new Error(
            "Configure the Home Assistant token and entity in .env.",
          );
        const response = await fetch(
          `${process.env.HA_URL.replace(/\/$/, "")}/api/services/${d.domain}/${d.service}`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.HA_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ entity_id: d.entity }),
            signal: AbortSignal.timeout(8000),
          },
        );
        if (!response.ok)
          throw new Error(
            `Home Assistant returned ${response.status}. Check your token and entity.`,
          );
      }
      event(
        null,
        `${process.env.HA_URL ? "Sent" : "Demo"}: ${body.device} ${body.device === "lights" ? (body.on ? "on" : "off") : "triggered"}`,
      );
      return reply({ ok: true, demo: !process.env.HA_URL });
    }
    throw new Error("Unknown action");
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Request failed",
      }),
      { status: 400, headers },
    );
  }
}

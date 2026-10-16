import { randomUUID, timingSafeEqual } from "node:crypto";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { admins, events, players, sessions } from "./schema.server";
import { openStore } from "./store.server";
import { areas, nextUnlock, unlockCodes } from "./game.server";
const databasePath = process.env.DATABASE_PATH || "data/threshold.sqlite";
const db = openStore(databasePath);
export function closeStore() {
  db.$client.close();
}
if (!db.select({ id: sessions.id }).from(sessions).limit(1).get())
  db.insert(sessions)
    .values({ id: "signal-house", name: "The Signal House" })
    .run();
function event(id: string | null, message: string) {
  db.insert(events).values({ session_id: id, message }).run();
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
  if (process.env.HA_URL && !process.env.ADMIN_KEY) return false;
  return !!db
    .select()
    .from(admins)
    .where(eq(admins.token, cookie(request, "gm")))
    .get();
}
function player(request: Request) {
  return db
    .select({ name: players.name, session_id: players.session_id })
    .from(players)
    .where(eq(players.token, cookie(request, "player")))
    .get();
}
function secret(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function session(id: string) {
  const s = db.select().from(sessions).where(eq(sessions.id, id)).get();
  if (!s) throw new Error("Game not found.");
  return s;
}
const headers = {
  "content-type": "application/json",
  "cache-control": "no-store",
};
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
        areas: areas.map((area, index) =>
          isAdmin
            ? { ...area, unlockCode: unlockCodes[index] }
            : {
                id: area.id,
                kind: area.kind,
                name:
                  p && index < session(p.session_id).progress
                    ? area.name
                    : "An unopened door",
                hint:
                  p && index === session(p.session_id).progress
                    ? area.hint
                    : "",
                description:
                  p && index < session(p.session_id).progress
                    ? area.description
                    : "",
              },
        ),
        sessions: db
          .select({
            id: sessions.id,
            name: sessions.name,
            status: sessions.status,
            progress: sessions.progress,
            players:
              sql<number>`(select count(*) from ${players} where ${players.session_id} = ${sessions.id})`.mapWith(
                Number,
              ),
          })
          .from(sessions)
          .where(
            isAdmin
              ? undefined
              : or(
                  eq(sessions.status, "open"),
                  eq(sessions.id, p?.session_id || ""),
                ),
          )
          .orderBy(desc(sessions.created))
          .limit(100)
          .all(),
        player: p ? { ...p, session: session(p.session_id) } : null,
        ...(isAdmin
          ? {
              events: db
                .select()
                .from(events)
                .orderBy(desc(events.id))
                .limit(60)
                .all(),
              players: db
                .select({ name: players.name, session_id: players.session_id })
                .from(players)
                .all(),
            }
          : {}),
      });
    if (request.method !== "POST")
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers,
      });
    if (request.headers.get("origin") !== new URL(request.url).origin)
      return new Response(
        JSON.stringify({
          error: "Invalid origin. Reload the app and try again.",
        }),
        { status: 403, headers },
      );
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error("Expected a JSON object.");
    const { action } = body;
    if (action === "login") {
      if (process.env.HA_URL && !process.env.ADMIN_KEY)
        throw new Error("Set ADMIN_KEY before connecting real devices.");
      if (!secret(String(body.key || ""), process.env.ADMIN_KEY || "demo"))
        throw new Error("Incorrect game master key.");
      const token = randomUUID();
      db.insert(admins).values({ token }).run();
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
      db.insert(players).values({ token, name, session_id: s.id }).run();
      db.delete(players)
        .where(eq(players.token, cookie(request, "player")))
        .run();
      event(s.id, `${name} joined the game`);
      return reply(
        { ok: true },
        `player=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`,
      );
    }
    if (action === "leave") {
      db.delete(players)
        .where(eq(players.token, cookie(request, "player")))
        .run();
      return reply(
        { ok: true },
        "player=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
      );
    }
    if (action === "unlock") {
      if (!p) throw new Error("Join a game first.");
      const s = session(p.session_id);
      if (s.status !== "running")
        throw new Error("Your game master needs to start or resume the game.");
      const progress = nextUnlock(s.progress, String(body.code || ""));
      db.update(sessions)
        .set({ progress })
        .where(and(eq(sessions.id, s.id), eq(sessions.progress, s.progress)))
        .run();
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
      db.delete(admins)
        .where(eq(admins.token, cookie(request, "gm")))
        .run();
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
      db.insert(sessions).values({ id, name }).run();
      event(id, "Session created");
      return reply({ ok: true, id });
    }
    if (action === "status") {
      session(body.id);
      if (!["open", "running", "paused", "closed"].includes(body.status))
        throw new Error("Invalid status");
      db.update(sessions)
        .set({ status: body.status })
        .where(eq(sessions.id, body.id))
        .run();
      event(body.id, `Session ${body.status}`);
      return reply({ ok: true });
    }
    if (action === "advance") {
      const s = session(body.id);
      if (s.progress >= 3) throw new Error("All areas are unlocked.");
      db.update(sessions)
        .set({ progress: sql`${sessions.progress} + 1` })
        .where(eq(sessions.id, s.id))
        .run();
      event(s.id, "Game master unlocked the next area");
      return reply({ ok: true });
    }
    if (action === "device") {
      if (body.device === "lights" && typeof body.on !== "boolean")
        throw new Error("Choose lights on or off.");
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
      const d = Object.hasOwn(devices, body.device)
        ? devices[body.device]
        : undefined;
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

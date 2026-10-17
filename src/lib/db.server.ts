import { randomUUID, timingSafeEqual } from "node:crypto";
import { and, desc, eq, or, sql } from "drizzle-orm";
import {
  admins,
  events,
  players,
  sessions,
  sessionGames,
} from "./schema.server";
import { openStore } from "./store.server";
import { loadGames, saveGame, gameSchema, nextUnlock } from "./game.server";
import { settings, saveSettings } from "./settings.server";
import { lanOrigin } from "./network.server";
const databasePath = process.env.DATABASE_PATH || "data/threshold.sqlite";
const db = openStore(databasePath);
export function closeStore() {
  db.$client.close();
}
if (!db.select({ id: sessions.id }).from(sessions).limit(1).get())
  db.insert(sessions)
    .values({ id: "signal-house", name: "The Signal House" })
    .run();
// Freeze legacy sessions once when adopting the game model.
for (const existing of db.select().from(sessions).all()) {
  if (
    !db
      .select()
      .from(sessionGames)
      .where(eq(sessionGames.session_id, existing.id))
      .get()
  ) {
    db.insert(sessionGames)
      .values({
        session_id: existing.id,
        definition: JSON.stringify(loadGames()[0]),
      })
      .run();
  }
}
function definition(id: string) {
  const saved = db
    .select()
    .from(sessionGames)
    .where(eq(sessionGames.session_id, id))
    .get();
  if (!saved) throw new Error("Session game definition not found.");
  return gameSchema.parse(JSON.parse(saved.definition));
}
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
  if (settings().haUrl && !settings().adminKey) return false;
  return !!db
    .select()
    .from(admins)
    .where(eq(admins.token, cookie(request, "gm")))
    .get();
}
function player(request: Request) {
  const found = db
    .select({ name: players.name, session_id: players.session_id })
    .from(players)
    .where(eq(players.token, cookie(request, "player")))
    .get();
  return found && session(found.session_id).status !== "closed"
    ? found
    : undefined;
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
    if (request.method === "GET") {
      const games = loadGames();
      const active = p ? definition(p.session_id) : games[0];
      const areas = active?.areas || [];
      return reply({
        admin: isAdmin,
        demo: !settings().haUrl,
        adminConfigured: !!settings().adminKey,
        areas: areas.map((area, index) =>
          isAdmin
            ? { ...area, unlockCode: area.unlockCode }
            : {
                id: area.id,
                kind: area.kind,
                playerView: area.playerView,
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
              games,
              shareOrigin: settings().publicUrl || lanOrigin(request.url),
              settings: {
                publicUrl: settings().publicUrl,
                haUrl: settings().haUrl,
                tokenConfigured: !!settings().haToken,
              },
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
    }
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
      if (settings().haUrl && !settings().adminKey)
        throw new Error("Set ADMIN_KEY before connecting real devices.");
      if (!secret(String(body.key || ""), settings().adminKey || "demo"))
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
        `player=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000`,
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
      const progress = nextUnlock(
        s.progress,
        String(body.code || ""),
        definition(s.id),
      );
      db.update(sessions)
        .set({ progress })
        .where(and(eq(sessions.id, s.id), eq(sessions.progress, s.progress)))
        .run();
      event(
        s.id,
        `${p.name} unlocked ${definition(s.id).areas[progress - 1].name}`,
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
    if (action === "session-definition")
      return reply({ game: definition(String(body.id)) });
    if (action === "save-settings") {
      saveSettings(body);
      db.delete(admins)
        .where(sql`${admins.token} != ${cookie(request, "gm")}`)
        .run();
      return reply({ ok: true });
    }
    if (action === "save-game") {
      saveGame(body.game);
      return reply({ ok: true });
    }
    if (action === "create") {
      const name = String(body.name || "").trim();
      if (!name || name.length > 80)
        throw new Error("Enter a session name (1–80 characters).");
      const id = randomUUID();
      const game = loadGames().find(
        (g) => g.id === (body.gameId || "signal-house"),
      );
      if (!game) throw new Error("Choose an existing game.");
      db.transaction((tx) => {
        tx.insert(sessions).values({ id, name }).run();
        tx.insert(sessionGames)
          .values({ session_id: id, definition: JSON.stringify(game) })
          .run();
      });
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
      if (body.status === "closed") {
        db.delete(players).where(eq(players.session_id, body.id)).run();
      }
      event(body.id, `Session ${body.status}`);
      return reply({ ok: true });
    }
    if (action === "advance") {
      const s = session(body.id);
      if (s.progress >= definition(s.id).areas.length)
        throw new Error("All areas are unlocked.");
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
      const game = definition(String(body.id || "signal-house"));
      const control = game.controls.find((c) => c.id === body.device);
      if (!control) throw new Error("Unknown control");
      const domain = control.entity.split(".")[0];
      if (domain === "light" && typeof body.on !== "boolean")
        throw new Error("Choose lights on or off.");
      const d = {
        domain,
        service: domain === "light" && !body.on ? "turn_off" : "turn_on",
        entity: control.entity,
      };
      if (settings().haUrl) {
        if (!settings().haToken || !d.entity)
          throw new Error(
            "Configure the Home Assistant connection in admin settings.",
          );
        const response = await fetch(
          `${settings().haUrl.replace(/\/$/, "")}/api/services/${d.domain}/${d.service}`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${settings().haToken}`,
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
        `${settings().haUrl ? "Sent" : "Demo"}: ${body.device} ${body.device === "lights" ? (body.on ? "on" : "off") : "triggered"}`,
      );
      return reply({ ok: true, demo: !settings().haUrl });
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

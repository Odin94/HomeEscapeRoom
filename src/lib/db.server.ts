import {
  voiceHealth,
  boundedBody,
  limited,
  transcribe,
  synthesize,
} from "./voice-runtime.server";
import { roomCommand } from "./voice-room.server";
import { availableChallenges, revealedClues } from "./challenge-progress";
import { moveVacuum } from "./vacuum.server";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { dirname, join } from "node:path";
import { AlexaAnswers } from "./alexa-answers.server";
import { and, desc, eq, or, sql } from "drizzle-orm";
import {
  sessionTimers,
  challengeCompletions,
  actionRuns,
  sessionAutomation,
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
import { speechTargets, speak, lightTargets, ha } from "./speech.server";
import { lightTransitionSchema } from "./light-transition";
import { LightLoops } from "./light-loops.server";
const lightLoops = new LightLoops();
let closing = false;
const databasePath = process.env.DATABASE_PATH || "data/threshold.sqlite";
const db = openStore(databasePath);
db.update(actionRuns)
  .set({
    status: "failed",
    error:
      "Server restarted during this action. Check device state before retrying; speech may repeat.",
  })
  .where(sql`${actionRuns.status} IN ('running', 'looping')`)
  .run();
export function closeStore() {
  closing = true;
  alexaAnswers.close();
  void lightLoops.close();
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
// Backfill original linear progress once; later completions are tracked by ID.
for (const existing of db.select().from(sessions).all()) {
  const game = definition(existing.id);
  if (
    !db
      .select()
      .from(challengeCompletions)
      .where(eq(challengeCompletions.session_id, existing.id))
      .get()
  )
    for (const area of game.areas.slice(0, existing.progress))
      db.insert(challengeCompletions)
        .values({
          id: `${existing.id}:${area.id}`,
          session_id: existing.id,
          challenge_id: area.id,
        })
        .run();
}
function solved(id: string) {
  return db
    .select()
    .from(challengeCompletions)
    .where(eq(challengeCompletions.session_id, id))
    .orderBy(sql`rowid`)
    .all()
    .map((c) => c.challenge_id);
}
const alexaAnswers = new AlexaAnswers(
  join(dirname(databasePath), "alexa-answers.json"),
  ({ sessionId, challengeId }) => {
    if (closing) return;
    try {
      const s = session(sessionId);
      const area = availableChallenges(
        definition(sessionId),
        solved(sessionId),
      ).find((a) => a.id === challengeId);
      if (
        s.status === "running" &&
        area?.kind === "external" &&
        area.id === challengeId &&
        !pending(sessionId).length
      )
        return `${sessionId}:${challengeId}`;
    } catch {
      /* Removed sessions cannot receive answers. */
    }
  },
  async ({ sessionId, challengeId }) => {
    const area = definition(sessionId).areas.find((a) => a.id === challengeId)!;
    await complete(sessionId, area.unlockCode, true, challengeId);
  },
);
alexaAnswers.start();
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
  const timer = db
    .select()
    .from(sessionTimers)
    .where(eq(sessionTimers.session_id, id))
    .get();
  const now = Date.now();
  return {
    ...s,
    timer: timer
      ? {
          remainingMs: timerRemaining(timer, now),
          measuredAt: now,
          running: timer.resumed_at !== null,
        }
      : null,
  };
}
function timerRemaining(
  timer: { remaining_ms: number; resumed_at: number | null },
  now: number,
) {
  return Math.max(
    0,
    timer.remaining_ms -
      (timer.resumed_at === null ? 0 : now - timer.resumed_at),
  );
}
function setSessionStatus(id: string, status: string) {
  const s = session(id),
    now = Date.now();
  if (status !== "running") roomCommand(id, "", "clear");
  db.transaction((tx) => {
    const timer = tx
      .select()
      .from(sessionTimers)
      .where(eq(sessionTimers.session_id, id))
      .get();
    const minutes = definition(id).timeLimitMinutes;
    const finished = s.progress >= definition(id).areas.length;
    if (timer || (status === "running" && minutes && !finished)) {
      tx.insert(sessionTimers)
        .values({
          session_id: id,
          remaining_ms: timer ? timerRemaining(timer, now) : minutes! * 60000,
          resumed_at: status === "running" && !finished ? now : null,
        })
        .onConflictDoUpdate({
          target: sessionTimers.session_id,
          set: {
            remaining_ms: timer ? timerRemaining(timer, now) : minutes! * 60000,
            resumed_at: status === "running" && !finished ? now : null,
          },
        })
        .run();
    }
    tx.update(sessions).set({ status }).where(eq(sessions.id, id)).run();
  });
}
const headers = {
  "content-type": "application/json",
  "cache-control": "no-store",
};
const reply = (data: unknown, setCookie?: string) =>
  new Response(JSON.stringify(data), {
    headers: { ...headers, ...(setCookie ? { "set-cookie": setCookie } : {}) },
  });
function pending(id: string) {
  return db
    .select()
    .from(actionRuns)
    .where(
      and(
        eq(actionRuns.session_id, id),
        sql`${actionRuns.status} IN ('pending', 'running', 'failed')`,
      ),
    )
    .orderBy(actionRuns.id)
    .all();
}
async function affectedLights(entity: string): Promise<string[]> {
  if (entity.startsWith("light.")) return [entity];
  // A scene can affect lights outside the selected group.
  const response = await ha(`states/${entity}`);
  const state = await response.json();
  const members = state?.attributes?.entity_id;
  if (
    !Array.isArray(members) ||
    members.some((member) => typeof member !== "string")
  )
    throw new Error(
      "Cannot determine scene lights. Use color / brightness steps or configure scene entities in Home Assistant.",
    );
  return members.filter((member: string) => member.startsWith("light."));
}
async function runActions(id: string) {
  for (const run of pending(id)) {
    if (session(id).status !== "running") break;
    if (run.status !== "pending") break;
    const claimed = db
      .update(actionRuns)
      .set({ status: "running", error: null })
      .where(and(eq(actionRuns.id, run.id), eq(actionRuns.status, "pending")))
      .run();
    if (!claimed.changes) break;
    try {
      const action = JSON.parse(run.payload);
      if (action.type === "speech") await speak(action);
      else if (action.type === "vacuum") await moveVacuum(action);
      else if (action.type === "lights") {
        const transition = lightTransitionSchema.parse(action);
        await Promise.all(
          transition.groups.map(async (group) => {
            const entities = [
              ...new Set([
                ...group.entities,
                ...(
                  await Promise.all(
                    group.steps.flatMap((step) =>
                      step.mode === "scene"
                        ? [affectedLights(step.entity)]
                        : [],
                    ),
                  )
                ).flat(),
              ]),
            ];
            const send = async (
              domain: string,
              service: string,
              data: Record<string, unknown>,
            ) => {
              await ha(`services/${domain}/${service}`, data);
            };
            await lightLoops.start(
              id,
              run.id,
              group,
              send,
              (error) => {
                if (closing) return;
                db.update(actionRuns)
                  .set({
                    status: "failed",
                    error:
                      error instanceof Error
                        ? error.message
                        : "Light loop failed",
                  })
                  .where(eq(actionRuns.id, run.id))
                  .run();
                event(id, "Light loop failed; game master retry required");
                void lightLoops.stopAction(run.id);
              },
              () => {
                if (!closing && !lightLoops.hasAction(run.id))
                  db.update(actionRuns)
                    .set({ status: "done" })
                    .where(
                      and(
                        eq(actionRuns.id, run.id),
                        eq(actionRuns.status, "looping"),
                      ),
                    )
                    .run();
              },
              entities,
              () =>
                !closing &&
                session(id).status === "running" &&
                db
                  .select()
                  .from(actionRuns)
                  .where(eq(actionRuns.id, run.id))
                  .get()?.status !== "failed",
            );
          }),
        );
      } else {
        const control = definition(id).controls.find(
          (c) => c.id === action.controlId,
        )!;
        const domain = control.entity.split(".")[0];
        if (lightLoops.active && (domain === "light" || domain === "scene"))
          await lightLoops.takeOver(await affectedLights(control.entity));
        const config = settings();
        if (!config.haUrl || !config.haToken)
          throw new Error(
            "Configure Home Assistant before running completion actions.",
          );
        const result = await fetch(
          `${config.haUrl.replace(/\/$/, "")}/api/services/${domain}/${domain === "light" && action.on === false ? "turn_off" : "turn_on"}`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${config.haToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ entity_id: control.entity }),
            signal: AbortSignal.timeout(8000),
          },
        );
        if (!result.ok)
          throw new Error(`Home Assistant returned ${result.status}.`);
      }
      db.update(actionRuns)
        .set({ status: lightLoops.hasAction(run.id) ? "looping" : "done" })
        .where(and(eq(actionRuns.id, run.id), eq(actionRuns.status, "running")))
        .run();
      event(id, "Completion action succeeded");
    } catch (error) {
      db.update(actionRuns)
        .set({
          status: "failed",
          error: error instanceof Error ? error.message : "Action failed",
        })
        .where(eq(actionRuns.id, run.id))
        .run();
      await lightLoops.stopAction(run.id);
      event(id, "Completion action failed; game master retry required");
      break;
    }
  }
}
async function complete(
  id: string,
  code: string,
  external: boolean,
  challenge?: string,
) {
  const s = session(id),
    game = definition(id),
    area = availableChallenges(game, solved(id)).find((a) => {
      if (challenge !== undefined) return a.id === challenge;
      try {
        nextUnlock(game.areas.indexOf(a), code, game);
        return (a.kind === "external") === external;
      } catch {
        return false;
      }
    });
  if (s.status !== "running") throw new Error("The connection is on standby.");
  if (s.progress >= game.areas.length)
    throw new Error("Your team has already completed the game.");
  if (
    !area ||
    (area.kind === "external") !== external ||
    ((external || challenge !== undefined) && area.id !== challenge)
  )
    throw new Error(
      game.areas.some((a) => solved(id).includes(a.id) && a.unlockCode === code)
        ? "This code has already been used."
        : "This code is not valid here.",
    );
  if (pending(id).length)
    throw new Error("Systems are responding. Try again in a moment.");
  nextUnlock(game.areas.indexOf(area), code, game);
  const progress = area.completesGame ? game.areas.length : s.progress + 1;
  db.transaction((tx) => {
    const updated = tx
      .update(sessions)
      .set({ progress })
      .where(and(eq(sessions.id, id), eq(sessions.progress, s.progress)))
      .run();
    if (!updated.changes)
      throw new Error("This challenge has already been completed.");
    tx.insert(challengeCompletions)
      .values({ id: `${id}:${area.id}`, session_id: id, challenge_id: area.id })
      .run();
    const now = Date.now();
    let timer = tx
      .select()
      .from(sessionTimers)
      .where(eq(sessionTimers.session_id, id))
      .get();
    for (const action of area.onComplete || []) {
      if (action.type !== "timer") continue;
      const remaining =
        action.minutes * 60000 +
        (action.mode === "extend" && timer ? timerRemaining(timer, now) : 0);
      timer = { session_id: id, remaining_ms: remaining, resumed_at: now };
      tx.insert(sessionTimers)
        .values(timer)
        .onConflictDoUpdate({ target: sessionTimers.session_id, set: timer })
        .run();
    }
    if (timer && progress === game.areas.length)
      tx.update(sessionTimers)
        .set({ remaining_ms: timerRemaining(timer, now), resumed_at: null })
        .where(eq(sessionTimers.session_id, id))
        .run();
    for (const [index, action] of (area.onComplete || []).entries()) {
      if (action.type === "timer") continue;
      tx.insert(actionRuns)
        .values({
          id: `${id}:${s.progress}:${index}`,
          session_id: id,
          payload: JSON.stringify(action),
        })
        .run();
    }
    tx.insert(events)
      .values({ session_id: id, message: `Unlocked ${area.name}` })
      .run();
  });
  await lightLoops.stopSession(id, progress < game.areas.length);
  await runActions(id);
}
export async function handleCallback(request: Request) {
  try {
    if (request.method !== "POST")
      return new Response("Method not allowed", { status: 405 });
    const body = await request.json();
    const credentials = db
      .select()
      .from(sessionAutomation)
      .where(eq(sessionAutomation.session_id, String(body.sessionId || "")))
      .get();
    if (
      !credentials ||
      !secret(
        request.headers.get("authorization") || "",
        `Bearer ${credentials.token}`,
      )
    )
      return new Response("Unauthorized", { status: 401 });
    await complete(
      credentials.session_id,
      String(body.answer || ""),
      true,
      String(body.challengeId || ""),
    );
    return reply({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Callback failed" },
      { status: 400 },
    );
  }
}
function validWriteOrigin(request: Request) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  return (
    origin === url.origin ||
    (["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
      !!settings().publicUrl &&
      origin === settings().publicUrl)
  );
}

function voiceAccess(request: Request, challengeId: string) {
  const p = player(request);
  if (!p) throw new Error("Join a game first.");
  if (
    session(p.session_id).status !== "running" ||
    pending(p.session_id).length
  )
    throw new Error("Voice connection is temporarily unavailable.");
  const area = availableChallenges(
    definition(p.session_id),
    solved(p.session_id),
  ).find((a) => a.id === challengeId && a.kind === "text");
  if (!area) throw new Error("This text challenge is no longer available.");
  return p;
}
function visibleVoiceText(id: string, source: string, contentId: string) {
  const game = definition(id),
    completed = solved(id);
  const area = game.areas.find((a) => a.id === contentId);
  if (
    source === "hint" &&
    area &&
    availableChallenges(game, completed).some((a) => a.id === contentId)
  )
    return area.hint;
  if (source === "story" && area && completed.includes(contentId))
    return area.description;
  if (source === "clue")
    return (
      revealedClues(game, completed).find(
        (c) => c.id === contentId && c.kind === "markdown",
      )?.content || ""
    );
  if (source === "test")
    return "Local speech is ready. Test your selected speaker output.";
  throw new Error("This passage is not available.");
}
async function handleVoice(request: Request) {
  try {
    if (request.method !== "POST" || !validWriteOrigin(request))
      return Response.json(
        { error: "Invalid voice request origin or method." },
        { status: 403 },
      );
    if (new URL(request.url).searchParams.get("voice") === "health") {
      if (!admin(request))
        return Response.json(
          { error: "Game master access required." },
          { status: 401 },
        );
      return Response.json(
        await limited(cookie(request, "gm"), request.signal, voiceHealth),
        { headers: { "cache-control": "no-store" } },
      );
    }
    if (!settings().voiceEnabled)
      throw new Error("Local voice is disabled. Typed play is available.");
    const url = new URL(request.url),
      mode = url.searchParams.get("voice");
    if (mode === "transcribe") {
      const challenge = url.searchParams.get("challenge") || "";
      const p = voiceAccess(request, challenge);
      if (
        !/^(audio\/(webm|mp4|ogg|wav|x-wav))(;|$)/i.test(
          request.headers.get("content-type") || "",
        )
      )
        throw new Error("Unsupported recording format.");
      const text = await limited(
        cookie(request, "player"),
        request.signal,
        async (signal) =>
          transcribe(
            await boundedBody(request),
            settings().voiceLanguage,
            signal,
          ),
      );
      const current = voiceAccess(request, challenge);
      if (current.session_id !== p.session_id)
        throw new Error("Game changed. Record again.");
      return Response.json(
        { text, challengeId: challenge, sessionId: p.session_id },
        { headers: { "cache-control": "no-store" } },
      );
    }
    const body = JSON.parse((await boundedBody(request, 4096)).toString());
    const gm = admin(request),
      p = player(request);
    const id = gm && body.sessionId ? String(body.sessionId) : p?.session_id;
    if (!id || (!gm && !p))
      return Response.json({ error: "Game access required." }, { status: 401 });
    const s = session(id);
    if (s.status !== "running") {
      roomCommand(id, "", "clear");
      throw new Error("Start or resume this game before playback.");
    }
    if (mode === "room") {
      if (!gm)
        return Response.json(
          { error: "Game master access required." },
          { status: 401 },
        );
      if (settings().voiceOutput !== "room")
        throw new Error("Select room output in Settings.");
      const device = String(body.device || "");
      if (!/^[a-f0-9-]{36}$/.test(device))
        throw new Error("Enable this room player first.");
      const command = String(body.command);
      if (!["claim", "next", "ack", "stop", "mute"].includes(command))
        throw new Error("Unknown room command.");
      const result = roomCommand(
        id,
        device,
        command,
        String(body.eventId || ""),
      );
      if ("text" in result && result.text) {
        const audio = await limited(`room:${id}`, request.signal, (signal) =>
          synthesize(result.text!, signal),
        );
        if (session(id).status !== "running" || !admin(request))
          throw new Error("Room playback stopped.");
        roomCommand(id, device, "valid", result.id);
        return new Response(new Uint8Array(audio), {
          headers: {
            "content-type": "audio/wav",
            "cache-control": "no-store",
            "x-voice-event": result.id!,
          },
        });
      }
      return Response.json(result);
    }
    if (mode !== "listen") throw new Error("Unknown voice operation.");
    const source = String(body.source),
      contentId = String(body.contentId || "");
    if (source === "test" && !gm)
      throw new Error("Game master access required.");
    const text = visibleVoiceText(id, source, contentId);
    if (settings().voiceOutput === "room")
      return Response.json(roomCommand(id, "", "enqueue", text));
    const audio = await limited(
      gm ? cookie(request, "gm") : cookie(request, "player"),
      request.signal,
      (signal) => synthesize(text, signal),
    );
    if (
      session(id).status !== "running" ||
      (!admin(request) && player(request)?.session_id !== id)
    )
      throw new Error("Game access changed.");
    visibleVoiceText(id, source, contentId);
    return new Response(new Uint8Array(audio), {
      headers: {
        "content-type": "audio/wav",
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          (error as Error).name === "AbortError"
            ? "Speech cancelled or timed out. Typed play is available."
            : (error as Error).message,
      },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
}

export async function handle(request: Request) {
  if (new URL(request.url).searchParams.has("voice"))
    return handleVoice(request);
  try {
    const isAdmin = admin(request),
      p = player(request);
    if (request.method === "GET") {
      const clueId = new URL(request.url).searchParams.get("clue");
      if (clueId !== null) {
        const clue =
          p &&
          revealedClues(definition(p.session_id), solved(p.session_id)).find(
            (c) => c.id === clueId && c.kind !== "markdown",
          );
        if (!clue) return new Response("Clue not found", { status: 404 });
        const [metadata, data] = clue.content.split(",");
        return new Response(Buffer.from(data, "base64"), {
          headers: {
            "content-type": metadata.slice(5).split(";")[0],
            "cache-control": "private, no-store",
            "x-content-type-options": "nosniff",
          },
        });
      }
      const games = loadGames();
      const active = p ? definition(p.session_id) : games[0];
      const areas = active?.areas || [];
      const completed = p ? solved(p.session_id) : [];
      const available = p
        ? availableChallenges(active, completed).map((a) => a.id)
        : [];
      return reply({
        voice: {
          enabled: settings().voiceEnabled,
          output: settings().voiceOutput,
        },
        designScheme: p ? active?.designScheme || "standard" : "standard",
        storyOrder: completed,
        automationPending: p ? pending(p.session_id).length > 0 : false,
        admin: isAdmin,
        demo: !settings().haUrl,
        adminConfigured: !!settings().adminKey,
        clues: p
          ? revealedClues(active, completed).map((c) => ({
              ...c,
              content:
                c.kind === "markdown"
                  ? c.content
                  : `/api/game?clue=${encodeURIComponent(c.id)}`,
            }))
          : [],
        areas: areas.map((area) =>
          isAdmin
            ? {
                ...area,
                unlockCode: area.unlockCode,
                available: available.includes(area.id),
                solved: completed.includes(area.id),
              }
            : {
                id: area.id,
                available: available.includes(area.id),
                solved: completed.includes(area.id),
                kind:
                  area.kind === "qr" && area.qrMode !== "prompted"
                    ? "hidden"
                    : area.kind,
                ...(p && available.includes(area.id)
                  ? { choices: area.choices }
                  : {}),
                ...(area.kind === "qr" && area.qrMode === "prompted"
                  ? { qrMode: "prompted" }
                  : {}),
                playerView: area.playerView,
                name:
                  p &&
                  (completed.includes(area.id) || available.includes(area.id))
                    ? area.name
                    : "An unopened door",
                hint: p && available.includes(area.id) ? area.hint : "",
                description:
                  p && completed.includes(area.id) ? area.description : "",
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
                  eq(sessions.status, "running"),
                  eq(sessions.id, p?.session_id || ""),
                ),
          )
          .orderBy(desc(sessions.created))
          .limit(100)
          .all()
          .map((s) => ({
            ...s,
            designScheme: definition(s.id).designScheme || "standard",
            gameName: definition(s.id).name,
            acceptingPlayers:
              s.status === "open" ||
              (s.status === "running" && !!definition(s.id).autoStart),
          }))
          .filter(
            (s) => isAdmin || s.acceptingPlayers || s.id === p?.session_id,
          ),
        player: p ? { ...p, session: session(p.session_id) } : null,
        ...(isAdmin
          ? {
              automation: db
                .select({
                  id: actionRuns.id,
                  session_id: actionRuns.session_id,
                  status: actionRuns.status,
                  error: actionRuns.error,
                })
                .from(actionRuns)
                .where(sql`${actionRuns.status} != 'done'`)
                .all(),
              games,
              shareOrigin: settings().publicUrl || lanOrigin(request.url),
              settings: {
                voiceEnabled: settings().voiceEnabled,
                voiceLanguage: settings().voiceLanguage,
                voiceOutput: settings().voiceOutput,
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
    if (!validWriteOrigin(request))
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
      if (
        s.status !== "open" &&
        !(s.status === "running" && definition(s.id).autoStart)
      )
        throw new Error("This game is not accepting players.");
      const token = randomUUID();
      db.insert(players).values({ token, name, session_id: s.id }).run();
      db.delete(players)
        .where(eq(players.token, cookie(request, "player")))
        .run();
      if (s.status === "open" && definition(s.id).autoStart)
        setSessionStatus(s.id, "running");
      const game = definition(s.id);
      const opening = game.areas.find((a) => a.id === game.joinChallengeId);
      if (opening && !solved(s.id).includes(opening.id))
        await complete(s.id, opening.unlockCode, false, opening.id);
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
      await complete(
        p.session_id,
        String(body.code || ""),
        false,
        body.challengeId,
      );
      return reply({ ok: true });
    }
    if (!isAdmin)
      return new Response(
        JSON.stringify({ error: "Game master access required." }),
        { status: 401, headers },
      );
    if (["alexa-setup", "alexa-test", "alexa-status"].includes(action)) {
      const id = String(body.id || "");
      const s = session(id);
      const challengeId = String(body.challengeId || "");
      const area = definition(id).areas.find(
        (a) => a.id === challengeId && a.kind === "external",
      );
      if (!area)
        throw new Error("Choose an external-answer challenge in this session.");
      if (action === "alexa-status")
        return reply({ setup: alexaAnswers.get(id, challengeId) });
      if (s.status === "closed")
        throw new Error("Choose an open session to set up or test Alexa.");
      if (action === "alexa-test")
        return reply({ setup: await alexaAnswers.test(id, challengeId) });
      return reply({
        setup: await alexaAnswers.setup(id, challengeId, s.name, area.name),
      });
    }
    if (action === "callback-config") {
      const id = String(body.id);
      session(id);
      db.insert(sessionAutomation)
        .values({ session_id: id, token: randomUUID() + randomUUID() })
        .onConflictDoNothing()
        .run();
      return reply({
        ...db
          .select()
          .from(sessionAutomation)
          .where(eq(sessionAutomation.session_id, id))
          .get(),
        challenges: definition(id)
          .areas.filter((a) => a.kind === "external")
          .map((a) => ({ id: a.id, name: a.name, answer: a.unlockCode })),
        url: `${settings().publicUrl || lanOrigin(request.url) || new URL(request.url).origin}/api/callback`,
      });
    }
    if (action === "retry-actions") {
      const id = String(body.id);
      const s = session(id);
      if (s.status !== "running")
        throw new Error("Resume this session before retrying.");
      if (pending(id).some((r) => r.status === "running"))
        throw new Error(
          "An action is running or was interrupted. Wait for completion; interrupted actions become retryable after a server restart.",
        );
      db.update(actionRuns)
        .set({ status: "pending", error: null })
        .where(
          and(eq(actionRuns.session_id, id), eq(actionRuns.status, "failed")),
        )
        .run();
      await runActions(id);
      return reply({ ok: true });
    }
    if (action === "speech-targets") {
      return reply({ targets: await speechTargets() });
    }
    if (action === "vacuum-targets")
      return reply({ targets: await lightTargets("vacuum") });
    if (action === "control-targets")
      return reply({ targets: await lightTargets("light|scene|script") });
    if (action === "light-targets")
      return reply({ targets: await lightTargets() });
    if (action === "speak") {
      const s = session(String(body.id || ""));
      const target = await speak(body);
      event(s.id, `Announcement sent to ${target.name}`);
      return reply({ ok: true });
    }
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
      setSessionStatus(body.id, body.status);
      if (body.status !== "running") await lightLoops.stopSession(body.id);
      if (body.status === "closed") {
        db.delete(players).where(eq(players.session_id, body.id)).run();
      }
      event(body.id, `Session ${body.status}`);
      return reply({ ok: true });
    }
    if (action === "advance") {
      const s = session(body.id),
        area = availableChallenges(definition(s.id), solved(s.id)).find(
          (a) => !body.challengeId || a.id === body.challengeId,
        );
      if (!area) throw new Error("All areas are unlocked.");
      await complete(s.id, area.unlockCode, area.kind === "external", area.id);
      return reply({ ok: true });
    }
    if (action === "device") {
      if (body.device === "lights" && typeof body.on !== "boolean")
        throw new Error("Choose lights on or off.");
      const game = definition(String(body.id || "signal-house"));
      const control = game.controls.find((c) => c.id === body.device);
      if (!control) throw new Error("Unknown control");
      const domain = control.entity.split(".")[0];
      if (lightLoops.active && (domain === "light" || domain === "scene"))
        await lightLoops.takeOver(await affectedLights(control.entity));
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

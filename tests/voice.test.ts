import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  boundedBody,
  limited,
  run,
  transcribe,
} from "../src/lib/voice-runtime.server";
import { roomCommand } from "../src/lib/voice-room.server";
const directory = mkdtempSync(join(tmpdir(), "threshold-voice-tests-"));
process.env.DATABASE_PATH = join(directory, "test.sqlite");
process.env.SETTINGS_PATH = join(directory, "settings.json");
process.env.GAMES_PATH = join(directory, "games");
process.env.ADMIN_KEY = "voice-test-key";
cpSync("games", process.env.GAMES_PATH, { recursive: true });
const { handle, closeStore } = await import("../src/lib/db.server");
const { saveSettings, settings } = await import("../src/lib/settings.server");
after(() => {
  closeStore();
  rmSync(directory, { recursive: true, force: true });
});
const signal = () => new AbortController().signal;
function req(
  body?: object,
  cookie = "",
  query = "",
  origin = "http://localhost",
) {
  return handle(
    new Request(`http://localhost/api/game${query}`, {
      method: body ? "POST" : "GET",
      headers: { origin, cookie, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
}

test("stream limits, cancellation, process failures and concurrency are bounded", async () => {
  await assert.rejects(
    () =>
      boundedBody(
        new Request("http://localhost", { method: "POST", body: "12345" }),
        4,
      ),
    /too large/,
  );
  await assert.rejects(
    () =>
      boundedBody(
        new Request("http://localhost", { method: "POST", body: "" }),
      ),
    /Empty/,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() =>
    run(
      process.execPath,
      ["-e", "setInterval(()=>{},1000)"],
      controller.signal,
    ),
  );
  await assert.rejects(
    () =>
      run(
        process.execPath,
        ["-e", "process.stdout.write('12345')"],
        signal(),
        4,
      ),
    /limit/,
  );
  let release!: () => void;
  const first = limited(
    "one",
    signal(),
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await assert.rejects(() => limited("two", signal(), async () => {}), /busy/);
  release();
  await first;
  await assert.rejects(() => limited("one", signal(), async () => {}), /busy/);
});

test("Silero no-speech and detector failures bypass Whisper; decode requests mono 16k and rejects long audio", async () => {
  const ffmpeg = join(directory, "ffmpeg"),
    python = join(directory, "python");
  writeFileSync(
    ffmpeg,
    `#!/usr/bin/env node\nif (!process.argv.includes('16000') || !process.argv.includes('s16le')) process.exit(1); process.stdout.write(Buffer.alloc(Number(process.env.FAKE_PCM || 32000)));`,
    { mode: 0o700 },
  );
  writeFileSync(
    python,
    `#!/usr/bin/env node\nprocess.stdout.write(process.env.FAKE_VAD || 'null');`,
    { mode: 0o700 },
  );
  process.env.VOICE_FFMPEG = ffmpeg;
  process.env.VOICE_PYTHON = python;
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    const form = init!.body as FormData;
    const blob = form.get("file") as Blob;
    const bytes = Buffer.from(await blob.arrayBuffer());
    assert.equal(bytes.readUInt32LE(24), 16000);
    assert.equal(bytes.length, 2044);
    return Response.json({ text: " red " });
  };
  try {
    await assert.rejects(
      () => transcribe(Buffer.from("input"), "en", signal()),
      /No speech/,
    );
    assert.equal(calls, 0);
    process.env.FAKE_VAD = "broken";
    await assert.rejects(() =>
      transcribe(Buffer.from("input"), "en", signal()),
    );
    assert.equal(calls, 0);
    process.env.FAKE_VAD = JSON.stringify({ start: 100, end: 1100 });
    assert.equal(await transcribe(Buffer.from("input"), "en", signal()), "red");
    assert.equal(calls, 1);
    process.env.FAKE_PCM = "480002";
    await assert.rejects(
      () => transcribe(Buffer.from("input"), "en", signal()),
      /15 seconds/,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = previous;
    delete process.env.FAKE_PCM;
    delete process.env.FAKE_VAD;
  }
});

test("room leases serialize delivery, reject other devices, expire and discard on stop", () => {
  const device = "device-one",
    other = "device-two";
  roomCommand("room", device, "claim");
  assert.throws(() => roomCommand("room", other, "claim"), /owns/);
  roomCommand("room", "", "enqueue", "Visible text");
  assert.throws(() => roomCommand("room", other, "next"), /own/);
  assert.equal(roomCommand("room", device, "next").text, "Visible text");
  assert.deepEqual(roomCommand("room", device, "next"), {});
  roomCommand("room", device, "stop");
  assert.deepEqual(roomCommand("room", device, "next"), {});
  roomCommand("room", device, "mute");
  assert.throws(() => roomCommand("room", "", "enqueue", "Test"), /muted/);
  roomCommand("room", device, "mute");
  for (let i = 0; i < 10; i++) roomCommand("room", "", "enqueue", "Test");
  assert.throws(() => roomCommand("room", "", "enqueue", "Test"), /full/);
  const real = Date.now;
  try {
    Date.now = () => real() + 61000;
    assert.throws(() => roomCommand("room", device, "next"), /first/);
    roomCommand("room", other, "claim");
    assert.deepEqual(roomCommand("room", other, "next"), {});
  } finally {
    Date.now = real;
  }
  roomCommand("room", "", "clear");
});

test("voice API preserves settings and enforces origin, membership, source, session state and hidden text", async () => {
  saveSettings({ ...settings(), voiceEnabled: true, voiceLanguage: "de" });
  saveSettings({ ...settings(), publicUrl: "https://threshold.home.arpa" });
  assert.equal(settings().voiceLanguage, "de");
  const login = await req({ action: "login", key: "voice-test-key" });
  const gm = login.headers.get("set-cookie")!.split(";")[0];
  assert.equal(
    (
      await req(
        { action: "login", key: "voice-test-key" },
        "",
        "",
        "https://evil.test",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await req(
        { action: "login", key: "voice-test-key" },
        "",
        "",
        "https://threshold.home.arpa",
      )
    ).status,
    200,
  );
  const game = {
    id: "voice",
    name: "Voice",
    autoStart: true,
    controls: [],
    areas: [
      {
        id: "a",
        name: "A",
        kind: "text",
        unlockCode: "red",
        hint: "Visible hint",
        description: "Hidden story",
      },
      {
        id: "b",
        name: "B",
        kind: "external",
        unlockCode: "secret",
        hint: "Hidden hint",
        description: "Hidden",
      },
    ],
  };
  assert.equal((await req({ action: "save-game", game }, gm)).status, 200);
  const { id } = await (
    await req({ action: "create", name: "Room", gameId: "voice" }, gm)
  ).json();
  const p = (await req({ action: "join", id, name: "Player" })).headers
    .get("set-cookie")!
    .split(";")[0];
  const state = await (await req(undefined, p)).json();
  assert.deepEqual(state.voice, { enabled: true, output: "phone" });
  assert.equal(
    (await req({ source: "story", contentId: "a" }, p, "?voice=listen")).status,
    400,
  );
  assert.equal(
    (await req({ source: "hint", contentId: "b" }, p, "?voice=listen")).status,
    400,
  );
  assert.equal((await req({ source: "test" }, p, "?voice=listen")).status, 400);
  assert.equal(
    (await req({ command: "claim", sessionId: id }, p, "?voice=room")).status,
    401,
  );
  assert.equal(
    (
      await req(
        { source: "hint", contentId: "a", sessionId: id },
        "",
        "?voice=listen",
      )
    ).status,
    401,
  );
  const upload = (challenge: string, cookie: string) =>
    handle(
      new Request(
        `http://localhost/api/game?voice=transcribe&challenge=${challenge}`,
        {
          method: "POST",
          headers: {
            origin: "http://localhost",
            cookie,
            "content-type": "audio/webm",
          },
          body: "fake",
        },
      ),
    );
  assert.equal((await upload("a", "")).status, 400);
  assert.equal((await upload("b", p)).status, 400);
  process.env.FAKE_VAD = JSON.stringify({ start: 0, end: 1000 });
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      await req({ action: "status", id, status: "paused" }, gm);
      return Response.json({ text: "red" });
    };
    const delayed = await upload("a", p);
    assert.equal(delayed.status, 400);
    assert.match((await delayed.json()).error, /paused/);
  } finally {
    globalThis.fetch = previousFetch;
    delete process.env.FAKE_VAD;
  }
  await req({ action: "status", id, status: "running" }, gm);
  await req({ action: "unlock", code: "red", challengeId: "a" }, p);
  assert.equal((await upload("a", p)).status, 400);
  assert.equal(
    (await req({ action: "unlock", code: "red", challengeId: "a" }, p)).status,
    400,
  );
  await req({ action: "status", id, status: "paused" }, gm);
  assert.equal(
    (await req({ source: "story", contentId: "a" }, p, "?voice=listen")).status,
    400,
  );
});

import { spawn } from "node:child_process";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
  readdir,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const uploadLimit = 5 * 1024 * 1024;
export const durationLimit = 15;
const audioLimit = 4 * 1024 * 1024;
let working = false;
const rates = new Map<string, number>();
// A crashed process cannot run finally. Remove only old abandoned upload folders.
const cleanup = (async () => {
  for (const name of await readdir(tmpdir())) {
    if (
      !name.startsWith("threshold-voice-") ||
      name.startsWith("threshold-voice-tests-")
    )
      continue;
    const path = join(tmpdir(), name);
    try {
      if ((await stat(path)).mtimeMs < Date.now() - 86400000)
        await rm(path, { recursive: true, force: true });
    } catch {
      /* A concurrent cleanup may already have removed it. */
    }
  }
})().catch(() => {});

export async function limited<T>(
  key: string,
  signal: AbortSignal,
  work: (signal: AbortSignal) => Promise<T>,
) {
  const now = Date.now();
  for (const [id, time] of rates) if (now - time > 60000) rates.delete(id);
  if (working || (rates.get(key) || 0) > now - 3000 || rates.size >= 1000)
    throw new Error("Speech is busy. Wait a moment or type your answer.");
  rates.set(key, now);
  working = true;
  try {
    return await work(AbortSignal.any([signal, AbortSignal.timeout(25000)]));
  } finally {
    working = false;
  }
}

export function run(
  command: string,
  args: string[],
  signal: AbortSignal,
  maxBytes = audioLimit,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      signal,
      killSignal: "SIGKILL",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        child.kill("SIGKILL");
        reject(new Error("Speech output exceeded its limit."));
      } else chunks.push(chunk);
    });
    child.on("error", () =>
      reject(
        new Error(
          "Local speech unavailable. Check runtime setup; typed play is available.",
        ),
      ),
    );
    child.on("close", (code) =>
      code === 0
        ? resolve(Buffer.concat(chunks))
        : reject(
            new Error(
              "Local speech failed or timed out. Try typing your answer.",
            ),
          ),
    );
  });
}

export async function boundedBody(request: Request, limit = uploadLimit) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Empty recording.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10000)]);
  const abort = () => {
    void reader.cancel();
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error("Recording too large. Maximum 5 MB.");
      chunks.push(value);
    }
    if (!size) throw new Error("Empty recording.");
    return Buffer.concat(chunks);
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel();
    reader.releaseLock();
  }
}

export async function temporary<T>(work: (dir: string) => Promise<T>) {
  // OS temporary directories also avoid keeping uploads in application backups.
  await cleanup;
  const dir = await mkdtemp(join(tmpdir(), "threshold-voice-"));
  try {
    return await work(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function transcribe(
  bytes: Buffer,
  language: string,
  signal: AbortSignal,
) {
  return temporary(async (dir) => {
    const input = join(dir, "upload");
    await writeFile(input, bytes, { mode: 0o600 });
    // A bounded raw output lets us detect overlong decoded audio without trusting metadata.
    const pcm = await run(
      process.env.VOICE_FFMPEG || "ffmpeg",
      [
        "-nostdin",
        "-v",
        "error",
        "-max_alloc",
        "33554432",
        "-format_whitelist",
        "matroska,webm,mov,ogg,wav",
        "-protocol_whitelist",
        "file,pipe",
        "-i",
        input,
        "-map",
        "0:a:0",
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-t",
        "15.1",
        "-f",
        "s16le",
        "pipe:1",
      ],
      signal,
      500000,
    );
    if (!pcm.length || pcm.length > 16000 * 2 * durationLimit)
      throw new Error(
        "Recording must contain audio and last at most 15 seconds.",
      );
    const raw = join(dir, "audio.pcm");
    await writeFile(raw, pcm, { mode: 0o600 });
    const detection = JSON.parse(
      (
        await run(
          process.env.VOICE_PYTHON || resolve("data/voice/venv/bin/python"),
          [resolve("scripts/voice-worker.py"), "detect", raw],
          signal,
          1024,
        )
      ).toString(),
    ) as { start: number; end: number } | null;
    if (!detection)
      throw new Error("No speech detected. Try again or type your answer.");
    const { start, end } = detection;
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end <= start ||
      end > pcm.length / 2
    )
      throw new Error("Speech detector unavailable.");
    const cropped = pcm.subarray(start * 2, end * 2);
    const wav = Buffer.alloc(44 + cropped.length);
    wav.write("RIFF", 0);
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(16000, 24);
    wav.writeUInt32LE(32000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(cropped.length, 40);
    cropped.copy(wav, 44);
    const form = new FormData();
    form.set("file", new Blob([wav], { type: "audio/wav" }), "answer.wav");
    form.set("language", language);
    form.set("response_format", "json");
    form.set("temperature", "0");
    const response = await fetch("http://127.0.0.1:8178/inference", {
      method: "POST",
      body: form,
      signal,
      redirect: "error",
    });
    if (!response.ok)
      throw new Error("Transcription unavailable. Type your answer.");
    const result = JSON.parse(
      (
        await boundedBody(
          new Request("http://localhost", {
            method: "POST",
            body: response.body,
            duplex: "half",
            signal,
          } as RequestInit),
          16384,
        )
      ).toString(),
    );
    if (
      typeof result.text !== "string" ||
      !result.text.trim() ||
      result.text.length > 500
    )
      throw new Error("No usable transcript. Try again or type your answer.");
    return result.text.trim() as string;
  });
}

export async function synthesize(text: string, signal: AbortSignal) {
  if (!text.trim() || text.length > 2500)
    throw new Error(
      "Choose a shorter passage to listen to (maximum 2500 characters).",
    );
  return temporary(async (dir) => {
    const input = join(dir, "text.txt"),
      output = join(dir, "speech.wav");
    await writeFile(input, text, { mode: 0o600 });
    await run(
      process.env.VOICE_PYTHON || resolve("data/voice/venv/bin/python"),
      [resolve("scripts/voice-worker.py"), "speak", input, output],
      signal,
    );
    const audio = await readFile(output);
    if (audio.length > audioLimit || audio.toString("ascii", 0, 4) !== "RIFF")
      throw new Error("Invalid speech output.");
    return audio;
  });
}

export async function voiceHealth(signal: AbortSignal) {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(10000)]);
  const results = await Promise.allSettled([
    run(process.env.VOICE_FFMPEG || "ffmpeg", ["-version"], bounded, 16384),
    run(
      process.env.VOICE_PYTHON || resolve("data/voice/venv/bin/python"),
      [resolve("scripts/voice-worker.py"), "health"],
      bounded,
      1024,
    ),
    fetch("http://127.0.0.1:8178/health", {
      signal: bounded,
      redirect: "error",
    }).then(async (response) => {
      await response.body?.cancel();
      if (!response.ok) throw new Error("Whisper unavailable");
    }),
  ]);
  return {
    decoder: results[0].status === "fulfilled",
    vadAndPiper: results[1].status === "fulfilled",
    whisper: results[2].status === "fulfilled",
  };
}

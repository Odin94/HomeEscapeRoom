import { useEffect, useRef, useState } from "react";
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { Button } from "./ui";

const voiceState = createStore<{ phase: string; set: (phase: string) => void }>(
  (set) => ({ phase: "idle", set: (phase) => set({ phase }) }),
);
let stopPlayback: (() => void) | undefined;
export function Talk({
  sessionId,
  challengeId,
  disabled,
  onText,
}: {
  sessionId: string;
  challengeId: string;
  disabled: boolean;
  onText: (text: string) => void;
}) {
  const phase = useStore(voiceState, (s) => s.phase);
  const [message, setMessage] = useState(
    "Tap Talk, allow microphone access, then stop and review your answer. Maximum 15 seconds.",
  );
  const recording = useRef<MediaRecorder | null>(null);
  const tracks = useRef<MediaStream | null>(null);
  const request = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  function release() {
    tracks.current?.getTracks().forEach((t) => t.stop());
    tracks.current = null;
    if (timer.current) clearTimeout(timer.current);
  }
  function cancel() {
    generation.current++;
    request.current?.abort();
    if (recording.current?.state === "recording") recording.current.stop();
    release();
    voiceState.getState().set("idle");
  }
  useEffect(() => {
    const hide = () => {
      if (document.hidden) cancel();
    };
    const leave = () => cancel();
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", leave);
    return () => {
      cancel();
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", leave);
    };
  }, []);
  useEffect(() => {
    if (disabled) cancel();
  }, [disabled]);
  async function start() {
    if (
      !window.isSecureContext ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setMessage(
        "Microphone needs HTTPS and a supported browser. Type your answer instead.",
      );
      return;
    }
    const current = ++generation.current;
    stopPlayback?.();
    voiceState.getState().set("permission");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      if (current !== generation.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      tracks.current = stream;
      const mimeType = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      if (!mimeType)
        throw new Error(
          "This browser has no supported recording format. Type your answer.",
        );
      const recorder = new MediaRecorder(stream, { mimeType });
      recording.current = recorder;
      const chunks: Blob[] = [];
      let bytes = 0;
      recorder.ondataavailable = (e) => {
        bytes += e.data.size;
        if (bytes > 5 * 1024 * 1024) {
          cancel();
          setMessage("Recording too large. Try a shorter answer.");
        } else chunks.push(e.data);
      };
      recorder.onerror = () => {
        cancel();
        setMessage("Recording failed. Try again or type your answer.");
      };
      recorder.onstop = async () => {
        if (current !== generation.current) return;
        release();
        voiceState.getState().set("transcribing");
        const controller = new AbortController();
        request.current = controller;
        try {
          const response = await fetch(
            `/api/game?voice=transcribe&challenge=${encodeURIComponent(challengeId)}`,
            {
              method: "POST",
              headers: { "content-type": mimeType },
              body: new Blob(chunks, { type: mimeType }),
              signal: controller.signal,
            },
          );
          const result = await response.json();
          if (!response.ok) throw new Error(result.error);
          if (
            current !== generation.current ||
            result.sessionId !== sessionId ||
            result.challengeId !== challengeId
          )
            return;
          onText(result.text);
          setMessage("Review and edit your answer, then submit it.");
        } catch (error) {
          if (current === generation.current)
            setMessage((error as Error).message);
        } finally {
          if (current === generation.current) voiceState.getState().set("idle");
        }
      };
      recorder.start(250);
      voiceState.getState().set("recording");
      timer.current = setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, 14500);
    } catch (error) {
      if (current === generation.current) {
        release();
        voiceState.getState().set("idle");
        setMessage(
          (error as Error).name === "NotAllowedError"
            ? "Microphone permission denied. Type your answer or enable it in browser settings."
            : (error as Error).message,
        );
      }
    }
  }
  return (
    <div className="voice-controls">
      <Button
        type="button"
        disabled={disabled || (phase !== "idle" && phase !== "recording")}
        onClick={() =>
          phase === "recording" ? recording.current?.stop() : void start()
        }
      >
        {phase === "recording"
          ? "Stop recording"
          : phase === "transcribing"
            ? "Transcribing…"
            : phase === "permission"
              ? "Waiting for microphone…"
              : "Talk"}
      </Button>
      {phase !== "idle" && (
        <Button type="button" onClick={cancel}>
          Cancel recording
        </Button>
      )}
      <p role="status">
        {phase === "recording" ? "Recording. Tap Stop when finished." : message}
      </p>
    </div>
  );
}

export async function voicePost(
  body: object,
  signal?: AbortSignal,
  mode = "listen",
) {
  const response = await fetch(`/api/game?voice=${mode}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok)
    throw new Error((await response.json()).error || "Speech unavailable.");
  return response;
}
export function Listen({
  source,
  contentId,
  sessionId,
}: {
  source: string;
  contentId?: string;
  sessionId?: string;
}) {
  const [message, setMessage] = useState("");
  const [playing, setPlaying] = useState(false);
  const phase = useStore(voiceState, (s) => s.phase);
  const cleanup = useRef<() => void>(() => {});
  useEffect(() => {
    const stop = () => cleanup.current();
    const hide = () => {
      if (document.hidden) stop();
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", hide);
    };
  }, []);
  async function listen() {
    stopPlayback?.();
    setMessage("");
    setPlaying(true);
    const controller = new AbortController();
    let audio: HTMLAudioElement | undefined, url: string | undefined;
    let stopped = false;
    const stop = () => {
      stopped = true;
      controller.abort();
      audio?.pause();
      if (url) URL.revokeObjectURL(url);
      setPlaying(false);
    };
    cleanup.current = stop;
    stopPlayback = stop;
    try {
      const response = await voicePost(
        { source, contentId, sessionId },
        controller.signal,
      );
      if (response.headers.get("content-type")?.includes("json")) {
        setMessage("Queued for the designated room player.");
        stop();
        return;
      }
      const blob = await response.blob();
      if (stopped) return;
      url = URL.createObjectURL(blob);
      audio = new Audio(url);
      audio.onended = stop;
      audio.onerror = () => {
        setMessage("Playback failed. Tap Listen to retry.");
        stop();
      };
      await audio.play();
    } catch (error) {
      if (!controller.signal.aborted)
        setMessage(`${(error as Error).message} Tap Listen to retry.`);
      stop();
    }
  }
  return (
    <div>
      <Button
        type="button"
        disabled={phase !== "idle"}
        onClick={() => (playing ? cleanup.current() : void listen())}
      >
        {playing ? "Stop speech" : "Listen"}
      </Button>
      {message && <p role="status">{message}</p>}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { Button } from "./ui";
import { Listen, voicePost } from "./voice-controls";
export function RoomPlayer({
  sessions,
}: {
  sessions: { id: string; name: string; status: string }[];
}) {
  const [id, setId] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [muted, setMuted] = useState(false);
  const [message, setMessage] = useState("");
  const [queue, setQueue] = useState(0);
  const device = useRef("");
  const audio = useRef<HTMLAudioElement | null>(null);
  const selected = sessions.find((s) => s.id === id);
  useEffect(() => {
    if (!enabled || selected?.status !== "running") return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let url: string | undefined;
    const command = (command: string, eventId?: string) =>
      voicePost(
        { sessionId: id, device: device.current, command, eventId },
        controller.signal,
        "room",
      );
    async function poll() {
      try {
        const status = await (await command("claim")).json();
        setMuted(status.muted);
        if (status.muted) audio.current?.pause();
        setQueue(status.entries.length);
        if (!audio.current || audio.current.paused) {
          const response = await command("next");
          if (response.headers.get("content-type")?.includes("audio")) {
            const eventId = response.headers.get("x-voice-event");
            const blob = await response.blob();
            controller.signal.throwIfAborted();
            if (url) URL.revokeObjectURL(url);
            url = URL.createObjectURL(blob);
            audio.current!.src = url;
            await audio.current!.play();
            await command("ack", eventId || "");
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setMessage(
            `${(error as Error).message} Uncertain announcements will not repeat; use Listen for intentional replay.`,
          );
          audio.current?.pause();
          setEnabled(false);
          return;
        }
      }
      if (!controller.signal.aborted)
        timer = setTimeout(() => void poll(), 3500);
    }
    void poll();
    const hide = () => {
      if (document.hidden) {
        audio.current?.pause();
        setEnabled(false);
      }
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      controller.abort();
      clearTimeout(timer);
      audio.current?.pause();
      if (url) URL.revokeObjectURL(url);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [enabled, id, selected?.status]);
  async function command(command: string) {
    try {
      const result = await (
        await voicePost(
          { sessionId: id, device: device.current, command },
          undefined,
          "room",
        )
      ).json();
      audio.current?.pause();
      setMuted(!!result.muted);
      setMessage("Queue cleared.");
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  return (
    <section>
      <h2>Local voice rehearsal and room output</h2>
      <Button
        type="button"
        onClick={() => {
          setMessage("Checking local runtimes…");
          void voicePost({}, undefined, "health")
            .then((response) => response.json())
            .then((health) =>
              setMessage(
                `Decoder: ${health.decoder ? "ready" : "unavailable"}; Silero and Piper: ${health.vadAndPiper ? "ready" : "unavailable"}; Whisper: ${health.whisper ? "ready" : "unavailable"}.`,
              ),
            )
            .catch((error) => setMessage(error.message));
        }}
      >
        Check local runtimes
      </Button>
      <p>
        Secure microphone context:{" "}
        {typeof window !== "undefined" && window.isSecureContext
          ? "yes"
          : "HTTPS required"}
        . Pair the speaker in macOS and keep this page visible. One active room
        player per session; lease expires after 20 seconds.
      </p>
      <label>
        Running session
        <select
          value={id}
          onChange={(e) => {
            setEnabled(false);
            setId(e.target.value);
          }}
        >
          <option value="">Choose a session</option>
          {sessions
            .filter((s) => s.status === "running")
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </select>
      </label>
      {id && <Listen source="test" sessionId={id} />}
      <audio
        ref={audio}
        src="data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQIAAAAAAA=="
        controls
        onError={() => {
          setMessage(
            "Playback failed. Enable the player and deliberately replay the passage.",
          );
          setEnabled(false);
        }}
      />
      <Button
        type="button"
        disabled={!id}
        onClick={() => {
          if (!device.current) device.current = crypto.randomUUID();
          setMessage("");
          if (!enabled && audio.current) {
            audio.current.src =
              "data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQIAAAAAAA==";
            void audio.current
              .play()
              .catch(() =>
                setMessage(
                  "Use the audio control to enable playback, then enable the room player.",
                ),
              );
          }
          setEnabled(!enabled);
        }}
      >
        {enabled ? "Disable room player" : "Enable room player"}
      </Button>
      {enabled && (
        <>
          <Button type="button" onClick={() => void command("mute")}>
            {muted ? "Unmute" : "Mute"}
          </Button>
          <Button type="button" onClick={() => void command("stop")}>
            Stop and clear queue
          </Button>
          <p>{queue} queued / claimed announcements</p>
        </>
      )}
      <p role="status">{message}</p>
    </section>
  );
}

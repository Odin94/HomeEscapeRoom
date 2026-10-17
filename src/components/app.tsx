import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useLocation } from "@tanstack/react-router";
import QRCode from "qrcode";
import { Button } from "./ui";
import { GameEditor, ChallengeInput } from "./game-editor";
import { MarkerPrint } from "./marker-print";
import { useStore } from "zustand";
import { createGameStore, type Game, type State } from "../lib/game-store";
async function api(body?: unknown) {
  const response = await fetch(
    "/api/game",
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : { cache: "no-store" },
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Request failed");
  return result;
}
export function App() {
  const adminPage = useLocation().pathname.startsWith("/secretadmin");
  const [store] = useState(createGameStore);
  const state = useStore(store, (value) => value.state);
  const setState = useStore(store, (value) => value.setState);
  const [toast, setToast] = useState("");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("Sessions");
  const [selected, setSelected] = useState("");
  const [editor, setEditor] = useState("");
  const [creatingGame, setCreatingGame] = useState(false);
  const [qr, setQr] = useState("");
  const [joinQr, setJoinQr] = useState<Record<string, string>>({});
  const [joinSession, setJoinSession] = useState("");
  const [code, setCode] = useState("");
  const refresh = useCallback(async () => {
    try {
      const next: State = await api();
      setState(next);
    } catch (e) {
      setFailed(true);
      setToast((e as Error).message);
    }
  }, [setState]);
  useEffect(() => {
    // Clean up the previous client cache; gameplay no longer uses localStorage.
    try {
      localStorage.removeItem("threshold-player");
    } catch {
      // Storage may be disabled; the server and cookie own persistence.
    }
    void refresh();
    const timer = setInterval(refresh, 3000);
    const resume = () => {
      void refresh();
    };
    window.addEventListener("focus", resume);
    setJoinSession(new URLSearchParams(location.search).get("session") || "");
    setCode(new URLSearchParams(location.search).get("code") || "");
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", resume);
    };
  }, [refresh]);
  useEffect(() => {
    setJoinQr({});
    setQr("");
    if (!state?.admin || !state.shareOrigin) return;
    let cancelled = false;
    for (const session of state.sessions)
      void QRCode.toDataURL(
        `${state.shareOrigin}/?session=${encodeURIComponent(session.id)}`,
        { width: 160, margin: 4 },
      )
        .then((url) => {
          if (!cancelled)
            setJoinQr((previous) => ({ ...previous, [session.id]: url }));
        })
        .catch(() => {
          setFailed(true);
          setToast("Could not generate join QR code");
        });
    return () => {
      cancelled = true;
    };
  }, [
    state?.admin,
    state?.shareOrigin,
    state?.sessions.map((s) => s.id).join(","),
  ]);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(""), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  async function act(body: Record<string, unknown>, message = "") {
    setBusy(true);
    try {
      await api(body);
      await refresh();
      setFailed(false);
      setToast(message);
      return true;
    } catch (e) {
      setFailed(true);
      setToast((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (
      !state?.player ||
      state.player.session.status !== "running" ||
      state.automationPending ||
      !code ||
      busy
    )
      return;
    const area = state.areas[state.player.session.progress];
    if (!area || !["qr", "hidden"].includes(area.kind)) return;
    const token = code;
    setCode("");
    history.replaceState(null, "", "/");
    void act({ action: "unlock", code: token, challengeId: area.id });
  }, [
    code,
    busy,
    state?.player?.session_id,
    state?.player?.session.status,
    state?.player?.session.progress,
    state?.automationPending,
  ]);
  function submit(e: FormEvent<HTMLFormElement>, action: string) {
    e.preventDefault();
    void act(
      { action, ...Object.fromEntries(new FormData(e.currentTarget)) },
      "Saved",
    );
  }
  const game =
    state?.games?.find((g) => g.id === selected) || state?.games?.[0];
  return (
    <div className={adminPage ? "admin-shell" : "player-shell"}>
      {adminPage && (
        <header>
          <a href="/secretadmin" className="brand">
            Threshold
          </a>
          <nav>
            {["Sessions", "Games", "Settings"].map((t) => (
              <button
                key={t}
                aria-current={tab === t ? "page" : undefined}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </nav>
          <a
            href={state?.shareOrigin ? `${state.shareOrigin}/` : "/"}
            target="_blank"
            rel="noreferrer"
          >
            Open join page ↗
          </a>
          {state?.admin && (
            <Button variant="ghost" onClick={() => act({ action: "logout" })}>
              Sign out
            </Button>
          )}
        </header>
      )}
      <main>
        {!state ? (
          <p>Loading…</p>
        ) : adminPage ? (
          !state.admin ? (
            <section className="login panel">
              <h1>Admin sign in</h1>
              <form onSubmit={(e) => submit(e, "login")}>
                <label>
                  Admin key
                  <input
                    name="key"
                    type="password"
                    required
                    autoComplete="current-password"
                  />
                </label>
                {!state.adminConfigured && (
                  <p>
                    {state.demo
                      ? "Initial key: demo. Set your own key in Settings before connecting devices."
                      : "Set ADMIN_KEY on the server to enable sign in."}
                  </p>
                )}
                <Button disabled={busy}>Sign in</Button>
              </form>
            </section>
          ) : (
            <>
              <h1>{tab}</h1>
              {tab === "Sessions" && (
                <>
                  <section className="panel">
                    <h2>New session</h2>
                    <form className="row" onSubmit={(e) => submit(e, "create")}>
                      <label>
                        Game
                        <select name="gameId" required>
                          {state.games?.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Session name
                        <input name="name" required maxLength={80} />
                      </label>
                      <Button disabled={busy}>Create session</Button>
                    </form>
                  </section>
                  <div className="session-grid">
                    {state.sessions.map((s) => (
                      <section className="panel" key={s.id}>
                        <h2>{s.name}</h2>
                        <p>
                          {s.status} · {s.players} joined · {s.progress}{" "}
                          discoveries
                        </p>
                        <div className="actions">
                          {["open", "running", "paused", "closed"].map(
                            (status, i) => (
                              <Button
                                key={status}
                                variant={
                                  s.status === status ? "default" : "outline"
                                }
                                disabled={busy}
                                onClick={() =>
                                  act({ action: "status", id: s.id, status })
                                }
                              >
                                {
                                  [
                                    "Open joining",
                                    "Start / resume",
                                    "Pause",
                                    "End",
                                  ][i]
                                }
                              </Button>
                            ),
                          )}
                          <Button
                            variant="outline"
                            disabled={busy}
                            onClick={() => act({ action: "advance", id: s.id })}
                          >
                            Unlock next area
                          </Button>
                        </div>
                        <SessionControls id={s.id} act={act} busy={busy} />
                        <SessionAutomation
                          id={s.id}
                          runs={
                            state.automation?.filter(
                              (r) => r.session_id === s.id,
                            ) || []
                          }
                          act={act}
                          busy={busy}
                        />
                        <div className="join-link">
                          <Button
                            variant="ghost"
                            disabled={!state.shareOrigin}
                            onClick={() => {
                              void navigator.clipboard
                                .writeText(
                                  `${state.shareOrigin}/?session=${encodeURIComponent(s.id)}`,
                                )
                                .then(() => {
                                  setFailed(false);
                                  setToast("Join link copied");
                                })
                                .catch(() => {
                                  setFailed(true);
                                  setToast("Could not copy link");
                                });
                            }}
                          >
                            Copy join link
                          </Button>
                          {joinQr[s.id] && (
                            <img
                              src={joinQr[s.id]}
                              width={160}
                              height={160}
                              alt="Scan to open the join page"
                            />
                          )}
                          {!state.shareOrigin && (
                            <p>
                              Connect the server to Wi-Fi or Ethernet to share a
                              join link.
                            </p>
                          )}
                        </div>
                      </section>
                    ))}
                  </div>
                  <section className="panel">
                    <h2>Activity</h2>
                    {state.events?.length ? (
                      state.events.map((e) => (
                        <p key={e.id}>
                          {e.message} <small>{e.created} UTC</small>
                        </p>
                      ))
                    ) : (
                      <p>No activity yet.</p>
                    )}
                  </section>
                </>
              )}
              {tab === "Games" && (
                <>
                  <section className="panel">
                    <div className="row">
                      <label>
                        Game
                        <select
                          value={game?.id || ""}
                          onChange={(e) => {
                            setSelected(e.target.value);
                            setEditor("");
                          }}
                        >
                          {state.games?.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <Button
                        onClick={() => {
                          setCreatingGame(false);
                          setEditor(JSON.stringify(game, null, 2));
                        }}
                      >
                        Edit definition
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setCreatingGame(true);
                          setEditor(
                            JSON.stringify(
                              {
                                id: "new-game",
                                name: "New game",
                                areas: [
                                  {
                                    id: "first",
                                    name: "First room",
                                    kind: "text",
                                    hint: "",
                                    description: "",
                                    unlockCode: "change-me",
                                    playerView: "narrative",
                                  },
                                ],
                                controls: [],
                              },
                              null,
                              2,
                            ),
                          );
                        }}
                      >
                        New game
                      </Button>
                    </div>
                    <p>
                      Definitions are saved in games/&lt;id&gt;.json for version
                      control. Sessions keep a snapshot. Available player view:
                      narrative.
                    </p>
                    {editor && (
                      <GameEditor
                        key={editor}
                        initial={JSON.parse(editor)}
                        isNew={creatingGame}
                        busy={busy}
                        save={(draft) =>
                          act(
                            { action: "save-game", game: draft },
                            "Game saved",
                          )
                        }
                      />
                    )}
                  </section>
                  {game?.areas.map((a) => (
                    <section className="panel" key={a.id}>
                      <h2>{a.name}</h2>
                      <p>
                        {a.kind} · {a.playerView}
                      </p>
                      <p>{a.description}</p>
                      <p>
                        Answer: <code>{a.unlockCode}</code>
                      </p>
                      {a.kind === "qr" && (
                        <Button
                          variant="outline"
                          disabled={!state.shareOrigin}
                          onClick={async () => {
                            try {
                              setQr(
                                await QRCode.toDataURL(
                                  `${state.shareOrigin}/?code=${encodeURIComponent(a.unlockCode || "")}`,
                                  { width: 320 },
                                ),
                              );
                            } catch {
                              setToast("Could not generate QR");
                              setFailed(true);
                            }
                          }}
                        >
                          Show QR
                        </Button>
                      )}
                    </section>
                  ))}
                  {qr && (
                    <MarkerPrint key={qr} qr={qr} close={() => setQr("")} />
                  )}
                </>
              )}
              {tab === "Settings" && (
                <section className="panel settings">
                  <h2>Server connection</h2>
                  <form
                    key={`${state.settings?.haUrl}:${state.settings?.publicUrl}`}
                    onSubmit={(e) => submit(e, "save-settings")}
                  >
                    <label>
                      Public game URL (for printed QR codes)
                      <input
                        name="publicUrl"
                        type="url"
                        defaultValue={state.settings?.publicUrl}
                        placeholder="http://threshold.home.arpa:3000"
                      />
                    </label>
                    <p>
                      Use a stable hostname that phones on your Wi-Fi can reach.
                      Leave blank to detect a LAN IP automatically. Current
                      link: {state.shareOrigin || "unavailable"}
                    </p>
                    <label>
                      Home Assistant URL
                      <input
                        name="haUrl"
                        type="url"
                        defaultValue={state.settings?.haUrl}
                        placeholder="http://homeassistant.local:8123"
                      />
                    </label>
                    <label>
                      Home Assistant token
                      <input
                        name="haToken"
                        type="password"
                        autoComplete="new-password"
                        placeholder={
                          state.settings?.tokenConfigured
                            ? "Saved — leave blank to keep"
                            : "Long-lived access token"
                        }
                      />
                    </label>
                    <label>
                      Admin key
                      <input
                        name="adminKey"
                        type="password"
                        minLength={8}
                        required={!state.adminConfigured}
                        autoComplete="new-password"
                        placeholder="Leave blank to keep"
                      />
                    </label>
                    <p>
                      Clear the URL to use demo mode. Credentials stay on this
                      server in data/settings.json. Entity mappings belong to
                      each game.
                    </p>
                    <Button disabled={busy}>Save settings</Button>
                  </form>
                </section>
              )}
            </>
          )
        ) : !state.player ? (
          <section className="join panel">
            <h1>Join a session</h1>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act({
                  action: "join",
                  ...Object.fromEntries(new FormData(e.currentTarget)),
                });
              }}
            >
              <label>
                Your name
                <input
                  name="name"
                  required
                  maxLength={40}
                  autoComplete="given-name"
                />
              </label>
              {joinSession ? (
                <>
                  <input type="hidden" name="id" value={joinSession} />
                  <p>
                    Joining{" "}
                    {state.sessions.find((s) => s.id === joinSession)?.name ||
                      "the linked session"}
                  </p>
                </>
              ) : (
                <label>
                  Session
                  <select name="id" required defaultValue="">
                    <option value="" disabled>
                      Select a session
                    </option>
                    {state.sessions
                      .filter((s) => s.acceptingPlayers)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              {joinSession &&
                !state.sessions.some(
                  (s) => s.id === joinSession && s.acceptingPlayers,
                ) && (
                  <p role="status">
                    The linked session is not accepting players. Ask your game
                    master to open joining.
                  </p>
                )}
              {!state.sessions.some((s) => s.acceptingPlayers) && (
                <p>No sessions are open.</p>
              )}
              <Button
                disabled={
                  busy ||
                  !state.sessions.some(
                    (s) =>
                      s.acceptingPlayers &&
                      (!joinSession || s.id === joinSession),
                  )
                }
              >
                Join
              </Button>
            </form>
          </section>
        ) : (
          <article className="story">
            <h1>{state.player.session.name}</h1>
            {state.player.session.status !== "running" && (
              <p className="session-status">
                {state.player.session.status === "open"
                  ? "Waiting to begin"
                  : state.player.session.status === "paused"
                    ? "Paused"
                    : "Session ended"}
              </p>
            )}
            {state.areas
              .filter((_, i) => i < state.player!.session.progress)
              .map((a) => (
                <section key={a.id} data-view={a.playerView || "narrative"}>
                  <h2>{a.name}</h2>
                  <p>{a.description}</p>
                </section>
              ))}
            {state.automationPending && (
              <p role="status">
                Waiting for room actions. Ask your game master to check
                Automation if nothing happens.
              </p>
            )}
            {state.player.session.progress === state.areas.length &&
              !state.automationPending && (
                <p role="status">All challenges solved!</p>
              )}
            {state.player.session.progress < state.areas.length && (
              <form
                className="unlock"
                onSubmit={(e) => {
                  e.preventDefault();
                  void act({
                    action: "unlock",
                    code,
                    challengeId: state.areas[state.player!.session.progress].id,
                  }).then((ok) => {
                    if (ok) {
                      setCode("");
                      history.replaceState(null, "", "/");
                    }
                  });
                }}
              >
                {state.areas[state.player.session.progress]?.hint && (
                  <p>{state.areas[state.player.session.progress].hint}</p>
                )}
                <ChallengeInput
                  key={`${state.player.session_id}-${state.player.session.progress}`}
                  area={state.areas[state.player.session.progress]}
                  code={code}
                  setCode={setCode}
                  disabled={
                    busy ||
                    !!state.automationPending ||
                    state.player.session.status !== "running"
                  }
                />
              </form>
            )}
            <Button variant="ghost" onClick={() => act({ action: "leave" })}>
              Leave session
            </Button>
          </article>
        )}
      </main>
      {toast && (
        <div
          className={`toast ${failed ? "failure" : ""}`}
          role={failed ? "alert" : "status"}
        >
          {toast}
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
function SessionControls({
  id,
  act,
  busy,
}: {
  id: string;
  act: (body: Record<string, unknown>, message?: string) => Promise<boolean>;
  busy: boolean;
}) {
  const [controls, setControls] = useState<Game["controls"]>([]);
  useEffect(() => {
    void api({ action: "session-definition", id })
      .then((d) => setControls(d.game.controls))
      .catch(() => setControls([]));
  }, [id]);
  return (
    <>
      <div className="controls">
        {controls.map((c) => (
          <div key={c.id}>
            <span>{c.name}</span>
            {c.entity.startsWith("light.") ? (
              <>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    act(
                      { action: "device", id, device: c.id, on: true },
                      "Command sent",
                    )
                  }
                >
                  On
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    act(
                      { action: "device", id, device: c.id, on: false },
                      "Command sent",
                    )
                  }
                >
                  Off
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  act({ action: "device", id, device: c.id }, "Command sent")
                }
              >
                Run
              </Button>
            )}
          </div>
        ))}
      </div>
      <Announcements id={id} act={act} busy={busy} />
    </>
  );
}

function Announcements({
  id,
  act,
  busy,
}: {
  id: string;
  act: (body: Record<string, unknown>, message?: string) => Promise<boolean>;
  busy: boolean;
}) {
  const [targets, setTargets] = useState<
    { entity: string; name: string; available: boolean }[]
  >([]);
  const [entity, setEntity] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  async function discover() {
    setLoading(true);
    setError("");
    try {
      const result = await api({ action: "speech-targets" });
      setTargets(result.targets);
      setEntity((previous) =>
        result.targets.some(
          (target: { entity: string; available: boolean }) =>
            target.entity === previous && target.available,
        )
          ? previous
          : result.targets.find(
              (target: { available: boolean }) => target.available,
            )?.entity || "",
      );
      setLoaded(true);
    } catch (e) {
      setError((e as Error).message);
      setTargets([]);
      setEntity("");
    } finally {
      setLoading(false);
    }
  }
  return (
    <form
      className="announcements"
      onSubmit={(event) => {
        event.preventDefault();
        void act(
          { action: "speak", id, entity, message },
          "Announcement accepted by Home Assistant",
        );
      }}
    >
      <h3>Alexa announcements</h3>
      <p>
        Type a clue or message. Speak reads it aloud; Announce adds a chime
        first.
      </p>
      <Button
        type="button"
        variant="outline"
        disabled={busy || loading}
        onClick={() => void discover()}
      >
        {loading
          ? "Finding speakers…"
          : loaded
            ? "Refresh speakers"
            : "Find speakers"}
      </Button>
      {error && <p role="alert">{error}</p>}
      {loaded && !error && targets.length === 0 && (
        <p>
          No Speak or Announce entities found. Finish Alexa Devices setup in
          Home Assistant, then refresh speakers.
        </p>
      )}
      {targets.length > 0 && (
        <>
          <label>
            Speaker
            <select
              value={entity}
              required
              disabled={busy || loading}
              onChange={(event) => setEntity(event.target.value)}
            >
              <option value="">Choose a speaker</option>
              {targets.map((target) => (
                <option
                  key={target.entity}
                  value={target.entity}
                  disabled={!target.available}
                >
                  {target.name}
                  {!target.available ? " (unavailable)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Message
            <textarea
              value={message}
              required
              maxLength={1000}
              rows={3}
              placeholder="Your next clue is hidden beneath the clock…"
              onChange={(event) => setMessage(event.target.value)}
            />
          </label>
          <small>{message.length}/1000 characters</small>
          <Button
            type="submit"
            disabled={busy || loading || !entity || !message.trim()}
          >
            Say it
          </Button>
        </>
      )}
    </form>
  );
}

function SessionAutomation({
  id,
  runs,
  act,
  busy,
}: {
  id: string;
  runs: NonNullable<State["automation"]>;
  act: (body: Record<string, unknown>, message?: string) => Promise<boolean>;
  busy: boolean;
}) {
  const [config, setConfig] = useState<{
    url: string;
    token: string;
    challenges: { id: string; name: string; answer: string }[];
  }>();
  const [error, setError] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const challenge =
    config?.challenges.find((a) => a.id === challengeId) ||
    config?.challenges[0];
  return (
    <details>
      <summary>Automation / Alexa callback</summary>
      <p>
        Failed actions block further answers. Check the device before retrying:
        a timed-out announcement may already have played.
      </p>
      {runs.map((r) => (
        <p key={r.id} role="status">
          {r.status}: {r.error || "Waiting for action completion"}
        </p>
      ))}
      {runs.length > 0 && (
        <Button
          disabled={busy || runs.some((r) => r.status === "running")}
          onClick={() => void act({ action: "retry-actions", id })}
        >
          Retry failed actions
        </Button>
      )}
      <Button
        variant="outline"
        onClick={() => {
          void api({ action: "callback-config", id })
            .then(setConfig)
            .catch((e) => setError(e.message));
        }}
      >
        Show callback configuration
      </Button>
      {error && <p role="alert">{error}</p>}
      {config && (
        <>
          <p>
            Keep this bearer token private. POST JSON from Home Assistant to:
          </p>
          <code>{config.url}</code>
          <p>Authorization: Bearer {config.token}</p>
          <label>
            External challenge
            <select
              value={challenge?.id || ""}
              onChange={(e) => setChallengeId(e.target.value)}
            >
              {config.challenges.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          {!challenge && (
            <p>
              This session has no external-answer challenges. Edit the game and
              create a new session.
            </p>
          )}
          <pre>
            {JSON.stringify(
              {
                sessionId: id,
                challengeId: challenge?.id,
                answer: challenge?.answer,
              },
              null,
              2,
            )}
          </pre>
          {challenge && (
            <details>
              <summary>Home Assistant YAML example</summary>
              <p>
                Merge this into your Home Assistant configuration,
                restart/reload the affected integrations, and expose the helper
                to Alexa. Create a voice routine whose action turns this helper
                on. Use a separate helper/command for each simultaneous session.
              </p>
              <pre
                style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
              >{`input_boolean:
  threshold_answer:
    name: Threshold answer
rest_command:
  threshold_answer:
    url: ${JSON.stringify(config.url)}
    method: POST
    headers:
      authorization: ${JSON.stringify(`Bearer ${config.token}`)}
    content_type: "application/json"
    payload: '${JSON.stringify({ sessionId: id, challengeId: challenge.id, answer: challenge.answer }).replace(/'/g, "''")}'
automation:
  - alias: Threshold spoken answer
    triggers:
      - trigger: state
        entity_id: input_boolean.threshold_answer
        from: "off"
        to: "on"
    actions:
      - action: input_boolean.turn_off
        target:
          entity_id: input_boolean.threshold_answer
      - action: rest_command.threshold_answer
    mode: single`}</pre>
            </details>
          )}
          <p>
            Configure an Alexa routine or skill to trigger a Home Assistant
            automation that sends this request. Use the challenge ID in this
            session’s game snapshot. Paused sessions and other stages reject the
            request.
          </p>
        </>
      )}
    </details>
  );
}

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useLocation } from "@tanstack/react-router";
import QRCode from "qrcode";
import { Button } from "./ui";
import { usePlayerStore } from "../lib/player-store";
type Game = {
  id: string;
  name: string;
  areas: Area[];
  controls: { id: string; name: string; entity: string }[];
};
type Area = {
  id: string;
  name: string;
  kind: string;
  hint: string;
  description: string;
  unlockCode?: string;
  playerView?: string;
};
type Session = {
  id: string;
  name: string;
  status: string;
  progress: number;
  players?: number;
};
type State = {
  admin: boolean;
  adminConfigured: boolean;
  shareOrigin?: string | null;
  demo: boolean;
  sessions: Session[];
  games?: Game[];
  areas: Area[];
  settings?: { haUrl: string; tokenConfigured: boolean; publicUrl: string };
  player: { name: string; session_id: string; session: Session } | null;
  events?: { id: number; message: string; created: string }[];
};
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
  const [state, setState] = useState<State>();
  const [toast, setToast] = useState("");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("Sessions");
  const [selected, setSelected] = useState("");
  const [editor, setEditor] = useState("");
  const [qr, setQr] = useState("");
  const [joinQr, setJoinQr] = useState("");
  const [code, setCode] = useState("");
  const refresh = useCallback(async () => {
    try {
      const next: State = await api();
      usePlayerStore
        .getState()
        .sync(
          next.player && !next.admin
            ? { player: next.player, areas: next.areas }
            : null,
        );
      setState(next);
    } catch (e) {
      setFailed(true);
      setToast((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void usePlayerStore.persist.rehydrate();
    void refresh();
    const timer = setInterval(refresh, 3000);
    const resume = () => {
      void refresh();
    };
    window.addEventListener("focus", resume);
    setCode(new URLSearchParams(location.search).get("code") || "");
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", resume);
    };
  }, [refresh]);
  useEffect(() => {
    setJoinQr("");
    setQr("");
    if (!state?.admin || !state.shareOrigin) return;
    let cancelled = false;
    void QRCode.toDataURL(`${state.shareOrigin}/`, { width: 160, margin: 4 })
      .then((url) => {
        if (!cancelled) setJoinQr(url);
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
          setToast("Could not generate join QR code");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [state?.admin, state?.shareOrigin]);
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
                        <div className="join-link">
                          <Button
                            variant="ghost"
                            disabled={!state.shareOrigin}
                            onClick={() => {
                              void navigator.clipboard
                                .writeText(`${state.shareOrigin}/`)
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
                          {joinQr && (
                            <img
                              src={joinQr}
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
                        onClick={() => setEditor(JSON.stringify(game, null, 2))}
                      >
                        Edit definition
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() =>
                          setEditor(
                            JSON.stringify(
                              {
                                id: "new-game",
                                name: "New game",
                                areas: [
                                  {
                                    id: "first",
                                    name: "First room",
                                    kind: "password",
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
                          )
                        }
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
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          try {
                            void act(
                              { action: "save-game", game: JSON.parse(editor) },
                              "Game saved",
                            );
                          } catch {
                            setFailed(true);
                            setToast("Enter valid JSON");
                          }
                        }}
                      >
                        <label>
                          Game JSON
                          <textarea
                            rows={22}
                            value={editor}
                            onChange={(e) => setEditor(e.target.value)}
                            spellCheck={false}
                            required
                          />
                        </label>
                        <Button disabled={busy}>Save game</Button>
                      </form>
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
                    <section className="panel qr">
                      <img src={qr} alt="Room marker" />
                      <Button onClick={() => window.print()}>
                        Print marker
                      </Button>
                      <Button variant="ghost" onClick={() => setQr("")}>
                        Close
                      </Button>
                    </section>
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
              <label>
                Session
                <select name="id" required defaultValue="">
                  <option value="" disabled>
                    Select a session
                  </option>
                  {state.sessions
                    .filter((s) => s.status === "open")
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
              </label>
              {!state.sessions.some((s) => s.status === "open") && (
                <p>No sessions are open.</p>
              )}
              <Button
                disabled={
                  busy || !state.sessions.some((s) => s.status === "open")
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
            {state.player.session.progress < state.areas.length && (
              <form
                className="unlock"
                onSubmit={(e) => {
                  e.preventDefault();
                  void act({ action: "unlock", code }).then((ok) => {
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
                <label>
                  {state.areas[state.player.session.progress]?.kind ===
                  "password"
                    ? "Password"
                    : "Code"}
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    required
                    autoComplete="off"
                  />
                </label>
                <Button
                  disabled={busy || state.player.session.status !== "running"}
                >
                  Unlock
                </Button>
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
  );
}

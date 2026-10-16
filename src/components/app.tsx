import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import {
  ArrowUpRight,
  ArrowRight,
  Radio,
  LayoutDashboard,
  Users,
  ScanLine,
  Settings2,
  House,
  Plus,
  Play,
  Pause,
  ChevronRight,
  Lightbulb,
  Volume2,
  Sun,
  Check,
  Lock,
  KeyRound,
  Activity,
  Copy,
  Command,
  PanelLeftClose,
  LogOut,
  Printer,
} from "lucide-react";
import QRCode from "qrcode";
import { Button, Modal } from "./ui";
import { areas } from "../lib/game";
type Session = {
  id: string;
  name: string;
  status: string;
  progress: number;
  players: number;
};
type State = {
  admin: boolean;
  demo: boolean;
  adminConfigured: boolean;
  sessions: Session[];
  events?: {
    id: number;
    message: string;
    created: string;
    session_id: string;
  }[];
  players?: { name: string; session_id: string }[];
  player: { name: string; session_id: string; session: Session } | null;
};
async function api(body?: unknown) {
  const r = await fetch(
    "/api/game",
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : undefined,
  );
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "Something went wrong");
  return d;
}
export function App() {
  const path = useLocation().pathname;
  const [state, setState] = useState<State>();
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState("");
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const [qr, setQr] = useState("");
  const [origin, setOrigin] = useState("");
  const refresh = () =>
    api()
      .then(setState)
      .catch((e) => setError(e.message));
  useEffect(() => {
    refresh();
    setOrigin(location.origin);
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setModal("navigate");
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 4000);
      return () => clearTimeout(t);
    }
  }, [toast]);
  async function act(body: Record<string, unknown>, message?: string) {
    setBusy(true);
    setError("");
    try {
      await api(body);
      await refresh();
      if (message) setToast(message);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  function submit(
    e: FormEvent<HTMLFormElement>,
    action: string,
    extra: Record<string, unknown> = {},
  ) {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.currentTarget));
    void act({ action, ...values, ...extra }).then((ok) => {
      if (ok) setModal("");
    });
  }
  async function showQr(code: string) {
    setQr(
      await QRCode.toDataURL(`${origin}/play?code=${code}`, {
        width: 320,
        margin: 2,
        color: { dark: "#182d29", light: "#ffffff" },
      }),
    );
    setModal("qr");
  }
  const game =
    state?.sessions.find((x) => x.id === selected) ||
    state?.sessions.find((x) => x.status === "running") ||
    state?.sessions[0];
  const adminPage = path !== "/play";
  const nav = [
    { url: "/", name: "Overview", icon: LayoutDashboard },
    { url: "/sessions", name: "Game sessions", icon: Users },
    { url: "/areas", name: "Areas & access", icon: ScanLine },
    { url: "/integrations", name: "Integrations", icon: Settings2 },
  ];
  return (
    <div className={adminPage ? "app" : "player-app"}>
      {adminPage && (
        <aside className="sidebar">
          <Link to="/" className="brand">
            <span className="brand-icon">
              <House size={23} />
            </span>
            threshold<span className="brand-dot">.</span>
          </Link>
          <div className="workspace">
            <span className="workspace-icon">S</span>
            <div>
              The Signal House<small>Your escape room workspace</small>
            </div>
            <ChevronRight size={15} />
          </div>
          <div className="nav-label">WORKSPACE</div>
          <nav>
            {nav.map((n) => (
              <Link
                key={n.url}
                to={n.url}
                className={path === n.url ? "nav-item active" : "nav-item"}
              >
                <n.icon size={19} />
                {n.name}
                {n.url === "/" && <span className="nav-dot" />}
              </Link>
            ))}
          </nav>
          <button className="quick" onClick={() => setModal("navigate")}>
            <Command size={16} /> Quick navigation <kbd>⌘ K</kbd>
          </button>
          <div className="sidebar-bottom">
            <div className="local">
              <span className="green-dot" />
              <div>
                Local workspace<small>Made for the room you're in.</small>
              </div>
            </div>
            <Link to="/play" className="player-link">
              Open player experience
              <ArrowUpRight size={17} />
            </Link>
            <div className="profile">
              <span className="avatar">GM</span>
              <div>
                Game master<small>Behind the scenes</small>
              </div>
              <PanelLeftClose size={17} />
            </div>
          </div>
        </aside>
      )}
      <main>
        <header className="topbar">
          {adminPage ? (
            <>
              <div className="breadcrumb">
                Workspace <ChevronRight size={14} />
                <span>
                  {nav.find((n) => n.url === path)?.name || "Overview"}
                </span>
              </div>
              <div className="top-status">
                <span className="green-dot" />
                Local server <span className="divider" />{" "}
                <span className="mode-label">GAME MASTER</span>
                {state?.admin && (
                  <button
                    className="icon-button"
                    aria-label="Sign out as game master"
                    onClick={() => act({ action: "logout" })}
                  >
                    <LogOut size={13} />
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <Link to="/" className="brand">
                <House size={21} /> threshold.
              </Link>
              <span className="mode-label">PLAYER EXPERIENCE</span>
            </>
          )}
        </header>
        {error && (
          <div className="error" role="alert">
            {error}
            <button
              onClick={() => {
                setError("");
                refresh();
              }}
            >
              Retry
            </button>
            <button onClick={() => setError("")}>Dismiss</button>
          </div>
        )}
        {!state ? (
          <div className="loading">Opening the house…</div>
        ) : adminPage && !state.admin ? (
          <div className="login panel">
            <div className="eyebrow">BEHIND THE SCENES</div>
            <h1>Welcome, game master.</h1>
            <p>Your room. Your story. Pull the strings from here.</p>
            <form onSubmit={(e) => submit(e, "login")}>
              <label>
                Game master key
                <input
                  name="key"
                  type="password"
                  required
                  placeholder="Enter your key"
                />
              </label>
              {!state.adminConfigured && (
                <p className="muted">
                  Demo workspace · use <strong>demo</strong> to explore. Set
                  ADMIN_KEY before hosting a game.
                </p>
              )}
              <Button disabled={busy}>
                Enter control room <ArrowRight size={17} />
              </Button>
            </form>
            <Link to="/play" className="text-link">
              Here to play? Join a game <ArrowUpRight size={15} />
            </Link>
          </div>
        ) : adminPage ? (
          <div className="content">
            <div className="page-heading">
              <div>
                <div className="eyebrow">THE HOUSE IS YOURS</div>
                <h1>
                  {path === "/"
                    ? "Control room"
                    : path === "/sessions"
                      ? "Game sessions"
                      : path === "/areas"
                        ? "Areas & access"
                        : "Connected home"}
                </h1>
                <p>
                  {path === "/"
                    ? "A little mystery. A few moving parts. Everything in one place."
                    : path === "/sessions"
                      ? "Set the stage, gather your players, and let the story unfold."
                      : path === "/areas"
                        ? "Turn physical discoveries into the next chapter."
                        : "One connection to orchestrate the whole house."}
                </p>
              </div>
              <Button onClick={() => setModal("create")}>
                <Plus size={17} />
                New session
              </Button>
            </div>
            {path === "/" && (
              <>
                <div className="stats">
                  <Stat
                    title="ACTIVE SESSIONS"
                    value={String(
                      state.sessions.filter((x) => x.status === "running")
                        .length,
                    ).padStart(2, "0")}
                    detail="Let the story unfold"
                    icon={<Radio size={19} />}
                  />
                  <Stat
                    title="PLAYERS IN THE HOUSE"
                    value={String(
                      state.sessions.reduce((a, x) => a + x.players, 0),
                    ).padStart(2, "0")}
                    detail="A shared adventure"
                    icon={<Users size={19} />}
                  />
                  <Stat
                    title="AREAS DISCOVERED"
                    value={`${game?.progress || 0}`}
                    suffix="/ 3"
                    detail="One clue at a time"
                    icon={<ScanLine size={19} />}
                  />
                  <Stat
                    title="HOME ASSISTANT"
                    value={state.demo ? "Demo mode" : "Configured"}
                    detail={
                      state.demo
                        ? "Explore without hardware"
                        : "Ready to send commands"
                    }
                    icon={<House size={19} />}
                    small
                  />
                </div>
                <div className="dashboard-grid">
                  <section className="session-hero">
                    <div className="hero-grain" />
                    <div className="hero-top">
                      <span className="light-eyebrow">
                        <span className="green-dot" />
                        {game?.status === "running"
                          ? "LIVE SESSION"
                          : "READY WHEN YOU ARE"}
                      </span>
                      <span className="hero-id">CHAPTER 001</span>
                    </div>
                    <div className="hero-copy">
                      <span className="hero-overline">
                        AN ESCAPE ROOM AT HOME
                      </span>
                      <h2>{game?.name || "The Signal House"}</h2>
                      <p>
                        The house has a secret.
                        <br />
                        Let curiosity lead the way.
                      </p>
                    </div>
                    <div className="hero-bottom">
                      <span>
                        <Users size={16} />
                        {game?.players || 0} players joined{" "}
                        <span className="hero-separator">·</span>3 connected
                        areas
                      </span>
                      <Button
                        variant="outline"
                        onClick={() => setModal("session")}
                      >
                        Manage session <ArrowUpRight size={16} />
                      </Button>
                    </div>
                    <div className="house-art">
                      <div className="orbit orbit-one" />
                      <div className="orbit orbit-two" />
                      <House strokeWidth={0.65} />
                      <div className="art-cross">+</div>
                    </div>
                  </section>
                  <section className="panel home-panel">
                    <SectionTitle
                      title="The connected house"
                      detail="A little atmosphere goes a long way."
                    />
                    <div className="connection-line">
                      <span className="ha-logo">
                        <House size={20} />
                      </span>
                      <div>
                        Home Assistant
                        <small>
                          {state.demo ? "Demo connection" : "Server configured"}
                        </small>
                      </div>
                      <span className="tag">
                        {state.demo ? "SIMULATED" : "CONFIGURED"}
                      </span>
                    </div>
                    <DeviceControls busy={busy} act={act} />
                    <Link to="/integrations" className="panel-footer">
                      Manage integrations <ArrowRight size={15} />
                    </Link>
                  </section>
                  <section className="panel progression">
                    <SectionTitle
                      title="The path through the house"
                      detail="A shared journey, unlocked one discovery at a time."
                      action={
                        <Link to="/areas">
                          View all <ArrowUpRight size={15} />
                        </Link>
                      }
                    />
                    <div className="area-path">
                      {areas.map((a, i) => (
                        <div
                          key={a.id}
                          className={`area-step ${i < (game?.progress || 0) ? "discovered" : ""}`}
                        >
                          <div className="step-number">
                            {i < (game?.progress || 0) ? (
                              <Check size={17} />
                            ) : i === game?.progress ? (
                              <ScanLine size={17} />
                            ) : (
                              <Lock size={15} />
                            )}
                          </div>
                          <span className="area-index">AREA 0{i + 1}</span>
                          <h3>{a.name}</h3>
                          <span className="muted area-kind">
                            {a.kind === "qr" ? (
                              <ScanLine size={13} />
                            ) : (
                              <KeyRound size={13} />
                            )}{" "}
                            {a.kind === "qr"
                              ? "QR discovery"
                              : "Password unlock"}
                          </span>
                          <span className="area-status">
                            {i < (game?.progress || 0)
                              ? "Discovered"
                              : i === game?.progress
                                ? "Next discovery"
                                : "Locked"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>
                  <section className="panel activity">
                    <SectionTitle
                      title="Room activity"
                      action={
                        <span className="live-indicator">
                          <span className="green-dot" />
                          LIVE
                        </span>
                      }
                    />
                    <EventList events={state.events || []} />
                  </section>
                </div>
                <div className="bottom-note">
                  <span>
                    <Lock size={13} />
                    Your game stays on your network.
                  </span>
                  <span>
                    Built for a little real-world magic.{" "}
                    <span className="sparkle">✧</span>
                  </span>
                </div>
              </>
            )}
            {path === "/sessions" && (
              <section className="panel">
                <SectionTitle
                  title="Your sessions"
                  detail="Open sessions accept new players. Start a session to enable discoveries."
                />
                {state.sessions.map((s) => (
                  <div
                    className="session-row"
                    key={s.id}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setSelected(s.id);
                      setModal("session");
                    }}
                  >
                    <span className="session-symbol">
                      <Radio size={21} />
                    </span>
                    <div className="grow">
                      <h3>{s.name}</h3>
                      <small>
                        {s.players} players · {s.progress}/3 areas discovered
                      </small>
                    </div>
                    <span className={`status ${s.status}`}>{s.status}</span>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setSelected(s.id);
                        setModal("session");
                      }}
                    >
                      Manage <ArrowRight size={15} />
                    </Button>
                  </div>
                ))}
              </section>
            )}
            {path === "/areas" && (
              <>
                <div className="info-note">
                  <ScanLine size={21} />
                  <div>
                    <strong>Let the room do the storytelling.</strong>
                    <p>
                      Print a marker, hide it in the physical room, and let
                      players scan it with their phone camera. Progress is
                      shared by the whole team.
                    </p>
                  </div>
                </div>
                <div className="area-cards">
                  {areas.map((a, i) => (
                    <section
                      className="panel area-card"
                      key={a.id}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        if (a.kind === "qr")
                          void showQr(
                            i === 0
                              ? "study-marker-7c92"
                              : "observatory-marker-a83f",
                          );
                      }}
                    >
                      <span className="area-index">CHAPTER 0{i + 1}</span>
                      <div className="area-illustration">
                        {a.kind === "qr" ? (
                          <ScanLine size={60} strokeWidth={1} />
                        ) : (
                          <KeyRound size={60} strokeWidth={1} />
                        )}
                      </div>
                      <h2>{a.name}</h2>
                      <p>{a.subtitle}</p>
                      <div className="clue">
                        <small>PLAYER CLUE</small>
                        {a.hint}
                      </div>
                      {a.kind === "qr" ? (
                        <Button
                          variant="outline"
                          onClick={() =>
                            showQr(
                              i === 0
                                ? "study-marker-7c92"
                                : "observatory-marker-a83f",
                            )
                          }
                        >
                          <Printer size={16} />
                          View printable QR
                        </Button>
                      ) : (
                        <div className="password-answer">
                          Demo password <code>RAVEN</code>
                        </div>
                      )}
                    </section>
                  ))}
                </div>
                <p className="muted">
                  QR links use this browser’s address: {origin}. Open this
                  dashboard using your MacBook’s LAN IP or Tailscale hostname
                  before printing.
                </p>
              </>
            )}
            {path === "/integrations" && (
              <div className="integration-grid">
                <section className="panel">
                  <SectionTitle
                    title="Home Assistant"
                    detail="Hue lights, scenes, and Alexa routines — through one hub."
                  />
                  <div className="integration-banner">
                    <House size={30} />
                    <div>
                      <h3>
                        {state.demo
                          ? "Demo mode is on"
                          : "Home Assistant configured"}
                      </h3>
                      <p>
                        {state.demo
                          ? "Controls record simulated events. No devices are contacted."
                          : "Commands are sent server-side. Success appears in the activity log."}
                      </p>
                    </div>
                  </div>
                  <DeviceControls busy={busy} act={act} />
                </section>
                <section className="panel setup">
                  <SectionTitle title="Connect your house" />
                  <ol>
                    <li>
                      Create a long-lived access token in your Home Assistant
                      profile.
                    </li>
                    <li>Set HA_URL and HA_TOKEN in your server’s .env file.</li>
                    <li>
                      Add HA_LIGHT_ENTITY, HA_SCENE_ENTITY, and HA_VOICE_SCRIPT.
                    </li>
                    <li>Restart the server, then try a control.</li>
                  </ol>
                  <p>
                    Alexa announcements are triggered through your Home
                    Assistant script. See README.md for a sample and networking
                    instructions.
                  </p>
                  <div className="clue">
                    Keep your Home Assistant token on the server. Players never
                    receive it.
                  </div>
                </section>
              </div>
            )}
          </div>
        ) : (
          <div className="player-content">
            {!state.player ? (
              <>
                <div className="eyebrow">A REAL-WORLD MYSTERY</div>
                <div className="player-emblem">
                  <House size={65} strokeWidth={1} />
                </div>
                <h1>Step into the story.</h1>
                <p>
                  Some doors open with a key.
                  <br />
                  Others need a little curiosity.
                </p>
                <form
                  className="panel join-form"
                  onSubmit={(e) => submit(e, "join")}
                >
                  <h2>Your adventure starts here.</h2>
                  <label>
                    Your name
                    <input
                      name="name"
                      required
                      maxLength={40}
                      placeholder="What should we call you?"
                      autoComplete="given-name"
                    />
                  </label>
                  <label>
                    Choose an open game
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
                    <p className="muted">
                      No games are open yet. Ask your game master to open one.
                    </p>
                  )}
                  <Button
                    disabled={
                      busy || !state.sessions.some((s) => s.status === "open")
                    }
                  >
                    Join the adventure <ArrowRight size={17} />
                  </Button>
                </form>
              </>
            ) : (
              <Player state={state} busy={busy} act={act} />
            )}
          </div>
        )}
      </main>
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          {toast}
        </div>
      )}
      <Modal
        open={!!modal}
        onOpenChange={(v) => !v && setModal("")}
        title={
          modal === "create"
            ? "Set the stage"
            : modal === "session"
              ? "Session controls"
              : modal === "qr"
                ? "A doorway to the next chapter"
                : "Go somewhere"
        }
      >
        {modal === "create" && (
          <form onSubmit={(e) => submit(e, "create")}>
            <p>Create an open game for players to join.</p>
            <label>
              Session name
              <input
                name="name"
                placeholder="Friday night mystery"
                maxLength={80}
                required
                autoFocus
              />
            </label>
            <Button disabled={busy}>
              <Plus size={17} />
              Create session
            </Button>
          </form>
        )}
        {modal === "session" && game && (
          <>
            <h3>{game.name}</h3>
            <p>
              {game.players} players · {game.progress} of 3 areas discovered
            </p>
            <div className="session-actions">
              {[
                ["open", "Open joining"],
                ["running", "Start / resume"],
                ["paused", "Pause"],
                ["closed", "End session"],
              ].map(([status, label]) => (
                <Button
                  key={status}
                  variant={game.status === status ? "default" : "outline"}
                  disabled={busy}
                  onClick={() =>
                    act(
                      { action: "status", id: game.id, status },
                      `Session ${status}`,
                    )
                  }
                >
                  {status === "running" ? (
                    <Play size={15} />
                  ) : status === "paused" ? (
                    <Pause size={15} />
                  ) : null}
                  {label}
                </Button>
              ))}
            </div>
            <Button
              variant="outline"
              disabled={busy || game.progress >= 3}
              onClick={() =>
                act({ action: "advance", id: game.id }, "Next area unlocked")
              }
            >
              Unlock next area <ArrowRight size={16} />
            </Button>
            <p className="muted">
              Players can join while open. Start the game once everyone is here.
              Pause freezes player discoveries.
            </p>
            <div className="players-list">
              {state?.players
                ?.filter((p) => p.session_id === game.id)
                .map((p, i) => (
                  <span key={i} className="player-chip">
                    <Users size={14} />
                    {p.name}
                  </span>
                ))}
            </div>
            <Button
              variant="ghost"
              onClick={async () => {
                await navigator.clipboard.writeText(`${origin}/play`);
                setToast("Player link copied");
              }}
            >
              <Copy size={15} />
              Copy player link
            </Button>
          </>
        )}
        {modal === "qr" && (
          <div className="qr-print">
            <img src={qr} alt="Scan to discover this area" />
            <p>Scan with your phone camera to discover the next area.</p>
            <Button onClick={() => window.print()}>
              <Printer size={16} />
              Print marker
            </Button>
            <p className="muted">
              Use a network-reachable address before printing.
            </p>
          </div>
        )}
        {modal === "navigate" && (
          <>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a page…"
              aria-label="Find a page"
            />
            <div className="command-links">
              {[
                ...nav,
                { url: "/play", name: "Player experience", icon: ScanLine },
              ]
                .filter((n) =>
                  n.name.toLowerCase().includes(query.toLowerCase()),
                )
                .map((n) => (
                  <Link key={n.url} to={n.url} onClick={() => setModal("")}>
                    <n.icon size={18} />
                    {n.name}
                    <ArrowRight size={16} />
                  </Link>
                ))}
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
function Stat({
  title,
  value,
  detail,
  icon,
  suffix,
  small,
}: {
  title: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
  suffix?: string;
  small?: boolean;
}) {
  return (
    <div className="stat">
      <div className="stat-top">
        {title}
        {icon}
      </div>
      <div className={small ? "stat-value small" : "stat-value"}>
        {value}
        <span>{suffix}</span>
      </div>
      <small>{detail}</small>
    </div>
  );
}
function SectionTitle({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="section-title">
      <div>
        <h2>{title}</h2>
        {detail && <p>{detail}</p>}
      </div>
      {action}
    </div>
  );
}
function DeviceControls({
  busy,
  act,
}: {
  busy: boolean;
  act: (body: Record<string, unknown>, message?: string) => Promise<boolean>;
}) {
  return (
    <div className="device-controls">
      {[
        {
          id: "lights",
          name: "Room lights",
          sub: "Hue · via Home Assistant",
          icon: Lightbulb,
        },
        {
          id: "scene",
          name: "Set the atmosphere",
          sub: "Activate your escape room scene",
          icon: Sun,
        },
        {
          id: "voice",
          name: "A voice in the room",
          sub: "Run your Alexa announcement script",
          icon: Volume2,
        },
      ].map((d) => (
        <div className="device" key={d.id}>
          <d.icon size={19} />
          <div className="grow">
            <strong>{d.name}</strong>
            <small>{d.sub}</small>
          </div>
          {d.id === "lights" ? (
            <div className="device-buttons">
              <button
                disabled={busy}
                onClick={() =>
                  act(
                    { action: "device", device: d.id, on: true },
                    "Lights command recorded",
                  )
                }
              >
                On
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  act(
                    { action: "device", device: d.id, on: false },
                    "Lights command recorded",
                  )
                }
              >
                Off
              </button>
            </div>
          ) : (
            <button
              className="icon-button"
              aria-label={`Trigger ${d.name}`}
              disabled={busy}
              onClick={() =>
                act({ action: "device", device: d.id }, "Command recorded")
              }
            >
              <Play size={16} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
function EventList({
  events,
}: {
  events: { id: number; message: string; created: string }[];
}) {
  return (
    <div className="event-list">
      {events.length ? (
        events.map((e) => (
          <div className="event" key={e.id}>
            <span className="event-dot" />
            <div>
              {e.message}
              <small>{e.created.replace(" ", " · ")} UTC</small>
            </div>
          </div>
        ))
      ) : (
        <div className="empty-activity">
          <Activity size={25} />
          <p>The house is quiet. For now.</p>
          <small>Player discoveries and controls appear here.</small>
        </div>
      )}
    </div>
  );
}
function Player({
  state,
  busy,
  act,
}: {
  state: State;
  busy: boolean;
  act: (body: Record<string, unknown>, message?: string) => Promise<boolean>;
}) {
  const p = state.player!;
  const progress = p.session.progress;
  const [code, setCode] = useState("");
  useEffect(() => {
    setCode(new URLSearchParams(location.search).get("code") || "");
  }, []);
  return (
    <>
      <div className="eyebrow">{p.session.name}</div>
      <h1>Welcome, {p.name}.</h1>
      <p>
        {progress >= 3
          ? "Every mystery has an ending. This one is yours."
          : "Stay curious. The house is full of clues."}
      </p>
      <div className="player-progress">
        <span>{progress}/3 areas discovered</span>
        <div>
          <i style={{ width: `${(progress / 3) * 100}%` }} />
        </div>
      </div>
      {p.session.status !== "running" && (
        <div className="info-note">
          {p.session.status === "paused"
            ? "The game is paused. Take a breath."
            : p.session.status === "closed"
              ? "This session has ended. Thank you for playing."
              : "Your game master will start the adventure shortly."}
        </div>
      )}
      {areas.map((a, i) => (
        <section
          className={`panel player-area ${i >= progress ? "locked-area" : ""}`}
          key={a.id}
        >
          <span className="area-index">
            AREA 0{i + 1} {i < progress ? "· DISCOVERED" : ""}
          </span>
          <h2>
            {i < progress
              ? a.name
              : i === progress
                ? "Your next discovery"
                : "An unopened door"}
            {i >= progress && <Lock size={18} />}
          </h2>
          <p>
            {i < progress
              ? a.description
              : i === progress
                ? a.hint
                : "Keep following the story to reveal this area."}
          </p>
        </section>
      ))}
      {progress < 3 && (
        <form
          className="panel unlock-form"
          onSubmit={(e) => {
            e.preventDefault();
            void act({ action: "unlock", code }, "A new chapter is open").then(
              (ok) => {
                if (ok) {
                  setCode("");
                  history.replaceState(null, "", "/play");
                }
              },
            );
          }}
        >
          <h2>
            {areas[progress].kind === "password"
              ? "A word opens the way."
              : "Found a marker?"}
          </h2>
          <p>
            {areas[progress].kind === "qr"
              ? "Scan the physical QR with your phone camera. Its discovery code will appear here."
              : "Enter the answer hidden in your clue."}
          </p>
          <label>
            {areas[progress].kind === "password"
              ? "Password"
              : "Discovery code"}
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              autoComplete="off"
              placeholder={
                areas[progress].kind === "password"
                  ? "Your answer…"
                  : "Scan a marker or enter its code"
              }
            />
          </label>
          <Button disabled={busy || p.session.status !== "running"}>
            Unlock the next chapter <ArrowRight size={17} />
          </Button>
        </form>
      )}
      {progress >= 3 && (
        <div className="completion">
          <Check size={30} />
          <h2>You restored the signal.</h2>
          <p>Three discoveries. One team. A house full of stories.</p>
        </div>
      )}
      <Button variant="ghost" onClick={() => act({ action: "leave" })}>
        <LogOut size={16} />
        Leave player view
      </Button>
    </>
  );
}

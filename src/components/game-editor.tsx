import { GameMarkdown } from "./game-markdown";
import { QrToken } from "./qr-token";
import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Plus, Trash2 } from "lucide-react";
import { gameDraftKey, readGameDraft } from "../lib/game-draft";
import type { Area, Game } from "../lib/game-store";
import { Button } from "./ui";
import {
  EntityPicker,
  type Target,
  LightTransitionEditor,
} from "./light-transition-editor";
function DevicePicker({
  domain,
  value,
  change,
}: {
  domain: "control" | "notify";
  value: string;
  change: (value: string) => void;
}) {
  const [targets, setTargets] = useState<Target[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: domain === "notify" ? "speech-targets" : "control-targets",
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Could not load devices.");
      setTargets(data.targets);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not load devices.",
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, [domain]);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={loading}
        onClick={() => void refresh()}
      >
        {loading ? "Loading devices…" : "Refresh devices"}
      </Button>
      {error && <p role="alert">{error}</p>}
      <EntityPicker
        targets={targets}
        domain={domain}
        single
        selected={value ? [value] : []}
        change={(values) => change(values[0] || "")}
      />
      <label>
        Selected entity
        <input
          required
          maxLength={256}
          value={value}
          onChange={(event) => change(event.target.value)}
        />
      </label>
    </>
  );
}
const kinds = {
  external: "Alexa / external answer",
  text: "Enter text",
  numbers: "Enter numbers",
  colors: "Select colors in order",
  symbols: "Select symbols in order",
  qr: "Scan QR code",
};
export function RemoveButton({
  label,
  configured,
  disabled,
  remove,
}: {
  label: string;
  configured: boolean;
  disabled?: boolean;
  remove: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        className="remove-item"
        aria-label={label}
        title={label}
        disabled={disabled}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          trigger.current = event.currentTarget;
          if (configured) setConfirming(true);
          else remove();
        }}
      >
        <Trash2 size={18} aria-hidden="true" />
      </Button>
      <Dialog.Root open={confirming} onOpenChange={setConfirming}>
        <Dialog.Portal>
          <Dialog.Overlay className="confirmation-overlay" />
          <Dialog.Content
            className="confirmation-modal"
            onClick={(event) => event.stopPropagation()}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              trigger.current?.focus();
            }}
          >
            <Dialog.Title>{label}?</Dialog.Title>
            <Dialog.Description>
              This will remove the item and its configured values from this
              game. You can’t undo this.
            </Dialog.Description>
            <div className="actions">
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="remove-confirm"
                onClick={() => {
                  setConfirming(false);
                  remove();
                }}
              >
                <Trash2 size={18} aria-hidden="true" />
                {label}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
export function GameEditor({
  initial,
  isNew = false,
  shareOrigin,
  busy,
  save,
}: {
  initial: Game;
  isNew?: boolean;
  shareOrigin?: string;
  busy: boolean;
  save: (game: Game) => Promise<boolean>;
}) {
  const draftKey = isNew ? gameDraftKey : `${gameDraftKey}:${initial.id}`;
  const [draft] = useState(() => readGameDraft(draftKey));
  const [game, setGame] = useState(draft?.game ?? initial);
  const [autoId, setAutoId] = useState(draft?.autoId ?? isNew);
  const savedGame = useRef<Game | null>(null);
  useEffect(() => {
    if (game === savedGame.current) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify({ game, autoId }));
    } catch {
      // Editing still works when browser storage is unavailable or full.
    }
  }, [game, autoId, draftKey]);
  const patch = (index: number, value: Partial<Area>) =>
    setGame({
      ...game,
      areas: game.areas.map((a, i) => (i === index ? { ...a, ...value } : a)),
    });
  return (
    <form
      className="game-editor"
      onInvalidCapture={(event) => {
        let ancestor = (event.target as HTMLElement).parentElement;
        while (ancestor) {
          if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
          ancestor = ancestor.parentElement;
        }
      }}
      onSubmit={(e) => {
        e.preventDefault();
        void save(game).then((success) => {
          if (!success) return;
          savedGame.current = game;
          try {
            localStorage.removeItem(draftKey);
          } catch {
            // A successful server save does not depend on browser storage.
          }
        });
      }}
    >
      <label>
        Game ID
        <input
          required
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          maxLength={80}
          value={game.id}
          onChange={(e) => {
            setAutoId(false);
            setGame({ ...game, id: e.target.value });
          }}
        />
      </label>
      <label>
        Game name (Markdown)
        <input
          required
          maxLength={80}
          value={game.name}
          onChange={(e) => {
            const name = e.target.value;
            setGame({
              ...game,
              name,
              ...(autoId
                ? {
                    id: name
                      .normalize("NFKD")
                      .replace(/[\u0300-\u036f]/g, "")
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, "-")
                      .replace(/^-+|-+$/g, "")
                      .slice(0, 80)
                      .replace(/-+$/g, ""),
                  }
                : {}),
            });
          }}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={game.autoStart || false}
          onChange={(e) => setGame({ ...game, autoStart: e.target.checked })}
        />{" "}
        Start on first join and allow joining while running
      </label>
      <p>
        Names, clues, stories, and symbol choices support Markdown. Use
        **bold**, *italic*, and `code`; clues and stories also support headings,
        lists, links, and images. IDs, answers, device settings, and spoken text
        are literal. 1–30 challenges, played in order. IDs must be unique
        lowercase slugs. Saving replaces this game's JSON file; existing
        sessions keep their snapshot.
      </p>
      {game.areas.map((a, i) => (
        <details className="challenge-editor" key={i} open>
          <summary>
            Challenge {i + 1}: {a.name || "Unnamed room"}
            <RemoveButton
              label="Remove challenge"
              disabled={game.areas.length === 1}
              configured={
                !/^challenge-\d+$/.test(a.id) ||
                a.name !== "New room" ||
                a.kind !== "text" ||
                !!a.hint ||
                !!a.description ||
                !!a.unlockCode ||
                !!a.caseSensitive ||
                !!a.qrMode ||
                !!a.choices?.length ||
                !!a.onComplete?.length ||
                (a.playerView !== undefined && a.playerView !== "narrative")
              }
              remove={() =>
                setGame({
                  ...game,
                  areas: game.areas.filter((_, n) => n !== i),
                })
              }
            />
          </summary>
          <div className="challenge-fields">
            <label>
              Challenge ID
              <input
                required
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                maxLength={80}
                value={a.id}
                onChange={(e) => patch(i, { id: e.target.value })}
              />
            </label>
            <label>
              Room name (Markdown)
              <input
                required
                maxLength={80}
                value={a.name}
                onChange={(e) => patch(i, { name: e.target.value })}
              />
            </label>
            <label>
              Challenge type
              <select
                value={a.kind}
                onChange={(e) =>
                  patch(i, {
                    kind: e.target.value,
                    choices: ["colors", "symbols"].includes(e.target.value)
                      ? e.target.value === "colors"
                        ? ["#ff0000", "#0000ff"]
                        : ["★", "●"]
                      : undefined,
                    qrMode: e.target.value === "qr" ? "prompted" : undefined,
                    unlockCode: "",
                    hint: "",
                  })
                }
              >
                {Object.entries(kinds).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {a.kind === "qr" && (
              <label>
                QR presentation
                <select
                  value={a.qrMode || "hidden"}
                  onChange={(e) =>
                    patch(i, {
                      qrMode: e.target.value as "hidden" | "prompted",
                    })
                  }
                >
                  <option value="prompted">Offer scanner in app</option>
                  <option value="hidden">
                    Hidden: players discover and scan physical code
                  </option>
                </select>
              </label>
            )}
            <label>
              {a.kind === "qr" && a.qrMode !== "prompted"
                ? "Clue for finding the QR code (optional) (Markdown)"
                : "Clue before solving (Markdown)"}
              <textarea
                maxLength={1000}
                value={a.hint}
                onChange={(e) => patch(i, { hint: e.target.value })}
              />
            </label>
            <label>
              Story revealed after solving (Markdown)
              <textarea
                maxLength={10000}
                value={a.description}
                onChange={(e) => patch(i, { description: e.target.value })}
              />
            </label>
            {a.kind === "colors" && (
              <>
                <fieldset className="color-answer-editor">
                  <legend>Color options</legend>
                  <p>2–12 unique colors.</p>
                  <div className="color-options-grid">
                    {(a.choices || []).map((color, n) => (
                      <div className="color-answer-row" key={n}>
                        <label>
                          Color {n + 1}
                          <input
                            type="color"
                            value={color}
                            onChange={(e) =>
                              patch(i, {
                                choices: a.choices!.map((value, k) =>
                                  k === n ? e.target.value : value,
                                ),
                                unlockCode: (a.unlockCode || "")
                                  .split("|")
                                  .map((value) =>
                                    value.toLowerCase() === color.toLowerCase()
                                      ? e.target.value
                                      : value,
                                  )
                                  .join("|"),
                              })
                            }
                          />
                        </label>
                        <RemoveButton
                          label={`Remove color ${n + 1}`}
                          configured={false}
                          disabled={a.choices!.length <= 2}
                          remove={() =>
                            patch(i, {
                              choices: a.choices!.filter((_, k) => k !== n),
                              unlockCode: (a.unlockCode || "")
                                .split("|")
                                .filter(
                                  (value) =>
                                    value.toLowerCase() !== color.toLowerCase(),
                                )
                                .join("|"),
                            })
                          }
                        />
                      </div>
                    ))}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={(a.choices?.length || 0) >= 12}
                    onClick={() => {
                      let color = "#00ff00";
                      while (
                        a.choices?.some(
                          (value) => value.toLowerCase() === color,
                        )
                      )
                        color = `#${(parseInt(color.slice(1), 16) + 1).toString(16).padStart(6, "0")}`;
                      patch(i, { choices: [...(a.choices || []), color] });
                    }}
                  >
                    <Plus size={18} aria-hidden="true" /> Add color
                  </Button>
                </fieldset>
                <fieldset className="color-answer-editor">
                  <legend>Correct order</legend>
                  <p>2–20 colors; repetitions allowed.</p>
                  {(a.unlockCode ? a.unlockCode.split("|") : []).map(
                    (color, n, order) => (
                      <div className="color-answer-row" key={n}>
                        <label>
                          Step {n + 1}
                          <span className="color-order-select">
                            <span
                              className="color-order-swatch"
                              style={{ backgroundColor: color }}
                              aria-hidden="true"
                            />
                            <select
                              required
                              value={color}
                              onChange={(e) =>
                                patch(i, {
                                  unlockCode: order
                                    .map((value, k) =>
                                      k === n ? e.target.value : value,
                                    )
                                    .join("|"),
                                })
                              }
                            >
                              {!a.choices?.includes(color) && (
                                <option value={color} disabled>
                                  Choose a color
                                </option>
                              )}
                              {a.choices?.map((value, k) => (
                                <option key={k} value={value}>
                                  Color {k + 1} ({value})
                                </option>
                              ))}
                            </select>
                          </span>
                        </label>
                        <RemoveButton
                          label={`Remove step ${n + 1}`}
                          configured={false}
                          remove={() =>
                            patch(i, {
                              unlockCode: order
                                .filter((_, k) => k !== n)
                                .join("|"),
                            })
                          }
                        />
                      </div>
                    ),
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    disabled={
                      !a.choices?.length ||
                      (a.unlockCode ? a.unlockCode.split("|").length : 0) >= 20
                    }
                    onClick={() =>
                      patch(i, {
                        unlockCode: [
                          ...(a.unlockCode ? a.unlockCode.split("|") : []),
                          a.choices![0],
                        ].join("|"),
                      })
                    }
                  >
                    <Plus size={18} aria-hidden="true" /> Add step
                  </Button>
                </fieldset>
              </>
            )}
            {a.kind === "symbols" && (
              <label>
                Choices (Markdown), separated by | (2–12 unique values)
                <input
                  required
                  value={a.choices?.join("|") || ""}
                  onChange={(e) =>
                    patch(i, { choices: e.target.value.split("|") })
                  }
                />
              </label>
            )}
            {a.kind !== "colors" && (
              <label>
                {a.kind === "qr"
                  ? "QR token (use a unique value)"
                  : ["colors", "symbols"].includes(a.kind)
                    ? "Correct order, separated by | (2–20 choices; repetitions allowed)"
                    : "Correct answer"}
                <input
                  required
                  maxLength={256}
                  pattern={a.kind === "numbers" ? "[0-9]+" : undefined}
                  value={a.unlockCode || ""}
                  onChange={(e) => patch(i, { unlockCode: e.target.value })}
                />
              </label>
            )}
            {a.kind === "qr" && (
              <QrToken token={a.unlockCode || ""} origin={shareOrigin} />
            )}
            {["text", "external"].includes(a.kind) && (
              <label>
                <input
                  type="checkbox"
                  checked={a.caseSensitive ?? false}
                  onChange={(e) =>
                    patch(i, { caseSensitive: e.target.checked })
                  }
                />
                Capitalization matters
              </label>
            )}
            <p>
              Leading and trailing whitespace is ignored when checking answers.
            </p>
            <fieldset>
              <legend>When solved</legend>
              <p>
                Actions run in order. Light groups within a transition run
                together.
              </p>
              {(a.onComplete || []).map((action, n) => (
                <div className="editor-item" key={n}>
                  <div className="editor-item-header">
                    <span id={`action-${i}-${n}-label`}>
                      {action.type === "lights"
                        ? "Light transition"
                        : action.type === "control"
                          ? "Home Assistant control"
                          : "Speaker entity"}
                    </span>
                    <RemoveButton
                      label="Remove action"
                      configured={
                        action.type === "lights"
                          ? true
                          : action.type === "control"
                            ? !!action.controlId || action.on === false
                            : !!action.entity || !!action.message
                      }
                      remove={() =>
                        patch(i, {
                          onComplete: a.onComplete!.filter((_, k) => k !== n),
                        })
                      }
                    />
                  </div>
                  {action.type === "lights" ? (
                    <LightTransitionEditor
                      value={action}
                      controls={game.controls}
                      onChange={(value) =>
                        patch(i, {
                          onComplete: a.onComplete!.map((v, k) =>
                            k === n ? value : v,
                          ),
                        })
                      }
                    />
                  ) : action.type === "control" ? (
                    <>
                      <label>
                        <select
                          aria-labelledby={`action-${i}-${n}-label`}
                          required
                          value={action.controlId}
                          onChange={(e) =>
                            patch(i, {
                              onComplete: a.onComplete!.map((v, k) =>
                                k === n
                                  ? { ...action, controlId: e.target.value }
                                  : v,
                              ),
                            })
                          }
                        >
                          <option value="">Choose control</option>
                          {game.controls.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={action.on !== false}
                          onChange={(e) =>
                            patch(i, {
                              onComplete: a.onComplete!.map((v, k) =>
                                k === n
                                  ? { ...action, on: e.target.checked }
                                  : v,
                              ),
                            })
                          }
                        />{" "}
                        Turn on (off applies only to lights)
                      </label>
                    </>
                  ) : (
                    <>
                      <DevicePicker
                        domain="notify"
                        value={action.entity}
                        change={(entity) =>
                          patch(i, {
                            onComplete: a.onComplete!.map((v, k) =>
                              k === n ? { ...action, entity } : v,
                            ),
                          })
                        }
                      />
                      <label>
                        Spoken riddle
                        <textarea
                          required
                          maxLength={1000}
                          value={action.message}
                          onChange={(e) =>
                            patch(i, {
                              onComplete: a.onComplete!.map((v, k) =>
                                k === n
                                  ? { ...action, message: e.target.value }
                                  : v,
                              ),
                            })
                          }
                        />
                      </label>
                    </>
                  )}
                </div>
              ))}
              <div className="actions">
                <Button
                  type="button"
                  variant="outline"
                  disabled={(a.onComplete?.length || 0) >= 10}
                  title="Up to 10 actions per challenge"
                  onClick={() =>
                    patch(i, {
                      onComplete: [
                        ...(a.onComplete || []),
                        {
                          type: "lights",
                          groups: [
                            {
                              entities: [],
                              steps: [
                                {
                                  mode: "color",
                                  color: "#ffbb66",
                                  brightness: 80,
                                  seconds: 2,
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    })
                  }
                >
                  Add light transition
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={(a.onComplete?.length || 0) >= 10}
                  onClick={() =>
                    patch(i, {
                      onComplete: [
                        ...(a.onComplete || []),
                        {
                          type: "control",
                          controlId: "",
                          on: true,
                        },
                      ],
                    })
                  }
                >
                  Add scene / script / light action
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={(a.onComplete?.length || 0) >= 10}
                  onClick={() =>
                    patch(i, {
                      onComplete: [
                        ...(a.onComplete || []),
                        { type: "speech", entity: "", message: "" },
                      ],
                    })
                  }
                >
                  Add Alexa speech
                </Button>
              </div>
            </fieldset>
            {a.kind === "external" && (
              <p>
                Use this challenge ID and correct answer in the authenticated
                callback under the session Automation section.
              </p>
            )}
            <div className="actions">
              <Button
                type="button"
                variant="ghost"
                disabled={i === 0}
                onClick={() => {
                  const areas = [...game.areas];
                  [areas[i - 1], areas[i]] = [areas[i], areas[i - 1]];
                  setGame({ ...game, areas });
                }}
              >
                Move up
              </Button>
            </div>
          </div>
        </details>
      ))}
      <Button
        type="button"
        variant="outline"
        disabled={game.areas.length >= 30}
        onClick={() =>
          setGame({
            ...game,
            areas: [
              ...game.areas,
              {
                id: `challenge-${game.areas.length + 1}`,
                name: "New room",
                kind: "text",
                hint: "",
                description: "",
                unlockCode: "",
                playerView: "narrative",
              },
            ],
          })
        }
      >
        Add challenge
      </Button>
      <fieldset>
        <legend>Home Assistant controls</legend>
        {game.controls.map((control, i) => (
          <div className="editor-item" key={i}>
            <div className="editor-item-header">
              <span>{control.name || "Home Assistant control"}</span>
              <RemoveButton
                label="Remove control"
                configured={
                  !/^control-\d+$/.test(control.id) ||
                  control.name !== "New control" ||
                  control.entity !== "light." ||
                  game.areas.some((area) =>
                    area.onComplete?.some(
                      (action) =>
                        action.type === "control" &&
                        action.controlId === control.id,
                    ),
                  )
                }
                remove={() =>
                  setGame({
                    ...game,
                    controls: game.controls.filter((_, n) => n !== i),
                  })
                }
              />
            </div>
            {(["id", "name", "entity"] as const).map((field) =>
              field === "entity" ? (
                <DevicePicker
                  key={field}
                  domain="control"
                  value={control.entity}
                  change={(entity) =>
                    setGame({
                      ...game,
                      controls: game.controls.map((c, n) =>
                        n === i ? { ...c, entity } : c,
                      ),
                    })
                  }
                />
              ) : (
                <label key={field}>
                  {`Control ${field}`}
                  <input
                    required
                    maxLength={80}
                    value={control[field]}
                    onChange={(e) =>
                      setGame({
                        ...game,
                        controls: game.controls.map((c, n) =>
                          n === i ? { ...c, [field]: e.target.value } : c,
                        ),
                      })
                    }
                  />
                </label>
              ),
            )}
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          disabled={game.controls.length >= 50}
          onClick={() =>
            setGame({
              ...game,
              controls: [
                ...game.controls,
                {
                  id: `control-${game.controls.length + 1}`,
                  name: "New control",
                  entity: "light.",
                },
              ],
            })
          }
        >
          Add control
        </Button>
      </fieldset>
      <Button disabled={busy}>Save game</Button>
    </form>
  );
}
export function ChallengeInput({
  area,
  code,
  setCode,
  disabled,
}: {
  area: Area;
  code: string;
  setCode: (value: string) => void;
  disabled: boolean;
}) {
  const [error, setError] = useState("");
  const hidden =
    area.kind === "hidden" ||
    (area.kind === "qr" && area.qrMode !== "prompted");
  if (area.kind === "external")
    return <p role="status">Waiting for your answer through Alexa…</p>;
  if (hidden && !code) return null;
  return (
    <>
      {area.kind === "qr" && !hidden ? (
        <>
          <p>
            Scan the room marker with your phone camera to open its link, or
            scan a photo here.
          </p>
          <label>
            Scan QR image
            <input
              type="file"
              accept="image/*"
              capture="environment"
              disabled={disabled}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  const image = await createImageBitmap(file);
                  try {
                    const canvas = document.createElement("canvas");
                    const scale = Math.min(
                      1,
                      1800 / Math.max(image.width, image.height),
                    );
                    canvas.width = Math.round(image.width * scale);
                    canvas.height = Math.round(image.height * scale);
                    const context = canvas.getContext("2d");
                    if (!context) throw new Error("Could not read image.");
                    context.drawImage(image, 0, 0, canvas.width, canvas.height);
                    const pixels = context.getImageData(
                      0,
                      0,
                      canvas.width,
                      canvas.height,
                    );
                    const { default: decode } = await import("jsqr");
                    const result = decode(
                      pixels.data,
                      pixels.width,
                      pixels.height,
                    );
                    if (!result)
                      throw new Error("No QR code found. Try a clearer photo.");
                    const url = new URL(result.data);
                    if (url.origin !== location.origin)
                      throw new Error("Scan a marker for this game server.");
                    const token = url.searchParams.get("code");
                    if (!token) throw new Error("No game marker found.");
                    setCode(token);
                    setError("");
                  } finally {
                    image.close();
                  }
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            />
          </label>
          {error && <p role="alert">{error}</p>}
        </>
      ) : null}
      {["colors", "symbols"].includes(area.kind) ? (
        <>
          <p>Select the choices in order. Repeated choices are allowed.</p>
          <div className="actions">
            {area.choices?.map((choice) => (
              <Button
                type="button"
                key={choice}
                disabled={disabled || code.split("|").length >= 20}
                onClick={() => setCode(code ? `${code}|${choice}` : choice)}
              >
                {area.kind === "colors" && (
                  <span
                    style={{
                      backgroundColor: choice,
                      width: 24,
                      height: 24,
                      display: "inline-block",
                    }}
                  />
                )}
                <GameMarkdown inline>{choice}</GameMarkdown>
              </Button>
            ))}
          </div>
          <output className="answer-sequence" aria-live="polite">
            {code
              .split("|")
              .filter(Boolean)
              .map((choice, index) => (
                <span key={index}>
                  {index > 0 && " → "}
                  <GameMarkdown inline>{choice}</GameMarkdown>
                </span>
              ))}
          </output>
          <div className="actions">
            <Button
              type="button"
              variant="ghost"
              disabled={disabled}
              onClick={() => setCode("")}
            >
              Clear order
            </Button>
            <Button disabled={disabled || !code}>Unlock</Button>
          </div>
        </>
      ) : area.kind !== "qr" && !hidden ? (
        <label>
          {area.kind === "numbers" ? "Number code" : "Answer"}
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode={area.kind === "numbers" ? "numeric" : "text"}
            pattern={area.kind === "numbers" ? "[0-9]+" : undefined}
            maxLength={256}
            required
            autoComplete="off"
            disabled={disabled}
          />
        </label>
      ) : null}
      {!["colors", "symbols"].includes(area.kind) && (
        <Button disabled={disabled || !code}>Unlock</Button>
      )}
    </>
  );
}

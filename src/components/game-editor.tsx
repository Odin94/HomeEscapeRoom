import { useState } from "react";
import type { Area, Game } from "../lib/game-store";
import { Button } from "./ui";
const kinds = {
  external: "Alexa / external answer",
  text: "Enter text",
  numbers: "Enter numbers",
  colors: "Select colors in order",
  symbols: "Select symbols in order",
  qr: "Scan QR code",
  password: "Enter text (legacy)",
};
export function GameEditor({
  initial,
  busy,
  save,
}: {
  initial: Game;
  busy: boolean;
  save: (game: Game) => Promise<boolean>;
}) {
  const [game, setGame] = useState(initial);
  const patch = (index: number, value: Partial<Area>) =>
    setGame({
      ...game,
      areas: game.areas.map((a, i) => (i === index ? { ...a, ...value } : a)),
    });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save(game);
      }}
    >
      <label>
        Game ID
        <input
          required
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          maxLength={80}
          value={game.id}
          onChange={(e) => setGame({ ...game, id: e.target.value })}
        />
      </label>
      <label>
        Game name
        <input
          required
          maxLength={80}
          value={game.name}
          onChange={(e) => setGame({ ...game, name: e.target.value })}
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
        1–30 challenges, played in order. IDs must be unique lowercase slugs.
        Saving replaces this game's JSON file; existing sessions keep their
        snapshot.
      </p>
      {game.areas.map((a, i) => (
        <fieldset key={i}>
          <legend>Challenge {i + 1}</legend>
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
            Room name
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
                    hint: "",
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
          {!(a.kind === "qr" && a.qrMode !== "prompted") && (
            <label>
              Clue before solving
              <textarea
                maxLength={1000}
                value={a.hint}
                onChange={(e) => patch(i, { hint: e.target.value })}
              />
            </label>
          )}
          <label>
            Story revealed after solving
            <textarea
              maxLength={10000}
              value={a.description}
              onChange={(e) => patch(i, { description: e.target.value })}
            />
          </label>
          {["colors", "symbols"].includes(a.kind) && (
            <label>
              Choices, separated by | (2–12 unique values; colors use #rrggbb)
              <input
                required
                value={a.choices?.join("|") || ""}
                onChange={(e) =>
                  patch(i, { choices: e.target.value.split("|") })
                }
              />
            </label>
          )}
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
          <fieldset>
            <legend>When solved</legend>
            <p>
              Actions run in order. Add controls below first; a scene can set
              all four lights.
            </p>
            {(a.onComplete || []).map((action, n) => (
              <div key={n}>
                {action.type === "control" ? (
                  <>
                    <label>
                      Home Assistant control
                      <select
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
                              k === n ? { ...action, on: e.target.checked } : v,
                            ),
                          })
                        }
                      />{" "}
                      Turn on (off applies only to lights)
                    </label>
                  </>
                ) : (
                  <>
                    <label>
                      Speaker entity
                      <input
                        required
                        placeholder="notify.living_room_speak"
                        value={action.entity}
                        onChange={(e) =>
                          patch(i, {
                            onComplete: a.onComplete!.map((v, k) =>
                              k === n
                                ? { ...action, entity: e.target.value }
                                : v,
                            ),
                          })
                        }
                      />
                    </label>
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
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    patch(i, {
                      onComplete: a.onComplete!.filter((_, k) => k !== n),
                    })
                  }
                >
                  Remove action
                </Button>
              </div>
            ))}
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
                      controlId: game.controls[0]?.id || "",
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
          </fieldset>
          {a.kind === "external" && (
            <p>
              Use this challenge ID and correct answer in the authenticated
              callback under the session Automation section.
            </p>
          )}
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
          <Button
            type="button"
            variant="ghost"
            disabled={game.areas.length === 1}
            onClick={() =>
              setGame({ ...game, areas: game.areas.filter((_, n) => n !== i) })
            }
          >
            Remove challenge
          </Button>
        </fieldset>
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
          <div key={i}>
            {(["id", "name", "entity"] as const).map((field) => (
              <label key={field}>
                {field === "entity"
                  ? "Entity (light.*, scene.* or script.*)"
                  : `Control ${field}`}
                <input
                  required
                  maxLength={field === "entity" ? 256 : 80}
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
            ))}
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                setGame({
                  ...game,
                  controls: game.controls.filter((_, n) => n !== i),
                })
              }
            >
              Remove control
            </Button>
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
          <div className="row">
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
                {choice}
              </Button>
            ))}
          </div>
          <output aria-live="polite">
            {code.split("|").filter(Boolean).join(" → ")}
          </output>
          <Button
            type="button"
            variant="ghost"
            disabled={disabled}
            onClick={() => setCode("")}
          >
            Clear order
          </Button>
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
      <Button disabled={disabled || !code}>Unlock</Button>
    </>
  );
}

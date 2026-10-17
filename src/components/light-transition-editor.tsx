import { useCallback, useEffect, useState } from "react";
import type { LightStep, LightTransition } from "../lib/light-transition";
import { Button } from "./ui";
import { RemoveButton } from "./game-editor";

type Target = { entity: string; name: string; available?: boolean };
function EntityPicker({
  targets,
  selected,
  domain,
  change,
}: {
  targets: Target[];
  selected: string[];
  domain: "light" | "scene";
  change: (entities: string[]) => void;
}) {
  const [filter, setFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const options = targets.filter(
    (t) =>
      t.entity.startsWith(`${domain}.`) &&
      `${t.name} ${t.entity}`.toLowerCase().includes(filter.toLowerCase()),
  );
  const rowHeight = 64;
  const start = Math.max(0, Math.floor(offset / rowHeight) - 2);
  return (
    <details
      className="entity-picker"
      onToggle={(e) => {
        if (e.currentTarget.open)
          e.currentTarget.querySelector("input")?.focus();
      }}
    >
      <summary>
        {selected.length
          ? `${selected.length} ${domain === "light" ? "lights" : "scene"} selected`
          : `Choose ${domain === "light" ? "lights" : "a scene"}`}
      </summary>
      <label>
        Filter by name or entity
        <input
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setOffset(0);
            const list = e.target
              .closest("details")
              ?.querySelector(".entity-options");
            if (list) list.scrollTop = 0;
          }}
          placeholder={`Search ${domain === "light" ? "lights" : "scenes"}…`}
        />
      </label>
      <div
        className="entity-options"
        onScroll={(e) => setOffset(e.currentTarget.scrollTop)}
      >
        <div
          style={{ height: options.length * rowHeight, position: "relative" }}
        >
          {options.slice(start, start + 8).map((target, i) => (
            <label
              key={target.entity}
              className="entity-option"
              style={{
                position: "absolute",
                top: (start + i) * rowHeight,
                height: rowHeight,
                width: "100%",
              }}
            >
              <input
                type="checkbox"
                checked={selected.includes(target.entity)}
                onChange={(e) =>
                  change(
                    domain === "scene"
                      ? e.target.checked
                        ? [target.entity]
                        : []
                      : e.target.checked
                        ? [...selected, target.entity]
                        : selected.filter((v) => v !== target.entity),
                  )
                }
              />
              <span>
                {target.name}
                <small>
                  {target.entity}
                  {target.available === false ? " · Unavailable" : ""}
                </small>
              </span>
            </label>
          ))}
        </div>
        {!options.length && (
          <p>No matches. Refresh devices or enter an entity below.</p>
        )}
      </div>
      <label>
        Enter an entity ID
        <input
          placeholder={`${domain}.living_room`}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const entity = e.currentTarget.value.trim();
            if (new RegExp(`^${domain}\\.[a-z0-9_]+$`).test(entity)) {
              change(
                domain === "scene"
                  ? [entity]
                  : [...new Set([...selected, entity])],
              );
              e.currentTarget.value = "";
            } else
              e.currentTarget.setCustomValidity(`Enter a ${domain} entity ID.`);
          }}
          onChange={(e) => e.currentTarget.setCustomValidity("")}
        />
      </label>
      <small>Press Enter to add a typed entity.</small>
    </details>
  );
}

export function LightTransitionEditor({
  value,
  controls,
  onChange,
}: {
  value: LightTransition;
  controls: Target[];
  onChange: (value: LightTransition) => void;
}) {
  const [targets, setTargets] = useState<Target[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const allTargets = [
    ...new Map(
      [
        ...controls,
        ...targets,
        ...value.groups
          .flatMap((g) => [
            ...g.entities,
            ...g.steps.flatMap((s) =>
              s.mode === "scene" && s.entity ? [s.entity] : [],
            ),
          ])
          .map((entity) => ({
            entity,
            name:
              targets.find((t) => t.entity === entity)?.name ||
              controls.find((t) => t.entity === entity)?.name ||
              entity,
          })),
      ].map((t) => [t.entity, t]),
    ).values(),
  ];
  const groupPatch = (
    index: number,
    patch: Partial<LightTransition["groups"][number]>,
  ) =>
    onChange({
      ...value,
      groups: value.groups.map((g, i) =>
        i === index ? { ...g, ...patch } : g,
      ),
    });
  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "light-targets" }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Could not load devices.");
      setTargets(data.targets);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load devices.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return (
    <details className="light-transition-disclosure" open>
      <summary>
        Edit transition
        <small>
          {value.groups.length} light groups ·{" "}
          {value.groups.reduce((sum, group) => sum + group.entities.length, 0)}{" "}
          lights
        </small>
      </summary>
      <div className="light-transition">
        <div className="actions">
          <Button
            type="button"
            variant="outline"
            disabled={loading}
            title={
              loading
                ? "Loading Home Assistant devices"
                : "Read lights and scenes from Home Assistant"
            }
            onClick={() => void refresh()}
          >
            {loading ? "Loading devices…" : "Refresh lights & scenes"}
          </Button>
          <small>One sequence per group. All groups start together.</small>
        </div>
        {error && (
          <p role="alert">
            {error}{" "}
            <Button
              type="button"
              variant="ghost"
              onClick={() => void refresh()}
            >
              Retry
            </Button>
          </p>
        )}
        {value.groups.map((group, i) => {
          const stepPatch = (n: number, step: LightStep) =>
            groupPatch(i, {
              steps: group.steps.map((s, k) => (k === n ? step : s)),
            });
          return (
            <details className="light-group" key={i} open>
              <summary>
                <span>
                  Light group {i + 1}
                  <small>
                    {group.entities.length} lights · {group.steps.length} steps
                    · {group.steps.reduce((sum, step) => sum + step.seconds, 0)}{" "}
                    seconds per play
                    {(group.repeat ?? 1) > 1 && ` � ${group.repeat} repeats`}
                  </small>
                </span>
                <RemoveButton
                  label="Delete light group"
                  configured={group.entities.length > 0}
                  disabled={value.groups.length === 1}
                  remove={() =>
                    onChange({
                      ...value,
                      groups: value.groups.filter((_, k) => k !== i),
                    })
                  }
                />
              </summary>
              <label>
                <input
                  type="checkbox"
                  checked={(group.repeat ?? 1) > 1}
                  onChange={(e) =>
                    groupPatch(i, { repeat: e.target.checked ? 2 : 1 })
                  }
                />{" "}
                Loop this light group
              </label>
              {(group.repeat ?? 1) > 1 && (
                <label>
                  Total repeats (including the first play)
                  <input
                    required
                    type="number"
                    min={2}
                    max={100}
                    step={1}
                    value={group.repeat}
                    onChange={(e) =>
                      groupPatch(i, { repeat: Number(e.target.value) })
                    }
                  />
                  <small>
                    This group repeats independently. The next action runs after
                    all groups finish. Pausing or closing the game stops
                    playback.
                  </small>
                </label>
              )}
              <EntityPicker
                domain="light"
                targets={allTargets.filter(
                  (t) =>
                    !value.groups.some(
                      (g, k) => k !== i && g.entities.includes(t.entity),
                    ),
                )}
                selected={group.entities}
                change={(entities) => groupPatch(i, { entities })}
              />
              {!group.entities.length && <p>Select at least one light.</p>}
              <div className="selected-lights">
                {group.entities.map((entity) => (
                  <Button
                    key={entity}
                    type="button"
                    variant="ghost"
                    aria-label={`Deselect ${entity}`}
                    onClick={() =>
                      groupPatch(i, {
                        entities: group.entities.filter((v) => v !== entity),
                      })
                    }
                  >
                    {allTargets.find((t) => t.entity === entity)?.name ||
                      entity}{" "}
                    ×
                  </Button>
                ))}
              </div>
              {group.steps.map((step, n) => (
                <div className="light-step" key={n}>
                  <div className="editor-item-header">
                    <strong>Step {n + 1}</strong>
                    <div className="actions">
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={n === 0}
                        title={
                          n === 0
                            ? "Already the first step"
                            : "Move step earlier"
                        }
                        onClick={() => {
                          const steps = [...group.steps];
                          [steps[n - 1], steps[n]] = [steps[n], steps[n - 1]];
                          groupPatch(i, { steps });
                        }}
                      >
                        ↑
                      </Button>
                      <RemoveButton
                        label="Delete step"
                        configured
                        disabled={group.steps.length === 1}
                        remove={() =>
                          groupPatch(i, {
                            steps: group.steps.filter((_, k) => k !== n),
                          })
                        }
                      />
                    </div>
                  </div>
                  <div className="light-step-fields">
                    <label>
                      Look
                      <select
                        value={step.mode}
                        onChange={(e) =>
                          stepPatch(
                            n,
                            e.target.value === "off"
                              ? { mode: "off", seconds: step.seconds }
                              : e.target.value === "scene"
                                ? {
                                    mode: "scene",
                                    entity: "",
                                    seconds: step.seconds,
                                  }
                                : {
                                    mode: "color",
                                    color: "#ffbb66",
                                    brightness: 80,
                                    seconds: step.seconds,
                                  },
                          )
                        }
                      >
                        <option value="color">Color & brightness</option>
                        <option value="off">Off</option>
                        <option value="scene">Home Assistant scene</option>
                      </select>
                    </label>
                    {step.mode === "color" && (
                      <>
                        <label>
                          Color
                          <input
                            type="color"
                            value={step.color}
                            onChange={(e) =>
                              stepPatch(n, { ...step, color: e.target.value })
                            }
                          />
                        </label>
                        <label>
                          Brightness (%)
                          <input
                            required
                            type="number"
                            min={1}
                            max={100}
                            value={step.brightness}
                            onChange={(e) =>
                              stepPatch(n, {
                                ...step,
                                brightness: Number(e.target.value),
                              })
                            }
                          />
                        </label>
                      </>
                    )}
                    <label>
                      Duration (seconds)
                      <input
                        required
                        type="number"
                        min={0.1}
                        max={3600}
                        step={0.1}
                        value={step.seconds}
                        onChange={(e) =>
                          stepPatch(n, {
                            ...step,
                            seconds: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                  </div>
                  {step.mode === "scene" && (
                    <>
                      <EntityPicker
                        domain="scene"
                        targets={allTargets}
                        selected={step.entity ? [step.entity] : []}
                        change={(entities) =>
                          stepPatch(n, { ...step, entity: entities[0] || "" })
                        }
                      />
                      <p>
                        {step.entity || "Choose a scene."} · A saved scene
                        affects all devices configured in that Home Assistant
                        scene.
                      </p>
                    </>
                  )}
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                disabled={group.steps.length >= 50}
                title="Up to 50 steps per group"
                onClick={() =>
                  groupPatch(i, {
                    steps: [...group.steps, { mode: "off", seconds: 2 }],
                  })
                }
              >
                Add step
              </Button>
              <p>
                {group.steps.reduce((sum, s) => sum + s.seconds, 0)} seconds
                total. The final look stays until another action changes it.
              </p>
            </details>
          );
        })}
        <Button
          type="button"
          variant="outline"
          disabled={value.groups.length >= 20}
          title="Up to 20 light groups"
          onClick={() =>
            onChange({
              ...value,
              groups: [
                ...value.groups,
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
            })
          }
        >
          Add another light group
        </Button>
      </div>
    </details>
  );
}

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { settings } from "./settings.server";
import { ha } from "./speech.server";

// Provisioning uses HA's authenticated WebSocket API; no Amazon credentials or
// session callback tokens are sent to helpers or exposed to players.
export async function haCommands<T>(
  run: (
    command: (body: Record<string, unknown>) => Promise<unknown>,
  ) => Promise<T>,
): Promise<T> {
  const config = settings();
  if (!config.haUrl || !config.haToken)
    throw new Error(
      "Configure the Home Assistant URL and token in Settings first.",
    );
  const url = new URL(`${config.haUrl.replace(/\/$/, "")}/api/websocket`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(url);
  let nextId = 0;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  let rejectAuth: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    rejectAuth = reject;
    socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(String(event.data));
        if (message.type === "auth_required")
          socket.send(
            JSON.stringify({ type: "auth", access_token: config.haToken }),
          );
        else if (message.type === "auth_ok") resolve();
        else if (message.type === "auth_invalid")
          reject(
            new Error(
              "Home Assistant rejected the token. Use an administrator token in Settings.",
            ),
          );
        else if (message.type === "result") {
          const request = pending.get(message.id);
          pending.delete(message.id);
          if (message.success) request?.resolve(message.result);
          else
            request?.reject(
              new Error(
                "Home Assistant could not configure the helper. Check administrator permissions and your Home Assistant version.",
              ),
            );
        }
      } catch {
        reject(
          new Error("Home Assistant returned an invalid WebSocket response."),
        );
      }
    });
  });
  const fail = () => {
    const error = new Error(
      "Home Assistant connection closed. Check Settings and try again.",
    );
    rejectAuth(error);
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  socket.addEventListener("error", fail);
  socket.addEventListener("close", fail);
  let timeout: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      (async () => {
        await ready;
        return run(
          (body) =>
            new Promise((resolve, reject) => {
              const id = ++nextId;
              pending.set(id, { resolve, reject });
              socket.send(JSON.stringify({ ...body, id }));
            }),
        );
      })(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new Error(
                "Home Assistant setup timed out. Retry to reuse the same helper.",
              ),
            ),
          15000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout!);
    socket.close();
    fail();
  }
}

const bindingSchema = z.object({
  sessionId: z.string(),
  challengeId: z.string(),
  entity: z.string().regex(/^input_boolean\.[a-z0-9_]+$/),
  name: z.string(),
  haUrl: z.string(),
});
type Binding = z.infer<typeof bindingSchema>;
type Runtime = {
  armed?: string;
  testingUntil?: number;
  tested?: boolean;
  received?: boolean;
  error?: string;
  testError?: string;
};

export class AlexaAnswers {
  private bindings: Binding[];
  private runtime = new Map<string, Runtime>();
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private busy = false;
  private settingUp = false;
  constructor(
    private path: string,
    private eligible: (binding: Binding) => string | undefined,
    private solve: (binding: Binding) => Promise<void>,
  ) {
    this.bindings = existsSync(path)
      ? z.array(bindingSchema).parse(JSON.parse(readFileSync(path, "utf8")))
      : [];
  }
  start() {
    if (this.timer || this.stopped) return;
    this.timer = setTimeout(async () => {
      this.timer = undefined;
      await this.poll();
      this.start();
    }, 1500);
    this.timer.unref();
  }
  close() {
    this.stopped = true;
    clearTimeout(this.timer);
  }
  private state(entity: string) {
    if (!this.runtime.has(entity)) this.runtime.set(entity, {});
    return this.runtime.get(entity)!;
  }
  get(sessionId: string, challengeId: string) {
    const binding = this.bindings.find(
      (b) =>
        b.sessionId === sessionId &&
        b.challengeId === challengeId &&
        b.haUrl === settings().haUrl,
    );
    if (!binding) return null;
    const state = this.state(binding.entity);
    return {
      entity: binding.entity,
      name: binding.name,
      testing: !!state.testingUntil,
      readyToTest: state.armed === "test",
      tested: !!state.tested,
      received: !!state.received,
      error: state.error || state.testError,
    };
  }
  async setup(
    sessionId: string,
    challengeId: string,
    sessionName: string,
    challengeName: string,
  ) {
    if (this.settingUp || this.busy)
      throw new Error("Home Assistant is busy. Try setup again in a moment.");
    this.settingUp = true;
    try {
      const connection = settings();
      const unchanged = () => {
        const current = settings();
        if (
          current.haUrl !== connection.haUrl ||
          current.haToken !== connection.haToken
        )
          throw new Error(
            "Home Assistant settings changed during setup. Run setup again.",
          );
      };
      const hash = createHash("sha256")
        .update(`${sessionId}:${challengeId}`)
        .digest("hex")
        .slice(0, 16);
      // Stable ASCII name also gives retries a predictable helper id.
      const name = `Threshold answer ${hash}`;
      const entity = `input_boolean.threshold_answer_${hash}`;
      let warning = "";
      await haCommands(async (command) => {
        const helpers = (await command({ type: "input_boolean/list" })) as {
          id: string;
        }[];
        if (
          !helpers.some((helper) => `input_boolean.${helper.id}` === entity)
        ) {
          const created = (await command({
            type: "input_boolean/create",
            name,
            icon: "mdi:comment-check",
          })) as { id: string };
          if (`input_boolean.${created.id}` !== entity)
            throw new Error(
              "The helper name is already in use. Remove the conflicting Threshold helper in Home Assistant and retry.",
            );
        }
        try {
          await command({
            type: "homeassistant/expose_entity",
            assistants: ["cloud.alexa"],
            entity_ids: [entity],
            should_expose: true,
          });
        } catch {
          warning =
            "Expose this helper to Alexa manually in Home Assistant. Automatic exposure requires a supported Home Assistant version and Home Assistant Cloud Alexa connection.";
        }
      });
      unchanged();
      await ha("services/input_boolean/turn_off", { entity_id: entity });
      unchanged();
      const binding = {
        sessionId,
        challengeId,
        entity,
        name,
        haUrl: connection.haUrl,
      };
      this.bindings = this.bindings.filter(
        (b) => !(b.sessionId === sessionId && b.challengeId === challengeId),
      );
      this.bindings.push(binding);
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(
        `${this.path}.tmp`,
        JSON.stringify(this.bindings, null, 2),
        { mode: 0o600 },
      );
      renameSync(`${this.path}.tmp`, this.path);
      this.runtime.set(entity, {});
      this.start();
      return {
        ...this.get(sessionId, challengeId)!,
        warning,
        description: `${sessionName}: ${challengeName}`,
      };
    } finally {
      this.settingUp = false;
    }
  }
  async test(sessionId: string, challengeId: string) {
    const binding = this.get(sessionId, challengeId);
    if (!binding)
      throw new Error("Set up this challenge's Home Assistant helper first.");
    if (this.busy || this.settingUp)
      throw new Error(
        "Home Assistant is busy. Try the test again in a moment.",
      );
    this.settingUp = true;
    try {
      const state = this.state(binding.entity);
      // Suppress solving before changing the helper; this is a dry run.
      state.testingUntil = Date.now() + 60000;
      state.tested = false;
      state.testError = undefined;
      state.armed = undefined;
      await ha("services/input_boolean/turn_off", {
        entity_id: binding.entity,
      });
      return this.get(sessionId, challengeId);
    } finally {
      this.settingUp = false;
    }
  }
  async poll() {
    if (this.stopped || this.busy || this.settingUp || !this.bindings.length)
      return;
    const bindings = this.bindings.filter((b) => b.haUrl === settings().haUrl);
    if (!bindings.length) return;
    this.busy = true;
    try {
      const states = z
        .array(z.object({ entity_id: z.string(), state: z.string() }))
        .parse(await (await ha("states")).json());
      for (const binding of bindings) {
        if (this.stopped) return;
        if (binding.haUrl !== settings().haUrl) continue;
        const runtime = this.state(binding.entity);
        const value = states.find((s) => s.entity_id === binding.entity)?.state;
        if (value !== "on" && value !== "off") {
          runtime.armed = undefined;
          runtime.error =
            "Helper unavailable. Check Home Assistant or run setup again.";
          continue;
        }
        runtime.error = undefined;
        const testing = !!runtime.testingUntil;
        const eligible = this.eligible(binding);
        const stage = testing ? "test" : eligible;
        if (value === "off") {
          if (testing && runtime.testingUntil! < Date.now()) {
            runtime.testingUntil = undefined;
            runtime.testError =
              "No Alexa signal received within 60 seconds. Check the routine and try the test again.";
            runtime.armed = undefined;
          } else runtime.armed = stage;
          continue;
        }
        const armed = runtime.armed;
        runtime.armed = undefined;
        // Reset before completion so a held helper cannot solve another stage.
        await ha("services/input_boolean/turn_off", {
          entity_id: binding.entity,
        });
        if (testing) {
          if (armed === "test" && runtime.testingUntil! >= Date.now())
            runtime.tested = true;
          else
            runtime.testError =
              "Test signal arrived before the test was ready or after it expired. Start a new test and wait for the instruction to speak.";
          runtime.testingUntil = undefined;
        } else if (
          stage &&
          armed === stage &&
          this.eligible(binding) === stage
        ) {
          await this.solve(binding);
          runtime.received = true;
        }
      }
    } catch {
      for (const binding of bindings) {
        const runtime = this.state(binding.entity);
        runtime.armed = undefined;
        runtime.error =
          "Could not process the Alexa signal. Check Home Assistant and the session's automation status, then try again.";
      }
    } finally {
      this.busy = false;
    }
  }
}

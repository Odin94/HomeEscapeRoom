import { runLightTransition, type LightTransition } from "./light-transition";

type Group = LightTransition["groups"][number];
type Running = {
  session: string;
  action: string;
  group: Group;
  entities: string[];
  controller: AbortController;
  done: Promise<void>;
  sending?: Promise<void>;
  error?: unknown;
};

// Lights are physical resources shared by every game session in this process.
export class LightLoops {
  private running = new Set<Running>();
  private queue: Promise<unknown> = Promise.resolve();
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.catch(() => {});
    return result;
  }
  async stopSession(
    session: string,
    nextChallenge = false,
    beforeProgress?: number,
  ) {
    await this.stopWhere(
      (run) =>
        run.session === session &&
        (!nextChallenge || run.group.loop === "next-challenge") &&
        (beforeProgress === undefined ||
          Number(
            run.action
              .slice(session.length + 1)
              .split(":")[0]
              .replace("!start", "-1"),
          ) < beforeProgress),
    );
  }
  async close() {
    await this.stopWhere(() => true);
  }
  async stopAction(action: string) {
    await this.stopWhere((run) => run.action === action);
  }
  private async stopWhere(matches: (run: Running) => boolean) {
    const runs = [...this.running].filter(matches);
    for (const run of runs) run.controller.abort();
    await Promise.all(runs.map((run) => run.done));
  }
  private async stopOverlapping(entities: string[]) {
    const stop = new Set<Running>();
    for (const run of this.running) {
      if (!run.entities.some((entity) => entities.includes(entity))) continue;
      const remaining = run.group.entities.filter(
        (entity) => !entities.includes(entity),
      );
      // Color/off steps can keep running for the other lamps in the same group.
      // Scenes are atomic and may affect lights beyond the group's targets.
      if (
        remaining.length &&
        !run.group.steps.some((step) => step.mode === "scene") &&
        run.entities.every((entity) => run.group.entities.includes(entity))
      ) {
        await run.sending?.catch(() => {});
        run.group.entities = remaining;
        run.entities = remaining;
      } else stop.add(run);
    }
    await this.stopWhere((run) => stop.has(run));
  }
  async takeOver(entities: string[]) {
    await this.serialize(() => this.stopOverlapping(entities));
  }
  start(
    session: string,
    action: string,
    group: Group,
    send: (
      domain: string,
      service: string,
      data: Record<string, unknown>,
    ) => Promise<void>,
    failed: (error: unknown) => void,
    finished: () => void,
    entities = group.entities,
    active: () => boolean = () => true,
  ): Promise<void> {
    group = structuredClone(group);
    return this.serialize(async () => {
      await this.stopOverlapping(entities);
      if (!active())
        throw new Error(
          "Light transition interrupted. Check lights before retrying.",
        );
      const controller = new AbortController();
      let ready!: () => void;
      let rejectReady!: (error: unknown) => void;
      const started = new Promise<void>((resolve, reject) => {
        ready = resolve;
        rejectReady = reject;
      });
      const run: Running = {
        session,
        action,
        group,
        entities,
        controller,
        done: Promise.resolve(),
      };
      this.running.add(run);
      run.done = runLightTransition(
        { type: "lights", groups: [group] },
        async (...args) => {
          run.sending = send(...args);
          await run.sending;
          ready();
        },
        (ms) =>
          new Promise<void>((resolve) => {
            if (controller.signal.aborted) {
              resolve();
              return;
            }
            const stop = () => {
              clearTimeout(timer);
              resolve();
            };
            const timer = setTimeout(() => {
              controller.signal.removeEventListener("abort", stop);
              resolve();
            }, ms);
            controller.signal.addEventListener("abort", stop, { once: true });
          }),
        () => !controller.signal.aborted && active(),
      )
        .catch((error) => {
          if (!controller.signal.aborted) {
            run.error = error;
            rejectReady(error);
            failed(error);
          } else ready();
        })
        .finally(() => {
          this.running.delete(run);
          finished();
        });
      await started;
      return run;
    }).then(async (run) => {
      if (!group.loop) {
        await run.done;
        if (run.error) throw run.error;
      }
    });
  }
  hasAction(action: string) {
    return [...this.running].some((run) => run.action === action);
  }
  get active() {
    return this.running.size > 0;
  }
}

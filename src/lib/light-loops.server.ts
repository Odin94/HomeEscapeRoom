import { runLightTransition, type LightTransition } from "./light-transition";

type Group = LightTransition["groups"][number];
type Running = {
  session: string;
  action: string;
  group: Group;
  entities: string[];
  controller: AbortController;
  done: Promise<void>;
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
  async stopSession(session: string, nextChallenge = false) {
    await this.stopWhere(
      (run) =>
        run.session === session &&
        (!nextChallenge || run.group.loop === "next-challenge"),
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
    await this.stopWhere((run) =>
      run.entities.some((entity) => entities.includes(entity)),
    );
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
          await send(...args);
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

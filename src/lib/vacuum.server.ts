import { setTimeout as delay } from "node:timers/promises";
import { ha } from "./speech.server";
import { vacuumSchema } from "./vacuum";

export async function moveVacuum(value: unknown, signal?: AbortSignal) {
  const action = vacuumSchema.parse(value);
  const entity_id = action.entity;
  signal?.throwIfAborted();
  if (action.movement === "goto") {
    await ha(
      "services/roborock/set_vacuum_goto_position",
      {
        entity_id,
        x: action.x,
        y: action.y,
      },
      signal,
    );
    return;
  }
  if (action.movement === "dock" || action.movement === "stop") {
    await ha(
      `services/vacuum/${action.movement === "dock" ? "return_to_base" : "stop"}`,
      { entity_id },
      signal,
    );
    return;
  }
  const send = (command: string, params?: unknown) => {
    if (command !== "app_rc_stop" && command !== "app_rc_end")
      signal?.throwIfAborted();
    return ha("services/vacuum/send_command", {
      entity_id,
      command,
      ...(params ? { params } : {}),
    });
  };
  // Always leave remote mode, including when start or movement returns an error.
  try {
    await send("app_rc_start");
    await delay(500, undefined, { signal });
    await send("app_rc_move", [
      {
        velocity: action.movement === "forward" ? 0.1 : 0,
        omega:
          action.movement === "spin-left"
            ? 0.5
            : action.movement === "spin-right"
              ? -0.5
              : 0,
        duration: (action.seconds ?? 1) * 1000,
        seqnum: 1,
      },
    ]);
    await delay((action.seconds ?? 1) * 1000, undefined, { signal });
  } finally {
    try {
      await send("app_rc_stop");
    } finally {
      await send("app_rc_end");
    }
  }
}

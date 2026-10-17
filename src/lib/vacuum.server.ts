import { setTimeout as delay } from "node:timers/promises";
import { ha } from "./speech.server";
import { vacuumSchema } from "./vacuum";

export async function moveVacuum(value: unknown) {
  const action = vacuumSchema.parse(value);
  const entity_id = action.entity;
  if (action.movement === "goto") {
    await ha("services/roborock/set_vacuum_goto_position", {
      entity_id,
      x: action.x,
      y: action.y,
    });
    return;
  }
  if (action.movement === "dock" || action.movement === "stop") {
    await ha(
      `services/vacuum/${action.movement === "dock" ? "return_to_base" : "stop"}`,
      { entity_id },
    );
    return;
  }
  const send = (command: string, params?: unknown) =>
    ha("services/vacuum/send_command", {
      entity_id,
      command,
      ...(params ? { params } : {}),
    });
  // Always leave remote mode, including when start or movement returns an error.
  try {
    await send("app_rc_start");
    await delay(500);
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
    await delay((action.seconds ?? 1) * 1000);
  } finally {
    try {
      await send("app_rc_stop");
    } finally {
      await send("app_rc_end");
    }
  }
}

import { z } from "zod";

export const lightStepSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("color"),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    brightness: z.number().int().min(1).max(100),
    seconds: z.number().min(0.1).max(3600),
  }),
  z.strictObject({
    mode: z.literal("off"),
    seconds: z.number().min(0.1).max(3600),
  }),
  z.strictObject({
    mode: z.literal("scene"),
    entity: z.string().regex(/^scene\.[a-z0-9_]+$/),
    seconds: z.number().min(0.1).max(3600),
  }),
]);
export const lightTransitionSchema = z.strictObject({
  type: z.literal("lights"),
  groups: z
    .array(
      z.strictObject({
        entities: z
          .array(z.string().regex(/^light\.[a-z0-9_]+$/))
          .min(1)
          .max(100)
          .refine(
            (v) => new Set(v).size === v.length,
            "Choose each light once.",
          ),
        steps: z.array(lightStepSchema).min(1).max(50),
      }),
    )
    .min(1)
    .max(20)
    .refine((groups) => {
      const entities = groups.flatMap((g) => g.entities);
      return new Set(entities).size === entities.length;
    }, "Each light can belong to only one transition group."),
});
export type LightTransition = z.infer<typeof lightTransitionSchema>;
export type LightStep = z.infer<typeof lightStepSchema>;

export async function runLightTransition(
  action: LightTransition,
  send: (
    domain: string,
    service: string,
    data: Record<string, unknown>,
  ) => Promise<void>,
  wait: (ms: number) => Promise<void>,
  active: () => boolean = () => true,
) {
  let failed = false;
  const results = await Promise.allSettled(
    action.groups.map(async (group) => {
      try {
        for (const step of group.steps) {
          if (failed || !active())
            throw new Error(
              "Light transition interrupted. Check lights before retrying.",
            );
          if (step.mode === "scene")
            await send("scene", "turn_on", { entity_id: step.entity });
          else
            await send("light", step.mode === "off" ? "turn_off" : "turn_on", {
              entity_id: group.entities,
              ...(step.mode === "color"
                ? {
                    brightness_pct: step.brightness,
                    rgb_color: [1, 3, 5].map((i) =>
                      parseInt(step.color.slice(i, i + 2), 16),
                    ),
                  }
                : {}),
            });
          await wait(step.seconds * 1000);
          if (!active())
            throw new Error(
              "Light transition interrupted. Check lights before retrying.",
            );
        }
      } catch (error) {
        failed = true;
        throw error;
      }
    }),
  );
  const failure = results.find((r) => r.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
}

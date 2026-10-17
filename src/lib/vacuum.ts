import { z } from "zod";

export const vacuumDraftSchema = z.object({
  type: z.literal("vacuum"),
  entity: z.string(),
  movement: z.enum([
    "goto",
    "forward",
    "spin-left",
    "spin-right",
    "dock",
    "stop",
  ]),
  destination: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  seconds: z.number().optional(),
});
export const vacuumSchema = vacuumDraftSchema
  .strict()
  .extend({
    entity: z.string().regex(/^vacuum\.[a-z0-9_]+$/),
    destination: z.string().trim().max(80).optional(),
    x: z.number().int().min(0).max(100000).optional(),
    y: z.number().int().min(0).max(100000).optional(),
    seconds: z.number().int().min(1).max(5).optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.movement === "goto" &&
      (value.x === undefined || value.y === undefined)
    )
      ctx.addIssue({
        code: "custom",
        message: "Choose a room destination with X and Y map coordinates.",
      });
  });
export type VacuumAction = z.infer<typeof vacuumDraftSchema>;

import { designSchemeIds } from "./design-scheme";
import { z } from "zod";
import { lightStepSchema } from "./light-transition";

import { vacuumDraftSchema } from "./vacuum";

export const gameDraftKey = "threshold-new-game-draft-v1";

// Drafts deliberately accept unfinished fields that cannot yet be saved as games.
const draftSchema = z.object({
  autoId: z.boolean(),
  game: z.object({
    id: z.string(),
    name: z.string(),
    designScheme: z.enum(designSchemeIds).optional(),
    autoStart: z.boolean().optional(),
    controls: z.array(
      z.object({ id: z.string(), name: z.string(), entity: z.string() }),
    ),
    areas: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        kind: z.string(),
        hint: z.string(),
        description: z.string(),
        unlockCode: z.string().optional(),
        caseSensitive: z.boolean().optional(),
        playerView: z.string().optional(),
        qrMode: z.enum(["hidden", "prompted"]).optional(),
        choices: z.array(z.string()).optional(),
        onComplete: z
          .array(
            z.discriminatedUnion("type", [
              vacuumDraftSchema,
              z.object({
                type: z.literal("lights"),
                groups: z.array(
                  z.object({
                    repeat: z.number().optional(),
                    loop: z.enum(["next-challenge", "replaced"]).optional(),
                    entities: z.array(z.string()),
                    steps: z.array(
                      z.union([
                        lightStepSchema,
                        z.object({
                          mode: z.literal("scene"),
                          entity: z.string(),
                          seconds: z.number(),
                        }),
                      ]),
                    ),
                  }),
                ),
              }),
              z.object({
                type: z.literal("control"),
                controlId: z.string(),
                on: z.boolean().optional(),
              }),
              z.object({
                type: z.literal("speech"),
                entity: z.string(),
                message: z.string(),
              }),
            ]),
          )
          .optional(),
      }),
    ),
  }),
});

export function readGameDraft(key = gameDraftKey) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const result = draftSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

import { z } from "zod";

export const gameDraftKey = "threshold-new-game-draft-v1";

// Drafts deliberately accept unfinished fields that cannot yet be saved as games.
const draftSchema = z.object({
  autoId: z.boolean(),
  game: z.object({
    id: z.string(),
    name: z.string(),
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

export function readGameDraft() {
  try {
    const raw = localStorage.getItem(gameDraftKey);
    if (!raw) return null;
    const result = draftSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

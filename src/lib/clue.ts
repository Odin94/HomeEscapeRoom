import { z } from "zod";

export const MAX_CLUE_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_CLUE_TOTAL_BYTES = 1024 * 1024 * 1024;

export function clueFileBytes(content: string): number {
  const comma = content.indexOf(",");
  if (comma < 0) return 0;
  const padding = content.endsWith("==") ? 2 : content.endsWith("=") ? 1 : 0;
  return Math.floor(((content.length - comma - 1) * 3) / 4) - padding;
}

export const clueSchema = z
  .strictObject({
    id: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(80),
    name: z.string().trim().min(1).max(80),
    kind: z.enum(["markdown", "image", "audio", "video"]),
    content: z
      .string()
      .min(1)
      .max(4 * Math.ceil(MAX_CLUE_FILE_BYTES / 3) + 100),
  })
  .superRefine((clue, ctx) => {
    const patterns = {
      image: /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/,
      audio:
        /^data:audio\/(mpeg|mp3|wav|x-wav|ogg|webm|mp4|aac|flac);base64,[A-Za-z0-9+/]+={0,2}$/,
      video:
        /^data:video\/(mp4|webm|ogg|quicktime);base64,[A-Za-z0-9+/]+={0,2}$/,
    };
    if (clue.kind !== "markdown" && !patterns[clue.kind].test(clue.content))
      ctx.addIssue({
        code: "custom",
        message: "Choose a supported image, audio or video file for this clue.",
      });
    if (
      clue.kind !== "markdown" &&
      clueFileBytes(clue.content) > MAX_CLUE_FILE_BYTES
    )
      ctx.addIssue({
        code: "custom",
        message: "Choose a file no larger than 100 MB.",
      });
    if (clue.kind === "markdown" && clue.content.length > 10000)
      ctx.addIssue({
        code: "custom",
        message: "Markdown clues can contain up to 10,000 characters.",
      });
  });
export type Clue = z.infer<typeof clueSchema>;

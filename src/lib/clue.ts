import { z } from "zod";

export const clueSchema = z
  .strictObject({
    id: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(80),
    name: z.string().trim().min(1).max(80),
    kind: z.enum(["markdown", "image", "audio", "video"]),
    content: z.string().min(1).max(8_000_000),
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
    if (clue.kind === "markdown" && clue.content.length > 10000)
      ctx.addIssue({
        code: "custom",
        message: "Markdown clues can contain up to 10,000 characters.",
      });
  });
export type Clue = z.infer<typeof clueSchema>;

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";
const schema = z.object({
  publicUrl: z
    .union([
      z.literal(""),
      z.url().refine((value) => {
        const url = new URL(value);
        return (
          ["http:", "https:"].includes(url.protocol) &&
          !url.username &&
          !url.password &&
          url.pathname === "/" &&
          !url.search &&
          !url.hash
        );
      }, "Use an http(s) origin without a path, credentials, query or fragment."),
    ])
    .transform((value) => (value ? new URL(value).origin : "")),
  haUrl: z.union([
    z.literal(""),
    z.url().refine((v) => ["http:", "https:"].includes(new URL(v).protocol)),
  ]),
  haToken: z.string(),
  voiceEnabled: z.boolean(),
  voiceLanguage: z.enum(["en", "de"]),
  voiceOutput: z.enum(["phone", "room"]),
  adminKey: z.string().min(8),
});
const path = () => resolve(process.env.SETTINGS_PATH || "data/settings.json");
export function settings() {
  const saved = existsSync(path())
    ? JSON.parse(readFileSync(path(), "utf8"))
    : {};
  return {
    voiceEnabled: false,
    voiceLanguage: "en",
    voiceOutput: "phone",
    publicUrl: process.env.PUBLIC_URL || "",
    haUrl: process.env.HA_URL || "",
    haToken: process.env.HA_TOKEN || "",
    adminKey: process.env.ADMIN_KEY || "",
    ...saved,
  } as {
    haUrl: string;
    haToken: string;
    adminKey: string;
    publicUrl: string;
    voiceEnabled: boolean;
    voiceLanguage: "en" | "de";
    voiceOutput: "phone" | "room";
  };
}
export function saveSettings(body: Record<string, unknown>) {
  const previous = settings();
  const next = schema.parse({
    publicUrl: body.publicUrl ?? previous.publicUrl,
    haUrl: body.haUrl ?? previous.haUrl,
    voiceEnabled:
      body.voiceEnabled === undefined
        ? previous.voiceEnabled
        : body.voiceEnabled === true || body.voiceEnabled === "true",
    voiceLanguage: body.voiceLanguage ?? previous.voiceLanguage,
    voiceOutput: body.voiceOutput ?? previous.voiceOutput,
    haToken: body.haToken || previous.haToken,
    adminKey: body.adminKey || previous.adminKey,
  });
  mkdirSync(dirname(path()), { recursive: true });
  writeFileSync(`${path()}.tmp`, JSON.stringify(next, null, 2), {
    mode: 0o600,
  });
  renameSync(`${path()}.tmp`, path());
}

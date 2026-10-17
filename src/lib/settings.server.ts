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
  adminKey: z.string().min(8),
});
const path = () => resolve(process.env.SETTINGS_PATH || "data/settings.json");
export function settings() {
  const saved = existsSync(path())
    ? JSON.parse(readFileSync(path(), "utf8"))
    : {};
  return {
    publicUrl: process.env.PUBLIC_URL || "",
    haUrl: process.env.HA_URL || "",
    haToken: process.env.HA_TOKEN || "",
    adminKey: process.env.ADMIN_KEY || "",
    ...saved,
  } as { haUrl: string; haToken: string; adminKey: string; publicUrl: string };
}
export function saveSettings(body: Record<string, unknown>) {
  const previous = settings();
  const next = schema.parse({
    publicUrl: body.publicUrl ?? previous.publicUrl,
    haUrl: body.haUrl,
    haToken: body.haToken || previous.haToken,
    adminKey: body.adminKey || previous.adminKey,
  });
  mkdirSync(dirname(path()), { recursive: true });
  writeFileSync(`${path()}.tmp`, JSON.stringify(next, null, 2), {
    mode: 0o600,
  });
  renameSync(`${path()}.tmp`, path());
}

import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { parseEnv } from "node:util";

// Quote values literally: Node's dotenv parser does not interpolate them.
function quote(value: string) {
  if (/[\r\n]/.test(value)) throw new Error("Values must fit on one line.");
  const delimiter = ['"', "'", "`"].find((char) => !value.includes(char));
  if (!delimiter)
    throw new Error("Use a value without at least one quote type.");
  return `${delimiter}${value}${delimiter}`;
}

async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error("Run pnpm run setup:env in an interactive terminal.");
  let source = "";
  try {
    source = await readFile(".env", "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const existing = parseEnv(source);
  const values: Record<string, string> = {};
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.on("SIGINT", () => {
    console.log("\nCancelled. .env was not changed.");
    process.exit(130);
  });
  async function ask(
    key: string,
    help: string,
    fallback = "",
    validate: (value: string) => boolean = () => true,
  ) {
    console.log(`\n${key}: ${help}`);
    const current = existing[key] || fallback;
    for (;;) {
      const answer = (
        await rl.question(
          `${current ? "Enter keeps the existing/default value" : "Enter skips"}; - clears: `,
        )
      ).trim();
      const value = answer === "-" ? "" : answer || current;
      if (!validate(value)) {
        console.log("Invalid value. Check the instructions and try again.");
        continue;
      }
      try {
        quote(value);
      } catch {
        console.log("Use a single line without at least one quote type.");
        continue;
      }
      values[key] = value;
      return value;
    }
  }
  try {
    console.log(
      "Threshold setup · saves only after confirmation. Typed values are visible in this terminal; existing secrets are never printed.",
    );
    await ask(
      "ADMIN_KEY",
      "Choose your game master login key (16+ characters). Enter generates one if none exists. You can find it in .env afterward.",
      randomBytes(24).toString("hex"),
      (value) =>
        value.length >= 16 && value !== "replace-with-a-long-random-key",
    );
    const url = await ask(
      "HA_URL",
      "Home Assistant address reachable from this computer, e.g. http://homeassistant.local:8123 or http://192.168.1.20:8123. Leave empty for demo mode; omit /api.",
      "",
      (value) => {
        if (!value) return true;
        try {
          const url = new URL(value);
          return (
            ["http:", "https:"].includes(url.protocol) &&
            !url.username &&
            !url.password &&
            !url.search &&
            !url.hash &&
            url.pathname === "/"
          );
        } catch {
          return false;
        }
      },
    );
    if (url) {
      await ask(
        "HA_TOKEN",
        "Home Assistant → your profile → Security → Long-lived access tokens → Create token. Copy it when shown; paste here.",
        "",
        (value) => !!value && !/\s/.test(value),
      );
      for (const [key, domain, help] of [
        ["HA_LIGHT_ENTITY", "light", "light or light group for room controls"],
        ["HA_SCENE_ENTITY", "scene", "scene for atmosphere"],
        ["HA_VOICE_SCRIPT", "script", "script that performs your announcement"],
      ]) {
        await ask(
          key,
          `Optional ${help}. Copy its entity ID from HA → Developer tools → States (e.g. ${domain}.escape_room). Unconfigured controls cannot run.`,
          "",
          (value) =>
            !value || new RegExp(`^${domain}\\.[a-z0-9_]+$`).test(value),
        );
      }
    }
    console.log(
      "\nSave these settings to .env? Other settings and comments are preserved.",
    );
    if (
      (await rl.question("Type yes to save: ")).trim().toLowerCase() !== "yes"
    ) {
      console.log("Cancelled. .env was not changed.");
      return;
    }
    const remaining = source.split(/\r?\n/).filter((line) => {
      const match = line.match(/^\s*(?:export\s+)?([\w]+)\s*=/);
      return !match || !(match[1] in values);
    });
    await writeFile(
      ".env",
      `${remaining.join("\n").trimEnd()}\n${Object.entries(values)
        .map(([key, value]) => `${key}=${quote(value)}`)
        .join("\n")}\n`,
      { mode: 0o600 },
    );
    console.log(
      "Saved .env. Restart with pnpm dev (or pnpm start). Sign in using ADMIN_KEY from .env.",
    );
    if (url)
      console.log(
        "Test a configured control in the dashboard to verify Home Assistant connectivity; setup sends no device commands.",
      );
  } finally {
    rl.close();
  }
}

main().catch((error: Error) => {
  console.error(`Setup failed: ${error.message}`);
  process.exitCode = 1;
});

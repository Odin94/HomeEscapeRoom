import { randomBytes } from "node:crypto";
import { readFile, writeFile, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { Writable, type Readable } from "node:stream";
import { parseEnv } from "node:util";

type Ask = (label: string, secret?: boolean) => Promise<string>;

export function terminalPrompt(input: Readable, output: Writable) {
  let hidden = false;
  // readline disables terminal echo. Suppress its own echo/redraws for secrets,
  // including pasted text, cursor movement and backspace.
  const screen = new Writable({
    write(chunk, encoding, done) {
      if (!hidden) output.write(chunk, encoding);
      done();
    },
  });
  Object.defineProperty(screen, "columns", {
    get: () => (output as NodeJS.WriteStream).columns || 80,
  });
  const rl = createInterface({
    input,
    output: screen,
    terminal: true,
    historySize: 0,
  });
  const abort = new AbortController();
  rl.on("SIGINT", () => abort.abort());
  rl.on("close", () => abort.abort());
  return {
    async ask(label: string, secret = false) {
      if (abort.signal.aborted) throw new Error("Input closed");
      output.write(label);
      hidden = secret;
      try {
        return await rl.question("", { signal: abort.signal });
      } finally {
        hidden = false;
        if (secret) output.write("\n");
      }
    },
    close: () => rl.close(),
  };
}

function quote(value: string) {
  if (/[\r\n]/.test(value)) throw new Error("Values must fit on one line.");
  const delimiter = ['"', "'", "`"].find((char) => !value.includes(char));
  if (!delimiter) throw new Error("Leave out at least one quote type.");
  return `${delimiter}${value}${delimiter}`;
}

export function mergeEnv(source: string, values: Record<string, string>) {
  const pending = { ...values };
  // Replace entire quoted assignments, including multiline values.
  const result = source.replace(
    /^[\t ]*(?:export\s+)?([\w]+)[\t ]*=[\t ]*(?:"[^"]*"|'[^']*'|`[^`]*`|[^\r\n]*)(?:[^\r\n]*)/gm,
    (line, key: string) => {
      if (!Object.hasOwn(values, key)) return line;
      delete pending[key];
      return `${key}=${quote(values[key])}`;
    },
  );
  const additions = Object.entries(pending).map(
    ([key, value]) => `${key}=${quote(value)}`,
  );
  return `${result}${result && !result.endsWith("\n") ? "\n" : ""}${additions.length ? additions.join("\n") + "\n" : ""}`;
}

async function readOptional(path: string) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return "";
  }
}

async function save(path: string, contents: string) {
  // Interruption cannot truncate the target file.
  const temporary = `${path}.setup-tmp`;
  await writeFile(temporary, contents, { mode: 0o600 });
  await rename(temporary, path);
}

export async function runSetup({
  ask,
  log,
  directory = process.cwd(),
}: {
  ask: Ask;
  log: (message: string) => void;
  directory?: string;
}) {
  const envPath = resolve(directory, ".env");
  const draftPath = resolve(directory, ".env.setup-draft");
  const source = await readOptional(envPath);
  const draft = await readOptional(draftPath);
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(parseEnv(draft))) {
    if (value !== undefined) values[key] = value;
  }
  const existing = parseEnv(source);
  log("\n  Threshold · Environment setup\n  ─────────────────────────────");
  log(
    "Enter keeps the shown value · - clears an optional field\nPasswords and tokens are hidden while typing. Ctrl+C keeps completed answers for next time.",
  );
  if (draft) log("\nResuming your saved answers. Nothing has been discarded.");

  async function field(
    key: string,
    title: string,
    help: string,
    validate: (value: string) => boolean = () => true,
    secret = false,
    fallback = "",
  ) {
    const current = values[key] ?? existing[key] ?? fallback;
    log(`\n${title}\n${help}`);
    log(`Current: ${current ? (secret ? "****" : current) : "not set"}`);
    for (;;) {
      const answer = (
        await ask(
          secret
            ? "  Value (hidden; Enter keeps): "
            : "  Value (Enter keeps): ",
          secret,
        )
      ).trim();
      const value = answer === "-" ? "" : answer || current;
      if (!validate(value)) {
        log(
          "  Please check the format above and try again. Earlier answers are kept.",
        );
        continue;
      }
      try {
        quote(value);
      } catch {
        log("  Use a single line and leave out at least one quote type.");
        continue;
      }
      values[key] = value;
      await save(draftPath, mergeEnv("", values));
      return value;
    }
  }

  for (;;) {
    await field(
      "ADMIN_KEY",
      "1 / 3 · Game master password",
      "Choose any non-empty password. A random default is ready if you don't have one; find it in .env after saving.",
      (value) => !!value,
      true,
      randomBytes(24).toString("hex"),
    );
    const url = await field(
      "HA_URL",
      "2 / 3 · Home Assistant address",
      "Example: http://homeassistant.local:8123 or your LAN IP. Omit /api. Empty means demo mode.",
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
      const base = url.replace(/\/$/, "");
      await field(
        "HA_TOKEN",
        "3 / 3 · Home Assistant access",
        `Open ${base}/profile/security\nUnder Long-lived access tokens, create a token named Threshold and paste it here.`,
        (value) => !!value && !/\s/.test(value),
        true,
      );
      for (const [key, domain, title] of [
        ["HA_LIGHT_ENTITY", "light", "Room light or light group"],
        ["HA_SCENE_ENTITY", "scene", "Atmosphere scene"],
        ["HA_VOICE_SCRIPT", "script", "Announcement script"],
      ]) {
        await field(
          key,
          title,
          `Open ${base}/config/tools/state\nCopy an entity ID such as ${domain}.escape_room. Optional; leave unset if unused.`,
          (value) =>
            !value || new RegExp(`^${domain}\\.[a-z0-9_]+$`).test(value),
        );
      }
    }
    log("\n  Review settings\n  ───────────────");
    for (const [key, value] of Object.entries({ ...existing, ...values })) {
      if (
        ![
          "ADMIN_KEY",
          "HA_URL",
          "HA_TOKEN",
          "HA_LIGHT_ENTITY",
          "HA_SCENE_ENTITY",
          "HA_VOICE_SCRIPT",
        ].includes(key)
      )
        continue;
      const secret = key === "ADMIN_KEY" || key === "HA_TOKEN";
      log(`  ${key}: ${value ? (secret ? "****" : value) : "not set"}`);
    }
    if (!url)
      log("  Demo mode. Existing Home Assistant bindings are kept for later.");
    for (;;) {
      const choice = (await ask("\nSave to .env? [Y/n] (or edit / discard): "))
        .trim()
        .toLowerCase();
      if (["", "y", "yes"].includes(choice)) {
        // Preserve unrelated edits made while setup was running.
        await save(envPath, mergeEnv(await readOptional(envPath), values));
        await rm(draftPath, { force: true });
        log(
          "\nSaved .env. Restart with pnpm dev (or pnpm start). Use ADMIN_KEY to sign in.",
        );
        if (url)
          log(
            "Test a configured dashboard control to verify connectivity. Setup sends no device commands.",
          );
        return;
      }
      if (["e", "edit"].includes(choice)) break;
      if (["n", "no"].includes(choice)) {
        log(
          "\nDraft kept. Run pnpm run setup:env to resume; .env is unchanged.",
        );
        return;
      }
      if (choice === "discard") {
        await rm(draftPath, { force: true });
        log("\nDraft discarded. .env is unchanged.");
        return;
      }
      log(
        "Press Enter to save, type edit to revise, n to keep a draft, or discard to delete it.",
      );
    }
  }
}

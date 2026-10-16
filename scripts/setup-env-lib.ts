import { randomBytes } from "node:crypto";
import { readFile, writeFile, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

type Ask = (label: string, secret?: boolean) => Promise<string>;
export type Choice = { value: string; label: string; hint?: string };
export type Choose = (
  message: string,
  options: Choice[],
  initialValue?: string,
  searchable?: boolean,
) => Promise<string>;
export type Entity = { id: string; name: string; state: string };

export async function discoverEntities(
  url: string,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<Entity[]> {
  let response: Response;
  try {
    response = await fetcher(`${url.replace(/\/$/, "")}/api/states`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
      redirect: "error",
    });
  } catch {
    throw new Error(
      "Could not reach Home Assistant within 8 seconds. Check the address and network connection.",
    );
  }
  if (!response.ok) {
    throw new Error(
      response.status === 401 || response.status === 403
        ? "Home Assistant rejected the token. Create or paste a valid long-lived access token."
        : `Home Assistant returned HTTP ${response.status}. Check the address and try again.`,
    );
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error("Home Assistant did not return valid entity data.");
  }
  if (!Array.isArray(data))
    throw new Error("Home Assistant did not return an entity list.");
  const entities = new Map<string, Entity>();
  for (const item of data) {
    if (
      !item ||
      typeof item.entity_id !== "string" ||
      !/^(light|scene|script)\.[a-z0-9_]+$/.test(item.entity_id)
    )
      continue;
    entities.set(item.entity_id, {
      id: item.entity_id,
      name:
        typeof item.attributes?.friendly_name === "string"
          ? item.attributes.friendly_name
          : item.entity_id,
      state: typeof item.state === "string" ? item.state : "unknown",
    });
  }
  return [...entities.values()].sort((a, b) => a.name.localeCompare(b.name));
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
  choose,
  fetcher = fetch,
  loading = () => () => {},
  directory = process.cwd(),
}: {
  ask: Ask;
  log: (message: string) => void;
  choose?: Choose;
  fetcher?: typeof fetch;
  loading?: (message: string) => (message: string) => void;
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
    validationMessage = "Please check the format above and try again. Earlier answers are kept.",
  ) {
    const current = values[key] ?? existing[key] ?? fallback;
    log(`\n${title}\n${help}`);
    log(`Current: ${current ? (secret ? "****" : current) : "not set"}`);
    for (;;) {
      const answer = (
        await ask(`${title} (Enter keeps${secret ? "; hidden" : ""})`, secret)
      ).trim();
      const value = answer === "-" ? "" : answer || current;
      if (!validate(value)) {
        log(validationMessage);
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

  setup: for (;;) {
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
      const token = await field(
        "HA_TOKEN",
        "3 / 3 · Home Assistant access",
        `Open ${base}/profile/security\nUnder Long-lived access tokens, create a token named Threshold and paste it here.`,
        (value) => !!value && !/\s/.test(value),
        true,
      );
      let entities: Entity[] = [];
      for (;;) {
        const stop = loading("Reading Home Assistant entities…");
        try {
          entities = await discoverEntities(base, token, fetcher);
          stop(`Found ${entities.length} lights, scenes and scripts.`);
          break;
        } catch (error) {
          stop("Entity discovery unavailable.");
          log((error as Error).message);
          const action = choose
            ? await choose(
                "How would you like to continue?",
                [
                  { value: "retry", label: "Retry connection" },
                  {
                    value: "edit",
                    label: "Edit URL and token",
                    hint: "Earlier answers are kept",
                  },
                  { value: "manual", label: "Enter entity IDs manually" },
                ],
                "retry",
              )
            : "manual";
          if (action === "retry") continue;
          if (action === "edit") continue setup;
          break;
        }
      }
      for (const [key, domain, title] of [
        ["HA_LIGHT_ENTITY", "light", "Room light or light group"],
        ["HA_SCENE_ENTITY", "scene", "Atmosphere scene"],
        ["HA_VOICE_SCRIPT", "script", "Announcement script"],
      ]) {
        const current = values[key] ?? existing[key] ?? "";
        const matches = entities.filter((entity) =>
          entity.id.startsWith(`${domain}.`),
        );
        if (!matches.length)
          log(
            `No ${domain}. entities discovered. You can keep a value, skip, or enter an ID manually.`,
          );
        if (choose) {
          const options: Choice[] = [
            {
              value: "keep",
              label: current ? `Keep ${current}` : "Leave unconfigured",
            },
            ...matches.map((entity) => ({
              value: entity.id,
              label: `${entity.name} · ${entity.id}`,
              hint: entity.state,
            })),
            { value: "manual", label: "Enter an entity ID manually" },
            ...(current
              ? [{ value: "clear", label: "Clear this binding" }]
              : []),
          ];
          const selected = await choose(title, options, "keep", true);
          if (selected !== "manual") {
            values[key] =
              selected === "keep"
                ? current
                : selected === "clear"
                  ? ""
                  : selected;
            await save(draftPath, mergeEnv("", values));
            continue;
          }
        }
        await field(
          key,
          title,
          `Open ${base}/config/tools/state\nCopy an entity ID such as ${domain}.escape_room. Optional; leave unset if unused.`,
          (value) =>
            !value || new RegExp(`^${domain}\\.[a-z0-9_]+$`).test(value),
          false,
          "",
          `This control needs a ${domain}. ID (for example ${domain}.escape_room). A scene. ID belongs in Atmosphere scene; a light. ID belongs in Room light. Surrounding whitespace is trimmed.`,
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
      const choice = (
        choose
          ? await choose(
              "Save these settings?",
              [
                { value: "yes", label: "Save to .env", hint: "Default" },
                { value: "edit", label: "Edit answers" },
                { value: "no", label: "Keep draft and exit" },
                { value: "discard", label: "Discard draft" },
              ],
              "yes",
            )
          : await ask("\nSave to .env? [Y/n] (or edit / discard): ")
      )
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

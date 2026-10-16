import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { parseEnv } from "node:util";
import { discoverEntities, mergeEnv, runSetup } from "../scripts/setup-env-lib";
import { terminalPrompt } from "../scripts/setup-env-ui";

const offline: typeof fetch = async () => {
  throw new Error("offline");
};

async function workspace(t: { after: (fn: () => Promise<void>) => void }) {
  const directory = await mkdtemp(join(tmpdir(), "threshold-env-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function answers(entries: string[]) {
  return async () => {
    assert.ok(entries.length, "Unexpected extra prompt");
    return entries.shift()!;
  };
}

test("Enter saves, links use chosen HA address, summaries mask credentials", async (t) => {
  const directory = await workspace(t);
  const logs: string[] = [];
  const hidden: boolean[] = [];
  const next = answers([
    "short-password",
    "http://ha.lan:8123/",
    "secret-token",
    "light.study",
    "scene.dusk",
    "",
    "",
  ]);
  await writeFile(
    join(directory, ".env"),
    '# keep\nDATABASE_PATH="custom.sqlite"\n',
  );
  await runSetup({
    directory,
    fetcher: offline,
    log: (message) => logs.push(message),
    ask: async (_label, secret) => {
      hidden.push(!!secret);
      return next();
    },
  });
  const saved = await readFile(join(directory, ".env"), "utf8");
  assert.ok(saved.includes("# keep"));
  assert.equal(parseEnv(saved).ADMIN_KEY, "short-password");
  assert.equal(parseEnv(saved).DATABASE_PATH, "custom.sqlite");
  assert.equal(parseEnv(saved).HA_SCENE_ENTITY, "scene.dusk");
  assert.ok(logs.join("\n").includes("http://ha.lan:8123/config/tools/state"));
  assert.ok(logs.join("\n").includes("http://ha.lan:8123/profile/security"));
  assert.ok(!logs.join("\n").includes("short-password"));
  assert.ok(!logs.join("\n").includes("secret-token"));
  assert.deepEqual(hidden, [true, false, true, false, false, false, false]);
  await assert.rejects(readFile(join(directory, ".env.setup-draft")), {
    code: "ENOENT",
  });
});

test("interrupted setup resumes completed values and edit keeps new answers", async (t) => {
  const directory = await workspace(t);
  const original = 'ADMIN_KEY="old"\n';
  await writeFile(join(directory, ".env"), original);
  let count = 0;
  await assert.rejects(
    runSetup({
      directory,
      log: () => {},
      ask: async () => {
        if (count++ === 0) return "new";
        throw new Error("Interrupted");
      },
    }),
  );
  assert.equal(await readFile(join(directory, ".env"), "utf8"), original);
  await runSetup({
    directory,
    log: () => {},
    ask: answers(["", "", "edit", "", "", ""]),
  });
  assert.equal(
    parseEnv(await readFile(join(directory, ".env"), "utf8")).ADMIN_KEY,
    "new",
  );
});

test("declining keeps a draft; only discard deletes it", async (t) => {
  const directory = await workspace(t);
  await runSetup({ directory, log: () => {}, ask: answers(["tiny", "", "n"]) });
  assert.equal(
    parseEnv(await readFile(join(directory, ".env.setup-draft"), "utf8"))
      .ADMIN_KEY,
    "tiny",
  );
  await assert.rejects(readFile(join(directory, ".env")), { code: "ENOENT" });
  await runSetup({
    directory,
    log: () => {},
    ask: answers(["", "", "discard"]),
  });
  await assert.rejects(readFile(join(directory, ".env.setup-draft")), {
    code: "ENOENT",
  });
});

test("clearing HA URL keeps bindings and unrelated multiline settings", async (t) => {
  const directory = await workspace(t);
  await writeFile(
    join(directory, ".env"),
    'ADMIN_KEY="ok"\nHA_URL="http://ha.lan:8123"\nHA_TOKEN="keep-token"\nHA_LIGHT_ENTITY="light.study"\nOTHER="line one\nline two"\n',
  );
  await runSetup({ directory, log: () => {}, ask: answers(["", "-", ""]) });
  const values = parseEnv(await readFile(join(directory, ".env"), "utf8"));
  assert.equal(values.HA_URL, "");
  assert.equal(values.HA_TOKEN, "keep-token");
  assert.equal(values.HA_LIGHT_ENTITY, "light.study");
  assert.equal(values.OTHER, "line one\nline two");
  assert.equal(
    parseEnv(mergeEnv('ADMIN_KEY="old\nvalue"\n', { ADMIN_KEY: "new" }))
      .ADMIN_KEY,
    "new",
  );
});

test("terminal suppresses typed/pasted secrets and restores normal echo", async () => {
  const input = new PassThrough();
  let output = "";
  const screen = new Writable({
    write(chunk, _encoding, done) {
      output += chunk;
      done();
    },
  });
  const terminal = terminalPrompt(input, screen);
  const secret = terminal.ask("Password: ", true);
  input.write("pasted-secret");
  input.write("\r");
  assert.equal(await secret, "pasted-secret");
  assert.ok(!output.includes("pasted-secret"));
  assert.ok(output.includes("*"));
  const regular = terminal.ask("URL: ");
  input.write("ha.lan\r");
  assert.equal(await regular, "ha.lan");
  assert.ok(output.includes("ha.lan"));
});

test("Ctrl+C aborts a hidden prompt without echoing its partial secret", async () => {
  const input = new PassThrough();
  let output = "";
  const screen = new Writable({
    write(chunk, _encoding, done) {
      output += chunk;
      done();
    },
  });
  const terminal = terminalPrompt(input, screen);
  const pending = terminal.ask("Token: ", true);
  const rejected = assert.rejects(pending, /Setup cancelled/);
  input.write("partial-secret\x03");
  await rejected;
  assert.ok(!output.includes("partial-secret"));
});

test("Clack filters entity choices and defaults review to saving", async () => {
  const input = new PassThrough();
  let output = "";
  const screen = new Writable({
    write(chunk, _encoding, done) {
      output += chunk;
      done();
    },
  });
  const terminal = terminalPrompt(input, screen);
  const selected = terminal.choose(
    "Atmosphere scene",
    [
      { value: "keep", label: "Leave unconfigured" },
      { value: "scene.twilight", label: "Twilight · scene.twilight" },
      { value: "manual", label: "Enter manually" },
    ],
    "keep",
    true,
  );
  input.write("twilight");
  input.write("\r");
  assert.equal(await selected, "scene.twilight");
  assert.ok(output.includes("Twilight"));
  const review = terminal.choose(
    "Save settings?",
    [
      { value: "yes", label: "Save" },
      { value: "discard", label: "Discard" },
    ],
    "yes",
  );
  input.write("\r");
  assert.equal(await review, "yes");
});

test("discovery uses a read-only authenticated request and filters supported entities", async () => {
  const entities = await discoverEntities(
    "http://ha.lan:8123/",
    "token",
    async (url, options) => {
      assert.equal(url, "http://ha.lan:8123/api/states");
      assert.equal(options?.method, undefined);
      assert.deepEqual(options?.headers, { Authorization: "Bearer token" });
      assert.equal(options?.redirect, "error");
      assert.ok(options?.signal);
      return Response.json([
        {
          entity_id: "light.study",
          attributes: { friendly_name: "Study lamp" },
          state: "on",
        },
        {
          entity_id: "scene.twilight",
          attributes: { friendly_name: "Twilight" },
        },
        { entity_id: "script.announcement" },
        { entity_id: "sensor.temperature" },
        null,
        { entity_id: "light.invalid id" },
      ]);
    },
  );
  assert.equal(entities.length, 3);
  assert.equal(
    entities.find((entity) => entity.id === "light.study")?.name,
    "Study lamp",
  );
});

test("discovery reports authentication, malformed responses and timeouts without leaking token", async () => {
  for (const [fetcher, message] of [
    [
      async () => new Response("secret-token", { status: 401 }),
      /rejected the token/,
    ],
    [async () => Response.json({}), /entity list/],
    [async () => new Response("not json"), /valid entity data/],
    [offline, /8 seconds/],
  ] as const) {
    await assert.rejects(
      discoverEntities("http://ha.lan", "secret-token", fetcher),
      message,
    );
  }
});

test("pickers show matching domains, allow manual entry, trim and explain wrong prefixes", async (t) => {
  const directory = await workspace(t);
  const logs: string[] = [];
  let choices = 0;
  const next = answers([
    "pw",
    "http://ha.lan:8123",
    "token",
    " scene.wrong ",
    " light.manual ",
  ]);
  await runSetup({
    directory,
    log: (message) => logs.push(message),
    ask: next,
    fetcher: async () =>
      Response.json([
        {
          entity_id: "light.study",
          attributes: { friendly_name: "Study" },
          state: "on",
        },
        { entity_id: "scene.twilight" },
        { entity_id: "script.say_hello" },
      ]),
    choose: async (_message, options, initial, searchable) => {
      choices++;
      if (choices <= 3) {
        assert.equal(searchable, true);
        assert.equal(initial, "keep");
        assert.ok(options.some((option) => option.value === "manual"));
      }
      if (choices === 1) {
        assert.ok(options.some((option) => option.value === "light.study"));
        assert.ok(!options.some((option) => option.value.startsWith("scene.")));
        return "manual";
      }
      if (choices === 2) return "scene.twilight";
      if (choices === 3) return "keep";
      assert.equal(initial, "yes");
      return "yes";
    },
  });
  const env = parseEnv(await readFile(join(directory, ".env"), "utf8"));
  assert.equal(env.HA_LIGHT_ENTITY, "light.manual");
  assert.equal(env.HA_SCENE_ENTITY, "scene.twilight");
  assert.equal(env.HA_VOICE_SCRIPT, "");
  assert.ok(logs.some((message) => message.includes("needs a light. ID")));
});

test("failed discovery retries then offers manual binding selection", async (t) => {
  const directory = await workspace(t);
  let requests = 0;
  const decisions = answers([
    "retry",
    "manual",
    "manual",
    "keep",
    "keep",
    "yes",
  ]);
  await runSetup({
    directory,
    log: () => {},
    ask: answers(["pw", "http://ha.lan", "token", "light.manual"]),
    fetcher: async () => {
      requests++;
      throw new Error("offline");
    },
    choose: decisions,
  });
  assert.equal(requests, 2);
  assert.equal(
    parseEnv(await readFile(join(directory, ".env"), "utf8")).HA_LIGHT_ENTITY,
    "light.manual",
  );
});

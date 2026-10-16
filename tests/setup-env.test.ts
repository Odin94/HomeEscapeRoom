import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { parseEnv } from "node:util";
import { mergeEnv, runSetup, terminalPrompt } from "../scripts/setup-env-lib";

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
  try {
    const secret = terminal.ask("Password: ", true);
    input.write("pasted-secret");
    input.write("\x7f!");
    input.write("\r");
    assert.equal(await secret, "pasted-secre!");
    assert.equal(output, "Password: \n");
    const regular = terminal.ask("URL: ");
    input.write("ha.lan\r");
    assert.equal(await regular, "ha.lan");
    assert.ok(output.includes("ha.lan"));
  } finally {
    terminal.close();
  }
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
  try {
    const pending = terminal.ask("Token: ", true);
    const rejected = assert.rejects(pending, { name: "AbortError" });
    input.write("partial-secret\x03");
    await rejected;
    assert.equal(output, "Token: \n");
  } finally {
    terminal.close();
  }
});

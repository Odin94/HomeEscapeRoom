import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/lib/store.server";

test("restart recovers queued effects and retry prepares replacements before executing older work", () => {
  const directory = mkdtempSync(join(tmpdir(), "room-effect-recovery-"));
  const databasePath = join(directory, "test.sqlite");
  const db = openStore(databasePath);
  const game = {
    id: "recovery",
    name: "Recovery",
    controls: [
      { id: "old", name: "Old lamp command", entity: "light.one" },
      { id: "new", name: "New scene", entity: "scene.green" },
    ],
    areas: [0, 1].map((n) => ({
      id: `step-${n}`,
      name: `Step ${n}`,
      kind: "text",
      hint: "",
      description: "",
      unlockCode: "yes",
    })),
  };
  try {
    db.$client
      .prepare(
        "INSERT INTO sessions(id,name,status,progress) VALUES ('room','Crew','running',2)",
      )
      .run();
    db.$client
      .prepare(
        "INSERT INTO session_games(session_id,definition) VALUES ('room',?)",
      )
      .run(JSON.stringify(game));
    for (const [index, status] of ["failed", "queued"].entries()) {
      db.$client
        .prepare(
          "INSERT INTO action_runs(id,session_id,payload,status) VALUES (?,'room',?,?)",
        )
        .run(
          `room:${index}:0`,
          JSON.stringify({
            type: "control",
            controlId: index === 0 ? "old" : "new",
            on: true,
          }),
          status,
        );
    }
    db.$client.close();
    const script = `
      import assert from 'node:assert/strict';
      const {saveSettings} = await import(${JSON.stringify(new URL("../src/lib/settings.server.ts", import.meta.url).href)});
      saveSettings({haUrl:'http://ha.test',haToken:'test',adminKey:'recovery-test-key',publicUrl:''});
      const sent=[];
      globalThis.fetch=async (url,init)=> {
        if(String(url).includes('/states/scene.')) return Response.json({attributes:{entity_id:['light.one']}});
        sent.push(String(url)); return Response.json([]);
      };
      const {handle,closeStore}=await import(${JSON.stringify(new URL("../src/lib/db.server.ts", import.meta.url).href)});
      const call=(body,cookie='')=>handle(new Request('http://localhost/api/game',{method:body?'POST':'GET',headers:{origin:'http://localhost',cookie,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}));
      try {
        const gm=(await call({action:'login',key:'recovery-test-key'})).headers.get('set-cookie').split(';')[0];
        let state=await (await call(undefined,gm)).json();
        assert.deepEqual(state.automation.map(run=>run.status),['failed','failed']);
        assert.equal((await call({action:'retry-actions',id:'room'},gm)).status,200);
        assert.equal(sent.length,1);
        assert.ok(sent[0].endsWith('/scene/turn_on'));
        assert.equal((await call({action:'retry-actions',id:'room'},gm)).status,200);
        assert.equal(sent.length,1);
      } finally { closeStore(); }
    `;
    assert.doesNotThrow(() =>
      execFileSync(
        process.execPath,
        ["--import", "tsx", "--input-type=module", "-e", script],
        {
          env: {
            ...process.env,
            DATABASE_PATH: databasePath,
            SETTINGS_PATH: join(directory, "settings.json"),
            ADMIN_KEY: "recovery-test-key",
            HA_URL: "",
            HA_TOKEN: "",
          },
          stdio: "pipe",
          timeout: 5000,
        },
      ),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

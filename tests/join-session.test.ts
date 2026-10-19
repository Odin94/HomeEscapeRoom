import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveJoinSession } from "../src/lib/join-session";

const open = { id: "open", acceptingPlayers: true };
const closed = { id: "closed", acceptingPlayers: false };

test("generic joining targets the only session accepting players", () => {
  assert.equal(resolveJoinSession([closed, open], "", ""), "open");
  assert.equal(resolveJoinSession([closed, open], "", "closed"), "open");
});

test("generic joining preserves the picker when zero or multiple sessions are open", () => {
  assert.equal(resolveJoinSession([closed], "", ""), "");
  const sessions = [open, { ...open, id: "other" }];
  assert.equal(resolveJoinSession(sessions, "", ""), "");
  assert.equal(resolveJoinSession(sessions, "", "other"), "other");
});

test("specific join links keep their target even when another session is the only open one", () => {
  assert.equal(resolveJoinSession([closed, open], "closed", ""), "closed");
  assert.equal(resolveJoinSession([open], "missing", ""), "missing");
});

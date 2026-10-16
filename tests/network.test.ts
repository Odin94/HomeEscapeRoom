import { test } from "node:test";
import assert from "node:assert/strict";
import { lanOrigin } from "../src/lib/network.server";

const address = (ip: string, internal = false) => ({
  address: ip,
  internal,
  family: "IPv4" as const,
  netmask: "255.255.255.0",
  mac: "00:00:00:00:00:00",
  cidr: `${ip}/24`,
});
test("localhost sharing selects Wi-Fi and preserves protocol and port", () => {
  assert.equal(
    lanOrigin("http://localhost:3000/api/game", {
      docker0: [address("172.17.0.1")],
      lo: [address("127.0.0.1", true)],
      en1: [address("10.0.0.5")],
      en0: [address("192.168.1.50")],
    }),
    "http://192.168.1.50:3000",
  );
});
test("an already-used LAN address takes precedence over interface selection", () => {
  assert.equal(
    lanOrigin("http://10.0.0.8:3000/api/game", {
      en0: [address("192.168.1.50")],
    }),
    "http://10.0.0.8:3000",
  );
});
test("no LAN address never produces a localhost or public sharing link", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]", "example.com"]) {
    assert.equal(
      lanOrigin(`http://${host}:3000/api/game`, {
        lo: [address("127.0.0.1", true)],
        eth0: [address("203.0.113.5")],
      }),
      null,
    );
  }
});

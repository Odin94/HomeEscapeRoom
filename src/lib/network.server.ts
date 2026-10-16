import { networkInterfaces } from "node:os";

export function lanOrigin(
  requestUrl: string,
  interfaces = networkInterfaces(),
): string | null {
  const url = new URL(requestUrl);
  const isLan = (address: string) =>
    /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address);
  if (isLan(url.hostname)) return url.origin;
  const candidates = Object.entries(interfaces)
    .filter(
      ([name]) =>
        !/loopback|docker|veth|vmnet|virtual|tailscale|utun/i.test(name),
    )
    .sort(([a], [b]) => {
      const rank = (name: string) =>
        /^(en0|wi-fi|wlan0|eth0)$/i.test(name) ? 0 : 1;
      return rank(a) - rank(b) || a.localeCompare(b);
    })
    .flatMap(([, addresses]) => addresses || []);
  const address = candidates.find(
    (entry) =>
      !entry.internal && entry.family === "IPv4" && isLan(entry.address),
  );
  if (!address) return null;
  url.hostname = address.address;
  return url.origin;
}

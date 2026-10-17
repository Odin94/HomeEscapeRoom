# Threshold

Home escape rooms with a React/TanStack Start admin and phone experience, backed by SQLite and Home Assistant.

## Run

Use Node 24 and pnpm, from the project root:

```sh
pnpm install
pnpm dev
```

Open `/` on phones to enter a name and join an open session. Admin lives at `/secretadmin` and still requires a key. Initially use `demo` when no ADMIN_KEY or Home Assistant connection is configured. In **Settings**, save an admin key (at least eight characters), Home Assistant URL and long-lived access token. Clearing the URL enables simulated controls. A blank token or key preserves the existing value. Settings apply immediately and are stored in Git-ignored `data/settings.json`; these override optional `.env` ADMIN_KEY, HA_URL and HA_TOKEN defaults. Keep data files private and backed up. DATABASE_PATH remains a server startup setting, since the running database cannot be moved from the UI.

## Games and sessions

**Games** lets admins create or edit validated JSON definitions. Save writes `games/<id>.json`; commit these files to track room changes. The editor supports any number of areas (up to 30) and named light, scene or script controls (up to 50). Each area has an unlock code, narrative content, QR/password mode and a `playerView` reference. `narrative` is the currently implemented view; unknown references are rejected, and definitions cannot contain executable page code. Schemas live in `src/lib/game.server.ts`. Invalid files fail validation on load and invalid UI edits are rejected before writing.

Entity mappings are game-specific, never read from HA_LIGHT_ENTITY, HA_SCENE_ENTITY or HA_VOICE_SCRIPT. These legacy wizard settings no longer affect play. Configure `controls[].entity` in the game definition instead. The old optional `setup:env` wizard remains available for connection bootstrap; prefer the UI for ongoing configuration.

Create a session by choosing a game and entering a session name. Each session saves a validated copy of that game's definition in SQLite, including answers and controls. Subsequent game edits affect future sessions only. Existing legacy sessions acquire a snapshot at the first startup after migration. Open joining, then start/resume once everyone has joined. Pause blocks discoveries; End closes the session. Players share progression within a session. Admin controls target that session's game entities.

The supplied Signal House game uses QR → RAVEN → QR. Under Games, show/print markers using a network-reachable browser address, e.g. `http://192.168.1.50:3000/secretadmin`. QR links use `/?code=…`; the code survives joining. `/play` redirects to the root and preserves QR queries; old admin URLs redirect to `/secretadmin`.

## Networking and devices

On a MacBook, run `pnpm dev`; it already listens on all network interfaces (`0.0.0.0`) on port 3000. Connect phones to the same Wi-Fi. Use the Network URL printed by Vite, for example `http://192.168.1.50:3000/`, on phones. Join links, the join-page shortcut and room QR markers automatically use a private LAN IPv4 address detected on the server, even when admin is opened through `localhost`. An existing LAN address in the browser is preferred; otherwise Wi-Fi is preferred over other interfaces. Sharing is disabled when no LAN address is available. You can also find the Mac's IP address in System Settings → Wi-Fi → Details → TCP/IP.

If macOS asks, allow Node to accept incoming connections. If necessary, allow it in System Settings → Network → Firewall → Options. Keep the Mac awake and avoid guest networks or Wi-Fi client isolation. No router port forwarding is needed for devices on the same LAN.

Host the server on your LAN, allow Node through the firewall, disable sleep and avoid guest Wi-Fi isolation. Tailscale also works if phones can reach the server and the server can reach Home Assistant. Use on a trusted network; `/secretadmin` is an address, not the authentication boundary. Cookies authenticate admin requests and all writes check Origin.

Home Assistant controls send server-side REST commands with an eight-second timeout. Light entities support on/off; scenes and scripts support turn_on. Add Hue and announcement integrations in Home Assistant first. Configured does not mean connectivity is verified; use a session control and check the result. Secrets and undiscovered content are withheld from unauthenticated API responses. Game JSON contains puzzle answers and belongs in an appropriately private repository.

## Build and checks

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm fmt
pnpm fmt:check
pnpm build
pnpm start
```

Keep `games/` and `drizzle/` beside the built app, run from the project root and preserve `data/`. Migrations apply automatically on startup. Schema: `src/lib/schema.server.ts`; generate changes with `pnpm db:generate` and commit SQL/snapshots. `pnpm db:migrate` applies without launching the app. Back up data before migration. Legacy schema drift stops migration rather than discarding data.

## Returning players and permanent QR markers

Player identity uses an HttpOnly cookie lasting up to one year; shared progress remains in SQLite. A typed Zustand store caches the player view in localStorage under `threshold-player`. Reopening checks membership and progress with the server before showing gameplay. Local data cannot unlock areas. Use the same browser and origin; clearing cookies, private browsing or changing hostnames loses that browser identity.

Connected pages poll every three seconds and refresh on window focus. End revokes the session's player credentials and clears local snapshots on the next successful refresh. Closed browsers reconcile when reopened. Joining another session replaces the previous snapshot. Reopening an ended session does not restore revoked memberships.

For permanent printouts, set **Settings → Public game URL**, e.g. `http://threshold.home.arpa:3000`. All join links and room QR codes use this origin even when admin uses localhost. Blank restores LAN IP detection. Optional `PUBLIC_URL` supplies the default. This setting generates links; it does not configure DNS.

1. Reserve the MacBook's Wi-Fi IP in your router's DHCP settings.
2. Add a local DNS record `threshold.home.arpa` pointing to that reserved MacBook IP.
3. If your router lacks local DNS, run AdGuard Home or Dnsmasq on the Home Assistant machine. Reserve its IP too and configure the router's DHCP DNS server to use it. The game hostname must point to the **MacBook**, where Threshold runs.
4. Test the exact public URL and QR codes on phones before printing. Keep the hostname, port and game unlock codes stable; preserve server data.

Being powered on 24/7 does not guarantee a fixed DHCP address. Home Assistant needs a configured DNS service; its web address does not automatically proxy Threshold. The Mac must remain awake with Threshold running. Phones must use the LAN DNS; custom DNS and VPNs can bypass it.

A simpler alternative is the Mac's local hostname, e.g. `http://threshold-mac.local:3000` (System Settings → General → Sharing → Local hostname). Test on all phones before printing because multicast DNS depends on the network. Existing QR codes containing numeric IPs cannot be changed through DNS: retain their original IP/port or reprint once. Marker codes work across sessions as long as the game's unlock codes stay unchanged.

References: [Apple local hostnames](https://support.apple.com/en-is/guide/mac-help/mchlp2322/mac), [Home Assistant LAN DNS setup](https://companion.home-assistant.io/docs/troubleshooting/networking/), [Home Assistant Dnsmasq](https://github.com/home-assistant/addons/blob/master/dnsmasq/DOCS.md).

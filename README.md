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

On a MacBook, run `pnpm dev`; it already listens on all network interfaces (`0.0.0.0`) on port 3000. Connect phones to the same Wi-Fi. Use the Network URL printed by Vite, for example `http://192.168.1.50:3000/`, on phones. Open `http://192.168.1.50:3000/secretadmin` on the Mac too, so **Copy join link** and its QR code use that reachable address. Opening admin through `localhost` creates links that phones cannot use. You can also find the Mac's IP address in System Settings → Wi-Fi → Details → TCP/IP.

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

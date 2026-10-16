# Threshold

A local-first home escape room baseline. TanStack Start + React + TypeScript, Tailwind, shadcn-style Radix UI components, and Drizzle ORM over SQLite through Node's built-in `node:sqlite`. The game master runs the server; players only need their phone browser.

## Run on your MacBook

Use Node **24 LTS** (Node 22.16+ is also supported), and pnpm. Drizzle's Node SQLite adapter and Drizzle Kit are pinned to `1.0.0-rc.4`; that adapter currently requires the release-candidate version.

```sh
pnpm install
pnpm run setup:env
pnpm dev
```

Open `http://localhost:3000` for the dashboard. Without ADMIN_KEY, the demo login key is `demo`; demo access is deliberately visible on the login screen. Connecting Home Assistant requires ADMIN_KEY; the demo key fallback is disabled when HA_URL is set. All device commands are simulated until HA_URL is configured. SQLite is created automatically at `data/threshold.sqlite`; keep that directory when moving the project. No cloud account is required.

For a built server:

```sh
pnpm build
node --env-file=.env .output/server/index.mjs
```

The `pnpm dev` and `pnpm start` scripts load `.env` explicitly with Node. Run from the project root so the same database is used. Use `HOST=0.0.0.0 PORT=3000 node --env-file=.env .output/server/index.mjs` if you need to override the production listener.

## Play the progression proof of concept

1. Sign in as game master. The seeded **The Signal House** session is open, or create another in Game sessions.
2. Open `/play` on each phone. Enter a name and select an open session. All players in a session share progress.
3. In Game sessions, choose Manage → Start / resume. Joining is only available while a session is open; reopen joining if a player arrives late, then resume.
4. Open Areas & access and print the study and observatory QR markers. The study marker unlocks the first chapter. The clue's answer is **RAVEN**, unlocking the archive. The observatory marker finishes the adventure.
5. Watch the dashboard refresh every three seconds. Pause blocks discoveries; manual unlock advances a stuck team. New sessions start at zero and do not affect existing sessions.

Players scan physical QR codes using their phone's camera app. No browser camera permission or camera API is needed, so plain HTTP on a trusted LAN works. Codes land at `/play?code=…`; the player confirms the discovery. If they have not joined yet, the code remains in the URL while joining. Scanning a later chapter early fails on the server. Codes are demo content, not cryptographic proof of being physically present.

## LAN and Tailscale

- Find your MacBook's Wi-Fi IP in System Settings → Wi-Fi → Details → TCP/IP, for example `192.168.1.50`.
- Open `http://192.168.1.50:3000` on the game-master browser **before generating QR codes**. Codes use the current browser origin; localhost codes will not work from a phone.
- Allow incoming connections for Node in the macOS firewall. Disable sleep during a game, keep the MacBook powered, and avoid guest Wi-Fi client isolation.
- With Tailscale, each phone needs access to the tailnet and the MacBook hostname/IP. Separately, the MacBook needs a route to Home Assistant, either directly or through a Tailscale subnet router. A phone reaching the app does not automatically make Home Assistant reachable from the MacBook.
- Treat this as a trusted-network baseline. Do not port-forward it onto the public internet. HTTPS via a trusted reverse proxy is appropriate for broader access. Tokens use HttpOnly, SameSite cookies; use a private browser for a separate player identity on the GM computer.

## Connect Home Assistant

Run `pnpm run setup:env` for guided setup. It explains each setting, generates a strong game master key by default, validates the URL and entity ID formats, and preserves other `.env` settings. Press Enter to keep an existing value or enter `-` to clear it. Leaving HA_URL empty enables demo mode. Changes are saved only after confirmation; existing secrets are not printed, but newly typed values are visible in your terminal. Find the generated login key in `.env`.

1. From the computer running Threshold, open your Home Assistant address (usually `http://homeassistant.local:8123`; use its LAN IP if that hostname does not resolve). Both machines must be reachable on the local network.
2. In Home Assistant, open your profile → Security → Long-lived access tokens → Create token. Name it Threshold and copy the token when shown. Use it as HA_TOKEN; your Home Assistant password is not the token.
3. In Developer tools → States, copy the entity IDs for your light, scene, and announcement script. Configure the devices, scene, or script in Home Assistant first. Each binding is optional; only configured controls can run. For several bulbs, use a Home Assistant light group.
4. Finish the wizard and restart Threshold. Sign in using ADMIN_KEY from `.env`, then test each configured dashboard control. These tests operate real devices.

The resulting `.env` looks like:

```dotenv
ADMIN_KEY=your-strong-game-master-key
HA_URL=http://homeassistant.local:8123
HA_TOKEN=your-long-lived-token
HA_LIGHT_ENTITY=light.study
HA_SCENE_ENTITY=scene.escape_room
HA_VOICE_SCRIPT=script.escape_room_announcement
```

Restart the app. Room lights call `light.turn_on` / `light.turn_off`; atmosphere calls `scene.turn_on`; the voice button calls `script.turn_on`. The app only sends these fixed service types and configured entity IDs. Tokens and entity configuration stay on the server. The dashboard's configured state means credentials exist, not that connectivity has been verified: click a control to test and inspect any returned error. Commands have an eight-second timeout, and successful requests are logged.

Set up Hue inside Home Assistant. For Alexa, expose a Home Assistant script/automation using your chosen Alexa integration. The exact announcement service depends on the integration installed in your HA instance; configure the announcement there and point HA_VOICE_SCRIPT at that script. This baseline triggers announcements; Alexa-to-app voice unlocks are an extension point, not implemented.

Reference: [Home Assistant REST API](https://developers.home-assistant.io/docs/api/rest/), [TanStack Start](https://tanstack.com/start/latest/docs/framework/react/build-from-scratch).

## Development

Database schema lives in `src/lib/schema.server.ts`; server queries use Drizzle's typed query builders. SQLite remains the persistent database. TanStack DB is a client-side reactive store and is not needed for this server-side ORM layer.

Migrations in `drizzle/` are applied automatically when the server starts. The initial migration adopts matching databases from the raw-SQL baseline without dropping tables or changing data; incompatible legacy schemas stop startup with an error. Back up `data/` before changing a real game's schema. Keep the `drizzle/` folder alongside the built app and run from the project root.

After editing the schema, generate and review a migration before applying it:

```sh
pnpm db:generate
pnpm db:migrate
```

Both scripts load `.env`; `DATABASE_PATH` optionally changes the SQLite path. `db:migrate` applies migrations without starting the server or seeding a game. Commit generated SQL and snapshots with the schema change. Avoid `drizzle-kit push` against a running game's database.

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm fmt
pnpm fmt:check
pnpm build
```

The design uses forest green, warm paper, sage accents, Manrope headings and DM Sans body text (Google Fonts, with local sans-serif fallbacks). Shared button, dialog, form and panel styles live in `src/components/ui.tsx` and `src/styles.css`. Cmd/Ctrl+K navigates pages; session rows and QR area cards have contextual actions. Lists are intentionally bounded (100 sessions / 60 recent events) for this small local baseline.

## Scope

The three-chapter content and device bindings are currently configured in code/environment variables. There is no puzzle authoring UI, timed expiry, multi-GM permissions, automatic device cues on unlock, or voice unlock endpoint yet. Sessions, player identities, GM tokens, and activity persist in SQLite. Player cookies last one day; leaving revokes the player credential and removes that player from the roster, while activity history remains. Switching games also revokes the previous player credential. Unlock codes are returned only to authenticated game masters; players receive discovered chapter descriptions and their next clue. API responses are not cached. Create a new session for each group. The database and Home Assistant credentials are local files and should be backed up and kept private.

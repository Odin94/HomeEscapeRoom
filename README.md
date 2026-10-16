# Threshold

A local-first home escape room baseline. TanStack Start + React + TypeScript, Tailwind, shadcn-style Radix UI components, and SQLite through Node's built-in `node:sqlite`. The game master runs the server; players only need their phone browser.

## Run on your MacBook

Use Node **24 LTS** (minimum 22.13), and pnpm.

```sh
pnpm install
cp .env.example .env
# Set a strong ADMIN_KEY in .env before inviting players.
pnpm dev
```

Open `http://localhost:3000` for the dashboard. Without ADMIN_KEY, the demo login key is `demo`; demo access is deliberately visible on the login screen. All device commands are simulated until HA_URL is configured. SQLite is created automatically at `data/threshold.sqlite`; keep that directory when moving the project. No cloud account is required.

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

Create a long-lived token in your Home Assistant profile and configure `.env`:

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

The three-chapter content and device bindings are currently configured in code/environment variables. There is no puzzle authoring UI, timed expiry, multi-GM permissions, automatic device cues on unlock, or voice unlock endpoint yet. Sessions, player identities, GM tokens, and activity persist in SQLite. Player cookies last one day; leaving the view clears the browser cookie but retains the player record for the GM's roster. Create a new session for each group. The database and Home Assistant credentials are local files and should be backed up and kept private.

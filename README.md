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

**Games** lets admins create or edit validated JSON definitions. Save writes `games/<id>.json`; commit these files to track room changes. The editor supports any number of areas (up to 30) and named light, scene or script controls (up to 50). Each area has an unlock code, narrative content, challenge type and a `playerView` reference. `narrative` is the currently implemented view; unknown references are rejected, and definitions cannot contain executable page code. Schemas live in `src/lib/game.server.ts`. Invalid files fail validation on load and invalid UI edits are rejected before writing.

Entity mappings are game-specific, never read from HA_LIGHT_ENTITY, HA_SCENE_ENTITY or HA_VOICE_SCRIPT. These legacy wizard settings no longer affect play. Configure `controls[].entity` in the game definition instead. The old optional `setup:env` wizard remains available for connection bootstrap; prefer the UI for ongoing configuration.

Create a session by choosing a game and entering a session name. Each session saves a validated copy of that game's definition in SQLite, including answers and controls. Subsequent game edits affect future sessions only. Existing legacy sessions acquire a snapshot at the first startup after migration. Open joining, then start/resume once everyone has joined. Pause blocks discoveries; End closes the session. Players share progression within a session. Admin controls target that session's game entities.

The supplied Signal House game uses QR → RAVEN → QR. Under Games, show/print markers using a network-reachable browser address, e.g. `http://192.168.1.50:3000/secretadmin`. QR links use `/?code=…`; the code survives joining. `/play` redirects to the root and preserves QR queries; old admin URLs redirect to `/secretadmin`.

## Networking and devices

On a MacBook, run `pnpm dev`; it already listens on all network interfaces (`0.0.0.0`) on port 3000. Connect phones to the same Wi-Fi. Use the Network URL printed by Vite, for example `http://192.168.1.50:3000/`, on phones. Join links, the join-page shortcut and room QR markers automatically use a private LAN IPv4 address detected on the server, even when admin is opened through `localhost`. An existing LAN address in the browser is preferred; otherwise Wi-Fi is preferred over other interfaces. Sharing is disabled when no LAN address is available. You can also find the Mac's IP address in System Settings → Wi-Fi → Details → TCP/IP.

If macOS asks, allow Node to accept incoming connections. If necessary, allow it in System Settings → Network → Firewall → Options. Keep the Mac awake and avoid guest networks or Wi-Fi client isolation. No router port forwarding is needed for devices on the same LAN.

Host the server on your LAN, allow Node through the firewall, disable sleep and avoid guest Wi-Fi isolation. Tailscale also works if phones can reach the server and the server can reach Home Assistant. Use on a trusted network; `/secretadmin` is an address, not the authentication boundary. Cookies authenticate admin requests and all writes check Origin.

Home Assistant controls send server-side REST commands with an eight-second timeout. Light entities support on/off; scenes and scripts support turn_on. Add Hue and announcement integrations in Home Assistant first. Configured does not mean connectivity is verified; use a session control and check the result. Secrets and undiscovered content are withheld from unauthenticated API responses. Game JSON contains puzzle answers and belongs in an appropriately private repository.

For dynamic Alexa speech, finish the **Alexa Devices** integration in Home Assistant and save its URL and long-lived access token in Threshold's **Settings**. Open a session's controls, select **Find speakers**, choose a Speak or Announce entity, type a message (up to 1,000 characters), and select **Say it**. No predefined Home Assistant script is needed. Speak reads the message; Announce adds a chime. Discovery lists notification entities whose IDs end in `_speak` or `_announce`; unavailable speakers cannot be selected. Refresh speakers after changing the connection or device setup. Announcements require a real Home Assistant connection and game master access; the success notification confirms Home Assistant accepted the request, not that audio playback was verified. The existing script-based announcement control remains available.

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

Player identity uses an HttpOnly cookie lasting up to one year; shared progress remains in SQLite. Zustand manages current API state in memory without localStorage persistence. Reopening fetches current membership and progress from the server. Use the same browser and origin; clearing cookies, private browsing or changing hostnames loses that browser identity. The old `threshold-player` localStorage cache is removed when the app opens.

Connected pages poll every three seconds and refresh on window focus. End revokes the session's player credentials and returns players to joining on the next successful refresh. Closed browsers reconcile when reopened. Joining another session replaces the previous membership. Reopening an ended session does not restore revoked memberships.

For permanent printouts, set **Settings → Public game URL**, e.g. `http://threshold.home.arpa:3000`. All join links and room QR codes use this origin even when admin uses localhost. Blank restores LAN IP detection. Optional `PUBLIC_URL` supplies the default. This setting generates links; it does not configure DNS.

### 1. Find the router and reserve the MacBook address

Examples below use router `192.168.1.1`, MacBook `192.168.1.50`, and Home Assistant `192.168.1.20`. Substitute addresses from your own network. Router menu names vary by manufacturer.

1. Connect the MacBook to the game Wi-Fi. Open **System Settings → Wi-Fi → Details → TCP/IP** and note its IPv4 address and **Router** address.
2. Open the router address in a browser and sign in with its administrator credentials. These may differ from the Wi-Fi password; check its label or your provider's router instructions.
3. Find **LAN / Home network → DHCP / Address reservations**, sometimes called **Static leases**, **DHCP binding**, or **Always assign the same IPv4 address**. Select the MacBook from connected devices and reserve its current address, or another unused address allowed by the router's reservation UI. Leave the Mac configured to obtain its address through DHCP.
4. Reservations identify the network adapter by its MAC address. If using a private Wi-Fi address, keep it stable for this home network (choose **Fixed** rather than **Rotating**, where available). Ethernet has a separate adapter; reserve that instead if you will host over Ethernet.
5. Save/apply, reconnect Wi-Fi or renew the DHCP lease if needed, and confirm the Mac has its reserved address. Run `pnpm dev` and open `http://<reserved-Mac-IP>:3000/` on a phone on the same Wi-Fi. Get this working before configuring DNS.

### 2. Create a hostname in your router

Look for **Local DNS**, **DNS records**, **Host overrides**, or **DNS host mapping**. Add an **A record**:

| Field        | Example value                            |
| ------------ | ---------------------------------------- |
| Hostname     | `threshold.home.arpa`                    |
| IPv4 address | `192.168.1.50` (the reserved MacBook IP) |

DNS records contain no protocol, port or path. If the UI separates host and domain, enter `threshold` and `home.arpa`. Save/apply. Some routers support only their own suffix; use the full hostname your router supports instead. A DHCP device label alone does not guarantee a DNS record.

Check **LAN → DHCP → DNS server**: clients should use the router's own address when it provides local DNS. The **WAN / Internet upstream DNS** setting is a different setting and may not configure clients. Reconnect phones to Wi-Fi to pick up changes. If the router lacks local DNS records, use the Home Assistant option below; otherwise go to step 3.

### Optional: use Home Assistant as the DNS server

Being powered on 24/7 does not guarantee a fixed DHCP IP. Home Assistant needs an IP reservation and an installed DNS service. Its usual web address does not automatically proxy Threshold.

On a Home Assistant installation supporting apps/add-ons, install **AdGuard Home** from the app/add-on store (the community repository may need to be enabled). The AdGuard integration alone does not install the DNS server. Dnsmasq is another option; its configuration reference is linked below.

1. Reserve Home Assistant's IP in the router, just as for the MacBook.
2. Start AdGuard Home, enable starting on boot and open its web UI. Follow its setup instructions to listen for DNS on the Home Assistant LAN address, port 53; resolve any port conflict before continuing.
3. Find **DNS rewrites**, usually under **Filters** depending on version. Add `threshold.home.arpa` pointing to the reserved **MacBook IP**. Home Assistant provides DNS; the MacBook runs the game.
4. From the Mac, test `nslookup threshold.home.arpa 192.168.1.20`, using your Home Assistant IP. The answer must contain the MacBook IP. Also test `nslookup example.com 192.168.1.20` to confirm ordinary names resolve before switching clients.
5. Record the router's previous DNS settings. In **LAN → DHCP → DNS server**, advertise the Home Assistant IP. Leave the gateway and DHCP server unchanged; do not enable another DHCP server in AdGuard. Avoid a public DNS server as secondary because clients may use it and fail to resolve the game hostname. If your router requires its own DNS proxy, configure its upstream to Home Assistant instead, ensuring AdGuard does not forward back to the router in a loop.
6. Reconnect phones to Wi-Fi to renew their DNS settings. If the router cannot advertise a DNS server, manually configure each game phone's Wi-Fi DNS to use the Home Assistant IP. On iOS use **Configure DNS → Manual**; Android network settings vary and may require manual network configuration. Android's **Private DNS provider hostname** field is not a field for a LAN IP.

Home Assistant must stay available for DNS lookups. Restore the previous router DNS settings and reconnect clients to undo this configuration. VPNs, custom DNS and browser secure-DNS settings may bypass LAN DNS; check these when a phone cannot resolve the local hostname.

### 3. Test the URL, save it and print

1. On the Mac, run `nslookup threshold.home.arpa`. Check the **answer address**, not just the DNS server address: it must be the MacBook IP. If an explicit query to Home Assistant worked but this query fails, the client is using the wrong DNS server; check its DNS settings or reconnect.
2. On every game phone, open `http://threshold.home.arpa:3000/` with the explicit protocol and port. If the numeric IP works but the hostname does not, investigate DNS. If neither works, check the running server, Mac sleep, firewall and Wi-Fi client isolation. No Internet port forwarding is needed.
3. Sign in at `/secretadmin`, open **Settings**, enter that exact origin in **Public game URL**, then save. Generate a join QR and room markers under **Games**. Scan with the phone's regular camera/browser, join a test session, start it and unlock an area. Close the tab and reopen the same URL to verify progress returns.
4. End the test session and verify the phone returns to joining after refresh. When convenient, restart the Mac/router and repeat hostname access to confirm reservations and DNS survived. Then print.

Keep the hostname, port and game unlock codes stable; preserve `data/`. Use this hostname consistently on phones: cookies for a numeric IP or another hostname do not transfer. If hosting later moves, update DNS to the new host's reserved IP and move server data; printed hostname links can remain unchanged. When using `pnpm start`, keep port 3000 (set `PORT=3000` if needed).

Existing QR codes containing numeric IPs cannot be changed by adding DNS. Preserve their original IP/port or reprint once with the hostname. Marker links work across sessions as long as game unlock codes stay unchanged.

A simpler alternative is the Mac's local hostname, e.g. `http://threshold-mac.local:3000` (System Settings → General → Sharing → Local hostname). Test on every phone before printing because multicast DNS depends on the network.

References: [Apple local hostnames](https://support.apple.com/en-is/guide/mac-help/mchlp2322/mac), [Home Assistant LAN DNS setup](https://companion.home-assistant.io/docs/troubleshooting/networking/), [Home Assistant Dnsmasq](https://github.com/home-assistant/addons/blob/master/dnsmasq/DOCS.md).

### Creating games and challenge rules

In `/secretadmin`, open **Games**, then **New game** or **Edit definition**.
The form configures ordered challenges and Home Assistant controls. Save writes
`games/<id>.json`; commit these files to keep definitions in Git. Saving an existing
ID replaces that definition. Sessions retain their original snapshots.
`games/tutorial-challenges.json` demonstrates every supported challenge.

- Games contain 1–30 challenges with unique lowercase slug IDs and names of 1–80 characters. Unknown fields and challenge types are rejected.
- Text answers ignore case and surrounding whitespace.
- Number answers contain only digits and preserve leading zeroes.
- Color and symbol challenges offer 2–12 unique choices and require an ordered answer of 2–20 choices separated by `|`. Repetitions are allowed. Choices cannot contain `|`; colors use six-digit hex values such as `#ff0000`.
- QR challenges use an exact, case-sensitive token. `qrMode: "prompted"` offers a camera/photo input in the app, decoded locally; players can also open the printed link with their phone camera. `qrMode: "hidden"` shows no scanner or hint: players discover and scan the physical marker externally, then confirm Unlock. Omitted QR mode retains legacy hidden behavior. Generate printable markers with **Show QR** in admin.
- Hints are limited to 1,000 characters, revealed story text to 10,000, and answers to 256. Hidden QR challenges cannot have hints. Answers never appear in player API responses.
- **Show QR** includes optional Markdown text above and below the marker, with a live preview. **Print marker** prints only that content and the QR code, with no default labels. The print layout suppresses browser headers and footers; if your browser still adds a date, title or URL, turn off **Headers and footers** in its print dialog. Marker text is a temporary print draft and resets when you close it or show another marker.
- Up to 50 Home Assistant controls may be configured, with unique slug IDs and `light.*`, `scene.*`, or `script.*` entity IDs.

## Automated QR → lights → colors → Alexa game

Open **Games → The Color Riddle → Edit definition** for a ready-to-configure example.
Set the scene control to your real Home Assistant scene and the speech entity to
an available Alexa Devices `notify.*_speak` or `notify.*_announce` entity. Create a
Home Assistant scene that turns on all four lamps: red, blue, green, yellow from
left to right (or change the answer and choices to match your scene).

The game creator now supports:

- **Start on first join and allow joining while running**: a session-specific join QR asks only for a name. Other games retain the host-controlled start.
- **When solved** actions on every challenge: activate a named scene/script/light control or speak a message on an Alexa notification entity. Actions execute in list order, up to ten per challenge. Use scripts for more complex lighting sequences.
- **Alexa / external answer** challenges: phones display a waiting state; only an authenticated integration callback or GM override can solve them. Answers ignore case and surrounding whitespace.
- **Story revealed after solving**: use this for the success message after the voice answer. Every connected phone sees shared progress on its next refresh.

Save the definition, create a **new session**, then share its QR under Sessions.
Existing sessions keep their original game snapshots. Scan the physical marker
from **Games → Show QR** to generate its printable URL. Room markers now submit
automatically when the session is running; QR photo decoding in the app also
submits without an extra Unlock tap. A wrong scan reports an error; scan again
to retry. Hidden QR challenges still do not display a scanner or hint.

### Wire Alexa's answer back to the session

Alexa Devices provides speech output; it does not automatically deliver spoken
answers to this app. Set up the return path once per session:

1. Under **Sessions → Automation / Alexa callback → Show callback configuration**, choose the external challenge. This shows its exact callback URL, bearer token, JSON body and a Home Assistant YAML example for that session snapshot.
2. Merge the YAML example into Home Assistant (do not overwrite existing sections). It defines a toggle helper, an authenticated REST command and an automation which resets the helper and submits the answer. Set the callback URL to an address reachable **from Home Assistant**, using Settings → Public game URL if necessary.
3. Expose `input_boolean.threshold_answer` through your Home Assistant Alexa Smart Home connection (Home Assistant Cloud or your configured Smart Home skill). Discover it in Alexa. This inbound connection is separate from the Alexa Devices speech integration.
4. In the Alexa app create a routine with the voice phrase **the answer is five**, and a Smart Home action that turns the Threshold answer helper **on**. Players say **Alexa, the answer is five**. Alexa availability and phrase handling depend on your account/language; rehearse on the actual Echo. This fixed-answer routine sends the configured answer; it is not general speech transcription.
5. For another answer or simultaneous session, use another routine/helper/REST command, with the matching session token, challenge ID and answer. Never route one voice phrase to multiple active teams sharing the same speaker.

The callback is `POST /api/callback`, authenticated by `Authorization: Bearer <session-token>`;
its body contains `sessionId`, `challengeId`, and `answer`. It deliberately accepts
server-to-server requests without the browser Origin requirement. Tokens are
random, session scoped, stable across restarts and shown only to authenticated
GMs. Keep them private. Closed/paused sessions, wrong stages, wrong answers,
wrong tokens and replayed completion callbacks cannot advance play. Phone answer
submission cannot bypass an external challenge.

Progress and pending actions are persisted together. Concurrent player scans
cannot run the same stage action twice. If Home Assistant fails, the challenge
remains solved, but new answers wait until the GM uses **Retry failed actions**.
Completed actions are not repeated. A server restart marks interrupted actions
as failed for explicit recovery. Check the device first: a timeout/crash can
occur after Home Assistant accepted a request, so retrying speech may repeat it.
Resume a paused session before retrying actions. Automatic actions require a
real connection and fail visibly when it is absent; they do not silently simulate
physical effects. A successful request confirms acceptance, not light/audio
verification.

Before inviting players, rehearse with two phones: name-only joining, the clue,
QR scene activation, the ordered colors, audible riddle, voice routine and success
message. Also pause the session and confirm the voice routine cannot advance it.
No game actions or integration credentials are included in player responses.

References: [Alexa Smart Home integration and supported helpers](https://www.home-assistant.io/integrations/alexa.smart_home/), [toggle helpers](https://www.home-assistant.io/integrations/input_boolean/), [Alexa Devices speech](https://www.home-assistant.io/integrations/alexa_devices/).

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

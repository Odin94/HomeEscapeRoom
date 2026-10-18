# Local voice operation

## HTTPS foundation

Use a stable local DNS record `threshold.home.arpa` pointing at the Mac's reserved
LAN address. Configure this record in your router's local DNS (or your LAN DNS
resolver). Both phones and the Mac must use that resolver. No port forwarding or
public tunnel is required. If the router cannot host local DNS, use an owned
domain with DNS certificate issuance and a local DNS override instead.

Install Caddy on the Mac and run `caddy run --config ops/Caddyfile`. Set Threshold's
Public game URL in GM Settings to `https://threshold.home.arpa`. Caddy must be the
only LAN entry point for voice play. Run Threshold bound to loopback behind it
(`NITRO_HOST=127.0.0.1 pnpm start` for production). Allow inbound HTTPS to Caddy in
the macOS firewall, never Whisper. Forwarded headers are not used as authority:
the configured public origin is the exact allowed write Origin. Existing direct
HTTP clients must rejoin using HTTPS. Reprint join and marker QR codes after the
origin changes; cookies do not migrate between origins.

Caddy creates a local CA in its application data directory. Locate the public
`pki/authorities/local/root.crt` using `caddy environ` to find its data directory.
Transfer only that public certificate to phones over a trusted channel; never
transfer the CA private key. On iOS install it via Settings → General → VPN &
Device Management, then enable full trust under General → About → Certificate
Trust Settings. On Android install the CA under Settings → Security → Encryption
& credentials → Install a certificate → CA certificate (wording varies by phone).
On the Mac trust this CA in Keychain Access, or use `caddy trust`. Verify the
certificate fingerprint before trusting. Some managed Android devices forbid
user CAs; use the owned-domain approach there.

Visit the HTTPS URL without a warning on each phone and confirm the browser's
microphone permission prompt appears. A warning bypass does not pass setup.
Keep Caddy's data directory across restarts: Caddy renews leaf certificates while
running. If trust breaks, check DNS, the Mac clock, certificate expiry, and that
the CA has not been replaced. Restore its protected backup or reinstall the new
public CA deliberately. Keep CA private keys out of game backups. Test reopening
the same HTTPS origin retains membership before admitting players.

## Rehearsal status

Implementation host observed on 2026-10-18: Apple M5 MacBook Air, 24 GB RAM,
macOS 27.0.1. Team count and languages are operator choices; start with one team
and multilingual Whisper base for English/German. No latency or physical-device
results have been measured yet. Phone trust, microphone capture, Bluetooth,
concurrent teams, quiet/digit/name answers, room noise, offline operation and
restart recovery require actual hardware rehearsal. Do not infer these results
from automated tests.

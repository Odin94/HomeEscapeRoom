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
and multilingual Whisper base for English/German. Local synthetic-audio timings are recorded below; physical-device
results have not been measured. Phone trust, microphone capture, Bluetooth,
concurrent teams, quiet/digit/name answers, room noise, offline operation and
restart recovery require actual hardware rehearsal. Do not infer these results
from automated tests.

## Pinned runtime setup

This implementation uses whisper.cpp **v1.8.3** (MIT), Silero **v6.0** ONNX
(MIT), ONNX Runtime **1.31.0** (MIT), NumPy **2.5.4** (BSD), and Piper
**1.8.0** (GPL-3.0). Piper publishes an Apple Silicon macOS wheel. The selected
English `en_US-ljspeech-high` voice's model card identifies its source dataset as
public domain. Read its model card and upstream licenses before redistribution;
no runtime binaries or voice weights are included in this repository. The
German transcription option uses multilingual Whisper; this starter TTS voice
speaks English. Install and license-review a German voice separately and change
`VOICE_PIPER_MODEL` to its absolute installed path for German output.

The pinned whisper.cpp server supports integrated Silero trimming but its public
HTTP response does not provide a standalone pre-inference speech/no-speech
contract. This implementation therefore uses the plan's ONNX fallback: a fresh
Silero state/context per recording, then calls Whisper only for detected speech.
It keeps the interval between the first and last positive frame with 250 ms
padding, retaining intervening pauses. One positive 32 ms frame is enough to
retain a short answer. Tune this deliberately during rehearsal; music and nearby
conversation can still be classified as speech.

Install Apple command line build tools and Homebrew, then:

```sh
brew install cmake ffmpeg python@3.14 caddy
/opt/homebrew/bin/python3.14 -m venv data/voice/venv
data/voice/venv/bin/python -m pip install -r scripts/voice-requirements.txt
python3 scripts/download-voice-models.py data/voice/models
git clone --branch v1.8.3 --depth 1 https://github.com/ggml-org/whisper.cpp.git data/voice/whisper.cpp
cmake -S data/voice/whisper.cpp -B data/voice/whisper.cpp/build -DWHISPER_BUILD_SERVER=ON
cmake --build data/voice/whisper.cpp/build --config Release -j 4
```

On Intel Macs use the matching Homebrew prefix instead of `/opt/homebrew`.
The downloader verifies pinned SHA-256 values for all models/configuration and
the voice card. It can be rerun safely; it never changes pnpm's release-age policy.
Allow roughly 1 GB free space for initial models, Python wheels and build output;
measure actual disk and peak memory use before choosing larger models. There
are no background downloads during gameplay.

The default paths use the `data/voice/` installation above. To customize them,
set the absolute paths shown in `.env.example`, source the trusted `.env` in your
shell (`set -a; . ./.env; set +a`), and run `scripts/start-local-voice.sh` in a
terminal. Whisper listens only on `127.0.0.1:8178`. Run Caddy in another terminal,
then `pnpm build` and `NITRO_HOST=127.0.0.1 pnpm start` in a third. Set a strong GM
key before LAN use. Start `caffeinate -i` during a game. Ctrl-C each process after
play; restart all three after reboot. Piper and Silero workers are started on
demand and killed on cancellation/timeout. Keep the repository working directory
as the server's working directory so worker paths resolve.

The worker runs locally with CPU ONNX inference. Models are process-isolated and
reload on each request; warm latency is a measurement target, not guaranteed.
Whisper stays loaded separately. Initial limits are one engine job at a time,
no waiting queue (busy requests get a retry message), one attempt per player
per three seconds, 5 MB uploaded, 15 seconds decoded mono 16 kHz PCM, 10 seconds
upload and 25 seconds inference deadline. FFmpeg inspects the actual container;
WebM/Opus, MP4/AAC, Ogg and WAV are accepted MIME families. Malformed data fails
closed. Temporary files are deleted after work; abandoned temporary directories
older than one day are cleaned on server startup. No transcript/audio is logged.
Generated audio is returned directly with no persistent cache.

## GM and player rehearsal

Enable local voice in GM Settings, select English or German transcription and
choose phone or room output. Create a short test game with a text challenge,
join it on a phone using the final HTTPS origin, start it, and try Talk → Stop →
review/edit → normal Submit. Numbers and external-answer challenges retain their
existing input rules. Try permission denial, Cancel, navigation, backgrounding,
pause and an answer completed by a teammate while transcription is running.
Typed answers must remain usable after every failure.

Use Check local runtimes in GM Settings to verify decoder, Silero/Piper models
and Whisper health. A successful check is not an audio-output or phone test.

Use Listen for already visible hints, completed story passages and revealed
markdown clues. Listen never accepts arbitrary player text. On phones, pair the
Bluetooth speaker with the phone and select it in the operating system. Listen
is a user action; if the browser blocks playback, tap again. Stop speech ends
playback and Listen intentionally replays it.

For room mode pair the speaker with the Mac. On its GM Settings page select the
running session and Enable room player. Keep the page foreground and select the
macOS audio output. The page polls serially, claims a 20-second lease, and plays
announcements one at a time; other phones stay quiet. Use Listen test to queue a
sample. Mute and Stop clear the queue. Queue inspection shows pending/claimed
counts. There are at most ten entries per session, expiring after 60 seconds.
Pause/end clears the queue; server restart discards it. Claimed events are never
automatically replayed after a crash, lost response, failed synthesis or autoplay
failure. Intentionally press Listen again to replay a visible passage. A second
device must wait for the first lease to expire. Disable/background the old player
before switching. Browser background audio and screen-lock playback are not
promised. If a browser blocks polling-triggered playback, keep its audio control
visible, interact with it and enable playback again.

Before a real game, rehearse on iPhone Safari and Android Chrome with a phone
speaker, phone-paired Bluetooth and Mac-paired Bluetooth. Measure cold/warm
transcription, synthesis and total latency, actual disk and memory, one-word
English/German answers, names, leading digits, quiet speech, silence, room noise,
music, natural pauses and two simultaneous teams. Repeat with internet disabled
after installation. Record false/missed VAD detections and clipped syllables;
no-speech must bypass Whisper. These checks remain pending until performed with
the actual game equipment. Do not enable continuous listening or automatic
submission based on VAD.

For failures check HTTPS trust and DNS first, then Whisper's loopback service,
absolute model paths, Python packages and FFmpeg. Missing/broken engines return
short errors and leave typed play available. After upgrades repeat offline and
Bluetooth rehearsals. Back up game/settings/database files using existing
procedures, separately protect CA private keys, and redownload verified models
rather than including recordings or runtime folders in normal backups.

## Upstream sources

- [Pinned Whisper server interface](https://github.com/ggml-org/whisper.cpp/blob/v1.8.3/examples/server/README.md)
- [Pinned Silero ONNX state and context format](https://github.com/snakers4/silero-vad/blob/v6.0/src/silero_vad/utils_vad.py)
- [Piper release and license](https://github.com/OHF-Voice/piper1-gpl/tree/v1.8.0)
- [Selected voice model card](https://huggingface.co/rhasspy/piper-voices/blob/c10ece1aade47bb51c153c893d14e5bf8e5b7117/en/en_US/ljspeech/high/MODEL_CARD)

## Local runtime evidence (2026-10-18)

Installed and ran the exact Python pins and verified model checksums on the M5
host above. Built whisper.cpp v1.8.3 locally with CMake and Metal. Runtime health
checks passed for FFmpeg, Silero/Piper and Whisper. The actual server rejects
`--no-context`; the launcher uses `--max-context 0` (its per-request
`no_context` default is already true).

Piper model load: 0.627 s. In-process synthesis of “red”, “zero one zero”, and
“The door is now open.”: 0.132, 0.188, and 0.187 s. Silero model load: 0.013 s;
one-second zero PCM classified as no speech in 0.002 s. Full bounded worker TTS,
including Python startup and model loading: 0.889 s. Full decode/resample → fresh
Silero → loaded Whisper processing of those synthetic English recordings:
0.432, 0.159, and 0.162 s. These are single runs, not percentiles or guarantees.

The one-word “red” sample transcribed incorrectly as “Brent.”; “zero one zero”
became “010.”; the sentence transcribed correctly. This confirms the need for
review/edit and explains why number-answer mapping is not enabled. A real
one-second silent WAV through the complete adapter returned “No speech detected”
before Whisper. Three Python detector tests passed for brief speech, padded
bounds, preserved pauses, fresh recording state and detector failure, in addition
to the TypeScript API/resource tests. Run the Python tests after runtime setup:

```sh
data/voice/venv/bin/python tests/voice-worker.test.py
```

Microphone recordings, German accuracy, cold Whisper startup, multi-team load,
battery/CPU, peak RAM, actual Bluetooth output, trusted phone HTTPS and full
offline rehearsal remain unmeasured. Generated synthetic fixtures stay in ignored
`artifacts/`; installed runtimes and models stay under ignored `data/voice/`.

Generated MP4/AAC and WebM/Opus encodings of the synthetic sentence also decoded,
passed VAD and transcribed correctly through the full adapter with default local
paths. This validates the server codec path, not actual Safari/Chrome capture.
The GM health UI was inspected locally and reported all three runtime checks
ready. Local tests leave voice disabled by default; enable it after HTTPS setup.

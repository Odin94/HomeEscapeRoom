# Local phone voice integration

Created: 2026-10-18. Status: implementation plan; no voice functionality has been implemented by this document.

## Goal

Players speak into the escape room page on their phones. The MacBook running Threshold transcribes their recordings, the existing game server validates their answers, and spoken feedback plays through a phone or one shared Bluetooth speaker. After initial installation and model downloads, the intended default works without a cloud speech provider.

Start with push-to-talk and short answers. Keep typed answers available. Continuous listening, wake words, conversational AI, voice cloning, and replacing the Alexa integration are outside the first release.

## Architecture and decisions

- Use `whisper.cpp` as a separate local transcription service, bound to loopback. OpenWhispr is a desktop dictation app; integrating the underlying speech engine provides a clearer server interface for recordings from several phones.
- Use Piper as a separate local text-to-speech service. Generate audio on the MacBook and deliver it through authenticated game endpoints. Verify the selected Piper release, macOS support, package license, and individual voice model license before adopting it. Browser speech synthesis can be an optional fallback, with device-dependent voices and offline availability.
- Phones communicate only with Threshold over HTTPS. Threshold authenticates requests and calls the speech services over loopback. Never expose speech engines directly to the LAN or place their configuration in player payloads.
- Transcription produces a candidate answer, never a decision about correctness. Route confirmed text through the existing player answer validation in `src/lib/db.server.ts`.
- Keep current server/database session authority and HttpOnly membership cookies. Zustand holds transient recording/playback UI state; do not add persistent player identity or progress to localStorage.
- Default playback is on the requesting phone. A Bluetooth speaker paired with that phone receives its audio through the operating system's output routing.
- For a shared room speaker, pair it with the MacBook and open one dedicated GM-authorized room playback page there. That page plays server-generated audio through the selected macOS output. The backend generating audio does not itself make the MacBook speak.

```text
Phone microphone -> HTTPS Threshold endpoint -> local Whisper -> candidate text
Candidate text -> player confirmation -> existing answer validation
Authorized feedback -> local Piper -> audio -> phone OR designated room player
```

## Phase 1: prove the MacBook and phone path

1. Record the MacBook chip, RAM, macOS version, expected simultaneous teams, and target languages. Choose a multilingual Whisper model if German is needed; English-only models are unsuitable for that path.
2. Install pinned compatible speech runtimes and download explicitly selected models outside Git. Follow the repository's pnpm minimum release age policy for any JavaScript dependencies; choose an older eligible release if necessary.
3. Benchmark short English/German puzzle answers, names, digits, silence, and background music on the actual MacBook. Measure cold start, warm transcription, synthesis, and concurrent requests while the game runs. Aim initially for a warm transcript within three seconds after recording stops; treat this as a target to measure, not a promise.
4. Test Piper output and model pronunciation. If the selected runtime cannot run reliably on this Mac, resolve the runtime choice before implementing its adapter.
5. Prove microphone capture and generated audio playback on actual iPhone Safari and Android Chrome, including a paired Bluetooth speaker.

Deliverable: documented working runtime/model versions, hardware, language choice, measured latency, and a confirmed HTTPS approach. Commit the integration design and setup notes as one finished step.

## Phase 2: HTTPS and sharing

Microphone capture requires a secure browser context. The current README's plain HTTP LAN address is sufficient for ordinary play but insufficient for phone microphone capture. `localhost` exemptions on the Mac do not apply to a phone visiting the Mac's LAN IP.

- Prefer a stable LAN hostname behind an HTTPS reverse proxy. Choose between a local certificate authority trusted on each game phone, or an owned domain with DNS-based certificate issuance and local DNS pointing at the Mac. The latter can keep game traffic local without router port forwarding; certificate renewal still needs connectivity.
- Write exact Mac, iOS, and Android trust/DNS instructions for the chosen approach, plus certificate renewal and recovery instructions. A certificate warning bypass is not a successful setup.
- A public tunnel is optional and requires a separate explicit decision about external exposure. Do not make publishing private game content a prerequisite for local voice.
- Audit `publicUrl`, LAN origin detection, join links, room QR markers, callback URLs, Origin checks, and proxy forwarding behavior. Preserve strict same-origin validation; trust forwarded headers only from the configured proxy.
- Explain that switching origins can require players to rejoin and existing QR codes may need reprinting. Do not silently migrate identities or clear saved state.

Acceptance: a real phone opens the shared HTTPS URL without warnings, reports a secure context, records after granting permission, and retains membership after reopening the same origin.

## Phase 3: speech backend

Add focused server-only adapters, for example `src/lib/transcription.server.ts` and `src/lib/voice-output.server.ts`. Keep existing Home Assistant speech behavior in `src/lib/speech.server.ts` intact.

- Add GM settings for enabling voice, language/model selection from installed options, output mode, and connection checks. Preserve existing settings and drafts; return only safe availability flags to players.
- Add authenticated recording upload and audio retrieval endpoints using the existing API/auth conventions. Check player membership, session status, and challenge eligibility before accepting work. Enforce Origin checks on writes and prevent cross-session audio access.
- Bound recording duration (initially 15 seconds), upload bytes (initially 5 MB), decoded duration, inference time, queue length, per-player rate, and concurrent engine work. Return useful busy/timeout errors. Tune limits using Phase 1 measurements.
- Negotiate recording formats on the client. Accept supported Safari/Chrome audio types, inspect/decode server-side, and convert to the format the pinned Whisper server accepts. Do not trust filename extensions or invoke a shell with user-controlled arguments.
- Use request cancellation and bounded subprocess/runtime behavior. Reject unsupported, malformed, overlong, silent, or empty recordings. Detectable silence should not produce a guess that gets submitted automatically.
- Keep uploads and generated audio temporary. Delete recordings after inference or failure, clean abandoned files on startup, and avoid logging raw audio or answer transcripts by default. Cache only authorized reusable TTS audio with bounded storage and session-scoped access.
- Use fixed administrator-controlled local service addresses; players cannot supply URLs, model paths, output paths, or arbitrary text for shared-room announcements.
- Check membership, session state, and challenge identity again at answer submission. A delayed transcript must never submit into a different challenge after shared progress advances.

Acceptance: engine failures leave typed play usable; unauthorized uploads and cross-session reads fail; resource limits prevent unbounded work; stale recordings cannot advance play.

## Phase 4: player speech input

Implement in the player experience under `src/components/app.tsx` or extracted components, after confirming the existing route/component boundaries.

- Add a large Talk control for eligible text-answer challenges. First use explains microphone access briefly. Use explicit tap-to-start/tap-to-stop, cancellation, and automatic stop at the duration limit.
- Show recording, transcribing, and review states. Stop microphone tracks on completion, cancellation, unmount, navigation, and relevant page lifecycle changes.
- Put the transcript in the existing answer field so the player can edit and submit it. Start with explicit confirmation; automatic submission can be evaluated later using real play evidence.
- Retain typed input when permission is denied, HTTPS is missing, recording is unsupported, or a speech service is unavailable. Provide short actionable messages without blocking the challenge.
- Support text answers first. Add number answers only after defining and testing how spoken numbers map to digit strings, especially leading zeroes. Do not apply fuzzy matching or alter existing answer rules globally.
- Do not turn Alexa/external-answer challenges into player-submittable challenges. Any future dedicated voice challenge type must explicitly define its allowed answer sources and session snapshot behavior.
- Pause recording while game speech plays to reduce feedback loops. Provide accessible labels, keyboard interaction, and visible focus without extra decorative UI.

Acceptance: players can speak, correct, and submit an answer using the normal rules; denying access and cancelling never leave the microphone active or block typed play.

## Phase 5: spoken feedback and room playback

- Start with explicit Listen controls for already-visible story/hint text and feedback after a confirmed answer. Do not synthesize undiscovered clues, hidden answers, GM-only text, or future story content into player-accessible audio.
- Require an initial user interaction to enable audio and expose stop/replay controls. Handle browser autoplay rejection, backgrounding, screen lock, and reconnects without claiming guaranteed background playback.
- Treat output destination as an explicit choice: requesting phone or designated room player. Do not make every connected phone announce shared events by default.
- For room mode, authorize one active playback device per configured room/session and queue messages serially. Use event IDs, a device lease, expiry, and acknowledgements to avoid duplicate delivery during normal polling/reconnects. Define at-most-once replay behavior across crashes; uncertain playback must not automatically repeat old announcements.
- Allow GM test, mute, stop, queue inspection, and intentional replay. Scope queue entries to the correct session and discard stale entries after end/reset.
- Preserve the current automation failure/retry semantics. If adding a local speech completion action, update game validation, drafts/editor, player-safe projections, session snapshots, and execution deliberately; keep existing Home Assistant speech actions compatible.

Acceptance: phone mode plays on the selected phone output; room mode plays once on the designated MacBook output in normal operation; other phones stay quiet. Test the actual Bluetooth device, not just successful HTTP requests.

## Phase 6: setup and operation

- Add guided GM setup: HTTPS check, microphone test, runtime/model health, language selection, sample transcription, sample speech, and output-device rehearsal.
- Provide macOS startup/shutdown scripts or service instructions for Threshold, the proxy, and speech services. Keep engines on loopback, keep the Mac awake during games, document firewall requirements, and recover cleanly after restart.
- Document model downloads, disk/RAM expectations from measurements, offline rehearsal, updates, certificate expiry, backup boundaries, and troubleshooting. Verify runtime and model licenses before redistributing any binaries or voices.
- Add a short voice section to README linking this plan and the final operator guide. Mark features as available only as they ship.

## Validation and delivery

Automated checks should cover authorization, request limits, malformed audio, cancellation/timeouts, queue bounds, stale challenge handling, hidden-content protection, settings preservation, and room-device ownership/deduplication. Stub speech engines in tests; separately run real-engine integration checks on macOS.

Manual rehearsal must include iPhone Safari and Android Chrome; English/German as needed; permissions granted/denied; Bluetooth paired to phone and Mac; room noise; multiple teams; simultaneous answers; pause/end during transcription; refresh/reconnect; service restart; and no internet after model download. Record actual results and remaining limitations.

Before each finished-step commit, run the codebase scripts and fix failures, including unrelated formatting issues as instructed:

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm fmt
pnpm fmt:check
```

Run `pnpm build` for implementation steps as well. Inspect the diff after formatting, preserve unrelated user work, and stage explicit paths. Commit finished steps separately: HTTPS/setup foundation; transcription backend; phone input; speech output/room player; final operator documentation and hardware rehearsal evidence. Report local commits separately from any later authorized push or deployment.

## References

- [whisper.cpp HTTP server and supported conversion options](https://github.com/ggml-org/whisper.cpp/tree/master/examples/server)
- [OpenWhispr](https://github.com/openwhispr/openwhispr)
- [Piper local speech synthesis](https://github.com/OHF-Voice/piper1-gpl)
- [Browser microphone secure-context requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
- [Browser speech synthesis](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis)

Recheck upstream installation instructions and compatibility when implementing; this plan does not pin untested runtime versions.

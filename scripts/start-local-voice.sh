#!/bin/sh
set -eu
# Run from repository root after following the operator guide.
VOICE_WHISPER_SERVER="${VOICE_WHISPER_SERVER:-$PWD/data/voice/whisper.cpp/build/bin/whisper-server}"
VOICE_WHISPER_MODEL="${VOICE_WHISPER_MODEL:-$PWD/data/voice/models/ggml-base.bin}"
# No shell interpolation of remote input; all arguments are operator-controlled.
exec "$VOICE_WHISPER_SERVER" --host 127.0.0.1 --port 8178 --model "$VOICE_WHISPER_MODEL" --max-context 0 --threads 4

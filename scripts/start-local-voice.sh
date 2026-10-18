#!/bin/sh
set -eu
# Run from repository root after following the operator guide.
: "${VOICE_WHISPER_SERVER:?Set the absolute path to whisper-server v1.8.3}"
: "${VOICE_WHISPER_MODEL:?Set the absolute path to multilingual ggml-base.bin}"
# No shell interpolation of remote input; all arguments are operator-controlled.
exec "$VOICE_WHISPER_SERVER" --host 127.0.0.1 --port 8178 --model "$VOICE_WHISPER_MODEL" --no-context --threads 4

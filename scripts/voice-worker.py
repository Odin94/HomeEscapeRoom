"""One bounded local process per recording: Silero state never crosses players."""
import json
import os
import sys
import wave
from pathlib import Path

MODEL_ROOT = Path(__file__).resolve().parent.parent / "data/voice/models"
VAD_MODEL = os.environ.get("VOICE_VAD_MODEL", str(MODEL_ROOT / "silero-v6.0.onnx"))
PIPER_MODEL = os.environ.get("VOICE_PIPER_MODEL", str(MODEL_ROOT / "en_US-ljspeech-high.onnx"))


def speech_bounds(pcm, session):
    import numpy as np
    samples = np.frombuffer(pcm, dtype='<i2').astype(np.float32) / 32768
    state = np.zeros((2, 1, 128), dtype=np.float32)
    context = np.zeros((1, 64), dtype=np.float32)
    hits = []
    for offset in range(0, len(samples), 512):
        chunk = np.zeros((1, 512), dtype=np.float32)
        part = samples[offset:offset + 512]
        chunk[0, :len(part)] = part
        current = np.concatenate([context, chunk], axis=1)
        probability, state = session.run(None, {
            'input': current, 'state': state, 'sr': np.array(16000, dtype=np.int64),
        })
        context = current[:, -64:]
        if float(probability[0][0]) >= 0.5:
            hits.append(offset)
    if not hits:
        return None
    # Keep even one positive frame; retain all intervening pauses and 250 ms padding.
    return {'start': max(0, hits[0] - 4000), 'end': min(len(samples), hits[-1] + 512 + 4000)}


def main():
    if sys.argv[1] == 'health':
        import onnxruntime as ort
        from piper import PiperVoice
        session = ort.InferenceSession(VAD_MODEL, providers=['CPUExecutionProvider'])
        if speech_bounds(bytes(32000), session) is not None:
            raise ValueError('Silence detected as speech')
        PiperVoice.load(PIPER_MODEL)
        print(json.dumps({'ready': True}))
    elif sys.argv[1] == 'detect':
        import onnxruntime as ort
        options = ort.SessionOptions()
        options.inter_op_num_threads = 1
        options.intra_op_num_threads = 1
        session = ort.InferenceSession(VAD_MODEL, sess_options=options,
                                       providers=['CPUExecutionProvider'])
        with open(sys.argv[2], 'rb') as source:
            print(json.dumps(speech_bounds(source.read(480002), session)))
    elif sys.argv[1] == 'speak':
        from piper import PiperVoice
        voice = PiperVoice.load(PIPER_MODEL)
        with open(sys.argv[2], encoding='utf-8') as source, wave.open(sys.argv[3], 'wb') as output:
            frames = 0
            for chunk in voice.synthesize(source.read(2501)):
                if frames == 0:
                    output.setnchannels(chunk.sample_channels)
                    output.setsampwidth(chunk.sample_width)
                    output.setframerate(chunk.sample_rate)
                data = chunk.audio_int16_bytes
                frames += len(data)
                if frames > 4 * 1024 * 1024 - 44:
                    raise ValueError('Speech output too long')
                output.writeframes(data)
    else:
        raise ValueError('Unsupported operation')


if __name__ == '__main__':
    main()

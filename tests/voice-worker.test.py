"""Run with data/voice/venv/bin/python tests/voice-worker.test.py."""
import importlib.util
from pathlib import Path
import unittest
import numpy as np

spec = importlib.util.spec_from_file_location('voice_worker', Path(__file__).parent.parent / 'scripts/voice-worker.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class Detector:
    def __init__(self, hits):
        self.hits = hits
        self.frame = 0
        self.initial_states = []

    def run(self, _, inputs):
        self.initial_states.append(inputs['state'].copy())
        assert inputs['input'].shape == (1, 576)
        assert int(inputs['sr']) == 16000
        probability = 0.9 if self.frame in self.hits else 0.1
        self.frame += 1
        return np.array([[probability]]), np.ones((2, 1, 128), dtype=np.float32)


class VoiceWorkerTests(unittest.TestCase):
    def test_silence_and_short_answer_padding(self):
        self.assertIsNone(worker.speech_bounds(bytes(32000), Detector(set())))
        self.assertEqual(worker.speech_bounds(bytes(32000), Detector({10})), {'start': 1120, 'end': 9632})
        self.assertEqual(worker.speech_bounds(bytes(1000), Detector({0})), {'start': 0, 'end': 500})

    def test_preserves_pauses_and_resets_state_each_recording(self):
        detector = Detector({0, 30})
        self.assertEqual(worker.speech_bounds(bytes(32000), detector), {'start': 0, 'end': 16000})
        detector.frame = 0
        worker.speech_bounds(bytes(32000), detector)
        self.assertFalse(detector.initial_states[0].any())
        self.assertFalse(detector.initial_states[32].any())
        self.assertTrue(detector.initial_states[1].any())

    def test_failure_is_not_silence(self):
        class Failed:
            def run(self, *_):
                raise RuntimeError('detector unavailable')
        with self.assertRaises(RuntimeError):
            worker.speech_bounds(bytes(1000), Failed())


if __name__ == '__main__':
    unittest.main()

"""Download explicitly pinned voice assets outside Git, verifying each SHA-256."""
import hashlib
import json
from pathlib import Path
import sys
import urllib.request

root = Path(sys.argv[1] if len(sys.argv) > 1 else 'data/voice/models').resolve()
root.mkdir(parents=True, exist_ok=True)
manifest = json.loads(Path(__file__).with_name('voice-models.json').read_text())
for entry in manifest:
    destination = root / entry['name']
    if destination.exists() and hashlib.sha256(destination.read_bytes()).hexdigest() == entry['sha256']:
        print('Verified', entry['name'])
        continue
    temporary = destination.with_suffix(destination.suffix + '.download')
    try:
        digest = hashlib.sha256()
        with urllib.request.urlopen(entry['url'], timeout=60) as source, temporary.open('wb') as output:
            while True:
                chunk = source.read(1024 * 1024)
                if not chunk:
                    break
                digest.update(chunk)
                output.write(chunk)
        if digest.hexdigest() != entry['sha256']:
            raise ValueError('Checksum mismatch for ' + entry['name'])
        temporary.replace(destination)
        print('Downloaded and verified', entry['name'])
    finally:
        temporary.unlink(missing_ok=True)

"""Package the reviewed local tool into the static site, without credentials."""
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parents[1]
folder = root / 'public' / 'downloads'
folder.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(folder / 'local-ai-windows.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
    for name in ('local_ai_bridge.py', 'start-local-ai.vbs', 'start-local-ai.bat', 'LOCAL-AI-README.txt'):
        archive.write(root / 'tools' / name, 'local-ai/' + name)

"""Compatibility bridge to the one native hook installer; never edits settings itself."""
import os
import shutil
import sys
from pathlib import Path

installer = Path(__file__).resolve().parents[3] / "scripts" / "setup-hooks.js"
if len(sys.argv) > 2:
    raise ValueError("expected at most one Claude settings path")
arguments = []
if len(sys.argv) == 2:
    settings_path = Path(sys.argv[1]).expanduser().resolve()
    if settings_path.name != "settings.json" or settings_path.parent.name != ".claude":
        raise ValueError("Claude settings path must end in .claude/settings.json")
    arguments.append(str(settings_path))
node = shutil.which("node")
if node is None:
    raise FileNotFoundError("Node.js executable was not found on PATH")
node_path = str(Path(node).resolve())
os.execv(node_path, [node_path, str(installer), *arguments])

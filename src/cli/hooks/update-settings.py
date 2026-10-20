"""Compatibility bridge to the one native hook installer; never edits settings itself."""
import os
import sys
from pathlib import Path

installer = Path(__file__).resolve().parents[3] / "scripts" / "setup-hooks.js"
os.execvp("node", ["node", str(installer), *sys.argv[1:]])

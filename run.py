"""WaterIQ AI — one-command launcher (Windows, macOS, Linux). Needs only Python 3.9+.

    Windows:  python run.py        (or double-click start.bat)
    Mac:      python3 run.py       (or ./start.sh)

First run creates backend/.venv and installs packages (1–3 min, needs internet).
Then it starts the server and opens http://localhost:8000 in your browser. Ctrl+C stops it.
"""
from __future__ import annotations

import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
VENV = BACKEND / ".venv"
DIST = ROOT / "frontend" / "dist"
WIN = os.name == "nt"
VPY = VENV / ("Scripts/python.exe" if WIN else "bin/python")


def say(msg: str) -> None:
    print(f"[WaterIQ] {msg}", flush=True)


def fail(msg: str) -> None:
    print(f"\n[WaterIQ] ERROR: {msg}\n", flush=True)
    sys.exit(1)


def free_port(start: int = 8000) -> int:
    for port in range(start, start + 20):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", port)) != 0:
                return port
    fail("Ports 8000-8019 are all busy. Close other servers and try again.")
    return 0


def deps_ok() -> bool:
    return subprocess.run([str(VPY), "-c", "import fastapi, uvicorn, sklearn, numpy, httpx, joblib"],
                          capture_output=True).returncode == 0


def main() -> None:
    if sys.version_info < (3, 9):
        fail(f"Python 3.9 or newer is needed (you have {sys.version.split()[0]}). Install from https://www.python.org/downloads/")

    # 1. virtual environment + packages (only when missing)
    if not VPY.exists():
        say("Creating Python environment (first run only)...")
        if VENV.exists():
            shutil.rmtree(VENV, ignore_errors=True)
        r = subprocess.run([sys.executable, "-m", "venv", str(VENV)])
        if r.returncode != 0 or not VPY.exists():
            fail("Could not create the virtual environment. On Ubuntu/Debian run: sudo apt install python3-venv")
    if not deps_ok():
        say("Installing packages (first run only, 1-3 min)...")
        subprocess.run([str(VPY), "-m", "pip", "install", "--upgrade", "pip", "-q"])
        r = subprocess.run([str(VPY), "-m", "pip", "install", "-r", str(BACKEND / "requirements.txt")])
        if r.returncode != 0 or not deps_ok():
            fail("Package install failed. Check your internet connection and run this command again.")

    # 2. settings file + built website
    env = BACKEND / ".env"
    if not env.exists():
        shutil.copy(BACKEND / ".env.example", env)
    if not (DIST / "index.html").exists():
        if shutil.which("npm"):
            say("Building the website (needs Node.js)...")
            npm = "npm.cmd" if WIN else "npm"
            subprocess.run([npm, "install", "--no-audit", "--no-fund"], cwd=ROOT / "frontend")
            subprocess.run([npm, "run", "build"], cwd=ROOT / "frontend")
        if not (DIST / "index.html").exists():
            fail("frontend/dist is missing. Re-download the zip (it includes the built website) or install Node.js 20+.")

    # 3. start the server
    port = free_port(int(os.environ.get("PORT", "8000")))
    url = f"http://localhost:{port}"
    say(f"Starting server on {url} ...")
    proc = subprocess.Popen([str(VPY), "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(port)], cwd=BACKEND)
    try:
        for _ in range(60):
            if proc.poll() is not None:
                fail("The server stopped during startup. Read the error printed above.")
            try:
                with urllib.request.urlopen(f"{url}/api/health", timeout=2) as res:
                    if res.status == 200:
                        break
            except Exception:
                time.sleep(1)
        print("\n" + "=" * 56)
        print(f"  WaterIQ AI is running:  {url}")
        print("  Press Ctrl+C in this window to stop.")
        print("=" * 56 + "\n", flush=True)
        webbrowser.open(url)
        proc.wait()
    except KeyboardInterrupt:
        say("Stopping...")
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


if __name__ == "__main__":
    main()

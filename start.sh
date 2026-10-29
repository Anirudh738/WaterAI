#!/usr/bin/env bash
# WaterIQ AI - Mac/Linux launcher. Same as: python3 run.py
cd "$(dirname "$0")"
command -v python3 >/dev/null || { echo "Python 3.9+ is required: https://www.python.org/downloads/"; exit 1; }
exec python3 run.py

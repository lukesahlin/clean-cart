#!/usr/bin/env bash
# Render build script -- installs Python deps then Playwright's Chromium browser
set -e

pip install -r requirements.txt
playwright install chromium
playwright install-deps chromium

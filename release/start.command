#!/bin/bash
# Double-click to run Spider Crawler on this Mac (on Linux: ./start.command).
# It needs Node.js 22 or newer: https://nodejs.org
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Spider Crawler needs Node.js 22 or newer."
  echo "Install it from https://nodejs.org, then open this file again."
  read -r -p "Press Enter to close. "
  exit 1
fi
exec node bin/spider-crawler.mjs "$@"

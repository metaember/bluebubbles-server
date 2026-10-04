#!/bin/bash
set -euo pipefail
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
if [ -n "${BB_BUILD_NODE_BIN:-}" ]; then export PATH="$BB_BUILD_NODE_BIN:$PATH"; fi
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CANDIDATE_APP="$ROOT_DIR/packages/server/candidate-build/mac/BlueBubbles Candidate.app"
MODE="${1:---verify}"
case "$MODE" in --build-only|--verify|run) ;; *) echo 'Usage: build_and_run.sh [--build-only|--verify|run]' >&2; exit 2;; esac
test "$(uname -s)" = Darwin
cd "$ROOT_DIR"
# Match the candidate bundle executable, never production or generic Electron.
if /usr/bin/pgrep -f "^$CANDIDATE_APP/Contents/MacOS/BlueBubbles Candidate$" >/dev/null; then
    /usr/bin/pkill -TERM -f "^$CANDIDATE_APP/Contents/MacOS/BlueBubbles Candidate$"
    for _ in 1 2 3 4 5; do
        /usr/bin/pgrep -f "^$CANDIDATE_APP/Contents/MacOS/BlueBubbles Candidate$" >/dev/null || break
        sleep 1
    done
    if /usr/bin/pgrep -f "^$CANDIDATE_APP/Contents/MacOS/BlueBubbles Candidate$" >/dev/null; then
        echo 'Candidate did not stop; refusing to overwrite its bundle' >&2; exit 1
    fi
fi
node scripts/patch-contacts.cjs
node --test tests/*.test.cjs
node node_modules/electron/install.js
cd packages/server
../../node_modules/.bin/electron-rebuild -f -w better-sqlite3,node-mac-contacts,node-mac-permissions
NODE_ENV=production ../../node_modules/.bin/webpack --config scripts/webpack.shadow.config.js
CSC_IDENTITY_AUTO_DISCOVERY=false ../../node_modules/.bin/electron-builder --mac dir --x64 --publish never --config scripts/electron-builder-shadow.js
# Ad-hoc signing establishes a distinct candidate identity, not production's grants.
/usr/bin/codesign --force --deep --sign - "$CANDIDATE_APP"
if [ "$MODE" = --build-only ]; then exit 0; fi
/usr/bin/open -n "$CANDIDATE_APP"
if [ "$MODE" = --verify ]; then
    sleep 3
    /usr/bin/pgrep -f "^$CANDIDATE_APP/Contents/MacOS/BlueBubbles Candidate$" >/dev/null
fi

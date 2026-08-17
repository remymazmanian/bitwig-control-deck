#!/bin/zsh
# Double-click installer for Bitwig Control Deck.
# (If macOS says the file can't be opened, right-click it and choose "Open".)

cd "$(dirname "$0")"

echo ""
echo "  ┌─────────────────────────────────────┐"
echo "  │   BITWIG CONTROL DECK — INSTALLER   │"
echo "  └─────────────────────────────────────┘"

# A double-clicked .command gets a login shell, but check the common install
# locations anyway in case Node was just installed.
export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin"

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Node.js is not installed yet, and Control Deck needs it to run."
  echo ""
  echo "  1. Your browser is opening https://nodejs.org — download the LTS"
  echo "     version and run its installer (all default options are fine)."
  echo "  2. When it finishes, double-click this installer again."
  echo ""
  open "https://nodejs.org"
  read -s -k '?  Press any key to close this window.'
  exit 1
fi

if node scripts/setup.mjs; then
  echo "  Opening the connection guide in your browser..."
  sleep 2
  open "http://127.0.0.1:50703/connect"
else
  echo ""
  echo "  Something went wrong — see the ✗ lines above. It is safe to run"
  echo "  this installer again after fixing the issue."
fi

echo ""
read -s -k '?  Press any key to close this window.'
echo ""

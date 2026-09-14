#!/usr/bin/env bash
set -euo pipefail

# Ensure Cargo is on PATH if installed in standard location
if [ -d "$HOME/.cargo/bin" ]; then
  export PATH="$HOME/.cargo/bin:$PATH"
fi

npx tauri build "$@"

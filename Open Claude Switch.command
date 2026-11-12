#!/bin/zsh
PROJECT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
exec /usr/bin/open "$PROJECT_DIR/release/Claude Switch-darwin-arm64/Claude Switch.app"

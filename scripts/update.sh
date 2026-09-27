#!/usr/bin/env bash
# Atualização automática (macOS/Linux), chamada pelo próprio escritório.
REPO="${1:-Junior331/agent-office}"
APP="${2:-$(cd "$(dirname "$0")/.." && pwd)}"
ZIP_URL="${AGENT_OFFICE_ZIP_URL:-https://github.com/$REPO/releases/latest/download/agent-office.zip}"
LOG="$APP/update.log"
log() { printf '%s  %s\n' "$(date '+%Y-%m-%dT%H:%M:%S')" "$*" >> "$LOG"; }
{
  log "inicio ($REPO)"
  sleep 1
  tmp="$(mktemp -d)"
  curl -fsSL "$ZIP_URL" -o "$tmp/a.zip" && unzip -q "$tmp/a.zip" -d "$tmp/x" || { log "erro no download"; exit 1; }
  src="$(dirname "$(find "$tmp/x" -name server.js -not -path '*/node_modules/*' | head -1)")"
  pkill -f "$APP/server.js" 2>/dev/null || true
  sleep 1
  cp -R "$src"/. "$APP"/
  chmod +x "$APP"/scripts/*.sh 2>/dev/null || true
  (cd "$APP" && npm install --omit=dev --no-audit --no-fund --loglevel=error >/dev/null && node setup.mjs >/dev/null)
  rm -rf "$tmp"
  log "instalado"
} || log "erro"
bash "$APP/scripts/launch.sh" silent
log "reiniciado"

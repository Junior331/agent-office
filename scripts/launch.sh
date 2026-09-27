#!/usr/bin/env bash
# Sobe o escritório (se não estiver rodando) e abre o navegador.  launch.sh silent → só sobe.
APP="$(cd "$(dirname "$0")/.." && pwd)"
up() { curl -fs -m 1 http://127.0.0.1:4000/health >/dev/null 2>&1; }
if ! up; then
  nohup node "$APP/server.js" >> "$APP/office.log" 2>&1 &
  for _ in $(seq 1 30); do sleep 0.3; up && break; done
fi
if [ "${1:-}" != "silent" ]; then
  if [ "$(uname)" = "Darwin" ]; then open "http://localhost:4000"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "http://localhost:4000" >/dev/null 2>&1 &
  else echo "Abra http://localhost:4000"; fi
fi

#!/usr/bin/env bash
# Instalador do Escritório de Agentes (macOS e Linux)
#   curl -fsSL https://raw.githubusercontent.com/Junior331/agent-office/main/install.sh | bash
# Rodar de novo = atualizar (configurações e histórico ficam).
set -euo pipefail

REPO="${AGENT_OFFICE_REPO:-Junior331/agent-office}"
ZIP_URL="${AGENT_OFFICE_ZIP_URL:-https://github.com/$REPO/releases/latest/download/agent-office.zip}"
if [ "$(uname)" = "Darwin" ]; then
  APP="$HOME/Library/Application Support/AgentOffice/app"
else
  APP="${XDG_DATA_HOME:-$HOME/.local/share}/agent-office/app"
fi
BIN="$HOME/.local/bin"

say() { printf '%s\n' "$*"; }
ask() { local r; read -r -p "$1 [S/n] " r </dev/tty || r=""; [[ ! "$r" =~ ^[nN] ]]; }

say ""
say "=== Escritório de Agentes: instalação ==="

# 1. Node 18+
if ! command -v node >/dev/null 2>&1; then
  say "Node.js não encontrado."
  if command -v brew >/dev/null 2>&1 && ask "Instalar o Node.js agora com o Homebrew?"; then
    brew install node
  fi
  command -v node >/dev/null 2>&1 || { say "Instale o Node.js 18 ou mais novo (https://nodejs.org) e rode este comando de novo."; exit 1; }
fi
major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$major" -lt 18 ]; then say "Seu Node é $(node -v). Precisa ser 18 ou mais novo (https://nodejs.org)."; exit 1; fi
say "Node $(node -v) ok"

# 2. Claude Code
if ! command -v claude >/dev/null 2>&1; then
  say "Claude Code não encontrado."
  if ask "Instalar agora (npm install -g @anthropic-ai/claude-code)?"; then
    npm install -g @anthropic-ai/claude-code || sudo npm install -g @anthropic-ai/claude-code
  fi
  command -v claude >/dev/null 2>&1 || { say "Instale o Claude Code (https://docs.claude.com/claude-code) e rode este comando de novo."; exit 1; }
fi
say "Claude Code ok"

# 3. baixa a última versão
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
say "Baixando a última versão..."
curl -fsSL "$ZIP_URL" -o "$tmp/agent-office.zip"
unzip -q "$tmp/agent-office.zip" -d "$tmp/x"
src="$(dirname "$(find "$tmp/x" -name server.js -not -path '*/node_modules/*' | head -1)")"

# 4. para o escritório se estiver rodando e instala por cima
pkill -f "$APP/server.js" 2>/dev/null || true
mkdir -p "$APP"
cp -R "$src"/. "$APP"/
chmod +x "$APP"/scripts/*.sh "$APP"/install.sh 2>/dev/null || true
(cd "$APP" && say "Instalando dependências..." && npm install --omit=dev --no-audit --no-fund --loglevel=error >/dev/null && node setup.mjs)

# 5. comando "agent-office" pra abrir
mkdir -p "$BIN"
cat > "$BIN/agent-office" <<LAUNCH
#!/usr/bin/env bash
exec bash "$APP/scripts/launch.sh" "\$@"
LAUNCH
chmod +x "$BIN/agent-office"

# no Mac, também um app clicável em ~/Applications
if [ "$(uname)" = "Darwin" ] && command -v osacompile >/dev/null 2>&1; then
  mkdir -p "$HOME/Applications"
  osacompile -o "$HOME/Applications/Escritório de Agentes.app" -e "do shell script \"bash '$APP/scripts/launch.sh' >/dev/null 2>&1 &\"" >/dev/null 2>&1 || true
fi

say ""
say "Pronto!"
case ":$PATH:" in *":$BIN:"*) ;; *) say "Dica: adicione $BIN ao PATH pra usar o comando 'agent-office' (ex.: echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.zshrc)";; esac
[ "$(uname)" = "Darwin" ] && say "Abra pelo app 'Escritório de Agentes' (pasta Aplicativos do seu usuário) ou pelo comando: agent-office"
say "Se for a primeira vez com o Claude Code, rode 'claude' no terminal e entre na sua conta (só uma vez)."
bash "$APP/scripts/launch.sh"

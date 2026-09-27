# Instalador do Escritorio de Agentes (Windows)
# Uso (PowerShell):
#   irm https://raw.githubusercontent.com/Junior331/agent-office/main/install.ps1 | iex
#
# O que faz: confere Node e Claude Code (oferece instalar), baixa a ultima versao,
# instala em %LOCALAPPDATA%\AgentOffice\app, roda o setup e cria um atalho na area de trabalho.
# Rodar de novo = atualizar (configuracoes e historico sao mantidos).

param([string]$Repo = 'Junior331/agent-office')

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$App = Join-Path $env:LOCALAPPDATA 'AgentOffice\app'

function Say([string]$msg, [string]$color = 'Gray') { Write-Host $msg -ForegroundColor $color }
function Has([string]$cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function RefreshPath { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') }
function Ask([string]$q) { $r = Read-Host "$q (S/n)"; return ($r -notmatch '^[nN]') }

Say ''
Say '=== Escritorio de Agentes: instalacao ===' Cyan

# 0. PowerShell com scripts bloqueados (padrao do Windows) impede o npm e o claude de rodarem no PowerShell
$policy = Get-ExecutionPolicy
if ($policy -in @('Restricted', 'AllSigned', 'Undefined')) {
  Say "A execucao de scripts esta bloqueada neste PowerShell ($policy). O npm e o claude precisam dela." Yellow
  if (Ask 'Liberar scripts locais so pro seu usuario (RemoteSigned, o padrao de quem programa)?') {
    Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force
    Say 'Liberado.' Green
  } else {
    Say 'Tudo bem: o instalador segue usando o npm.cmd. Pra rodar o claude, use o Prompt de Comando (cmd).' Yellow
  }
}

# 1. Node.js 18+
if (-not (Has 'node')) {
  Say 'Node.js nao encontrado.' Yellow
  if ((Has 'winget') -and (Ask 'Instalar o Node.js LTS agora com o winget?')) {
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    RefreshPath
  }
  if (-not (Has 'node')) { Say 'Instale o Node.js 18 ou mais novo (https://nodejs.org) e rode este comando de novo.' Red; return }
}
$major = [int]((node -v).TrimStart('v').Split('.')[0])
if ($major -lt 18) { Say "Seu Node e a versao $(node -v). Precisa ser 18 ou mais nova (https://nodejs.org)." Red; return }
Say "Node $(node -v) ok" Green

# 2. Claude Code
if (-not (Has 'claude')) {
  Say 'Claude Code nao encontrado.' Yellow
  if (Ask 'Instalar agora (npm install -g @anthropic-ai/claude-code)?') {
    npm.cmd install -g @anthropic-ai/claude-code
    RefreshPath
  }
  if (-not (Has 'claude')) { Say 'Instale o Claude Code (https://docs.claude.com/claude-code) e rode este comando de novo.' Red; return }
}
Say 'Claude Code ok' Green
$needsLogin = -not (Test-Path (Join-Path $HOME '.claude\.credentials.json'))

# 3. baixa a ultima versao
$tmp = Join-Path $env:TEMP ("agent-office-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $tmp | Out-Null
$zip = Join-Path $tmp 'agent-office.zip'
Say 'Baixando a ultima versao...'
Invoke-WebRequest "https://github.com/$Repo/releases/latest/download/agent-office.zip" -OutFile $zip -UseBasicParsing
Expand-Archive $zip $tmp -Force
$src = (Get-ChildItem $tmp -Recurse -Filter server.js | Where-Object { $_.FullName -notmatch 'node_modules' } | Select-Object -First 1).Directory.FullName

# 4. para o escritorio se estiver rodando e instala por cima (config.json e history.json ficam)
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -and ($_.CommandLine -replace '/', '\') -match 'server\.js' -and ($_.CommandLine -match 'AgentOffice' -or $_.CommandLine -match 'agent-office') } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
New-Item -ItemType Directory $App -Force | Out-Null
Copy-Item "$src\*" $App -Recurse -Force
Remove-Item $tmp -Recurse -Force

Push-Location $App
Say 'Instalando dependencias...'
npm.cmd install --omit=dev --no-audit --no-fund --loglevel=error | Out-Null
node setup.mjs
Pop-Location

# 5. atalho na area de trabalho
$desktop = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut((Join-Path $desktop 'Escritorio de Agentes.lnk'))
$lnk.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$lnk.Arguments = '"' + (Join-Path $App 'scripts\launch.vbs') + '"'
$lnk.WorkingDirectory = $App
$lnk.IconLocation = (Join-Path $env:WINDIR 'System32\shell32.dll') + ',150'
$lnk.Save()

Say ''
Say 'Pronto! Atalho "Escritorio de Agentes" criado na area de trabalho.' Green
if ($needsLogin) {
  Say 'Falta entrar na sua conta do Claude: abra um terminal, rode "claude" e siga o login (ou use o botao de login no chat do Lider). So precisa uma vez.' Yellow
}
Start-Process (Join-Path $env:WINDIR 'System32\wscript.exe') ('"' + (Join-Path $App 'scripts\launch.vbs') + '"')

# Atualizacao automatica (chamada pelo proprio escritorio, escondida).
# Baixa a ultima versao, para o servidor, instala por cima, roda o setup e sobe de novo.
param([string]$Repo = 'Junior331/agent-office', [string]$App = (Split-Path $PSScriptRoot -Parent))

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$log = Join-Path $App 'update.log'
function Log([string]$m) { Add-Content $log ("{0}  {1}" -f (Get-Date -Format s), $m) }

try {
  Log "inicio ($Repo)"
  Start-Sleep -Seconds 1
  $tmp = Join-Path $env:TEMP ("agent-office-up-" + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory $tmp | Out-Null
  $zip = Join-Path $tmp 'agent-office.zip'
  Invoke-WebRequest "https://github.com/$Repo/releases/latest/download/agent-office.zip" -OutFile $zip -UseBasicParsing
  Expand-Archive $zip $tmp -Force
  $src = (Get-ChildItem $tmp -Recurse -Filter server.js | Where-Object { $_.FullName -notmatch 'node_modules' } | Select-Object -First 1).Directory.FullName
  Log "baixado"

  $appRe = [regex]::Escape($App)
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine -match 'server\.js' -and $_.CommandLine -match $appRe } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 1

  Copy-Item "$src\*" $App -Recurse -Force
  Remove-Item $tmp -Recurse -Force
  Push-Location $App
  npm.cmd install --omit=dev --no-audit --no-fund --loglevel=error | Out-Null
  node setup.mjs | Out-Null
  Pop-Location
  Log "instalado"
} catch {
  Log ("erro: " + $_.Exception.Message)
}
Start-Process (Join-Path $env:WINDIR 'System32\wscript.exe') ('"' + (Join-Path $App 'scripts\launch.vbs') + '" silent')
Log "reiniciado"

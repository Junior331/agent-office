#!/usr/bin/env node
// Executado pelo Claude Code a cada evento de hook.
// Lê o JSON do stdin e repassa pro servidor do escritório.
// Se o escritório estiver desligado, sobe ele sozinho em segundo plano (auto-start).
// Nunca trava nem quebra o Claude Code: timeouts curtos e sempre sai com 0.
//
// Desligar o auto-start: variável de ambiente CLAUDE_OFFICE_AUTOSTART=0

import { spawn } from 'node:child_process';
import { openSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HOME } from './paths.mjs';

const TARGET = process.env.CLAUDE_OFFICE_URL || 'http://127.0.0.1:4000/event';
const AUTOSTART = process.env.CLAUDE_OFFICE_AUTOSTART !== '0';
// onde o app do escritório está instalado (gravado pelo setup)
let ROOT = null;
try {
  ROOT = JSON.parse(readFileSync(join(HOME, 'config.json'), 'utf8')).officeDir || null;
} catch {
  ROOT = null;
}
const LOCK = join(tmpdir(), 'claude-office-start.lock');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function send(body) {
  try {
    const res = await fetch(TARGET, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(400),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function startOffice() {
  if (!ROOT) return false;
  // evita vários hooks subindo o servidor ao mesmo tempo
  try {
    if (Date.now() - statSync(LOCK).mtimeMs < 15_000) return false;
  } catch {
    /* sem lock */
  }
  writeFileSync(LOCK, String(Date.now()));

  const log = openSync(join(ROOT, 'office.log'), 'a');
  const child = spawn(process.execPath, [join(ROOT, 'server.js')], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', log, log],
    windowsHide: true,
  });
  child.unref();
  return true;
}

let payload = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (payload += chunk));
process.stdin.on('end', async () => {
  if (!(await send(payload)) && AUTOSTART && startOffice()) {
    // dá um tempinho pro servidor subir e reenvia este evento
    for (let i = 0; i < 5; i++) {
      await sleep(300);
      if (await send(payload)) break;
    }
  }
  process.exit(0);
});

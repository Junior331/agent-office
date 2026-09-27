#!/usr/bin/env node
// Conecta o escritório a um bot do Telegram.
//   1. No Telegram, fale com @BotFather → /newbot → copie o token.
//   2. npm run telegram:setup -- <TOKEN>
//   3. Quando pedir, mande /start pro seu bot pelo celular.
// Grava config.json com o token e o SEU chat (só ele é atendido).

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(ROOT, 'config.json');
const token = process.argv[2];
if (!token) {
  console.error('Uso: npm run telegram:setup -- <TOKEN_DO_BOT>');
  process.exit(1);
}

const api = (method, body = {}) =>
  fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());

const me = await api('getMe');
if (!me.ok) {
  console.error('Token inválido. Confira o que o @BotFather te passou.');
  process.exit(1);
}
console.log(`Bot: @${me.result.username}`);
console.log(`Agora mande /start pro @${me.result.username} pelo celular (esperando até 2 minutos)…`);

let offset = 0;
const deadline = Date.now() + 120_000;
let chat = null;
while (!chat && Date.now() < deadline) {
  const r = await api('getUpdates', { offset, timeout: 20 });
  for (const u of r.result || []) {
    offset = u.update_id + 1;
    if (u.message?.text?.startsWith('/start')) chat = u.message.chat;
  }
}
if (!chat) {
  console.error('Não recebi o /start. Rode de novo e mande a mensagem pro bot.');
  process.exit(1);
}
await api('getUpdates', { offset }); // limpa a fila

let config = {};
try {
  config = JSON.parse(readFileSync(FILE, 'utf8'));
} catch {
  config = {};
}
config.telegram = { token, chat_id: chat.id, bot: me.result.username };
writeFileSync(FILE, JSON.stringify(config, null, 2) + '\n');
await api('sendMessage', { chat_id: chat.id, text: '✅ Escritório conectado. Reinicie o escritório no PC e mande /ajuda aqui.' });
console.log(`✅ Conectado ao chat de ${chat.first_name || chat.username || chat.id}. Config salva em config.json.`);
console.log('Reinicie o escritório (ele sobe sozinho na próxima ação do Claude Code).');

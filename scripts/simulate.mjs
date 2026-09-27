#!/usr/bin/env node
// Manda eventos falsos pro servidor, pra você ver o escritório funcionando
// sem precisar abrir o Claude Code. Ctrl+C pra parar.

const TARGET = process.env.CLAUDE_OFFICE_URL || 'http://localhost:4000/event';

const sessions = ['loja-api', 'dashboard-admin', 'landing-page', 'infra-terraform', 'app-mobile'].map((name, i) => ({
  session_id: `sim-${i}-${Math.random().toString(36).slice(2, 8)}`,
  cwd: `/home/dev/projetos/${name}`,
}));

const TOOLS = [
  ['Edit', { file_path: 'src/components/Header.tsx' }],
  ['Write', { file_path: 'src/services/payment.ts' }],
  ['Read', { file_path: 'package.json' }],
  ['Grep', { pattern: 'useEffect' }],
  ['Glob', { pattern: '**/*.test.ts' }],
  ['Bash', { command: 'npm test -- --watch=false' }],
  ['Bash', { command: 'git status' }],
  ['WebSearch', { query: 'next.js 16 server actions cache' }],
  ['WebFetch', { url: 'https://docs.example.com/api' }],
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let toolUseSeq = 0;

async function send(session, event) {
  try {
    await fetch(TARGET, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...session, ...event }),
    });
  } catch {
    console.error(`Não consegui falar com ${TARGET}. O servidor tá rodando? (npm start)`);
    process.exit(1);
  }
}

async function spawnSubagent(session) {
  const tool_use_id = `sim_tool_${++toolUseSeq}`;
  const tool_input = { description: pick(['Revisar testes', 'Mapear rotas da API', 'Auditar acessibilidade', 'Refatorar hooks']), subagent_type: 'general-purpose' };
  await send(session, { hook_event_name: 'PreToolUse', tool_name: 'Task', tool_use_id, tool_input });
  await sleep(4000 + Math.random() * 6000);
  await send(session, { hook_event_name: 'SubagentStop' });
  await send(session, { hook_event_name: 'PostToolUse', tool_name: 'Task', tool_use_id, tool_input });
}

console.log(`Simulando ${sessions.length} agentes → ${TARGET}`);
for (const s of sessions) {
  await send(s, { hook_event_name: 'SessionStart' });
  await sleep(500);
}

while (true) {
  const s = pick(sessions);
  const roll = Math.random();
  if (roll < 0.08) await send(s, { hook_event_name: 'Notification', message: 'Claude precisa da sua permissão pra usar Bash' });
  else if (roll < 0.16) await send(s, { hook_event_name: 'Stop' });
  else if (roll < 0.22) await send(s, { hook_event_name: 'UserPromptSubmit', prompt: 'agora cria os testes pra esse componente' });
  else if (roll < 0.27) spawnSubagent(s); // sem await: roda em paralelo
  else {
    const [tool_name, tool_input] = pick(TOOLS);
    await send(s, { hook_event_name: 'PreToolUse', tool_name, tool_input });
  }
  await sleep(700 + Math.random() * 900);
}

// Cálculo de desempenho da equipe.
// O escritório importa este mesmo arquivo, então o líder e a tela chegam sempre no mesmo número.

export const CRITERIA = {
  qualidade: 'Qualidade',
  entrega: 'Entrega',
  escopo: 'Escopo e protocolo',
  comunicacao: 'Comunicação',
  colaboracao: 'Colaboração',
};

export const CLASSES = [
  { key: 'destaque', min: 85, label: 'Destaque', icon: '🟢' },
  { key: 'bom', min: 70, label: 'Bom', icon: '🔵' },
  { key: 'atencao', min: 50, label: 'Atenção', icon: '🟡' },
  { key: 'critico', min: 0, label: 'Crítico', icon: '🔴' },
];

const WEIGHTS = { lead: 0.5, peers: 0.3, objective: 0.2 };

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const norm = (v) => ((clamp(Number(v) || 0, 1, 5) - 1) / 4) * 100; // 1..5 → 0..100

function reviewScore(r) {
  const vals = Object.keys(CRITERIA).map((k) => r.scores?.[k]).filter((v) => Number.isFinite(Number(v)));
  if (!vals.length) return null;
  return vals.reduce((s, v) => s + norm(v), 0) / vals.length;
}

// média ponderada puxando pras avaliações mais recentes
function recentWeighted(list, max) {
  const recent = list.slice(-max);
  if (!recent.length) return null;
  let sum = 0;
  let wsum = 0;
  recent.forEach((r, i) => {
    const w = i + 1;
    sum += r._score * w;
    wsum += w;
  });
  return sum / wsum;
}

export function classify(score) {
  if (score == null) return null;
  return CLASSES.find((c) => score >= c.min);
}

/**
 * @param members  roster.members (ativos e desligados)
 * @param reviews  lista de avaliações { reviewer, reviewee, scores, comment, delivery, task, round, at }
 * @param policy   roster.policy
 * @param load     { [memberId]: número de issues abertas atribuídas } (opcional)
 */
export function computeScores(members, reviews, policy = {}, load = {}) {
  const valid = reviews
    .filter((r) => r && r.reviewee && r.reviewer && r.reviewer !== r.reviewee)
    .map((r) => ({ ...r, _score: reviewScore(r) }))
    .filter((r) => r._score != null)
    .sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));

  const out = {};
  for (const m of members) {
    const mine = valid.filter((r) => r.reviewee === m.id);
    const lead = mine.filter((r) => r.reviewer === 'lead');
    const peers = mine.filter((r) => r.reviewer !== 'lead');

    const st = m.stats || {};
    const fixed = Number(st.issues_fixed) || 0;
    const reopened = Number(st.reopened) || 0;
    const objective = fixed + reopened > 0 ? clamp((100 * fixed) / (fixed + 2 * reopened), 0, 100) : null;

    const parts = { lead: recentWeighted(lead, 5), peers: recentWeighted(peers, 8), objective };
    let sum = 0;
    let wsum = 0;
    for (const [k, v] of Object.entries(parts)) {
      if (v == null) continue;
      sum += v * WEIGHTS[k];
      wsum += WEIGHTS[k];
    }
    const score = wsum && mine.length ? Math.round(sum / wsum) : null;

    const byCriterion = {};
    for (const k of Object.keys(CRITERIA)) {
      const vals = mine.slice(-8).map((r) => Number(r.scores?.[k])).filter(Number.isFinite);
      byCriterion[k] = vals.length ? Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10 : null;
    }

    const last2 = mine.slice(-2).map((r) => r._score);
    const prev2 = mine.slice(-4, -2).map((r) => r._score);
    const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    const trend = last2.length && prev2.length ? (avg(last2) - avg(prev2) > 5 ? 'up' : avg(prev2) - avg(last2) > 5 ? 'down' : 'flat') : null;

    const cls = classify(score);
    let recommendation = null;
    if (m.status === 'fired') recommendation = null;
    else if (!cls) recommendation = { key: 'sem-dados', text: 'Sem avaliações ainda' };
    else if (cls.key === 'critico' && (lead.length >= 2 || mine.length >= 3)) recommendation = { key: 'desligar', text: 'Desligar e substituir' };
    else if (cls.key === 'critico') recommendation = { key: 'alerta', text: 'Alerta: mais uma rodada ruim e desliga' };
    else if (cls.key === 'atencao') recommendation = { key: 'melhoria', text: 'Plano de melhoria na próxima rodada' };
    else recommendation = { key: 'manter', text: 'Manter' };

    const worst = Object.entries(byCriterion)
      .filter(([, v]) => v != null)
      .sort((a, b) => a[1] - b[1])
      .slice(0, 2)
      .map(([k]) => CRITERIA[k]);

    out[m.id] = {
      score,
      class: cls,
      trend,
      parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, v == null ? null : Math.round(v)])),
      byCriterion,
      worst,
      reviews: { total: mine.length, lead: lead.length, peers: peers.length },
      latest: mine.slice(-5).reverse().map(({ _score, ...r }) => ({ ...r, score: Math.round(_score) })),
      recommendation,
      load: load[m.id] || 0,
    };
  }

  // recomendações pra equipe
  const active = members.filter((m) => m.status !== 'fired');
  const maxTasks = Number(policy.max_tasks_per_member) || 5;
  const overloaded = active.filter((m) => (load[m.id] || 0) > maxTasks);
  const toFire = active.filter((m) => out[m.id]?.recommendation?.key === 'desligar');
  const team = [];
  for (const m of toFire) {
    team.push({ key: 'substituir', member: m.id, text: `Desligar ${m.name || m.id} (score ${out[m.id].score}) e contratar substituto pro escopo dele` });
  }
  if (overloaded.length) {
    team.push({
      key: 'contratar',
      members: overloaded.map((m) => m.id),
      text: `Contratar: ${overloaded.length} membro${overloaded.length > 1 ? 's' : ''} com mais de ${maxTasks} issues abertas (${overloaded.map((m) => m.name || m.id).join(', ')})`,
    });
  }
  const scored = active.map((m) => out[m.id]?.score).filter((s) => s != null);
  const teamAvg = scored.length ? Math.round(scored.reduce((s, v) => s + v, 0) / scored.length) : null;

  return { members: out, team, teamAvg };
}

// ------------------------------------------------------------------ uso pelo líder (linha de comando)
//   node "<KIT_DIR>/hooks/team-score.mjs"          → placar da equipe do projeto atual
//   node "<KIT_DIR>/hooks/team-score.mjs" --json   → mesmo dado em JSON

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { teamDirFor } from './paths.mjs';

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function loadReviews(teamDir) {
  const tasksDir = join(teamDir, 'tasks');
  const out = [];
  let tasks = [];
  try {
    tasks = readdirSync(tasksDir);
  } catch {
    return out;
  }
  for (const task of tasks) {
    const dir = join(tasksDir, task, 'reviews');
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
      const r = readJson(join(dir, f), null);
      if (r) out.push({ task, ...r });
    }
  }
  return out;
}

function openLoad(teamDir, members) {
  const task = (() => {
    try {
      return readFileSync(join(teamDir, 'ACTIVE'), 'utf8').trim();
    } catch {
      return '';
    }
  })();
  const load = {};
  if (!task) return load;
  const dir = join(teamDir, 'tasks', task, 'issues');
  if (!existsSync(dir)) return load;
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.md'))) {
    const text = readFileSync(join(dir, f), 'utf8');
    const to = /^to:\s*(.+)$/m.exec(text)?.[1]?.trim();
    const status = /^status:\s*(.+)$/m.exec(text)?.[1]?.trim();
    if (!to || !['open', 'reopened', 'in_progress'].includes(status)) continue;
    const m = members.find((x) => x.id === to) || members.filter((x) => x.role === to).length === 1 && members.find((x) => x.role === to);
    if (m) load[m.id] = (load[m.id] || 0) + 1;
  }
  return load;
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isCli) {
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const teamDir = teamDirFor(projectDir);
  const roster = readJson(join(teamDir, 'roster.json'), { members: [], policy: {} });
  const members = roster.members || [];
  const result = computeScores(members, loadReviews(teamDir), roster.policy || {}, openLoad(teamDir, members));
  const usage = readJson(join(teamDir, 'usage.json'), { members: {} }).members || {};
  const avgs = members.map((m) => usage[m.id]?.avg_tokens).filter(Boolean).sort((a, b) => a - b);
  const mid = Math.floor(avgs.length / 2);
  const median = !avgs.length ? null : avgs.length % 2 ? avgs[mid] : Math.round((avgs[mid - 1] + avgs[mid]) / 2);
  const k = (n) => (n == null ? '—' : n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n));

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const rows = members
      .filter((m) => m.status !== 'fired')
      .map((m) => ({ m, s: result.members[m.id] }))
      .sort((a, b) => (b.s.score ?? -1) - (a.s.score ?? -1));
    console.log(`Placar da equipe · média ${result.teamAvg ?? '—'} · mediana de tokens/disparo ${k(median)}`);
    for (const { m, s } of rows) {
      const cls = s.class ? `${s.class.icon} ${s.class.label}` : '⚪ sem avaliação';
      const trend = { up: '↑', down: '↓', flat: '→' }[s.trend] || ' ';
      console.log(
        `${String(s.score ?? '—').padStart(3)} ${trend} ${cls.padEnd(14)} ${(m.name || m.id).padEnd(26)} ` +
          `líder ${s.parts.lead ?? '—'} · colegas ${s.parts.peers ?? '—'} · objetivo ${s.parts.objective ?? '—'} · ${s.reviews.total} aval. · ${s.load} abertas` +
          ` · 🪙 ${k(usage[m.id]?.avg_tokens)}/disparo${median && usage[m.id]?.avg_tokens > 1.5 * median ? ' ⚠️ acima de 1,5× a mediana' : ''}` +
          (s.worst.length ? ` · pior: ${s.worst.join(', ')}` : '') +
          ` → ${s.recommendation?.text ?? ''}`,
      );
    }
    if (result.team.length) {
      console.log('\nRecomendações:');
      for (const t of result.team) console.log(`- ${t.text}`);
    }
  }
}

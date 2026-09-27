/* global Phaser */

// ------------------------------------------------------------------ mapa (coordenadas em pixels da imagem de fundo)

const W = 2816;
const H = 1536;
const BG = { key: 'office-bg', url: '/assets/office-bg.jpg' };
const HALL_Y = 797; // meio do corredor de madeira
const ENTRANCE = { x: W + 80, y: HALL_Y }; // chegam e saem pela direita do corredor
const SPEED = 320; // px/s
const FIG = 2.8; // escala dos bonecos (≈118px de altura no mapa)
const HEAD = 42 * FIG;
const FONT = 32; // tamanho base das etiquetas (a câmera aplica o zoom)

// spritesheet: 8 personagens (linhas) × 6 quadros, 96×128 cada, conteúdo com 118px de altura
// quadros: 0 parado · 1-2 andando de frente · 3-4 andando de lado (olhando pra direita) · 5 sentado no notebook
const SHEET = { key: 'chars', url: '/assets/characters.png', fw: 96, fh: 128, content: 118, cols: 6 };
const ROLE_ROW = { frontend: 0, qa: 1, designer: 2, backend: 3 };

// piso útil de cada sala + porta (x da porta e y logo dentro da sala)
const ROOMS = {
  desks:    { label: 'Mesas',      x: 70,   y: 150,  w: 840, h: 445, door: { x: 483,  y: 565 } },
  library:  { label: 'Biblioteca', x: 990,  y: 250,  w: 820, h: 350, door: { x: 1390, y: 565 } },
  terminal: { label: 'Terminais',  x: 1900, y: 160,  w: 840, h: 445, door: { x: 2320, y: 565 } },
  lounge:   { label: 'Lounge',     x: 70,   y: 990,  w: 830, h: 450, door: { x: 690,  y: 1030 } },
  meeting:  { label: 'Reunião',    x: 990,  y: 1000, w: 820, h: 450, door: { x: 1390, y: 1030 } },
  web:      { label: 'Pesquisa',   x: 1900, y: 1000, w: 840, h: 455, door: { x: 2320, y: 1030 } },
};

// placas das salas na parede de cima (como na referência)
const PLAQUES = {
  desks: { x: 490, y: 40 }, library: { x: 1395, y: 40 }, terminal: { x: 2320, y: 40 },
  lounge: { x: 370, y: 930 }, meeting: { x: 1580, y: 930 }, web: { x: 2320, y: 930 },
};

// mesas: a região da imagem recortada e desenhada NA FRENTE do boneco (esconde as pernas = sentado)
const deskRow = (room, xs, halfW, top, bottom, feet) =>
  xs.map((x) => ({ room, crop: { x: x - halfW, y: top, w: halfW * 2, h: bottom - top }, seat: { x, y: feet, sit: true } }));

const DESKS = [
  // só o tampo e a frente da mesa: o monitor fica atrás do boneco e a cabeça aparece
  ...deskRow('desks', [143, 370, 597, 823], 74, 192, 292, 232),
  ...deskRow('desks', [143, 370, 597, 823], 74, 429, 528, 469),
  ...deskRow('terminal', [2073, 2248, 2424, 2600], 74, 506, 602, 546),
  ...deskRow('web', [2144, 2564], 108, 1071, 1182, 1111),
  ...deskRow('web', [2144, 2564], 108, 1289, 1394, 1329),
];
const TABLES = [{ crop: { x: 1160, y: 1118, w: 470, h: 186 } }]; // mesa de reunião

const SLOTS = {
  desks: DESKS.filter((d) => d.room === 'desks').map((d) => d.seat),
  terminal: DESKS.filter((d) => d.room === 'terminal').map((d) => d.seat),
  web: DESKS.filter((d) => d.room === 'web').map((d) => d.seat),
  library: [
    { x: 1130, y: 318 }, { x: 1290, y: 318 }, { x: 1455, y: 318 }, { x: 1615, y: 318 },
    { x: 1330, y: 565 }, { x: 1480, y: 565 },
  ],
  lounge: [
    { x: 310, y: 1085 }, { x: 380, y: 1085 }, { x: 450, y: 1085 },
    { x: 560, y: 1205 }, { x: 640, y: 1205 }, { x: 470, y: 1290 },
    { x: 300, y: 1205 }, { x: 560, y: 1330 }, { x: 700, y: 1290 }, { x: 380, y: 1300 },
  ],
  meeting: [
    { x: 1255, y: 1150, sit: true }, { x: 1370, y: 1150, sit: true }, { x: 1485, y: 1150, sit: true },
    { x: 1255, y: 1425 }, { x: 1370, y: 1425 }, { x: 1485, y: 1425 },
  ],
};

// etiquetas de vizinhos em alturas diferentes, pra não se sobreporem
const STAGGER = { desks: 2, terminal: 2, web: 1, library: 2, lounge: 3, meeting: 3 };

const STATE_ROOM = {
  typing: 'desks', thinking: 'desks', reading: 'library', terminal: 'terminal',
  web: 'web', meeting: 'meeting', idle: 'lounge',
};

const STATE_META = {
  typing:   { label: 'escrevendo código',       icon: '⌨️' },
  thinking: { label: 'pensando',                icon: '💭' },
  reading:  { label: 'lendo arquivos',          icon: '📖' },
  terminal: { label: 'rodando comando',         icon: '💻' },
  web:      { label: 'pesquisando',             icon: '🔎' },
  meeting:  { label: 'delegando pra subagente', icon: '🤝' },
  idle:     { label: 'de boa',                  icon: '☕' },
};
const WAITING = { label: 'precisa de você', icon: '✋' };
const STATE_COLOR = {
  typing: '#6fdc8c', thinking: '#b8a9ff', reading: '#4fc3f7', terminal: '#ffd54f',
  web: '#ffb74d', meeting: '#f48fb1', idle: '#9e9e9e', waiting: '#ff5252',
};

const hexToInt = (hex) => parseInt(hex.replace('#', ''), 16);
const hash = (s) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 0);
const clip = (s, n = 16) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

const TEXT = { fontFamily: '"VT323", "Pixelify Sans", monospace', resolution: 2 };


// ------------------------------------------------------------------ caminho (A* sobre o chão do mapa)
// walkmask.json: grade de 16px gerada a partir das cores do piso de cada sala + corredor.
// 1 = chão livre, 0 = parede ou móvel.

const Nav = {
  grid: null, cell: 16, cols: 0, rows: 0,

  load(json) {
    this.cell = json.cell;
    this.cols = json.cols;
    this.rows = json.rows;
    this.grid = new Uint8Array(this.cols * this.rows);
    json.data.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) this.grid[y * this.cols + x] = row.charCodeAt(x) === 49 ? 1 : 0;
    });
  },
  ok(x, y) {
    return x >= 0 && y >= 0 && x < this.cols && y < this.rows && this.grid[y * this.cols + x] === 1;
  },
  toCell(p) {
    return { x: Math.min(this.cols - 1, Math.max(0, Math.floor(p.x / this.cell))), y: Math.min(this.rows - 1, Math.max(0, Math.floor(p.y / this.cell))) };
  },
  center(c) {
    return { x: c.x * this.cell + this.cell / 2, y: c.y * this.cell + this.cell / 2 };
  },
  // célula livre mais próxima (busca em anel crescente)
  nearest(c) {
    if (this.ok(c.x, c.y)) return c;
    for (let r = 1; r < 40; r++) {
      let best = null;
      let bestD = Infinity;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = c.x + dx;
          const y = c.y + dy;
          if (!this.ok(x, y)) continue;
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = { x, y };
          }
        }
      }
      if (best) return best;
    }
    return c;
  },
  // linha reta livre entre duas células (pra suavizar o caminho)
  clear(a, b) {
    const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) * 2;
    for (let i = 0; i <= steps; i++) {
      const t = steps ? i / steps : 0;
      const x = Math.round(a.x + (b.x - a.x) * t);
      const y = Math.round(a.y + (b.y - a.y) * t);
      if (!this.ok(x, y)) return false;
    }
    return true;
  },
  astar(start, goal) {
    const { cols } = this;
    const idx = (x, y) => y * cols + x;
    const g = new Float32Array(this.cols * this.rows).fill(Infinity);
    const from = new Int32Array(this.cols * this.rows).fill(-1);
    const closed = new Uint8Array(this.cols * this.rows);
    const h = (x, y) => {
      const dx = Math.abs(x - goal.x);
      const dy = Math.abs(y - goal.y);
      return Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
    };
    const heap = [];
    const push = (f, i) => {
      heap.push([f, i]);
      let n = heap.length - 1;
      while (n > 0) {
        const p = (n - 1) >> 1;
        if (heap[p][0] <= heap[n][0]) break;
        [heap[p], heap[n]] = [heap[n], heap[p]];
        n = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let n = 0;
        for (;;) {
          const l = 2 * n + 1;
          const r = l + 1;
          let m = n;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === n) break;
          [heap[m], heap[n]] = [heap[n], heap[m]];
          n = m;
        }
      }
      return top;
    };

    const s = idx(start.x, start.y);
    const goalI = idx(goal.x, goal.y);
    g[s] = 0;
    push(h(start.x, start.y), s);
    const dirs = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];

    while (heap.length) {
      const [, cur] = pop();
      if (cur === goalI) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cx = cur % cols;
      const cy = (cur - cx) / cols;
      for (const [dx, dy, cost] of dirs) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!this.ok(nx, ny)) continue;
        if (dx && dy && (!this.ok(cx + dx, cy) || !this.ok(cx, cy + dy))) continue; // não corta quina
        const ni = idx(nx, ny);
        const ng = g[cur] + cost;
        if (ng < g[ni]) {
          g[ni] = ng;
          from[ni] = cur;
          push(ng + h(nx, ny), ni);
        }
      }
    }
    if (from[goalI] === -1 && goalI !== s) return null;

    const cells = [];
    for (let i = goalI; i !== -1; i = from[i]) cells.push({ x: i % cols, y: Math.floor(i / cols) });
    cells.reverse();

    // suaviza: pula pontos intermediários quando há linha reta livre
    const out = [cells[0]];
    let anchor = 0;
    for (let i = 2; i < cells.length; i++) {
      if (!this.clear(cells[anchor], cells[i])) {
        out.push(cells[i - 1]);
        anchor = i - 1;
      }
    }
    if (cells.length > 1) out.push(cells[cells.length - 1]);
    return out;
  },
  // caminho em coordenadas do mapa, de "from" até "to"
  route(from, to) {
    if (!this.grid) return [to];
    const a = this.nearest(this.toCell(from));
    const b = this.nearest(this.toCell(to));
    const cells = this.astar(a, b);
    if (!cells) return [to];
    const pts = cells.map((c) => this.center(c));
    pts.push(to); // último trecho: da borda livre até a vaga (ex.: sentar atrás da mesa)
    return pts;
  },
  randomIn(r) {
    for (let i = 0; i < 200; i++) {
      const p = { x: r.x + Math.random() * r.w, y: r.y + Math.random() * r.h };
      const c = this.toCell(p);
      if (this.ok(c.x, c.y)) return this.center(c);
    }
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  },
};

function labelFor(agent) {
  const meta = agent.waiting ? WAITING : STATE_META[agent.state] || STATE_META.idle;
  return `${meta.icon}${agent.perf?.icon ? ' ' + agent.perf.icon : ''} ${clip(agent.name)}`;
}

// ------------------------------------------------------------------ cena

class Office extends Phaser.Scene {
  constructor() {
    super('office');
    this.sprites = new Map();
    this.occupancy = Object.fromEntries(Object.entries(SLOTS).map(([k, v]) => [k, v.map(() => null)]));
  }

  preload() {
    this.load.image(BG.key, BG.url);
    this.load.json('walkmask', '/assets/walkmask.json');
    this.load.spritesheet(SHEET.key, SHEET.url, { frameWidth: SHEET.fw, frameHeight: SHEET.fh });
  }

  create() {
    const mask = this.cache.json.get('walkmask');
    if (mask) Nav.load(mask);
    for (let r = 0; r < 8; r++) {
      const f = (i) => r * SHEET.cols + i;
      this.anims.create({ key: `down-${r}`, frames: this.anims.generateFrameNumbers(SHEET.key, { frames: [f(1), f(2)] }), frameRate: 6, repeat: -1 });
      this.anims.create({ key: `side-${r}`, frames: this.anims.generateFrameNumbers(SHEET.key, { frames: [f(3), f(4)] }), frameRate: 6, repeat: -1 });
    }

    // fundo
    this.add.image(0, 0, BG.key).setOrigin(0).setDepth(0);

    // pedaços do fundo desenhados por cima dos bonecos sentados (mesas e mesa de reunião)
    for (const piece of [...DESKS, ...TABLES]) {
      const { x, y, w, h } = piece.crop;
      this.add.image(0, 0, BG.key).setOrigin(0).setCrop(x, y, w, h).setDepth(10 + y + h);
    }

    // placas com o nome das salas
    for (const [key, p] of Object.entries(PLAQUES)) {
      const t = this.add
        .text(p.x, p.y, ROOMS[key].label, {
          ...TEXT, fontSize: `${FONT + 8}px`, color: '#3b2414',
          backgroundColor: '#d9a066', padding: { x: 18, y: 4 },
        })
        .setOrigin(0.5, 0)
        .setDepth(5);
      const g = this.add.graphics().setDepth(4);
      g.fillStyle(0x6b3e1f).fillRect(t.x - t.width / 2 - 5, t.y - 5, t.width + 10, t.height + 10);
    }

    this.fit();
    this.scale.on('resize', () => this.fit());

    this.tooltip = this.add
      .text(0, 0, '', {
        ...TEXT, fontSize: `${FONT}px`, color: '#efe9ff', backgroundColor: 'rgba(27,24,48,0.96)',
        padding: { x: 16, y: 10 }, wordWrap: { width: 460 }, lineSpacing: 4,
      })
      .setDepth(9999)
      .setVisible(false);
    this.input.on('pointermove', (p) => this.hover(p));
    this.input.on('pointerdown', (p) => {
      const hit = this.hitAt(p.worldX, p.worldY);
      if (!hit) return;
      const a = hit.agent;
      if (a.member) openChat(a.cwd, a.memberId);
      else {
        const cwd = a.cwd || currentAgents.find((x) => x.id === a.parentId)?.cwd;
        if (cwd) openChat(cwd, 'lead');
      }
    });

    connect(this);
  }

  fit() {
    const { width, height } = this.scale;
    const cam = this.cameras.main;
    cam.setZoom(Math.min(width / W, height / H));
    cam.centerOn(W / 2, H / 2);
  }

  hitAt(x, y) {
    let hit = null;
    for (const s of this.sprites.values()) {
      if (s.leaving) continue;
      const half = 14 * s.figScale;
      if (x > s.x - half && x < s.x + half && y > s.y - HEAD - 40 && y < s.y + 10) {
        if (!hit || s.y > hit.y) hit = s;
      }
    }
    return hit;
  }

  hover(p) {
    const hit = this.hitAt(p.worldX, p.worldY);
    this.game.canvas.style.cursor = hit ? 'pointer' : 'default';
    if (!hit) return this.tooltip.setVisible(false);
    const a = hit.agent;
    const meta = a.waiting ? WAITING : STATE_META[a.state] || STATE_META.idle;
    this.tooltip
      .setText(`${a.name}\n${meta.icon} ${meta.label}\n${a.detail || ''}\n(clique pra conversar)`)
      .setPosition(Math.min(hit.x + 30, W - 500), Math.max(hit.y - HEAD, 10))
      .setVisible(true);
  }

  // --- vagas
  claim(roomKey, id) {
    const occ = this.occupancy[roomKey];
    const i = occ.indexOf(null);
    if (i >= 0) {
      occ[i] = id;
      return { ...SLOTS[roomKey][i], roomKey, index: i };
    }
    const r = ROOMS[roomKey]; // sala lotada: fica num canto livre
    return { ...Nav.randomIn({ x: r.x + 40, y: r.y + 60, w: r.w - 80, h: r.h - 80 }), roomKey, index: -1 };
  }
  release(slot) {
    if (slot && slot.index >= 0) this.occupancy[slot.roomKey][slot.index] = null;
  }

  // --- caminho: sai pela porta da sala atual, anda no corredor, entra pela porta da sala de destino
  routeTo(s, target) {
    const path = [];
    let from = { x: s.x, y: s.y };
    if (from.x > W - 24) {
      // chegando de fora do mapa: entra pelo corredor
      from = { x: W - 24, y: HALL_Y };
      path.push(from);
    }
    s.path = [...path, ...Nav.route(from, target)];
  }


  spawn(agent) {
    const parent = agent.parentId && this.sprites.get(agent.parentId);
    const start = parent ? { x: parent.x + 40, y: parent.y } : ENTRANCE;
    const s = this.add.container(start.x, start.y);
    s.agentId = agent.id;
    s.agent = agent;
    s.path = [];
    s.leaving = false;
    s.slot = null;
    s.lane = HALL_Y + ((hash(agent.id) % 5) - 2) * 16;
    s.figScale = FIG * (agent.isSub ? 0.85 : 1);
    s.row = agent.member ? agent.rosterIndex % 8 : agent.role in ROLE_ROW ? ROLE_ROW[agent.role] : 4 + (hash(agent.id) % 4);

    s.ring = this.add.graphics();
    s.figure = this.add
      .sprite(0, 0, SHEET.key, s.row * SHEET.cols)
      .setOrigin(0.5, 1)
      .setScale((s.figScale * 42) / SHEET.content);

    s.labelBase = -42 * s.figScale - 10;
    s.labelY = s.labelBase;
    s.label = this.add
      .text(0, s.labelBase, labelFor(agent), {
        ...TEXT, fontSize: `${agent.isSub ? FONT - 4 : FONT}px`, color: '#ffffff',
        backgroundColor: 'rgba(28,24,44,0.92)', padding: { x: 12, y: 3 },
      })
      .setOrigin(0.5, 1);
    s.alert = this.add
      .text(0, s.labelBase, '!', {
        ...TEXT, fontSize: `${FONT + 10}px`, color: '#ffffff',
        backgroundColor: '#e53935', padding: { x: 14, y: 0 },
      })
      .setOrigin(1, 1)
      .setVisible(false);

    s.add([s.ring, s.figure, s.label, s.alert]);
    this.sprites.set(agent.id, s);
    return s;
  }

  drawRing(s, color, alpha) {
    s.ring.clear().fillStyle(color, alpha).fillEllipse(0, 0, 22 * s.figScale, 7 * s.figScale);
  }

  refresh(s, agent) {
    s.agent = agent;
    s.label.setText(labelFor(agent));
    s.label.setBackgroundColor(agent.waiting ? '#d93b3b' : 'rgba(28,24,44,0.92)');
    // com equipe grande, etiqueta só em quem está trabalhando ou precisa de você (passe o mouse pra ver os outros)
    s.label.setVisible(!(agent.member && agent.state === 'idle' && !agent.waiting));
    s.alert.setVisible(agent.waiting);
    this.drawRing(s, hexToInt(agent.color), 0.5);

    let roomKey = STATE_ROOM[agent.state] || 'lounge';
    // livres: lounge primeiro; lotou, espalha por salas com vaga (sem ninguém trabalhando nelas)
    if (roomKey === 'lounge' && s.slot?.roomKey !== 'lounge' && !this.occupancy.lounge.includes(null)) {
      const alt = ['meeting', 'library', 'web', 'terminal', 'desks'].find((k) => this.occupancy[k].includes(null));
      if (alt && !(s.slot && ['meeting', 'library', 'web', 'terminal', 'desks'].includes(s.slot.roomKey) && s.idleSpot)) roomKey = alt;
      else if (s.idleSpot && s.slot) roomKey = s.slot.roomKey;
    }
    s.idleSpot = agent.state === 'idle';
    if (!s.slot || s.slot.roomKey !== roomKey) {
      const target = this.claim(roomKey, agent.id);
      this.routeTo(s, target);
      this.release(s.slot);
      s.slot = target;
      const level = target.index >= 0 ? target.index % STAGGER[roomKey] : 0;
      s.labelY = s.labelBase - level * 52;
    }
    this.placeLabel(s);
  }

  isSitting(s) {
    return !s.path.length && !!s.slot?.sit;
  }

  placeLabel(s) {
    const walking = s.path.length > 0;
    const base = walking ? s.labelBase : s.labelY;
    const y = base + (this.isSitting(s) ? 0.19 * 42 * s.figScale : 0);
    if (s.label.y !== y) s.label.y = y;
    s.alert.setPosition(-s.label.width / 2 - 6, s.label.y);
  }

  leave(s) {
    s.leaving = true;
    this.release(s.slot);
    s.slot = null;
    s.alert.setVisible(false);
    s.path = [...Nav.route({ x: s.x, y: s.y }, { x: W - 24, y: s.lane }), { x: ENTRANCE.x, y: s.lane }];
  }

  // troca de andar: some todo mundo na hora e o novo andar entra do zero
  clearFloor() {
    for (const s of this.sprites.values()) s.destroy();
    this.sprites.clear();
    for (const k of Object.keys(this.occupancy)) this.occupancy[k].fill(null);
  }

  sync(list) {
    const seen = new Set();
    for (const agent of [...list].sort((a, b) => Number(a.isSub) - Number(b.isSub))) {
      seen.add(agent.id);
      const s = this.sprites.get(agent.id) ?? this.spawn(agent);
      this.refresh(s, agent);
    }
    for (const s of this.sprites.values()) if (!seen.has(s.agentId) && !s.leaving) this.leave(s);
    renderRoster(list);
  }

  update(time) {
    const delta = Math.min(time - (this.lastTime ?? time), 250);
    this.lastTime = time;

    for (const s of [...this.sprites.values()]) {
      if (s.path.length) {
        const p = s.path[0];
        const dx = p.x - s.x;
        const dy = p.y - s.y;
        const dist = Math.hypot(dx, dy);
        const step = (SPEED * delta) / 1000;
        if (dist <= step) {
          s.setPosition(p.x, p.y);
          s.path.shift();
          if (!s.path.length && s.leaving) {
            this.sprites.delete(s.agentId);
            s.destroy();
            continue;
          }
        } else {
          s.x += (dx / dist) * step;
          s.y += (dy / dist) * step;
        }
        const side = Math.abs(dx) > Math.abs(dy);
        s.figure.play(`${side ? 'side' : 'down'}-${s.row}`, true).setFlipX(side && dx < 0);
        s.figure.y = 0;
      } else {
        const sitting = this.isSitting(s);
        s.figure.stop().setFlipX(false).setFrame(s.row * SHEET.cols + (sitting ? 5 : 0));
        const st = s.agent.state;
        if (st === 'typing' || st === 'terminal') s.figure.y = -Math.abs(Math.sin(time / 70)) * 3;
        else if (st === 'reading' || st === 'web') s.figure.y = Math.sin(time / 400) * 2;
        else s.figure.y = 0;
      }
      this.placeLabel(s);

      if (s.agent.waiting) {
        const k = Math.sin(time / 160);
        s.alert.setScale(1 + k * 0.12);
        this.drawRing(s, 0xff5252, 0.45 + k * 0.3);
      } else {
        s.alert.setScale(1);
      }
      s.setDepth(10 + s.y);
    }
  }
}

// ------------------------------------------------------------------ painel lateral: utilidades

const $teams = document.getElementById('teams');
const $list = document.getElementById('agents');
const $empty = document.getElementById('empty');
const $conn = document.getElementById('conn');
const $chat = document.getElementById('chat');
const $history = document.getElementById('history');
const $chatBadge = document.getElementById('chat-badge');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ROLE_LABEL = { frontend: 'Front', qa: 'QA', designer: 'Designer', backend: 'Back', lead: 'Líder', specialist: 'Especialista' };
const STATE_LABEL = { idle: 'parado', working: 'trabalhando', blocked: 'bloqueado', waiting_fix: 'esperando correção', done: 'pronto' };
const OPEN_ISSUE = new Set(['open', 'reopened', 'in_progress']);
const RATING = { novo: '🆕 novo', bom: '👍 bom', 'atenção': '⚠️ atenção', ruim: '👎 ruim' };
const CRITERIA = { qualidade: 'Qualidade', entrega: 'Entrega', escopo: 'Escopo/protocolo', comunicacao: 'Comunicação', colaboracao: 'Colaboração' };
const TREND = { up: '↑ subindo', down: '↓ caindo', flat: '→ estável' };
const stars = (score) => {
  const n = Math.round((score ?? 0) / 20);
  return '★'.repeat(n) + '☆'.repeat(5 - n);
};

function perfBlock(t, p) {
  if (!p?.class) return '<div class="perf perf-none">⚪ Sem avaliações ainda</div>';
  const nameOf = (id) => (id === 'lead' ? 'Líder' : rosterEntry(t, id).name || ROLE_LABEL[id] || id);
  const bars = Object.entries(CRITERIA)
    .map(([k, label]) => {
      const v = p.byCriterion[k];
      const pct = v == null ? 0 : ((v - 1) / 4) * 100;
      return `<div class="bar"><span>${label}</span><i><b style="width:${pct}%" class="${v != null && v < 3 ? 'low' : v >= 4 ? 'high' : ''}"></b></i><em>${v ?? '—'}</em></div>`;
    })
    .join('');
  const rec = p.recommendation;
  return `<div class="perf perf-${p.class.key}">
    <div class="perf-top">
      <span class="perf-score">${p.class.icon} ${p.score}</span>
      <span class="perf-label">${esc(p.class.label)}</span>
      <span class="stars" aria-label="${Math.round(p.score / 20)} de 5 estrelas">${stars(p.score)}</span>
      ${p.trend ? `<span class="perf-trend t-${p.trend}">${TREND[p.trend]}</span>` : ''}
    </div>
    <div class="perf-bars">${bars}</div>
    <div class="perf-meta">${p.reviews.lead} do líder · ${p.reviews.peers} de colegas · líder ${p.parts.lead ?? '—'} · colegas ${p.parts.peers ?? '—'} · objetivo ${p.parts.objective ?? '—'}</div>
    ${rec ? `<div class="perf-rec rec-${esc(rec.key)}">➜ ${esc(rec.text)}${p.worst.length && rec.key !== 'manter' ? ` · focar em ${esc(p.worst.join(' e '))}` : ''}</div>` : ''}
    ${p.latest.length ? `<details class="perf-reviews"><summary>Últimas avaliações (${p.reviews.total})</summary>${p.latest
      .map((r) => `<div class="rv${r.reviewer === 'lead' ? ' rv-lead' : ''}">
          <div class="rv-top"><b>${esc(nameOf(r.reviewer))}</b> <span class="stars">${stars(r.score)}</span> <span>${r.round ? 'r' + esc(r.round) : ''}</span></div>
          ${r.delivery ? `<div class="rv-del">${esc(r.delivery)}</div>` : ''}
          <div class="rv-c">${esc(r.comment || '')}</div>
        </div>`)
      .join('')}</details>` : ''}
  </div>`;
}

function performancePanel(t, members) {
  const perf = t.performance;
  if (!perf || !members.length) return '';
  const ranked = members
    .map((a) => ({ a, p: t.memberInfo?.[a.memberId]?.perf }))
    .sort((x, y) => (y.p?.score ?? -1) - (x.p?.score ?? -1));
  const recs = perf.team || [];
  return `<div class="perf-panel">
    <h3 class="sub-title">Desempenho · média ${perf.teamAvg ?? '—'}</h3>
    ${(() => {
      const total = members.reduce((sum, a) => sum + (t.memberInfo?.[a.memberId]?.tokens || 0), 0);
      return total ? `<p class="team-tokens">🪙 ${fmtTokens(total)} consumidos pela equipe nesta sessão do escritório</p>` : '';
    })()}
    <ol class="ranking">${ranked
      .map(({ a, p }) => {
        const inf = t.memberInfo?.[a.memberId] || {};
        const avg = inf.tokens_known ? Math.round(inf.tokens / inf.tokens_known) : null;
        return `<li><span>${p?.class ? p.class.icon : '⚪'}</span><b>${esc(a.name)}</b><small>${avg ? `🪙 ${fmtTokens(avg).replace(' tokens', '')}/disp.` : ''}</small><em>${p?.score ?? '—'}</em>${p?.trend ? `<i class="t-${p.trend}">${{ up: '↑', down: '↓', flat: '→' }[p.trend]}</i>` : '<i></i>'}</li>`;
      })
      .join('')}</ol>
    ${recs
      .map((r) => {
        if (r.key === 'substituir') {
          const m = rosterEntry(t, r.member);
          return `<div class="rec-card rec-bad" data-cwd="${esc(t.cwd)}" data-task="${esc(t.task || '')}" data-member="${esc(r.member)}">
            <p>🔴 ${esc(r.text)}</p>
            ${t.task ? `<div class="actions"><button data-act="rec-fire" class="danger">Desligar ${esc(m.name || r.member)}</button><button data-act="rec-chance">Dar mais uma chance</button></div><p class="form-error" hidden></p>` : ''}
          </div>`;
        }
        if (r.key === 'contratar') {
          const role = rosterEntry(t, r.members?.[0]).role || 'frontend';
          return `<div class="rec-card rec-hire" data-cwd="${esc(t.cwd)}" data-task="${esc(t.task || '')}" data-role="${esc(role)}">
            <p>🧑‍💼 ${esc(r.text)}</p>
            ${t.task ? '<div class="actions"><button data-act="rec-hire" class="primary">Abrir contratação</button></div>' : ''}
          </div>`;
        }
        return '';
      })
      .join('')}
  </div>`;
}

const TYPE_LABEL = {
  path: 'arquivo', command: 'comando', tool: 'ferramenta', credential: 'credencial', environment: 'ambiente',
  access: 'acesso', dependency: 'dependência', decision: 'decisão', data: 'dados',
};

const drafts = {}; // texto digitado sobrevive às atualizações do painel
let currentAgents = [];
let currentTeams = [];
let currentHistory = [];
let activeTab = 'team';
// prédio: cada projeto é um andar
let allAgents = [];
let allTeams = [];
let allHistory = [];
let leadChats = {};
let loginState = { status: 'idle', message: '' };
let projects = [];
let floor = null;
try {
  floor = localStorage.getItem('office-floor');
} catch {
  floor = null;
}
let buildingOpen = true;

function fmtTime(iso) {
  return iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
}
function fmtDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${sec}s` : `${sec}s`;
}
const fmtTokens = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k tokens` : `${n} tokens`);

function markdown(text) {
  const src = String(text || '');
  if (window.marked && window.DOMPurify) {
    return window.DOMPurify.sanitize(window.marked.parse(src, { gfm: true, breaks: true }));
  }
  return esc(src).replace(/\n/g, '<br>');
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

// mantém foco, cursor e rolagem ao redesenhar um pedaço do painel
function preserve(container, render) {
  const active = document.activeElement;
  const focusKey = container.contains(active) ? active?.dataset?.draft : null;
  const selStart = active?.selectionStart;
  const selEnd = active?.selectionEnd;
  const scrolls = [...container.querySelectorAll('[data-scroll]')].map((el) => [el.dataset.scroll, el.scrollTop, el.scrollHeight - el.scrollTop - el.clientHeight < 40]);
  render();
  for (const [key, top, atBottom] of scrolls) {
    const el = container.querySelector(`[data-scroll="${CSS.escape(key)}"]`);
    if (el) el.scrollTop = atBottom ? el.scrollHeight : top;
  }
  if (focusKey) {
    const el = [...container.querySelectorAll('[data-draft]')].find((e) => e.dataset.draft === focusKey);
    if (el) {
      el.focus();
      if (typeof selStart === 'number' && el.setSelectionRange) el.setSelectionRange(selStart, selEnd);
    }
  }
}

async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'não deu certo');
  return data;
}

// ------------------------------------------------------------------ abas

const $tabs = document.querySelectorAll('.tabs button');
function showTab(name) {
  activeTab = name;
  for (const b of $tabs) b.setAttribute('aria-selected', String(b.dataset.tab === name));
  for (const el of document.querySelectorAll('.tab')) el.hidden = el.id !== `tab-${name}`;
  document.querySelector('.roster').classList.toggle('wide', chat.wide && name === 'chat');
  window.dispatchEvent(new Event('resize'));
  if (name === 'chat') renderChat(true);
}
$tabs.forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

// ------------------------------------------------------------------ sessões e agentes fora da equipe

function renderRoster(list) {
  const others = list.filter((a) => !a.member);
  $empty.hidden = list.length > 0 || currentTeams.length > 0;
  $list.innerHTML = others.length
    ? `<li class="list-title">Sessões e agentes avulsos</li>` +
      others
        .map((a) => {
          const meta = a.waiting ? WAITING : STATE_META[a.state] || STATE_META.idle;
          const color = a.waiting ? STATE_COLOR.waiting : STATE_COLOR[a.state] || STATE_COLOR.idle;
          return `<li class="agent${a.isSub ? ' sub' : ''}${a.waiting ? ' waiting' : ''}" style="--c:${esc(a.color)};--s:${color}">
            <span class="dot"></span>
            <div><strong>${esc(a.name)}</strong><span class="state">${meta.icon} ${esc(meta.label)}</span><p class="detail">${esc(a.detail)}</p></div>
          </li>`;
        })
        .join('')
    : '';
}

// ------------------------------------------------------------------ aba Equipe

function membersOfTeam(t) {
  return currentAgents.filter((a) => a.member && a.cwd === t.cwd).sort((a, b) => a.rosterIndex - b.rosterIndex);
}
function rosterEntry(t, memberId) {
  return t.roster.find((m) => m.id === memberId) || {};
}

function reqCard(t, r) {
  const key = `ans|${t.cwd}|${t.task}|${r.id}`;
  const isDecision = r.type === 'decision';
  const who = rosterEntry(t, r.from).name || ROLE_LABEL[r.from] || r.from;
  return `<div class="req${r.blocking === 'true' ? ' blocking' : ''}" data-cwd="${esc(t.cwd)}" data-task="${esc(t.task)}" data-id="${esc(r.id)}">
    <strong>⛔ ${esc(r.id)} · ${esc(who)} precisa de você</strong>
    <span>${esc(TYPE_LABEL[r.type] || r.type)}${r.blocking === 'true' ? ' · bloqueando' : ''}</span>
    <p>${esc(r.title)}</p>
    <textarea data-draft="${esc(key)}" rows="2" placeholder="${isDecision ? 'Sua resposta…' : 'Escopo ou observação (opcional)…'}">${esc(drafts[key] || '')}</textarea>
    <div class="actions">
      ${isDecision ? '<button data-act="answer" class="primary">Responder</button>' : '<button data-act="approve" class="primary">Aprovar</button><button data-act="deny">Negar</button><button data-act="answer">Só responder</button>'}
    </div>
    <p class="form-error" hidden></p>
  </div>`;
}

function answeredCard(r) {
  const label = { approve: 'aprovou', deny: 'negou', answer: 'respondeu' }[r.user_decision] || 'respondeu';
  return `<div class="req answered">
    <strong>✔ Você ${label} ${esc(r.id)}</strong>
    <span>${r.lead_notified !== 'true' ? 'aguardando o líder receber…' : 'entregue ao líder'}</span>
    ${r.user_note ? `<p>“${esc(r.user_note)}”</p>` : ''}
  </div>`;
}

function memberCard(t, a) {
  const r = rosterEntry(t, a.memberId);
  const info = t.memberInfo?.[a.memberId] || {};
  const fireKey = `fire|${t.cwd}|${a.memberId}`;
  const firing = drafts[`${fireKey}|open`];
  const state = a.waiting
    ? `<span class="m-state m-wait">✋ ${esc(a.detail)}</span>`
    : info.running
      ? `<span class="m-state m-run">● ${esc((STATE_META[a.state] || STATE_META.idle).label)} · ${esc(a.detail)}</span>`
      : `<span class="m-state m-idle">○ livre${info.last ? ` · último: ${esc(info.last.name)}` : ''}</span>`;
  const stats = [
    info.dispatches ? `${info.dispatches} disparo${info.dispatches > 1 ? 's' : ''}` : 'sem disparos ainda',
    info.done ? `✅ ${info.done}` : '',
    info.open_issues ? `${info.open_issues} issue${info.open_issues > 1 ? 's' : ''} abertas` : '',
    info.fixed_issues ? `${info.fixed_issues} resolvidas` : '',
    info.reopened_now ? `🔁 ${info.reopened_now} reabertas` : '',
  ].filter(Boolean).join(' · ');
  const avgTok = info.tokens_known ? Math.round(info.tokens / info.tokens_known) : null;
  const perFix = info.tokens && info.fixed_issues ? Math.round(info.tokens / info.fixed_issues) : null;
  const tokens = info.tokens
    ? `🪙 ${fmtTokens(info.tokens)} no total · ${fmtTokens(avgTok)}/disparo${perFix ? ` · ${fmtTokens(perFix)}/issue resolvida` : ''}`
    : '🪙 consumo aparece após o primeiro disparo';

  return `<li class="member" style="--c:${esc(a.color)}" data-cwd="${esc(t.cwd)}" data-task="${esc(t.task || '')}" data-member="${esc(a.memberId)}">
    <div class="m-top">
      <strong>${esc(a.name)}</strong>
      ${r.rating ? `<span class="m-rating">${esc(RATING[r.rating] || r.rating)}</span>` : ''}
    </div>
    <div class="m-meta">${esc(ROLE_LABEL[r.role] || r.role || ROLE_LABEL[a.role] || '')}${r.level ? ' · ' + esc(r.level) : ''}${r.prefix ? ' · ' + esc(r.prefix) : ''}${r.hired_by ? ` · contratado por ${r.hired_by === 'user' ? 'você' : 'líder'}` : ''}</div>
    ${state}
    ${r.scope ? `<p class="m-scope">${esc(r.scope)}</p>` : ''}
    <p class="m-stats">${esc(stats)}</p>
    <p class="m-tokens">${esc(tokens)}</p>
    ${perfBlock(t, info.perf)}
    ${r.notes ? `<details class="m-notes"><summary>Avaliação do líder</summary><p>${esc(r.notes)}</p></details>` : ''}
    <div class="actions">
      <button data-act="chat-with">💬 Conversar</button>
      ${t.task ? `<button data-act="fire-open">${firing ? 'Cancelar' : 'Desligar'}</button>` : ''}
    </div>
    ${firing ? `<div class="fire-form">
      <textarea data-draft="${esc(fireKey)}" rows="2" placeholder="Motivo (vai pro líder e fica registrado)…">${esc(drafts[fireKey] || '')}</textarea>
      <div class="actions"><button data-act="fire" class="danger">Confirmar desligamento</button></div>
      <p class="form-error" hidden></p>
    </div>` : ''}
  </li>`;
}

const HIRE_OPTIONS = [['frontend', 'Front'], ['qa', 'QA'], ['designer', 'Designer'], ['backend', 'Back'], ['specialist', 'Especialista (outro papel)']];
const WHEN_OPTIONS = [['now', 'Agora, em paralelo'], ['next', 'Depois da rodada atual'], ['later', 'Depois de fechar a task']];
const LEVEL_OPTIONS = [['senior', 'Sênior'], ['pleno', 'Pleno'], ['junior', 'Júnior']];

function hireBox(t) {
  const k = `hire|${t.cwd}|${t.task}`;
  const val = (f, d) => drafts[`${k}|${f}`] ?? d;
  const opt = (list, cur) => list.map(([v, l]) => `<option value="${v}"${cur === v ? ' selected' : ''}>${esc(l)}</option>`).join('');
  const role = val('role', 'frontend');
  const hires = (t.messages || []).filter((m) => m.kind === 'hire').reverse().slice(0, 3);
  return `<details class="hire" data-open-key="${esc(k)}|open"${drafts[`${k}|open`] ? ' open' : ''}>
    <summary>🧑‍💼 Contratar</summary>
    <div class="hire-form" data-cwd="${esc(t.cwd)}" data-task="${esc(t.task)}">
      <div class="row2">
        <label>Papel<select data-draft="${esc(k)}|role" data-field="role">${opt(HIRE_OPTIONS, role)}</select></label>
        <label>Nível<select data-draft="${esc(k)}|level" data-field="level">${opt(LEVEL_OPTIONS, val('level', 'senior'))}</select></label>
      </div>
      <input data-draft="${esc(k)}|title" data-field="title" placeholder="Nome do especialista (ex.: Performance)" value="${esc(val('title', ''))}"${role === 'specialist' ? '' : ' hidden'} />
      <textarea data-draft="${esc(k)}|text" data-field="task_text" rows="3" placeholder="O que vai fazer? Tela, fluxo, issues, critério de pronto…">${esc(val('text', ''))}</textarea>
      <input data-draft="${esc(k)}|scope" data-field="scope" placeholder="Escopo: arquivos/módulos (opcional)" value="${esc(val('scope', ''))}" />
      <div class="row2">
        <label>Quantos<select data-draft="${esc(k)}|count" data-field="count">${opt([['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5']], val('count', '1'))}</select></label>
        <label>Quando<select data-draft="${esc(k)}|when" data-field="when">${opt(WHEN_OPTIONS, val('when', 'now'))}</select></label>
      </div>
      <div class="actions"><button data-act="hire" class="primary">Contratar</button></div>
      <p class="form-error" hidden></p>
      ${hires.length ? `<ul class="msgs">${hires
        .map((m) => {
          const reply = t.replies?.[m.id];
          const state = reply ? '💬 líder respondeu' : m.delivered ? '✓ líder recebeu' : '⏳ aguardando o líder';
          return `<li><b>${esc(m.hire?.count > 1 ? `${m.hire.count}× ` : '')}${esc(m.hire?.title || 'Agente')}</b> ${state}<br><span>${esc(m.hire?.task || '')}</span></li>`;
        })
        .join('')}</ul>` : ''}
    </div>
  </details>`;
}

function renderTeams() {
  preserve($teams, () => {
    $teams.innerHTML = currentTeams
      .map((t) => {
        const reqs = t.requests.filter((r) => r.status === 'open').sort((a, b) => (b.blocking === 'true') - (a.blocking === 'true'));
        const answered = t.requests.filter((r) => r.user_decision && r.lead_notified !== 'true');
        const openIssues = t.issues.filter((i) => OPEN_ISSUE.has(i.status));
        const count = (sev) => openIssues.filter((i) => i.severity === sev).length;
        const fixed = t.issues.filter((i) => i.status === 'fixed').length;
        const top = openIssues.filter((i) => i.severity === 'P0' || i.severity === 'P1').slice(0, 5);
        const members = membersOfTeam(t);
        const fired = t.roster.filter((m) => m.status === 'fired');
        const running = members.filter((m) => t.memberInfo?.[m.memberId]?.running).length;
        const nameOf = (id) => rosterEntry(t, id).name || ROLE_LABEL[id] || id;

        return `<section class="team">
          <h2>${esc(t.title)}</h2>
          <p class="team-meta">${esc(t.project)}${t.task ? ' · ' + esc(t.task) : ' · sem task ativa'}${t.size ? ' · ' + esc(t.size) : ''}${t.spec ? ' · spec ' + esc(t.spec) : ''}</p>

          ${t.task ? reqs.map((r) => reqCard(t, r)).join('') : ''}
          ${answered.map(answeredCard).join('')}

          ${performancePanel(t, members)}

          <h3 class="sub-title">Equipe · ${members.length} ativo${members.length === 1 ? '' : 's'} · ${running} trabalhando</h3>
          ${members.length ? `<ul class="members">${members.map((a) => memberCard(t, a)).join('')}</ul>` : '<p class="hint">O líder ainda não montou a equipe desta task.</p>'}
          ${fired.length ? `<details class="fired"><summary>Desligados (${fired.length})</summary>${fired
            .map((m) => `<p><b>${esc(m.name || m.id)}</b> · ${esc(ROLE_LABEL[m.role] || m.role)}${m.fired_at ? ' · ' + esc(m.fired_at) : ''}<br><span>${esc(m.fire_reason || 'sem motivo registrado')}</span></p>`)
            .join('')}</details>` : ''}

          ${t.task ? hireBox(t) : ''}

          ${t.task ? `<div class="sev">
            <span class="p0">P0 ${count('P0')}</span><span class="p1">P1 ${count('P1')}</span><span class="p2">P2 ${count('P2')}</span>
            <span class="fixed">${fixed} p/ verificar</span>
          </div>` : ''}
          ${top.length ? `<ul class="issues">${top
            .map((i) => `<li><b class="${esc(i.severity).toLowerCase()}">${esc(i.severity)}</b> ${esc(i.id)} · ${esc(nameOf(i.from))} → ${esc(nameOf(i.to))}<br><span>${esc(i.title)}</span></li>`)
            .join('')}</ul>` : ''}
          ${t.guard.length ? `<details class="guard"><summary>Bloqueios recentes do guard</summary>${t.guard.map((g) => `<p>${esc(g)}</p>`).join('')}</details>` : ''}
        </section>`;
      })
      .join('');
  });
}

// ------------------------------------------------------------------ aba Chat

const chat = { cwd: null, contact: 'lead', lastKey: '', picker: false, wide: false };
try {
  chat.wide = localStorage.getItem('office-chat-wide') === '1';
} catch {
  /* sem storage */
}
const unread = new Set();
let seenReplies = null; // ids de respostas já vistas (primeira carga não conta como novidade)

function updateBadge() {
  $chatBadge.textContent = unread.size ? String(unread.size) : '';
  $chatBadge.hidden = !unread.size;
}

function trackUnread() {
  const all = new Set();
  for (const t of allTeams) for (const id of Object.keys(t.replies || {})) all.add(`${t.cwd}|${id}`);
  for (const [cwd, lc] of Object.entries(leadChats)) for (const e of lc.entries || []) if (e.from === 'lead' && e.status !== 'running' && e.text) all.add(`${cwd}|${e.id}`);
  if (seenReplies) {
    for (const id of all) {
      if (seenReplies.has(id)) continue;
      const [cwd, msgId] = [id.slice(0, id.lastIndexOf('|')), id.slice(id.lastIndexOf('|') + 1)];
      const t = allTeams.find((x) => x.cwd === cwd);
      const m = t?.messages?.find((x) => x.id === msgId);
      const contactId = msgId.startsWith('L-') ? 'lead' : m ? m.member || (m.to === 'lead' ? 'lead' : m.to) : null;
      // conta como não lida se você não está olhando essa conversa agora
      if (!(activeTab === 'chat' && chat.cwd === cwd && chat.contact === contactId)) unread.add(id);
    }
  }
  seenReplies = all;
  updateBadge();
}

function contactsOf(t) {
  const lead = currentAgents.find((a) => !a.isSub && !a.member && a.cwd === t.cwd);
  const leadState = lead ? (lead.waiting ? WAITING.label : (STATE_META[lead.state] || STATE_META.idle).label) : 'sessão fechada';
  return [
    { id: 'lead', name: 'Líder', role: 'lead', color: '#b8a9ff', state: leadState, running: !!lead && lead.state !== 'idle', waiting: !!lead?.waiting },
    ...membersOfTeam(t).map((a) => ({
      id: a.memberId,
      name: a.name,
      role: rosterEntry(t, a.memberId).role || a.role || 'specialist',
      color: a.color,
      state: a.waiting ? 'precisa de você' : t.memberInfo?.[a.memberId]?.running ? (STATE_META[a.state] || STATE_META.idle).label : 'livre',
      running: !!t.memberInfo?.[a.memberId]?.running,
      waiting: a.waiting,
    })),
  ];
}

function threadOf(t, contactId) {
  if (contactId === 'lead') {
    const inbox = (t.messages || []).filter((m) => m.to === 'lead' && !m.member);
    const office = (leadChats[t.cwd]?.entries || []).map((e) => ({ ...e, lead: true }));
    return [...inbox, ...office].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  }
  return threadOfTeam(t, contactId);
}
function threadOfTeam(t, contactId) {
  return (t.messages || []).filter((m) => (contactId === 'lead' ? m.to === 'lead' && !m.member : m.member === contactId || (!m.member && m.to === contactId)));
}

function openChat(cwd, contactId) {
  if (cwd && cwd !== floor) setFloor(cwd);
  chat.cwd = cwd;
  chat.contact = contactId;
  showTab('chat');
  setTimeout(() => $chat.querySelector('.composer textarea')?.focus(), 0);
}

function unreadFor(t, contactId) {
  return threadOf(t, contactId).filter((m) => unread.has(`${t.cwd}|${m.id}`)).length;
}

// contatos com quem houve conversa, do mais recente pro mais antigo
function recentContacts(t) {
  const last = {};
  for (const m of t.messages || []) {
    const id = m.member || (m.to === 'lead' ? 'lead' : m.to);
    last[id] = m.at;
  }
  return Object.entries(last).sort((a, b) => String(b[1]).localeCompare(String(a[1]))).map(([id]) => id);
}

const GROUP_ORDER = ['lead', 'frontend', 'qa', 'designer', 'backend', 'specialist'];
const GROUP_LABEL = { lead: 'Liderança', frontend: 'Front', qa: 'QA', designer: 'Design', backend: 'Back / AppSec', specialist: 'Especialistas' };

function contactButton(t, c, selected) {
  const n = unreadFor(t, c.id);
  return `<button data-contact="${esc(c.id)}" aria-pressed="${selected}" style="--c:${esc(c.color)}" title="${esc(c.name)} · ${esc(c.state)}">
    <span class="c-dot${c.waiting ? ' c-wait' : c.running ? ' c-run' : ''}"></span><span class="c-name">${esc(c.name)}</span>${n ? `<span class="c-unread">${n}</span>` : ''}</button>`;
}

function renderChat(force = false) {
  document.querySelector('.roster').classList.toggle('wide', chat.wide && activeTab === 'chat');
  if (!floor) {
    $chat.innerHTML = '<p class="hint">Nenhum andar ainda. Adicione um projeto pelo prédio, à esquerda do mapa.</p>';
    chat.lastKey = '';
    return;
  }
  // andar sem time: só o líder, sem equipe (ele monta a equipe quando você pedir)
  const p = projects.find((x) => x.cwd === floor) || { name: floor };
  const t = currentTeams.find((x) => x.cwd === floor && x.task) || {
    cwd: floor, project: p.name, title: currentTeams.find((x) => x.cwd === floor)?.title || p.name, task: null,
    messages: [], replies: {}, roster: [], status: [], requests: [], issues: [], memberInfo: {},
  };
  chat.cwd = t.cwd;
  const contacts = contactsOf(t);
  if (!contacts.some((c) => c.id === chat.contact)) chat.contact = 'lead';
  const contact = contacts.find((c) => c.id === chat.contact);
  const thread = threadOf(t, contact.id);
  const search = (drafts[`chat-search|${t.cwd}`] || '').trim().toLowerCase();

  // atalhos: líder, quem está falando com você, quem está rodando agora (no máx. 8)
  const recent = recentContacts(t);
  const quickIds = [...new Set(['lead', contact.id, ...contacts.filter((c) => c.waiting).map((c) => c.id), ...recent, ...contacts.filter((c) => c.running).map((c) => c.id)])].slice(0, 8);
  const quick = quickIds.map((id) => contacts.find((c) => c.id === id)).filter(Boolean);

  const lc = leadChats[t.cwd] || { entries: [], running: false, mode: 'equilibrado', route: 'office' };
  const key = JSON.stringify([t.cwd, contact, chat.picker, chat.wide, search, [...unread].length, contacts.map((c) => [c.id, c.state, c.waiting]), thread.map((m) => [m.id, m.delivered, m.status, m.activity, (m.text || '').length, t.replies?.[m.id]?.text?.length || 0]), contact.id === 'lead' ? [lc.running, lc.mode, lc.route, lc.queued, loginState.status, loginState.message] : 0]);
  if (!force && key === chat.lastKey) return;
  chat.lastKey = key;

  const running = contacts.filter((c) => c.running).length;
  const waiting = contacts.filter((c) => c.waiting).length;
  const filtered = contacts.filter((c) => !search || c.name.toLowerCase().includes(search) || c.id.includes(search));
  const groups = GROUP_ORDER.map((g) => [g, filtered.filter((c) => (GROUP_ORDER.includes(c.role) ? c.role : 'specialist') === g)]).filter(([, list]) => list.length);

  const draftKey = `chat|${t.cwd}|${contact.id}`;
  preserve($chat, () => {
    $chat.innerHTML = `
      <p class="chat-floor">🏢 ${esc(t.project)} · ${esc(t.title)}</p>

      <div class="chat-bar">
        <button class="who" data-act="toggle-picker" aria-expanded="${chat.picker}" style="--c:${esc(contact.color)}">
          <span class="c-dot${contact.waiting ? ' c-wait' : contact.running ? ' c-run' : ''}"></span>
          <span class="who-text"><strong>${esc(contact.name)}</strong><small>${esc(contact.state)}</small></span>
          <span class="who-caret">${chat.picker ? '▴' : '▾'}</span>
        </button>
        <button class="icon-btn" data-act="toggle-wide" title="${chat.wide ? 'Voltar ao tamanho normal' : 'Expandir o chat pra ler melhor'}">${chat.wide ? '⇥' : '⇤'}</button>
      </div>

      ${chat.picker ? `<div class="picker">
          <input type="search" data-draft="chat-search|${esc(t.cwd)}" data-chat-search placeholder="Buscar entre ${contacts.length} pessoas…" value="${esc(drafts[`chat-search|${t.cwd}`] || '')}" />
          <p class="picker-sum">${running} trabalhando · ${waiting} precisando de você</p>
          <div class="picker-list" data-scroll="picker|${esc(t.cwd)}">
            ${groups.map(([g, list]) => `<div class="pg"><h4>${esc(GROUP_LABEL[g] || g)} <span>${list.length}</span></h4><div class="pg-items">${list.map((c) => contactButton(t, c, c.id === contact.id)).join('')}</div></div>`).join('') || '<p class="hint">Ninguém com esse nome.</p>'}
          </div>
        </div>` : `<div class="quick" aria-label="Atalhos de conversa">${quick.map((c) => contactButton(t, c, c.id === contact.id)).join('')}${contacts.length > quick.length ? `<button class="more" data-act="toggle-picker">+${contacts.length - quick.length}</button>` : ''}</div>`}

      ${contact.id === 'lead' ? leadBar(t, lc) : ''}

      <div class="thread" data-scroll="thread|${esc(t.cwd)}|${esc(contact.id)}">
        ${thread.length ? thread.map((m) => (m.lead ? leadBubble(t, m, contact) : bubble(t, m, contact))).join('') : `<p class="hint">Nenhuma conversa com ${esc(contact.name)} ainda. ${contact.id === 'lead' ? (t.task ? 'Pergunte o andamento, peça um plano, mude prioridades…' : 'Diga o que você quer fazer neste projeto. Ex.: <code>/team criar a tela de login seguindo o Figma …</code> ou só uma pergunta sobre o código.') : 'A mensagem chega nele na próxima ação (ou via líder, se ele não estiver rodando).'}</p>`}
      </div>

      <div class="composer" data-cwd="${esc(t.cwd)}" data-task="${esc(t.task)}" data-to="${esc(contact.id)}">
        <textarea data-draft="${esc(draftKey)}" rows="2" placeholder="Mensagem pra ${esc(contact.name)}… (Enter envia · Shift+Enter quebra linha)">${esc(drafts[draftKey] || '')}</textarea>
        <button data-act="send" class="primary send" title="Enviar">Enviar</button>
        <p class="form-error" hidden></p>
      </div>`;
  });
}

const MODE_LABEL = { cauteloso: 'Cauteloso', equilibrado: 'Equilibrado', livre: 'Livre' };
const MODE_HINT = {
  cauteloso: 'lê, planeja e escreve nos arquivos do time; pede antes de mexer no código',
  equilibrado: 'edita o projeto e roda lint, testes e build; pede antes de instalar, git que altera histórico e comandos destrutivos',
  livre: 'faz tudo que o Claude Code conseguir (o guard do time continua valendo)',
};

function leadBar(t, lc) {
  const route = lc.route === 'inbox'
    ? '💻 entregue na sessão aberta no seu terminal/VS Code'
    : lc.running ? `🖥️ trabalhando pelo escritório${lc.queued ? ` · ${lc.queued} na fila` : ''}` : '🖥️ roda pelo escritório, sem terminal';
  return `<div class="lead-bar" data-cwd="${esc(t.cwd)}">
    <span class="lb-route">${route}</span>
    <label title="${esc(MODE_HINT[lc.mode] || '')}">Autonomia
      <select data-lead-mode>${Object.entries(MODE_LABEL).map(([k, l]) => `<option value="${k}"${lc.mode === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
    </label>
    ${lc.running ? '<button data-act="lead-stop" class="danger">■ Parar</button>' : ''}
  </div>`;
}

function lastLoginId(t) {
  const list = leadChats[t.cwd]?.entries || [];
  for (let i = list.length - 1; i >= 0; i--) if (list[i].needsLogin) return list[i].id;
  return null;
}

// botões do login, conforme o escritório acompanha a janela do terminal
function loginControls(t, e) {
  const st = loginState.status;
  const msg = loginState.message ? `<p class="login-msg login-${esc(st)}">${esc(loginState.message)}</p>` : '';
  if (st === 'open' || st === 'checking') {
    return `${msg}<div class="actions"><button class="primary" disabled>⏳ ${st === 'open' ? 'Esperando você terminar o login…' : 'Conferindo o login…'}</button></div>`;
  }
  if (st === 'ok') {
    return `${msg}<div class="actions" data-cwd="${esc(t.cwd)}"><button data-act="lead-retry" data-id="${esc(e.id)}" class="primary">↻ Tentar de novo</button></div>`;
  }
  const label = st === 'failed' ? '🔑 Tentar o login de novo' : '🔑 Entrar na conta do Claude';
  return `${st === 'failed' ? msg : ''}<div class="actions"><button data-act="lead-login" class="primary">${label}</button></div>`;
}

function leadBubble(t, e, contact) {
  if (e.from === 'user') {
    const st = { queued: '⏳ na fila', sent: '✓ recebido', interrupted: '✓ recebido' }[e.status] || '✓';
    return `<div class="bubble me"><div class="b-text">${esc(e.text)}</div><div class="b-meta">${fmtTime(e.at)} · ${st}</div></div>`;
  }
  const running = e.status === 'running';
  const note = { error: '⚠️ terminou com erro', stopped: '■ parado por você', interrupted: '■ interrompido (o escritório fechou)' }[e.status];
  const cost = [e.tokens ? fmtTokens(e.tokens) : '', e.cost != null ? `US$ ${Number(e.cost).toFixed(2)}` : ''].filter(Boolean).join(' · ');
  return `<div class="bubble them${e.status === 'error' ? ' b-error' : ''}" style="--c:${esc(contact.color)}">
    <div class="b-head"><strong>Líder</strong>${!running && e.text ? `<button class="copy" data-copy-lead="${esc(`${t.cwd}|${e.id}`)}" title="Copiar resposta">📋 Copiar</button>` : ''}</div>
    ${e.text ? `<div class="b-md">${markdown(e.text)}</div>` : ''}
    ${running ? `<div class="b-live"><span class="dots" aria-hidden="true"></span>${esc(e.activity || 'pensando…')}</div>` : ''}
    ${e.needsLogin && e.id === lastLoginId(t) && !e.retried ? loginControls(t, e) : ''}
    ${note || cost ? `<div class="b-meta b-meta-them">${[note, cost].filter(Boolean).join(' · ')}</div>` : ''}
  </div>`;
}

function bubble(t, m, contact) {
  const reply = t.replies?.[m.id];
  const kindIcon = m.kind === 'hire' ? '🧑‍💼 ' : m.kind === 'fire' ? '🚪 ' : '';
  const shown = m.kind === 'hire' ? `Contratar ${m.hire?.count > 1 ? `${m.hire.count}× ` : ''}${m.hire?.title}: ${m.hire?.task}` : m.kind === 'fire' ? `Desligar ${m.fire?.name}${m.fire?.reason ? ': ' + m.fire.reason : ''}` : m.text;
  const status = reply ? '💬 respondeu' : m.delivered ? '✓ entregue' : '⏳ aguardando entrega';
  const replier = reply ? rosterEntry(t, reply.from).name || ROLE_LABEL[reply.from] || contact.name : '';
  return `<div class="bubble me">
      <div class="b-text">${kindIcon}${esc(shown)}</div>
      <div class="b-meta">${fmtTime(m.at)} · ${status}</div>
    </div>
    ${reply ? `<div class="bubble them" style="--c:${esc(contact.color)}">
      <div class="b-head"><strong>${esc(replier)}</strong><button class="copy" data-copy="${esc(`${t.cwd}|${m.id}`)}" title="Copiar resposta">📋 Copiar</button></div>
      <div class="b-md">${markdown(reply.text)}</div>
    </div>` : ''}`;
}

// ------------------------------------------------------------------ aba Histórico

const RESULT = {
  done: { icon: '✅', label: 'pronto' },
  issues: { icon: '🔁', label: 'abriu issues' },
  req: { icon: '⛔', label: 'pediu permissão' },
  blocked: { icon: '🚧', label: 'bloqueado' },
  finished: { icon: '✔', label: 'terminou' },
};
const ROLE_COLOR = { frontend: '#29b6f6', qa: '#8bc34a', designer: '#ec407a', backend: '#ffb300' };

function renderHistory() {
  const items = currentHistory;
  $history.innerHTML = items.length
    ? items
        .map((h) => {
          const running = !h.endedAt;
          const r = RESULT[h.result?.kind] || RESULT.finished;
          const team = currentTeams.find((t) => t.cwd === h.cwd);
          const who = (h.memberId && team && rosterEntry(team, h.memberId).name) || ROLE_LABEL[h.role] || h.type;
          const status = running ? '<span class="h-run">● em andamento</span>' : `<span class="h-res h-${esc(h.result?.kind || 'finished')}">${h.result?.text ? esc(h.result.text) : `${r.icon} ${r.label}`}</span>`;
          return `<li style="--c:${ROLE_COLOR[h.role] || '#9e9e9e'}">
            <div class="h-top"><strong>${esc(h.name)}</strong><span class="h-time" data-start="${h.startedAt}"${running ? '' : ` data-end="${h.endedAt}"`}>${fmtDuration((h.endedAt || Date.now()) - h.startedAt)}</span></div>
            <div class="h-meta">${esc(who)} · ${esc(h.project)}${h.tokens ? ' · ' + fmtTokens(h.tokens) : ''}</div>
            ${status}
          </li>`;
        })
        .join('')
    : '<p class="hint">Os subagentes disparados aparecem aqui, com tempo e resultado.</p>';
}

setInterval(() => {
  for (const el of $history.querySelectorAll('.h-time[data-start]:not([data-end])')) {
    el.textContent = fmtDuration(Date.now() - Number(el.dataset.start));
  }
}, 1000);

// ------------------------------------------------------------------ eventos do painel

const $aside = document.querySelector('.roster');

$aside.addEventListener('input', (e) => {
  if (e.target.dataset.draft) drafts[e.target.dataset.draft] = e.target.value;
  if (e.target.matches('[data-chat-search]')) renderChat(true);
  if (e.target.matches('.composer textarea')) {
    e.target.style.height = 'auto';
    e.target.style.height = `${e.target.scrollHeight + 4}px`;
  }
});
$aside.addEventListener('change', (e) => {
  if (e.target.dataset.draft) drafts[e.target.dataset.draft] = e.target.value;
  if (e.target.dataset.field === 'role') {
    e.target.closest('.hire-form').querySelector('[data-field="title"]').hidden = e.target.value !== 'specialist';
  }
  if (e.target.matches('[data-lead-mode]')) {
    post('/api/lead/mode', { cwd: e.target.closest('[data-cwd]').dataset.cwd, mode: e.target.value }).catch(() => {});
  }
  if (e.target.dataset.actChange === 'team') {
    chat.cwd = e.target.value;
    chat.contact = 'lead';
    renderChat(true);
  }
});
$aside.addEventListener('toggle', (e) => {
  if (e.target.dataset?.openKey) drafts[e.target.dataset.openKey] = e.target.open;
}, true);

$chat.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && chat.picker) {
    chat.picker = false;
    renderChat(true);
    $chat.querySelector('.who')?.focus();
    return;
  }
  if (e.key === 'Enter' && !e.shiftKey && e.target.matches('.composer textarea')) {
    e.preventDefault();
    e.target.closest('.composer').querySelector('[data-act="send"]').click();
  }
});

$aside.addEventListener('click', async (e) => {
  const contactBtn = e.target.closest('[data-contact]');
  if (contactBtn) {
    chat.contact = contactBtn.dataset.contact;
    chat.picker = false;
    const t = currentTeams.find((x) => x.cwd === chat.cwd);
    if (t) for (const m of threadOf(t, chat.contact)) unread.delete(`${t.cwd}|${m.id}`);
    updateBadge();
    renderChat(true);
    $chat.querySelector('.composer textarea')?.focus();
    return;
  }

  const copyLead = e.target.closest('[data-copy-lead]');
  if (copyLead) {
    const k = copyLead.dataset.copyLead;
    const [cwd, id] = [k.slice(0, k.lastIndexOf('|')), k.slice(k.lastIndexOf('|') + 1)];
    await copyText(leadChats[cwd]?.entries?.find((x) => x.id === id)?.text || '');
    copyLead.textContent = '✔ Copiado';
    setTimeout(() => (copyLead.textContent = '📋 Copiar'), 1500);
    return;
  }
  const copyBtn = e.target.closest('[data-copy]');
  if (copyBtn) {
    const [cwd, id] = [copyBtn.dataset.copy.slice(0, copyBtn.dataset.copy.lastIndexOf('|')), copyBtn.dataset.copy.slice(copyBtn.dataset.copy.lastIndexOf('|') + 1)];
    const text = currentTeams.find((t) => t.cwd === cwd)?.replies?.[id]?.text || '';
    await copyText(text);
    copyBtn.textContent = '✔ Copiado';
    setTimeout(() => (copyBtn.textContent = '📋 Copiar'), 1500);
    return;
  }

  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;

  if (act === 'lead-login') {
    btn.disabled = true;
    try {
      await post('/api/lead/login', {});
    } catch (ex) {
      btn.disabled = false;
      btn.textContent = ex.message;
    }
    return;
  }
  if (act === 'lead-retry') {
    btn.disabled = true;
    await post('/api/lead/retry', { cwd: btn.closest('[data-cwd]').dataset.cwd, id: btn.dataset.id }).catch(() => (btn.disabled = false));
    return;
  }
  if (act === 'lead-stop') {
    btn.disabled = true;
    await post('/api/lead/stop', { cwd: btn.closest('[data-cwd]').dataset.cwd }).catch(() => {});
    return;
  }
  if (act === 'toggle-picker') {
    chat.picker = !chat.picker;
    renderChat(true);
    if (chat.picker) $chat.querySelector('[data-chat-search]')?.focus();
    return;
  }
  if (act === 'toggle-wide') {
    chat.wide = !chat.wide;
    try {
      localStorage.setItem('office-chat-wide', chat.wide ? '1' : '0');
    } catch {
      /* sem storage */
    }
    renderChat(true);
    window.dispatchEvent(new Event('resize'));
    return;
  }

  if (act === 'chat-with') {
    const card = btn.closest('[data-member]');
    openChat(card.dataset.cwd, card.dataset.member);
    return;
  }
  if (act === 'rec-hire') {
    const card = btn.closest('[data-role]');
    const k = `hire|${card.dataset.cwd}|${card.dataset.task}`;
    drafts[`${k}|open`] = true;
    drafts[`${k}|role`] = card.dataset.role;
    renderTeams();
    $teams.querySelector('.hire')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (act === 'rec-fire' || act === 'rec-chance') {
    const card = btn.closest('[data-member]');
    const err = card.querySelector('.form-error');
    const name = rosterEntry(currentTeams.find((x) => x.cwd === card.dataset.cwd) || { roster: [] }, card.dataset.member).name || card.dataset.member;
    btn.disabled = true;
    try {
      if (act === 'rec-fire') {
        await post('/api/team/fire', { cwd: card.dataset.cwd, task: card.dataset.task, member: card.dataset.member, reason: 'Placar de desempenho em Crítico (recomendação: desligar e substituir).' });
      } else {
        await post('/api/team/message', {
          cwd: card.dataset.cwd,
          task: card.dataset.task,
          to: 'lead',
          text: `Dê mais uma chance para ${name} (${card.dataset.member}): na próxima rodada, plano de melhoria focado nos piores critérios do placar, tarefas menores e revisão logo em seguida. Se continuar Crítico depois disso, pode desligar.`,
        });
      }
      openChat(card.dataset.cwd, 'lead');
    } catch (ex) {
      if (err) {
        err.textContent = `Não enviado: ${ex.message}`;
        err.hidden = false;
      }
    } finally {
      btn.disabled = false;
    }
    return;
  }
  if (act === 'fire-open') {
    const card = btn.closest('[data-member]');
    const k = `fire|${card.dataset.cwd}|${card.dataset.member}|open`;
    drafts[k] = !drafts[k];
    renderTeams();
    return;
  }

  const box = btn.closest('[data-task]');
  const err = box.querySelector('.form-error');
  const textarea = box.querySelector('textarea');
  const base = { cwd: box.dataset.cwd, task: box.dataset.task };
  const fields = Object.fromEntries([...box.querySelectorAll('[data-field]')].map((el) => [el.dataset.field, el.value]));

  let url;
  let body;
  if (act === 'send' && box.dataset.to === 'lead') [url, body] = ['/api/lead/send', { cwd: base.cwd, text: textarea.value }];
  else if (act === 'send') [url, body] = ['/api/team/message', { ...base, to: box.dataset.to, text: textarea.value }];
  else if (act === 'hire') [url, body] = ['/api/team/hire', { ...base, ...fields }];
  else if (act === 'fire') [url, body] = ['/api/team/fire', { ...base, member: box.dataset.member, reason: textarea.value }];
  else [url, body] = ['/api/team/answer', { ...base, id: box.dataset.id, decision: act, text: textarea.value }];

  box.querySelectorAll('button').forEach((b) => (b.disabled = true));
  try {
    await post(url, body);
    for (const el of box.querySelectorAll('textarea, input')) {
      if (el.dataset.field === 'title' || el.tagName === 'TEXTAREA' || el.dataset.field === 'scope') {
        delete drafts[el.dataset.draft];
        el.value = '';
      }
    }
    if (act === 'fire') {
      delete drafts[`fire|${base.cwd}|${box.dataset.member}|open`];
      openChat(base.cwd, 'lead');
    }
    if (act === 'hire') openChat(base.cwd, 'lead');
    if (err) err.hidden = true;
  } catch (ex) {
    if (err) {
      err.textContent = `Não enviado: ${ex.message}`;
      err.hidden = false;
    }
  } finally {
    box.querySelectorAll('button').forEach((b) => (b.disabled = false));
  }
});

function pickDefaultFloor() {
  if (floor && projects.some((p) => p.cwd === floor)) return floor;
  const byActivity = [...projects].sort((a, b) => b.waiting - a.waiting || b.working - a.working || b.lastActive - a.lastActive);
  return byActivity[0]?.cwd || null;
}

function applyFloor(scene, changed = false) {
  const next = pickDefaultFloor();
  if (next !== floor) changed = true;
  floor = next;
  currentAgents = allAgents.filter((a) => a.cwd === floor);
  currentTeams = allTeams.filter((t) => t.cwd === floor);
  currentHistory = allHistory.filter((h) => !h.cwd || h.cwd === floor);
  if (changed) {
    scene.clearFloor();
    chat.cwd = floor;
    chat.contact = 'lead';
    chat.lastKey = '';
  }
  scene.sync(currentAgents);
  renderBuilding();
  renderAll();
}

function setFloor(cwd) {
  floor = cwd;
  try {
    localStorage.setItem('office-floor', cwd);
  } catch {
    /* sem storage */
  }
  applyFloor(window.officeGame.scene.getScene('office'), true);
}

const $building = document.getElementById('building');
function renderBuilding() {
  const sorted = [...projects].sort((a, b) => a.name.localeCompare(b.name));
  const unreadBy = {};
  for (const id of unread) {
    const cwd = id.slice(0, id.lastIndexOf('|'));
    unreadBy[cwd] = (unreadBy[cwd] || 0) + 1;
  }
  $building.innerHTML = `
    <button class="b-toggle" data-building="toggle" aria-expanded="${buildingOpen}">🏢 ${buildingOpen ? 'Prédio' : `${esc(sorted.find((p) => p.cwd === floor)?.name || 'Prédio')} ▾`}</button>
    ${buildingOpen ? `<ol class="floors">${sorted
      .map((p, i) => ({ p, n: i + 1 }))
      .reverse()
      .map(({ p, n }) => `<li><button data-floor="${esc(p.cwd)}" aria-current="${p.cwd === floor}" title="${esc(p.cwd)}">
          <span class="f-n">${n}º</span>
          <span class="f-name">${p.online ? '' : '<b class="f-off" title="sem sessão do Claude Code aberta">◌</b> '}${esc(p.name)}${p.team ? '' : ' <em>sem time</em>'}</span>
          <span class="f-stats">${p.working ? `<i class="f-run">● ${p.working}</i>` : ''}${p.waiting ? `<i class="f-wait">✋ ${p.waiting}</i>` : ''}${unreadBy[p.cwd] ? `<i class="f-msg">💬 ${unreadBy[p.cwd]}</i>` : ''}</span>
        </button></li>`)
      .join('')}</ol><button class="b-add" data-building="add">＋ Adicionar andar</button>` : ''}`;
}

// ------------------------------------------------------------------ adicionar andar

const $floorDialog = document.getElementById('floor-dialog');
let scanCache = null;

async function openFloorDialog() {
  $floorDialog.showModal();
  renderFloorDialog('Procurando projetos no seu computador…');
  try {
    const r = await fetch('/api/floors/scan').then((x) => x.json());
    scanCache = r.repos || [];
  } catch {
    scanCache = [];
  }
  renderFloorDialog();
}

function renderFloorDialog(loading) {
  const q = ($floorDialog.querySelector('[data-scan-filter]')?.value || '').toLowerCase();
  const list = (scanCache || []).filter((r) => !q || r.path.toLowerCase().includes(q));
  $floorDialog.querySelector('.fd-body').innerHTML = `
    <label class="fd-label">Caminho da pasta
      <div class="fd-row"><input data-floor-path placeholder="C:\\Users\\voce\\Documents\\meu-projeto" /><button data-floor-add-path class="primary">Adicionar</button></div>
    </label>
    <p class="form-error" hidden></p>
    <h4>Projetos encontrados${scanCache ? ` (${scanCache.length})` : ''}</h4>
    ${loading ? `<p class="hint">${esc(loading)}</p>` : `
      <input data-scan-filter placeholder="Filtrar…" value="${esc(q)}" />
      <ul class="fd-list">${list.length ? list.map((r) => `<li><span title="${esc(r.path)}"><b>${esc(r.name)}</b><small>${esc(r.path)}</small></span>${r.added ? '<em>já é um andar</em>' : `<button data-floor-add="${esc(r.path)}">Adicionar</button>`}</li>`).join('') : '<li class="hint">Nenhum repositório git encontrado nas pastas comuns. Cole o caminho acima.</li>'}</ul>`}
    ${projects.length ? `<h4>Andares atuais</h4><ul class="fd-list">${projects.map((p) => `<li><span><b>${esc(p.name)}</b><small>${esc(p.cwd)}</small></span><button data-floor-hide="${esc(p.cwd)}" title="Some do prédio (os dados do time ficam guardados)">Ocultar</button></li>`).join('')}</ul>` : ''}`;
}

async function addFloor(path) {
  const err = $floorDialog.querySelector('.form-error');
  try {
    const r = await post('/api/floors/add', { path });
    if (scanCache) scanCache = scanCache.map((x) => (x.path.toLowerCase() === r.cwd.toLowerCase() ? { ...x, added: true } : x));
    setTimeout(() => setFloor(r.cwd), 300);
    $floorDialog.close();
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  }
}

$floorDialog.addEventListener('click', async (e) => {
  if (e.target === $floorDialog || e.target.closest('[data-fd-close]')) return $floorDialog.close();
  const add = e.target.closest('[data-floor-add]');
  if (add) return addFloor(add.dataset.floorAdd);
  if (e.target.closest('[data-floor-add-path]')) return addFloor($floorDialog.querySelector('[data-floor-path]').value);
  const hide = e.target.closest('[data-floor-hide]');
  if (hide) {
    await post('/api/floors/hide', { cwd: hide.dataset.floorHide }).catch(() => {});
    hide.closest('li').remove();
  }
});
$floorDialog.addEventListener('input', (e) => {
  if (e.target.matches('[data-scan-filter]')) {
    const pos = e.target.selectionStart;
    renderFloorDialog();
    const el = $floorDialog.querySelector('[data-scan-filter]');
    el.focus();
    el.setSelectionRange(pos, pos);
  }
});
$floorDialog.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('[data-floor-path]')) addFloor(e.target.value);
});
$building.addEventListener('click', (e) => {
  if (e.target.closest('[data-building="add"]')) {
    openFloorDialog();
    return;
  }
  if (e.target.closest('[data-building="toggle"]')) {
    buildingOpen = !buildingOpen;
    renderBuilding();
    return;
  }
  const b = e.target.closest('[data-floor]');
  if (b) setFloor(b.dataset.floor);
});

// ------------------------------------------------------------------ atualização

const $update = document.getElementById('update-banner');
const $version = document.getElementById('app-version');
function renderUpdate(u) {
  if (u?.current) {
    $version.hidden = false;
    $version.textContent = u.available ? `v${u.current} → v${u.latest}` : `v${u.current}`;
    $version.classList.toggle('has-update', !!u.available);
    $version.title = u.available ? 'Tem versão nova: veja o aviso logo abaixo' : 'Versão instalada';
  }
  if (!u || (!u.available && !u.updating)) {
    $update.hidden = true;
    return;
  }
  $update.hidden = false;
  $update.innerHTML = u.updating
    ? '⏳ Atualizando… o escritório volta sozinho em cerca de 1 minuto.'
    : `🆕 Versão ${esc(u.latest)} disponível (você tem ${esc(u.current)}).${u.notes ? ` <span>${esc(u.notes)}</span>` : ''} <button data-act-update>Atualizar agora</button>`;
}
$update.addEventListener('click', async (e) => {
  if (!e.target.closest('[data-act-update]')) return;
  e.target.disabled = true;
  try {
    await post('/api/update', {});
  } catch (ex) {
    $update.textContent = `Não deu pra atualizar: ${ex.message}`;
  }
});

function renderAll() {
  renderTeams();
  renderChat();
  renderHistory();
  trackUnread();
}

// ------------------------------------------------------------------ websocket

function connect(scene) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => {
    $conn.textContent = 'Ao vivo';
    $conn.dataset.on = 'true';
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'agents') {
      allAgents = msg.agents || [];
      allTeams = msg.teams || [];
      allHistory = msg.history || [];
      leadChats = msg.leadChats || {};
      loginState = msg.login || loginState;
      renderUpdate(msg.update);
      projects = msg.projects || [];
      applyFloor(scene);
    }
  };
  ws.onclose = () => {
    $conn.textContent = 'Servidor desligado, tentando reconectar…';
    $conn.dataset.on = 'false';
    setTimeout(() => connect(scene), 2000);
  };
}

// ------------------------------------------------------------------ boot

try {
  await Promise.all([document.fonts.load('26px "VT323"'), document.fonts.load('14px "Pixelify Sans"')]);
} catch {
  /* segue com a fonte de fallback */
}

window.Nav = Nav;
// o painel muda de largura (chat expandido): ajusta o mapa junto
let refreshTimer = null;
new ResizeObserver(() => {
  window.officeGame?.scale.refresh();
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => window.officeGame?.scale.refresh(), 120); // garante o tamanho final
}).observe(document.getElementById('game'));
window.officeGame = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#0f0b08',
  antialias: true,
  roundPixels: true,
  scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
  scene: Office,
});

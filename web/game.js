(() => {
  'use strict';

  if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, r) {
      r = Math.min(r || 0, Math.abs(w) / 2, Math.abs(h) / 2);
      this.beginPath();
      this.moveTo(x + r, y);
      this.arcTo(x + w, y, x + w, y + h, r);
      this.arcTo(x + w, y + h, x, y + h, r);
      this.arcTo(x, y + h, x, y, r);
      this.arcTo(x, y, x + w, y, r);
      this.closePath();
      return this;
    };
  }

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  const ui = document.getElementById('uiRoot');
  const TAU = Math.PI * 2;
  const DPR = Math.min(2, window.devicePixelRatio || 1);

  let W = 1280, H = 720;
  let last = performance.now();
  let shake = 0;
  let paused = false;
  let audioReady = false;
  let audioCtx = null;
  let musicGain = null;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const dist = (a, b, c, d) => Math.hypot(a - c, b - d);
  const rand = (a = 1, b = 0) => Math.random() * (a - b) + b;
  const choice = arr => arr[Math.floor(Math.random() * arr.length)];
  const nowSec = () => performance.now() / 1000;

  const COLORS = {
    bg: '#050906', ground: '#0a1510', ground2: '#0f2118', grid: 'rgba(103,255,183,.07)',
    accent: '#52ffae', cyan: '#5fdfff', warn: '#ffc85b', danger: '#ff5d6c', text: '#d7ffe9', steel: '#28352f'
  };

  const DEFAULT_SAVE = {
    version: 3,
    day: 1,
    resources: { energy: 70, water: 52, parts: 12, data: 0, medicine: 5 },
    base: { reactor: 0, filtration: 0, greenhouse: 0, mesh: 0, drone: 0, workshop: 0 },
    unlocked: ['base'],
    completedMissions: 0,
    highScore: 0,
    seenIntro: false,
    bestRun: { antenna: false, deaths: 0 }
  };

  const state = loadSave();
  let mode = 'menu';
  let toastTimer = 0;
  let toastText = '';

  const input = {
    keys: {},
    mx: 0, my: 0, mouseDown: false,
    moveX: 0, moveY: 0,
    touchMoveX: 0, touchMoveY: 0,
    fire: false, interact: false, scan: false,
    joyActive: false, joyId: null, joyCX: 0, joyCY: 0,
  };

  const game = {
    time: 0,
    camera: { x: 0, y: 0, tx: 0, ty: 0 },
    player: null,
    drone: null,
    enemies: [], pickups: [], obstacles: [], terminals: [], bullets: [], particles: [], lights: [], decals: [],
    weather: [],
    mission: null,
    objective: 'Return to base.',
    extractionOpen: false,
    score: 0,
    mapSeed: 868,
  };

  const missions = [
    {
      id: 'gardunha', name: 'Gardunha Relay', region: 'Serra da Gardunha',
      intro: 'Reactivate the buried relay under an abandoned fire lookout. Expect broken security drones and wet terrain.',
      difficulty: 1, goal: 3, width: 2600, height: 1900,
      palette: ['#0a1510', '#0f2118', '#121b15'], weather: 'rain'
    },
    {
      id: 'estrela', name: 'Frozen Node', region: 'Serra da Estrela',
      intro: 'The node is still broadcasting noise. Recover data caches and boot the antenna before the storm closes in.',
      difficulty: 2, goal: 4, width: 3000, height: 2100,
      palette: ['#0b1113', '#111e21', '#18282a'], weather: 'snow'
    },
    {
      id: 'marão', name: 'Black Ridge', region: 'Serra do Marão',
      intro: 'A dead convoy blocks the access road. Something is still feeding power into the old jammer array.',
      difficulty: 3, goal: 5, width: 3300, height: 2300,
      palette: ['#100f0b', '#1e1b12', '#29220f'], weather: 'ash'
    }
  ];

  function resize() {
    W = Math.floor(innerWidth); H = Math.floor(innerHeight);
    canvas.width = Math.floor(W * DPR); canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  addEventListener('resize', resize, { passive: true });
  resize();

  function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }
  function loadSave() {
    try {
      const raw = localStorage.getItem('blackout_garden_protocol_868_save');
      if (!raw) return deepClone(DEFAULT_SAVE);
      const parsed = JSON.parse(raw);
      return mergeSave(deepClone(DEFAULT_SAVE), parsed);
    } catch (e) { return deepClone(DEFAULT_SAVE); }
  }
  function mergeSave(base, saved) {
    for (const k in saved) {
      if (saved[k] && typeof saved[k] === 'object' && !Array.isArray(saved[k])) base[k] = mergeSave(base[k] || {}, saved[k]);
      else base[k] = saved[k];
    }
    return base;
  }
  function save() {
    localStorage.setItem('blackout_garden_protocol_868_save', JSON.stringify(state));
  }
  function resetSave() {
    localStorage.removeItem('blackout_garden_protocol_868_save');
    Object.assign(state, deepClone(DEFAULT_SAVE));
    showMenu();
  }

  function showToast(text, t = 2.2) {
    toastText = text;
    toastTimer = t;
    let el = document.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; ui.appendChild(el); }
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(el._to);
    el._to = setTimeout(() => el.classList.remove('show'), t * 1000);
  }

  function ensureAudio() {
    if (audioReady) return;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      musicGain = audioCtx.createGain();
      musicGain.gain.value = 0.045;
      musicGain.connect(audioCtx.destination);
      const osc = audioCtx.createOscillator();
      const filter = audioCtx.createBiquadFilter();
      osc.type = 'sawtooth'; osc.frequency.value = 55;
      filter.type = 'lowpass'; filter.frequency.value = 360; filter.Q.value = 7;
      osc.connect(filter); filter.connect(musicGain); osc.start();
      setInterval(() => {
        if (!audioCtx || audioCtx.state !== 'running') return;
        const t = audioCtx.currentTime;
        filter.frequency.cancelScheduledValues(t);
        filter.frequency.setValueAtTime(280 + Math.sin(t * .3) * 90, t);
      }, 200);
      audioReady = true;
    } catch (e) {}
  }
  function beep(freq = 280, dur = .08, type = 'triangle', gain = .05) {
    if (!audioCtx || audioCtx.state !== 'running') return;
    const t = audioCtx.currentTime;
    const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + .01); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g); g.connect(audioCtx.destination); o.start(t); o.stop(t + dur + .03);
  }

  function createMenuMarkup() {
    return `
      <div class="screen">
        <div class="menu-card">
          <div class="title-row">
            <div>
              <h1>Blackout<br><span>Garden</span></h1>
              <p class="subtitle"><b>Protocol 868</b> — offline survival action in a collapsed Portugal. Repair relays, recover parts, keep the base alive and rebuild a mountain Mesh network one dangerous mission at a time.</p>
            </div>
            <div class="badge">OFFLINE · SINGLE PLAYER</div>
          </div>
          <div class="actions">
            <button id="continueBtn">Continue</button>
            <button class="secondary" id="newRunBtn">New Game</button>
            <button class="secondary" id="baseBtn">Base</button>
          </div>
          <div class="grid3">
            <div class="panel"><h3>Explore</h3><p>Isometric missions with rain, fog, drones, loot, terminals and extraction.</p></div>
            <div class="panel"><h3>Upgrade</h3><p>Improve reactor, filtration, greenhouse, drone systems and Mesh range.</p></div>
            <div class="panel"><h3>Survive</h3><p>Energy, water, parts, data and medicine matter. Ignore systems and the base bleeds.</p></div>
          </div>
          <div class="stats">
            <div class="stat"><b>${state.day}</b><span>Day</span></div>
            <div class="stat"><b>${state.completedMissions}</b><span>Relays</span></div>
            <div class="stat"><b>${state.resources.parts}</b><span>Parts</span></div>
            <div class="stat"><b>${state.highScore}</b><span>Best Score</span></div>
          </div>
        </div>
      </div>`;
  }

  function showMenu() {
    mode = 'menu'; paused = false; ui.innerHTML = createMenuMarkup();
    document.getElementById('continueBtn').onclick = () => { ensureAudio(); showBase(); };
    document.getElementById('newRunBtn').onclick = () => { ensureAudio(); if (confirm('Reset save and start again?')) resetSave(); };
    document.getElementById('baseBtn').onclick = () => { ensureAudio(); showBase(); };
  }

  function showBase() {
    mode = 'base'; paused = false;
    const r = state.resources, b = state.base;
    const nextMission = missions[Math.min(state.completedMissions, missions.length - 1)];
    ui.innerHTML = `
    <div class="screen">
      <div class="base-card">
        <div class="title-row">
          <div>
            <h1>Base <span>Hub</span></h1>
            <p class="subtitle">Day ${state.day}. Bunker systems are stable enough for another sortie. Next target: <b>${nextMission.name}</b>, ${nextMission.region}.</p>
          </div>
          <div class="badge">${nextMission.region}</div>
        </div>
        <div class="stats">
          <div class="stat"><b>${r.energy}</b><span>Energy</span></div>
          <div class="stat"><b>${r.water}</b><span>Water</span></div>
          <div class="stat"><b>${r.parts}</b><span>Parts</span></div>
          <div class="stat"><b>${r.data}</b><span>Data</span></div>
          <div class="stat"><b>${r.medicine}</b><span>Medicine</span></div>
          <div class="stat"><b>${b.reactor}</b><span>Reactor</span></div>
          <div class="stat"><b>${b.mesh}</b><span>Mesh</span></div>
          <div class="stat"><b>${b.drone}</b><span>Drone</span></div>
        </div>
        <div class="grid2">
          <div class="panel"><h3>Mission Briefing</h3><p>${nextMission.intro}</p></div>
          <div class="panel"><h3>Controls</h3><p>Desktop: WASD/arrows move, mouse/tap fires EMP, E interacts, Q scan, Esc pause. Mobile: joystick + action buttons.</p></div>
        </div>
        <h3 style="margin:22px 0 0">Upgrades</h3>
        <div class="upgrades">
          ${upgradeCard('reactor','Reactor Core','More mission battery and stronger emergency lighting.', cost('reactor'), b.reactor)}
          ${upgradeCard('filtration','Water Filtration','Better water gain after successful missions.', cost('filtration'), b.filtration)}
          ${upgradeCard('greenhouse','Medicinal Grow','Produces medicine every completed mission.', cost('greenhouse'), b.greenhouse)}
          ${upgradeCard('mesh','Mesh Amplifier','Improves scan range and objective visibility.', cost('mesh'), b.mesh)}
          ${upgradeCard('drone','Drone Companion','Increases drone damage and enemy detection.', cost('drone'), b.drone)}
          ${upgradeCard('workshop','Workshop','Reduces future upgrade cost and improves loot salvage.', cost('workshop'), b.workshop)}
        </div>
        <div class="actions">
          <button id="launchBtn">Launch Mission</button>
          <button class="secondary" id="menuBtn">Main Menu</button>
          <button class="danger" id="resetBtn">Reset Save</button>
        </div>
      </div>
    </div>`;
    document.querySelectorAll('[data-upgrade]').forEach(btn => {
      btn.onclick = () => buyUpgrade(btn.dataset.upgrade);
    });
    document.getElementById('launchBtn').onclick = () => { ensureAudio(); startMission(nextMission); };
    document.getElementById('menuBtn').onclick = showMenu;
    document.getElementById('resetBtn').onclick = () => { if (confirm('Reset everything?')) resetSave(); };
  }

  function upgradeCard(id, title, desc, c, level) {
    return `<div class="upgrade"><h4>${title} Lv.${level}</h4><small>${desc}</small><div class="cost">Cost: ${c.parts} parts · ${c.data} data</div><div class="actions" style="margin-top:12px"><button data-upgrade="${id}">Upgrade</button></div></div>`;
  }
  function cost(id) {
    const lvl = state.base[id] || 0;
    const discount = Math.max(0, state.base.workshop || 0);
    return { parts: Math.max(2, 6 + lvl * 5 - discount), data: Math.max(0, lvl * 3 - discount) };
  }
  function buyUpgrade(id) {
    const c = cost(id); const r = state.resources;
    if (r.parts < c.parts || r.data < c.data) { showToast('Not enough resources. Salvage more parts/data.'); beep(120, .1, 'sawtooth', .05); return; }
    r.parts -= c.parts; r.data -= c.data; state.base[id] = (state.base[id] || 0) + 1; save(); beep(520, .11, 'triangle', .06); showBase();
  }

  function startMission(mission) {
    mode = 'mission'; paused = false; ui.innerHTML = missionUI();
    buildMission(mission);
    showToast(`${mission.name}: activate ${mission.goal} terminals, then raise antenna`, 3.2);
  }

  function missionUI() {
    return `
      <div class="hud">
        <div class="hud-panel">
          <div class="hud-top"><b>Protocol 868</b><span id="missionName"></span></div>
          <div class="bars">
            <div class="bar" title="Health"><i id="hpBar" style="width:100%"></i></div>
            <div class="bar" title="Battery"><i id="batBar" style="width:100%"></i></div>
            <div class="bar red" title="Threat"><i id="threatBar" style="width:20%"></i></div>
          </div>
        </div>
        <div class="hud-panel objective" id="objectiveText">Booting field terminal...</div>
      </div>
      <div class="controls">
        <div class="joystick" id="joystick"><div class="stick" id="stick"></div></div>
        <div class="action-pad">
          <div class="action-btn" id="fireBtn">EMP</div>
          <div class="action-btn" id="scanBtn">SCAN</div>
          <div class="action-btn big" id="interactBtn">INTERACT</div>
        </div>
      </div>`;
  }

  function buildMission(mission) {
    game.time = 0; game.mission = mission; game.enemies = []; game.pickups = []; game.obstacles = []; game.terminals = [];
    game.bullets = []; game.particles = []; game.lights = []; game.decals = []; game.weather = [];
    game.extractionOpen = false; game.score = 0;
    const hpBonus = state.base.reactor * 8;
    game.player = {
      x: 220, y: mission.height - 240, r: 19, hp: 100, maxHp: 100, battery: 100 + hpBonus, maxBattery: 100 + hpBonus,
      speed: 218, aimX: 1, aimY: 0, fireCd: 0, scanCd: 0, invuln: 0, facing: 0, alive: true,
      loot: { energy: 0, water: 0, parts: 0, data: 0, medicine: 0 }, interactT: 0
    };
    game.drone = { x: 180, y: mission.height - 300, r: 10, t: 0, fireCd: 0 };
    game.camera.x = game.player.x - W/2; game.camera.y = game.player.y - H/2;
    game.camera.tx = game.camera.x; game.camera.ty = game.camera.y;
    const rng = mulberry32(hash(mission.id) + state.completedMissions * 913);

    // Perimeter and ruin chunks
    for (let i = 0; i < 80 + mission.difficulty * 22; i++) {
      const kind = rng() < .45 ? 'rock' : rng() < .72 ? 'wall' : rng() < .88 ? 'pipe' : 'tree';
      const x = lerp(170, mission.width - 170, rng());
      const y = lerp(160, mission.height - 160, rng());
      if (dist(x,y,game.player.x,game.player.y) < 250) continue;
      game.obstacles.push(makeObstacle(kind, x, y, rng));
    }
    // Dead road and technical props
    for (let i = 0; i < 22; i++) game.decals.push({ x: 170 + i * 118 + rng()*30, y: mission.height*.58 + Math.sin(i*.8)*45, kind:'road' });
    for (let i = 0; i < 15; i++) game.obstacles.push(makeObstacle('tech', lerp(300, mission.width-360, rng()), lerp(300, mission.height-340, rng()), rng));

    // Terminals around map
    const positions = [
      [mission.width*.22, mission.height*.24], [mission.width*.77, mission.height*.25],
      [mission.width*.50, mission.height*.52], [mission.width*.24, mission.height*.73], [mission.width*.77, mission.height*.72]
    ];
    for (let i=0;i<mission.goal;i++) {
      const p = positions[i];
      game.terminals.push({ x:p[0]+rng()*120-60, y:p[1]+rng()*90-45, r:34, active:false, progress:0, name:['Power Coupler','Packet Router','Weather Probe','Battery Bank','Jammer Bypass'][i] || 'Relay' });
    }
    game.terminals.push({ x: mission.width - 260, y: 220, r: 54, active: false, progress: 0, antenna: true, name:'868 MHz Antenna' });

    // Enemies
    const enemyCount = 5 + mission.difficulty * 4;
    for (let i=0;i<enemyCount;i++) {
      const type = rng() < .52 ? 'drone' : rng() < .8 ? 'crawler' : 'turret';
      let x, y;
      do { x = lerp(320, mission.width-320, rng()); y = lerp(260, mission.height-260, rng()); } while (dist(x,y,game.player.x,game.player.y) < 450);
      game.enemies.push(makeEnemy(type, x, y, rng));
    }

    // Pickups
    const types = ['energy','water','parts','data','medicine'];
    for (let i=0;i<34 + mission.difficulty*9;i++) {
      let x = lerp(180, mission.width-180, rng()), y = lerp(160, mission.height-160, rng());
      if (dist(x,y,game.player.x,game.player.y)<180) { x += 240; y -= 120; }
      game.pickups.push({ x, y, r: 12, type: choice(types), phase: rng()*TAU, value: 1 + Math.floor(rng()*3), collected:false });
    }

    for (let i=0;i<160;i++) game.weather.push({ x:rng()*W, y:rng()*H, z:rng(), sp: lerp(220, 620, rng()), len: lerp(12, 32, rng()) });
    document.getElementById('missionName').textContent = mission.name;
    updateObjective();
  }

  function makeObstacle(kind, x, y, rng) {
    const size = kind === 'wall' ? lerp(52, 130, rng()) : kind === 'pipe' ? lerp(40, 90, rng()) : kind === 'tech' ? lerp(42, 80, rng()) : lerp(34, 92, rng());
    return { kind, x, y, w: size, h: size * lerp(.62, 1.45, rng()), r: size*.42, rot: rng()*TAU, hp: 999 };
  }
  function makeEnemy(type, x, y, rng) {
    const base = type === 'turret' ? 64 : type === 'crawler' ? 42 : 34;
    return { type, x, y, sx:x, sy:y, r: base*.45, hp: type==='turret'?70: type==='crawler'?48:38, maxHp: type==='turret'?70: type==='crawler'?48:38,
      speed: type==='crawler'?112:type==='drone'?92:0, state:'patrol', a:rng()*TAU, t:rng()*10, fireCd:rng()*2, alert:0, dead:false };
  }
  function hash(str) { let h=2166136261; for (let i=0;i<str.length;i++) { h ^= str.charCodeAt(i); h = Math.imul(h,16777619); } return h>>>0; }
  function mulberry32(a) { return function() { let t = a += 0x6D2B79F5; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  function updateObjective() {
    const active = game.terminals.filter(t => !t.antenna && t.active).length;
    const goal = game.mission.goal;
    if (game.extractionOpen) game.objective = 'Extraction online. Return to the green flare at the southern gate.';
    else if (game.terminals.find(t => t.antenna)?.active) game.objective = 'Antenna raised. Reach extraction before the storm peaks.';
    else if (active >= goal) game.objective = 'All terminals active. Boot the 868 MHz antenna in the north-east.';
    else game.objective = `Activate field terminals: ${active}/${goal}. Collect parts/data and avoid hostile drones.`;
    const el = document.getElementById('objectiveText'); if (el) el.textContent = game.objective;
  }

  function update(dt) {
    if (mode !== 'mission' || paused || !game.player) return;
    game.time += dt;
    const p = game.player;
    if (!p.alive) return;

    let ax = 0, ay = 0;
    if (input.keys['w'] || input.keys['arrowup']) ay -= 1;
    if (input.keys['s'] || input.keys['arrowdown']) ay += 1;
    if (input.keys['a'] || input.keys['arrowleft']) ax -= 1;
    if (input.keys['d'] || input.keys['arrowright']) ax += 1;
    ax += input.touchMoveX; ay += input.touchMoveY;
    const len = Math.hypot(ax, ay) || 1; ax /= len; ay /= len;
    const speed = p.speed * (p.battery < 10 ? .7 : 1);
    if (Math.abs(ax)+Math.abs(ay)>0.05) {
      p.facing = Math.atan2(ay, ax); p.aimX = Math.cos(p.facing); p.aimY = Math.sin(p.facing);
      moveEntity(p, ax*speed*dt, ay*speed*dt);
      p.battery = clamp(p.battery - dt * (1.25 - state.base.reactor*.07), 0, p.maxBattery);
      if (Math.random()<dt*9) addParticle(p.x-rand(8,-8), p.y+12, 'dust');
    } else p.battery = clamp(p.battery + dt * (2.8 + state.base.reactor*.35), 0, p.maxBattery);

    p.fireCd = Math.max(0, p.fireCd - dt); p.scanCd = Math.max(0, p.scanCd - dt); p.invuln = Math.max(0, p.invuln - dt);
    if ((input.fire || input.mouseDown) && p.fireCd <= 0 && p.battery > 5) fireEMP();
    if ((input.scan || input.keys['q']) && p.scanCd <= 0 && p.battery > 10) doScan();
    handleInteractions(dt);
    updateDrone(dt); updateEnemies(dt); updateBullets(dt); updatePickups(dt); updateParticles(dt); updateWeather(dt);

    const ex = { x: 220, y: game.mission.height - 240 };
    if (game.extractionOpen && dist(p.x,p.y,ex.x,ex.y)<72) completeMission();

    // Storm pressure
    if (game.time > 300 && Math.random()<dt*.7) hurtPlayer(2, 'storm surge');
    updateCamera(dt); updateHUD();
  }

  function moveEntity(e, dx, dy) {
    e.x = clamp(e.x + dx, 50, game.mission.width - 50); e.y = clamp(e.y + dy, 50, game.mission.height - 50);
    for (const o of game.obstacles) {
      const d = dist(e.x,e.y,o.x,o.y), rr = e.r + o.r;
      if (d < rr) { const nx=(e.x-o.x)/(d||1), ny=(e.y-o.y)/(d||1); e.x=o.x+nx*rr; e.y=o.y+ny*rr; }
    }
  }
  function fireEMP() {
    const p = game.player;
    p.fireCd = .34; p.battery -= 4.2; beep(220, .05, 'square', .035); beep(660, .06, 'triangle', .025);
    let ax = p.aimX, ay = p.aimY;
    // Aim toward mouse if desktop/touch fire location is far
    const wx = input.mx + game.camera.x, wy = input.my + game.camera.y;
    if (dist(wx,wy,p.x,p.y) > 60) { const d = dist(wx,wy,p.x,p.y); ax=(wx-p.x)/d; ay=(wy-p.y)/d; }
    game.bullets.push({ x:p.x+ax*28, y:p.y+ay*28, vx:ax*620, vy:ay*620, r:7, life:.72, kind:'emp', friendly:true });
    for(let i=0;i<7;i++) addParticle(p.x+ax*22, p.y+ay*22, 'spark', ax, ay);
  }
  function doScan() {
    const p = game.player; p.scanCd = 5.5 - state.base.mesh*.35; p.battery -= 10; shake = 4; beep(132, .08, 'sine', .05); beep(528, .15, 'sine', .045);
    game.particles.push({ x:p.x, y:p.y, r:20, life:1.1, max:1.1, type:'scan' });
    const range = 260 + state.base.mesh*75;
    for (const e of game.enemies) if (!e.dead && dist(p.x,p.y,e.x,e.y)<range) { e.alert = 2.2; e.hp -= 10 + state.base.mesh*2; addParticle(e.x,e.y,'zap'); if (e.hp<=0) killEnemy(e); }
    for (const t of game.terminals) if (dist(p.x,p.y,t.x,t.y)<range) for(let i=0;i<10;i++) addParticle(t.x,t.y,'data');
  }

  function handleInteractions(dt) {
    const p = game.player; const want = input.interact || input.keys['e'];
    let near = null;
    for (const t of game.terminals) {
      if (t.active) continue;
      if (t.antenna && game.terminals.filter(x => !x.antenna && x.active).length < game.mission.goal) continue;
      const d = dist(p.x,p.y,t.x,t.y); if (d < t.r+42) { near = t; break; }
    }
    if (near && want) {
      near.progress += dt * (near.antenna ? .38 : .65) * (1 + state.base.mesh*.08);
      p.battery = clamp(p.battery - dt*3.3, 0, p.maxBattery);
      if (Math.random()<dt*22) addParticle(near.x+rand(28,-28), near.y+rand(20,-20), 'data');
      if (near.progress >= 1) {
        near.active = true; near.progress = 1; game.score += near.antenna ? 500 : 170;
        if (near.antenna) { game.extractionOpen = true; showToast('Antenna raised. Extraction beacon online.', 2.5); }
        else showToast(`${near.name} online.`, 1.8);
        beep(780, .08, 'triangle', .055); beep(1040, .12, 'triangle', .045); updateObjective();
      }
    }
  }
  function updateDrone(dt) {
    const p = game.player, d = game.drone; d.t += dt;
    const tx = p.x - Math.cos(p.facing)*55 + Math.sin(d.t*2)*16;
    const ty = p.y - Math.sin(p.facing)*55 + Math.cos(d.t*1.7)*16;
    d.x = lerp(d.x, tx, 1-Math.pow(.001, dt)); d.y = lerp(d.y, ty, 1-Math.pow(.001, dt));
    d.fireCd -= dt;
    if (d.fireCd <= 0) {
      let target = null, best = 250 + state.base.drone*45;
      for (const e of game.enemies) if (!e.dead) { const dd = dist(d.x,d.y,e.x,e.y); if (dd < best) { best=dd; target=e; } }
      if (target) {
        const dd = dist(d.x,d.y,target.x,target.y); const ax=(target.x-d.x)/dd, ay=(target.y-d.y)/dd;
        game.bullets.push({ x:d.x, y:d.y, vx:ax*520, vy:ay*520, r:4, life:.5, kind:'drone', friendly:true, dmg: 8 + state.base.drone*3 });
        d.fireCd = Math.max(.28, .9 - state.base.drone*.09); addParticle(d.x,d.y,'spark', ax, ay);
      }
    }
  }
  function updateEnemies(dt) {
    const p = game.player;
    for (const e of game.enemies) {
      if (e.dead) continue; e.t += dt; e.fireCd -= dt; e.alert = Math.max(0, e.alert-dt);
      const dd = dist(e.x,e.y,p.x,p.y);
      if (dd < (e.type==='turret'?440:300) || e.alert>0) e.state='chase'; else if (dd>520) e.state='patrol';
      if (e.state === 'chase') {
        if (e.type !== 'turret') {
          const ax=(p.x-e.x)/(dd||1), ay=(p.y-e.y)/(dd||1);
          moveEntity(e, ax*e.speed*dt, ay*e.speed*dt);
        }
        if (e.fireCd<=0 && dd < (e.type==='crawler'?54:520)) {
          if (e.type==='crawler') { hurtPlayer(13, 'crawler bite'); e.fireCd = 1.1; }
          else { enemyShoot(e); e.fireCd = e.type==='turret'?1.25:1.55; }
        }
      } else if (e.type !== 'turret') {
        const ax = Math.cos(e.a + Math.sin(e.t*.8)*.7), ay = Math.sin(e.a + Math.cos(e.t*.7)*.7);
        moveEntity(e, ax*e.speed*.32*dt, ay*e.speed*.32*dt);
        if (Math.random()<dt*.2) e.a += rand(1,-1);
      }
      if (Math.random()<dt*2) addParticle(e.x,e.y,e.type==='drone'?'spark':'dust');
    }
  }
  function enemyShoot(e) {
    const p = game.player, dd = dist(e.x,e.y,p.x,p.y); const ax=(p.x-e.x)/dd, ay=(p.y-e.y)/dd;
    game.bullets.push({ x:e.x+ax*18, y:e.y+ay*18, vx:ax*360, vy:ay*360, r:6, life:1.45, kind:'hostile', friendly:false, dmg:e.type==='turret'?15:10 });
    beep(95, .04, 'sawtooth', .025);
  }
  function updateBullets(dt) {
    for (const b of game.bullets) {
      b.x += b.vx*dt; b.y += b.vy*dt; b.life -= dt;
      if (Math.random()<.65) addParticle(b.x,b.y,b.friendly?'spark':'ember');
      if (b.friendly) {
        for (const e of game.enemies) if(!e.dead && dist(b.x,b.y,e.x,e.y)<b.r+e.r) { e.hp -= b.dmg || 22; b.life=0; e.alert=1.5; shake=3; for(let i=0;i<8;i++) addParticle(e.x,e.y,'zap'); if(e.hp<=0) killEnemy(e); break; }
      } else if (dist(b.x,b.y,game.player.x,game.player.y)<b.r+game.player.r) { b.life=0; hurtPlayer(b.dmg || 10, 'hostile fire'); }
      for (const o of game.obstacles) if (dist(b.x,b.y,o.x,o.y)<b.r+o.r*.75) { b.life=0; break; }
    }
    game.bullets = game.bullets.filter(b => b.life>0);
  }
  function killEnemy(e) {
    e.dead = true; game.score += e.type==='turret'?120:80; beep(70, .18, 'sawtooth', .04);
    for(let i=0;i<24;i++) addParticle(e.x,e.y, choice(['spark','zap','ember']));
    if (Math.random() < .66 + state.base.workshop*.04) game.pickups.push({ x:e.x+rand(25,-25), y:e.y+rand(25,-25), r:12, type: Math.random()<.55?'parts':'data', phase:rand(TAU), value:1+Math.floor(Math.random()*2), collected:false });
  }
  function hurtPlayer(amount, src) {
    const p = game.player; if (p.invuln>0) return;
    p.hp = clamp(p.hp - amount, 0, p.maxHp); p.invuln = .35; shake = Math.max(shake, 8); beep(55, .12, 'sawtooth', .04);
    for(let i=0;i<14;i++) addParticle(p.x,p.y,'ember');
    if (p.hp<=0) gameOver(src);
  }
  function gameOver(src) {
    const p = game.player; p.alive=false; state.bestRun.deaths++; state.highScore = Math.max(state.highScore, game.score); save();
    ui.innerHTML = `
    <div class="screen">
      <div class="pause-card">
        <h1>Signal <span>Lost</span></h1>
        <p class="subtitle">Field operator down: ${src}. Mission failed, but base telemetry was saved. Current score: <b>${game.score}</b>.</p>
        <div class="actions"><button id="retryBtn">Retry Mission</button><button class="secondary" id="toBaseBtn">Return to Base</button></div>
      </div>
    </div>`;
    document.getElementById('retryBtn').onclick = () => startMission(game.mission);
    document.getElementById('toBaseBtn').onclick = () => showBase();
  }
  function updatePickups(dt) {
    const p = game.player;
    for (const it of game.pickups) {
      if (it.collected) continue; it.phase += dt*2;
      const d = dist(p.x,p.y,it.x,it.y);
      if (d < 28) {
        it.collected = true; p.loot[it.type] += it.value; game.score += 15*it.value; beep(420 + Math.random()*180, .05, 'triangle', .025);
        for(let i=0;i<8;i++) addParticle(it.x,it.y,'data');
      } else if (d < 110) { it.x = lerp(it.x,p.x,dt*2.2); it.y=lerp(it.y,p.y,dt*2.2); }
    }
  }
  function completeMission() {
    const p = game.player; const r = state.resources;
    const gain = p.loot;
    const waterBonus = 2 + state.base.filtration * 3;
    const medBonus = state.base.greenhouse * 2;
    r.energy = clamp(r.energy + gain.energy + 14 - 3*game.mission.difficulty, 0, 150);
    r.water = clamp(r.water + gain.water + waterBonus, 0, 150);
    r.parts += gain.parts + 3 + state.base.workshop;
    r.data += gain.data + 2 + state.base.mesh;
    r.medicine += gain.medicine + medBonus;
    state.completedMissions = Math.min(state.completedMissions + 1, missions.length);
    state.day += 1;
    state.highScore = Math.max(state.highScore, game.score);
    state.bestRun.antenna = true;
    if (state.completedMissions >= missions.length) state.completedMissions = 0; // loop with higher base power
    save();
    beep(440, .1, 'triangle', .05); beep(880, .16, 'triangle', .04);
    ui.innerHTML = `
      <div class="screen"><div class="pause-card">
        <h1>Relay <span>Online</span></h1>
        <p class="subtitle">${game.mission.name} joined the 868 MHz network. Salvage recovered and base systems updated.</p>
        <div class="stats">
          <div class="stat"><b>+${gain.parts + 3 + state.base.workshop}</b><span>Parts</span></div>
          <div class="stat"><b>+${gain.data + 2 + state.base.mesh}</b><span>Data</span></div>
          <div class="stat"><b>+${gain.water + waterBonus}</b><span>Water</span></div>
          <div class="stat"><b>${game.score}</b><span>Score</span></div>
        </div>
        <div class="actions"><button id="baseAfterBtn">Return to Base</button><button class="secondary" id="nextAfterBtn">Next Mission</button></div>
      </div></div>`;
    document.getElementById('baseAfterBtn').onclick = () => showBase();
    document.getElementById('nextAfterBtn').onclick = () => startMission(missions[Math.min(state.completedMissions, missions.length - 1)]);
  }

  function updateParticles(dt) {
    for (const p of game.particles) { p.life -= dt; p.x += (p.vx||0)*dt; p.y += (p.vy||0)*dt; p.vx *= Math.pow(.1, dt); p.vy *= Math.pow(.1, dt); if (p.type==='scan') p.r += dt*520; }
    game.particles = game.particles.filter(p => p.life>0);
    shake = Math.max(0, shake - dt*22);
  }
  function updateWeather(dt) {
    for (const w of game.weather) { w.y += w.sp*dt; w.x += (game.mission.weather==='rain'?-80: game.mission.weather==='ash'?20:10)*dt*w.z; if(w.y>H+40){w.y=-40; w.x=Math.random()*W;} if(w.x<-60)w.x=W+40; if(w.x>W+60)w.x=-40; }
  }
  function addParticle(x,y,type,dx=rand(1,-1),dy=rand(1,-1)) {
    const sp = type==='spark'||type==='zap'?rand(160,40):rand(60,10);
    game.particles.push({ x,y, vx:dx*sp+rand(40,-40), vy:dy*sp+rand(40,-40), life:rand(.75,.25), max:.75, type, r:rand(5,2) });
  }
  function updateCamera(dt) {
    const p = game.player;
    game.camera.tx = clamp(p.x - W/2, 0, game.mission.width - W);
    game.camera.ty = clamp(p.y - H/2, 0, game.mission.height - H);
    game.camera.x = lerp(game.camera.x, game.camera.tx, 1-Math.pow(.0002, dt));
    game.camera.y = lerp(game.camera.y, game.camera.ty, 1-Math.pow(.0002, dt));
  }
  function updateHUD() {
    const p = game.player;
    const hp = document.getElementById('hpBar'), bat = document.getElementById('batBar'), th = document.getElementById('threatBar');
    if (hp) hp.style.width = `${clamp(p.hp/p.maxHp*100,0,100)}%`;
    if (bat) bat.style.width = `${clamp(p.battery/p.maxBattery*100,0,100)}%`;
    if (th) {
      const near = game.enemies.filter(e=>!e.dead && dist(e.x,e.y,p.x,p.y)<330).length;
      th.style.width = `${clamp(near*22 + game.mission.difficulty*8, 8, 100)}%`;
    }
  }

  function render() {
    ctx.save(); ctx.setTransform(DPR,0,0,DPR,0,0); ctx.fillStyle = COLORS.bg; ctx.fillRect(0,0,W,H);
    if (mode === 'mission' && game.player) renderMission(); else renderMenuBackground();
    ctx.restore();
  }

  function renderMenuBackground() {
    const t = nowSec();
    ctx.fillStyle = '#050906'; ctx.fillRect(0,0,W,H);
    const g = ctx.createRadialGradient(W*.5,H*.35,20,W*.5,H*.35,Math.max(W,H)*.8);
    g.addColorStop(0,'rgba(82,255,174,.11)'); g.addColorStop(.45,'rgba(95,223,255,.04)'); g.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
    ctx.strokeStyle = 'rgba(82,255,174,.05)'; ctx.lineWidth = 1;
    for(let x=-60+(t*12%60);x<W+60;x+=60){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x+H*.45,H);ctx.stroke();}
    for(let y=-60+(t*8%60);y<H+60;y+=60){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y+W*.15);ctx.stroke();}
  }

  function renderMission() {
    const p = game.player; const cam = game.camera;
    const sx = (Math.random()-.5)*shake, sy = (Math.random()-.5)*shake;
    ctx.save(); ctx.translate(-cam.x + sx, -cam.y + sy);
    drawGround(); drawDecals(); drawTerminals(false); drawPickups(); drawObstacles(); drawEnemies(); drawPlayer(); drawDrone(); drawBullets(); drawTerminals(true); drawExtraction(); drawParticlesWorld();
    ctx.restore();
    drawWeather(); drawMinimap(); drawPostFX();
  }
  function drawGround() {
    const m = game.mission; const cam = game.camera; const tile=96;
    const grad = ctx.createLinearGradient(0,0,m.width,m.height); grad.addColorStop(0,m.palette[0]); grad.addColorStop(.55,m.palette[1]); grad.addColorStop(1,m.palette[2]);
    ctx.fillStyle = grad; ctx.fillRect(0,0,m.width,m.height);
    const x0 = Math.floor(cam.x/tile)*tile, y0 = Math.floor(cam.y/tile)*tile;
    ctx.strokeStyle = COLORS.grid; ctx.lineWidth = 1;
    for(let x=x0; x<cam.x+W+tile; x+=tile){ ctx.beginPath(); ctx.moveTo(x, cam.y-100); ctx.lineTo(x, cam.y+H+100); ctx.stroke(); }
    for(let y=y0; y<cam.y+H+tile; y+=tile){ ctx.beginPath(); ctx.moveTo(cam.x-100, y); ctx.lineTo(cam.x+W+100, y); ctx.stroke(); }
    // Patches
    for (let i=0;i<game.decals.length;i++) {
      const d=game.decals[i]; if(!onScreen(d.x,d.y,220)) continue;
      if (d.kind==='road') { ctx.fillStyle='rgba(20,24,21,.45)'; ctx.beginPath(); ellipseRot(d.x,d.y,90,30,Math.sin(i)*.12); ctx.fill(); }
    }
    // world boundary glow
    ctx.strokeStyle='rgba(82,255,174,.12)'; ctx.lineWidth=6; ctx.strokeRect(30,30,m.width-60,m.height-60);
  }
  function drawDecals() {
    const t=game.time;
    for (const d of game.decals) if (onScreen(d.x,d.y,220) && d.kind==='road') {
      ctx.strokeStyle='rgba(95,223,255,.06)'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(d.x,d.y,34+Math.sin(t+d.x*.01)*3,0,TAU); ctx.stroke();
    }
  }
  function drawObstacles() {
    const obs = [...game.obstacles].sort((a,b)=>a.y-b.y);
    for (const o of obs) { if (!onScreen(o.x,o.y,o.w+100)) continue; drawObstacle(o); }
  }
  function drawObstacle(o) {
    ctx.save(); ctx.translate(o.x,o.y); ctx.rotate(o.rot*.08);
    if (o.kind==='wall') drawCrate(-o.w/2,-o.h*.35,o.w,o.h*.62,o.h*.55,'#29382f','#101812','#46574d');
    else if (o.kind==='pipe') { ctx.strokeStyle='rgba(170,210,190,.42)'; ctx.lineWidth=14; ctx.lineCap='round'; ctx.beginPath(); ctx.moveTo(-o.w/2,0); ctx.quadraticCurveTo(0,-o.h*.25,o.w/2,0); ctx.stroke(); ctx.strokeStyle='rgba(82,255,174,.18)'; ctx.lineWidth=3; ctx.stroke(); }
    else if (o.kind==='tree') { ctx.fillStyle='rgba(5,10,7,.55)'; ctx.beginPath(); ctx.ellipse(0,8,o.w*.55,o.w*.22,0,0,TAU); ctx.fill(); ctx.strokeStyle='rgba(71,59,42,.9)'; ctx.lineWidth=8; ctx.beginPath(); ctx.moveTo(0,16); ctx.lineTo(0,-o.h*.45); ctx.stroke(); ctx.fillStyle='rgba(34,64,45,.72)'; for(let i=0;i<4;i++){ ctx.beginPath(); ctx.ellipse(rand(o.w*.2,-o.w*.2),-o.h*.3+rand(20,-20),o.w*.28,o.w*.16,rand(.8,-.8),0,TAU); ctx.fill(); } }
    else if (o.kind==='tech') { drawCrate(-o.w/2,-o.h*.38,o.w,o.h*.62,o.h*.45,'#1a2925','#07100d','#394a40'); drawGlow(0,-o.h*.22,o.w*.42,'rgba(82,255,174,.16)'); ctx.fillStyle='rgba(82,255,174,.8)'; ctx.fillRect(-o.w*.2,-o.h*.42,o.w*.4,4); }
    else { ctx.fillStyle='rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(4,14,o.w*.48,o.w*.22,0,0,TAU); ctx.fill(); ctx.fillStyle='#1b241d'; ctx.beginPath(); ctx.moveTo(-o.w*.5,10); ctx.lineTo(-o.w*.25,-o.h*.2); ctx.lineTo(o.w*.15,-o.h*.36); ctx.lineTo(o.w*.55,-o.h*.02); ctx.lineTo(o.w*.36,o.h*.2); ctx.closePath(); ctx.fill(); ctx.strokeStyle='rgba(118,255,190,.06)'; ctx.stroke(); }
    ctx.restore();
  }
  function drawCrate(x,y,w,h,depth,front,side,top) {
    ctx.fillStyle='rgba(0,0,0,.32)'; ctx.beginPath(); ctx.ellipse(x+w/2,y+h+depth*.62,w*.58,depth*.28,0,0,TAU); ctx.fill();
    ctx.fillStyle=front; ctx.fillRect(x,y,w,h);
    ctx.fillStyle=side; ctx.beginPath(); ctx.moveTo(x+w,y); ctx.lineTo(x+w+depth*.38,y-depth*.24); ctx.lineTo(x+w+depth*.38,y+h-depth*.24); ctx.lineTo(x+w,y+h); ctx.closePath(); ctx.fill();
    ctx.fillStyle=top; ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x+depth*.38,y-depth*.24); ctx.lineTo(x+w+depth*.38,y-depth*.24); ctx.lineTo(x+w,y); ctx.closePath(); ctx.fill();
    ctx.strokeStyle='rgba(200,255,225,.08)'; ctx.strokeRect(x,y,w,h);
  }
  function drawTerminals(topPass) {
    for (const t of game.terminals) {
      if (!onScreen(t.x,t.y,160)) continue;
      if (!topPass) {
        ctx.save(); ctx.translate(t.x,t.y);
        if (t.antenna) {
          ctx.strokeStyle=t.active?'rgba(82,255,174,.45)':'rgba(95,223,255,.17)'; ctx.lineWidth=4;
          ctx.beginPath(); ctx.arc(0,0,t.r+10+Math.sin(game.time*3)*4,0,TAU); ctx.stroke();
        }
        ctx.fillStyle='rgba(0,0,0,.32)'; ctx.beginPath(); ctx.ellipse(0,18,t.r*1.1,t.r*.36,0,0,TAU); ctx.fill();
        ctx.restore();
      } else {
        ctx.save(); ctx.translate(t.x,t.y);
        if (t.antenna) {
          ctx.strokeStyle='#303f38'; ctx.lineWidth=6; ctx.beginPath(); ctx.moveTo(0,18); ctx.lineTo(0,-95); ctx.stroke();
          ctx.strokeStyle=t.active?COLORS.accent:'rgba(95,223,255,.7)'; ctx.lineWidth=3; ctx.beginPath(); ctx.moveTo(0,-72); ctx.lineTo(-48,-18); ctx.moveTo(0,-72); ctx.lineTo(48,-18); ctx.moveTo(-34,-48); ctx.lineTo(34,-48); ctx.stroke();
          if (t.active) { drawGlow(0,-72,110,'rgba(82,255,174,.28)'); ctx.strokeStyle='rgba(82,255,174,.45)'; ctx.beginPath(); ctx.arc(0,-72,52+Math.sin(game.time*5)*8,0,TAU); ctx.stroke(); }
        } else {
          drawCrate(-22,-36,44,44,22,t.active?'#1d5a3f':'#22312b','#0c1512',t.active?'#55bd83':'#405046');
          if (!t.active) { ctx.fillStyle='rgba(95,223,255,.85)'; ctx.fillRect(-12,-46,24,5); }
          else drawGlow(0,-30,60,'rgba(82,255,174,.18)');
        }
        if (!t.active && t.progress>0) { ctx.strokeStyle=COLORS.accent; ctx.lineWidth=5; ctx.beginPath(); ctx.arc(0,-50,t.r*.8,-Math.PI/2,-Math.PI/2+TAU*t.progress); ctx.stroke(); }
        ctx.restore();
      }
    }
  }
  function drawPickups() {
    for (const it of game.pickups) { if (it.collected || !onScreen(it.x,it.y,80)) continue; const c = pickupColor(it.type); const y=it.y+Math.sin(it.phase)*5;
      drawGlow(it.x,y,36,c.replace('1)', '.18)'));
      ctx.save(); ctx.translate(it.x,y); ctx.rotate(it.phase*.5);
      ctx.fillStyle=c; ctx.strokeStyle='rgba(255,255,255,.35)'; ctx.lineWidth=1.5;
      ctx.beginPath(); for(let i=0;i<6;i++){ const a=i/6*TAU; const r=i%2?8:13; ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r); } ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    }
  }
  function pickupColor(type) { return ({energy:'rgba(255,200,91,1)',water:'rgba(95,223,255,1)',parts:'rgba(215,255,233,1)',data:'rgba(82,255,174,1)',medicine:'rgba(160,255,128,1)'})[type] || 'rgba(255,255,255,1)'; }
  function drawEnemies() {
    const arr = [...game.enemies].filter(e=>!e.dead).sort((a,b)=>a.y-b.y);
    for (const e of arr) { if (!onScreen(e.x,e.y,140)) continue; ctx.save(); ctx.translate(e.x,e.y); const hp=e.hp/e.maxHp;
      ctx.fillStyle='rgba(0,0,0,.34)'; ctx.beginPath(); ctx.ellipse(0,16,e.r*1.25,e.r*.44,0,0,TAU); ctx.fill();
      if (e.type==='drone') { drawGlow(0,-12,60,'rgba(255,93,108,.14)'); ctx.fillStyle='#2a2428'; ctx.beginPath(); ctx.roundRect(-20,-26,40,26,8); ctx.fill(); ctx.fillStyle=COLORS.danger; ctx.fillRect(-9,-20,18,5); ctx.strokeStyle='rgba(255,93,108,.75)'; ctx.beginPath(); ctx.arc(-27,-13,8,0,TAU); ctx.arc(27,-13,8,0,TAU); ctx.stroke(); }
      else if (e.type==='crawler') { ctx.fillStyle='#2a211d'; ctx.beginPath(); ctx.ellipse(0,-8,25,17,0,0,TAU); ctx.fill(); ctx.strokeStyle='rgba(255,200,91,.5)'; ctx.lineWidth=3; for(let i=-1;i<=1;i+=2){ctx.beginPath();ctx.moveTo(i*10,-4);ctx.lineTo(i*30,8+Math.sin(game.time*8+i)*5);ctx.stroke();} }
      else { drawCrate(-25,-44,50,42,28,'#302529','#120b0d','#4c363b'); ctx.strokeStyle=COLORS.danger; ctx.lineWidth=3; ctx.beginPath(); ctx.arc(0,-40,28+Math.sin(game.time*4)*3,0,TAU); ctx.stroke(); }
      ctx.fillStyle='rgba(0,0,0,.55)'; ctx.fillRect(-24,-60,48,5); ctx.fillStyle=hp>.45?COLORS.warn:COLORS.danger; ctx.fillRect(-24,-60,48*hp,5);
      ctx.restore(); }
  }
  function drawPlayer() {
    const p = game.player; if (!p.alive) return; const flash = p.invuln>0 && Math.floor(game.time*18)%2===0;
    ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.facing*.08);
    drawGlow(0,-16,70, flash?'rgba(255,93,108,.20)':'rgba(82,255,174,.12)');
    ctx.fillStyle='rgba(0,0,0,.36)'; ctx.beginPath(); ctx.ellipse(0,18,24,9,0,0,TAU); ctx.fill();
    ctx.fillStyle=flash?'#ff8f98':'#20342d'; ctx.beginPath(); ctx.roundRect(-14,-38,28,42,10); ctx.fill();
    ctx.fillStyle='#0b1511'; ctx.beginPath(); ctx.arc(0,-48,13,0,TAU); ctx.fill();
    ctx.fillStyle=COLORS.accent; ctx.fillRect(-8,-52,16,4);
    ctx.strokeStyle='rgba(215,255,233,.75)'; ctx.lineWidth=4; ctx.lineCap='round';
    const ax=Math.cos(p.facing), ay=Math.sin(p.facing); ctx.beginPath(); ctx.moveTo(ax*8, -20+ay*4); ctx.lineTo(ax*32, -20+ay*8); ctx.stroke();
    ctx.fillStyle='rgba(95,223,255,.9)'; ctx.beginPath(); ctx.arc(-13,-15,4,0,TAU); ctx.fill();
    ctx.restore();
  }
  function drawDrone() { const d=game.drone; drawGlow(d.x,d.y-18,48,'rgba(95,223,255,.16)'); ctx.save(); ctx.translate(d.x,d.y+Math.sin(game.time*6)*3); ctx.fillStyle='rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(0,12,15,5,0,0,TAU); ctx.fill(); ctx.fillStyle='#172824'; ctx.beginPath(); ctx.roundRect(-14,-20,28,18,7); ctx.fill(); ctx.strokeStyle=COLORS.cyan; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(-22,-12,7,0,TAU); ctx.arc(22,-12,7,0,TAU); ctx.stroke(); ctx.fillStyle=COLORS.cyan; ctx.fillRect(-6,-15,12,3); ctx.restore(); }
  function drawBullets() { for (const b of game.bullets) { if(!onScreen(b.x,b.y,50)) continue; drawGlow(b.x,b.y,b.friendly?34:28,b.friendly?'rgba(82,255,174,.22)':'rgba(255,93,108,.22)'); ctx.fillStyle=b.friendly?COLORS.accent:COLORS.danger; ctx.beginPath(); ctx.arc(b.x,b.y,b.r,0,TAU); ctx.fill(); } }
  function drawExtraction() { if (!game.extractionOpen) return; const x=220,y=game.mission.height-240; drawGlow(x,y,120,'rgba(82,255,174,.24)'); ctx.strokeStyle='rgba(82,255,174,.65)'; ctx.lineWidth=4; ctx.beginPath(); ctx.arc(x,y,56+Math.sin(game.time*4)*8,0,TAU); ctx.stroke(); ctx.fillStyle='rgba(82,255,174,.2)'; ctx.beginPath(); ctx.arc(x,y,38,0,TAU); ctx.fill(); }
  function drawParticlesWorld() { for (const p of game.particles) { if(!onScreen(p.x,p.y,p.r+40) && p.type!=='scan') continue; const a=clamp(p.life/(p.max||.75),0,1); if(p.type==='scan'){ ctx.strokeStyle=`rgba(95,223,255,${a*.45})`; ctx.lineWidth=3; ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,TAU); ctx.stroke(); continue; } const color = p.type==='spark'?'95,223,255':p.type==='zap'?'82,255,174':p.type==='ember'?'255,93,108':p.type==='data'?'82,255,174':'190,170,130'; ctx.fillStyle=`rgba(${color},${a})`; ctx.beginPath(); ctx.arc(p.x,p.y,p.r*a,0,TAU); ctx.fill(); } }
  function drawWeather() { const m=game.mission; ctx.save(); if(m.weather==='rain'){ ctx.strokeStyle='rgba(160,220,255,.26)'; ctx.lineWidth=1; for(const w of game.weather){ctx.beginPath();ctx.moveTo(w.x,w.y);ctx.lineTo(w.x-18*w.z,w.y+w.len);ctx.stroke();} }
    else if(m.weather==='snow'){ ctx.fillStyle='rgba(210,245,255,.26)'; for(const w of game.weather){ctx.beginPath();ctx.arc(w.x,w.y,1.5+w.z*2,0,TAU);ctx.fill();} }
    else { ctx.fillStyle='rgba(255,210,150,.14)'; for(const w of game.weather){ctx.beginPath();ctx.arc(w.x,w.y,1+w.z*2.8,0,TAU);ctx.fill();} }
    // fog
    const fog=ctx.createRadialGradient(W*.5,H*.5,50,W*.5,H*.5,Math.max(W,H)*.72); fog.addColorStop(0,'rgba(0,0,0,0)'); fog.addColorStop(1,'rgba(2,8,6,.52)'); ctx.fillStyle=fog; ctx.fillRect(0,0,W,H); ctx.restore(); }
  function drawMinimap() { const mw=150, mh=106, x=W-mw-16, y=16; if(W<760) return; const m=game.mission; ctx.save(); ctx.globalAlpha=.88; ctx.fillStyle='rgba(2,8,6,.55)'; ctx.strokeStyle='rgba(118,255,190,.22)'; ctx.lineWidth=1; ctx.beginPath(); ctx.roundRect(x,y,mw,mh,14); ctx.fill(); ctx.stroke(); const sx=mw/m.width, sy=mh/m.height; ctx.fillStyle=COLORS.accent; ctx.beginPath(); ctx.arc(x+game.player.x*sx,y+game.player.y*sy,3,0,TAU); ctx.fill(); ctx.fillStyle=COLORS.danger; for(const e of game.enemies) if(!e.dead && dist(e.x,e.y,game.player.x,game.player.y)<360+state.base.mesh*80){ctx.fillRect(x+e.x*sx-1.5,y+e.y*sy-1.5,3,3);} ctx.fillStyle=COLORS.cyan; for(const t of game.terminals) if(!t.active){ctx.fillRect(x+t.x*sx-2,y+t.y*sy-2,4,4);} ctx.restore(); }
  function drawPostFX() { ctx.save(); ctx.globalCompositeOperation='source-over'; const v=ctx.createRadialGradient(W/2,H/2,Math.min(W,H)*.22,W/2,H/2,Math.max(W,H)*.72); v.addColorStop(0,'rgba(0,0,0,0)'); v.addColorStop(1,'rgba(0,0,0,.62)'); ctx.fillStyle=v; ctx.fillRect(0,0,W,H); ctx.fillStyle='rgba(255,255,255,.025)'; for(let y=0;y<H;y+=4) ctx.fillRect(0,y,W,1); ctx.restore(); }
  function drawGlow(x,y,r,color){ ctx.save(); ctx.globalCompositeOperation='lighter'; const g=ctx.createRadialGradient(x,y,0,x,y,r); g.addColorStop(0,color); g.addColorStop(1,'rgba(0,0,0,0)'); ctx.fillStyle=g; ctx.beginPath(); ctx.arc(x,y,r,0,TAU); ctx.fill(); ctx.restore(); }
  function ellipseRot(x,y,rx,ry,rot){ ctx.ellipse(x,y,rx,ry,rot,0,TAU); }
  function onScreen(x,y,pad=0){ return x>game.camera.x-pad && y>game.camera.y-pad && x<game.camera.x+W+pad && y<game.camera.y+H+pad; }

  function loop(t) { const dt = Math.min(.033, (t-last)/1000 || .016); last=t; update(dt); render(); requestAnimationFrame(loop); }

  // Input
  addEventListener('keydown', e => { input.keys[e.key.toLowerCase()] = true; if(e.key==='Escape') togglePause(); if(['w','a','s','d','ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' ','q','e'].includes(e.key)) e.preventDefault(); if(e.key===' ') input.fire=true; });
  addEventListener('keyup', e => { input.keys[e.key.toLowerCase()] = false; if(e.key===' ') input.fire=false; });
  canvas.addEventListener('pointerdown', e => { ensureAudio(); input.mouseDown = true; const rect=canvas.getBoundingClientRect(); input.mx=e.clientX-rect.left; input.my=e.clientY-rect.top; });
  canvas.addEventListener('pointermove', e => { const rect=canvas.getBoundingClientRect(); input.mx=e.clientX-rect.left; input.my=e.clientY-rect.top; });
  addEventListener('pointerup', () => { input.mouseDown=false; });

  function bindTouchControls() {
    const joy = () => document.getElementById('joystick'), stick = () => document.getElementById('stick');
    ui.addEventListener('pointerdown', e => {
      const j=joy(); if(!j) return; const r=j.getBoundingClientRect();
      if(e.clientX>=r.left && e.clientX<=r.right && e.clientY>=r.top && e.clientY<=r.bottom){ input.joyActive=true; input.joyId=e.pointerId; input.joyCX=r.left+r.width/2; input.joyCY=r.top+r.height/2; updateJoy(e.clientX,e.clientY); e.preventDefault(); }
    });
    ui.addEventListener('pointermove', e => { if(input.joyActive && e.pointerId===input.joyId) updateJoy(e.clientX,e.clientY); });
    ui.addEventListener('pointerup', e => { if(input.joyActive && e.pointerId===input.joyId){ input.joyActive=false; input.touchMoveX=0; input.touchMoveY=0; const s=stick(); if(s){s.style.transform='translate(0,0)';} } });
    const down = (id, key) => { ui.addEventListener('pointerdown', e => { if(e.target && e.target.id===id){ input[key]=true; ensureAudio(); e.preventDefault(); } }); ui.addEventListener('pointerup', e=>{ if(e.target && e.target.id===id) input[key]=false; }); ui.addEventListener('pointercancel',()=>input[key]=false); };
    down('fireBtn','fire'); down('scanBtn','scan'); down('interactBtn','interact');
  }
  function updateJoy(x,y){ const dx=x-input.joyCX, dy=y-input.joyCY; const d=Math.hypot(dx,dy); const max=48; const nx=clamp(dx/(d||1)*Math.min(d,max),-max,max), ny=clamp(dy/(d||1)*Math.min(d,max),-max,max); input.touchMoveX=nx/max; input.touchMoveY=ny/max; const s=document.getElementById('stick'); if(s) s.style.transform=`translate(${nx}px, ${ny}px)`; }
  bindTouchControls();

  function togglePause() {
    if (mode !== 'mission') return;
    paused = !paused;
    if (paused) {
      const overlay = document.createElement('div'); overlay.className='screen'; overlay.id='pauseOverlay'; overlay.innerHTML=`<div class="pause-card"><h1>Paused <span>Field</span></h1><p class="subtitle">The mission state is held locally. No network, no login, no nonsense.</p><div class="actions"><button id="resumeBtn">Resume</button><button class="secondary" id="basePauseBtn">Abort to Base</button></div></div>`; ui.appendChild(overlay);
      document.getElementById('resumeBtn').onclick=togglePause; document.getElementById('basePauseBtn').onclick=showBase;
    } else { document.getElementById('pauseOverlay')?.remove(); }
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(()=>{});
  }

  showMenu(); requestAnimationFrame(loop);
})();

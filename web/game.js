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
  const DPR = Math.min(2, window.devicePixelRatio || 1);
  const TAU = Math.PI * 2;

  let W = 390, H = 844, last = performance.now();
  let mode = 'menu', paused = false;
  let toastText = '', toastTimer = 0;
  let shake = 0;
  let audioCtx = null, audioReady = false;

  const C = {
    bg: '#050906', ground: '#0a1510', ground2: '#102018', grid: 'rgba(103,255,183,.065)',
    accent: '#52ffae', cyan: '#5fdfff', warn: '#ffc85b', danger: '#ff5d6c', text: '#d7ffe9', steel: '#28352f'
  };
  const clamp = (v,a,b) => Math.max(a, Math.min(b,v));
  const lerp = (a,b,t) => a + (b-a)*t;
  const dist = (a,b,c,d) => Math.hypot(a-c,b-d);
  const rnd = (a=1,b=0) => Math.random()*(a-b)+b;
  const angleTo = (a,b,c,d) => Math.atan2(d-b,c-a);
  const choice = arr => arr[Math.floor(Math.random()*arr.length)];

  const SAVE_KEY = 'blackout_garden_protocol_868_save_pt_v2';
  const DEFAULT = {
    version: 5, day: 1, completed: 0, highScore: 0,
    resources: { energia: 75, agua: 52, pecas: 14, dados: 0, medicina: 5 },
    base: { reator: 0, filtragem: 0, estufa: 0, rede: 0, drone: 0, oficina: 0 }
  };

  function clone(o){ return JSON.parse(JSON.stringify(o)); }
  function merge(a,b){ for(const k in b){ if(b[k] && typeof b[k]==='object' && !Array.isArray(b[k])) a[k]=merge(a[k]||{},b[k]); else a[k]=b[k]; } return a; }
  function load(){ try{ const r=localStorage.getItem(SAVE_KEY); return r?merge(clone(DEFAULT),JSON.parse(r)):clone(DEFAULT); }catch(e){ return clone(DEFAULT); } }
  function save(){ localStorage.setItem(SAVE_KEY, JSON.stringify(state)); }
  const state = load();

  const input = {
    keys:{}, moveX:0, moveY:0, tx:0, ty:0,
    aimX:0, aimY:-1, targetX:null, targetY:null,
    shoot:false, interact:false, scan:false,
    joy:false, joyId:null, joyCX:0, joyCY:0,
    shootId:null
  };

  const game = {
    t:0, zoom:0.84, cam:{x:0,y:0,tx:0,ty:0}, mission:null,
    player:null, drone:null, enemies:[], bullets:[], pickups:[], obstacles:[], terminals:[], particles:[], weather:[], decals:[],
    objective:'', score:0, extraction:false
  };

  const missions = [
    { id:'gardunha', nome:'Relé da Gardunha', regiao:'Serra da Gardunha', clima:'chuva', w:1400, h:1900, goal:3, dif:1, intro:'Reativa o relé enterrado junto ao antigo posto de vigia. Há drones avariados e terreno encharcado.' },
    { id:'estrela', nome:'Nó Congelado', regiao:'Serra da Estrela', clima:'neve', w:1500, h:2200, goal:4, dif:2, intro:'O nó ainda transmite ruído. Recupera dados, ativa terminais e levanta a antena antes da tempestade.' },
    { id:'marao', nome:'Cume Negro', regiao:'Serra do Marão', clima:'cinza', w:1600, h:2400, goal:5, dif:3, intro:'Um comboio destruído bloqueia o caminho. O antigo jammer ainda consome energia algures no cume.' }
  ];

  function resize(){
    W = Math.floor(innerWidth); H = Math.floor(innerHeight);
    canvas.width = Math.floor(W*DPR); canvas.height = Math.floor(H*DPR);
    canvas.style.width = W+'px'; canvas.style.height = H+'px';
    ctx.setTransform(DPR,0,0,DPR,0,0);
  }
  addEventListener('resize', resize, {passive:true}); resize();

  function ensureAudio(){
    if(audioReady) return;
    try{
      audioCtx = new (window.AudioContext||window.webkitAudioContext)();
      const g = audioCtx.createGain(); g.gain.value = .035; g.connect(audioCtx.destination);
      const o = audioCtx.createOscillator(); const f = audioCtx.createBiquadFilter();
      o.type='sawtooth'; o.frequency.value=46; f.type='lowpass'; f.frequency.value=290; f.Q.value=4;
      o.connect(f); f.connect(g); o.start(); audioReady=true;
    }catch(e){}
  }
  function beep(freq=300,dur=.07,type='triangle',gain=.05){
    if(!audioCtx || audioCtx.state!=='running') return;
    const t=audioCtx.currentTime, o=audioCtx.createOscillator(), g=audioCtx.createGain();
    o.type=type; o.frequency.value=freq; g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(gain,t+.01); g.gain.exponentialRampToValueAtTime(.0001,t+dur);
    o.connect(g); g.connect(audioCtx.destination); o.start(t); o.stop(t+dur+.03);
  }

  function toast(text,t=2.2){
    toastText=text; toastTimer=t;
    let el=document.querySelector('.toast'); if(!el){ el=document.createElement('div'); el.className='toast'; ui.appendChild(el); }
    el.textContent=text; el.classList.add('show'); clearTimeout(el._t); el._t=setTimeout(()=>el.classList.remove('show'),t*1000);
  }

  function showMenu(){
    mode='menu'; paused=false;
    ui.innerHTML=`<div class="screen"><div class="menu-card">
      <h1>Blackout<br><span>Garden</span></h1>
      <div class="badge">Protocolo 868 · Offline · Um jogador</div>
      <p class="subtitle">Portugal ficou às escuras. Tu controlas uma base técnica escondida na serra, reativas relés 868 MHz, recolhes recursos e manténs a rede Mesh viva. Agora afinado para telemóvel em modo horizontal, com campo de visão mais aberto e apresentação mais cinematográfica.</p>
      <div class="actions"><button id="continueBtn">Continuar</button><button class="secondary" id="newBtn">Novo jogo</button><button class="secondary" id="baseBtn">Base</button></div>
      <div class="stats"><div class="stat"><b>${state.day}</b><span>Dia</span></div><div class="stat"><b>${state.completed}</b><span>Relés</span></div><div class="stat"><b>${state.resources.pecas}</b><span>Peças</span></div><div class="stat"><b>${state.highScore}</b><span>Recorde</span></div></div>
      <div class="grid3"><div class="panel"><h3>Explorar</h3><p>Missões em modo horizontal, campo de batalha mais aberto, nevoeiro, chuva, drones e extração.</p></div><div class="panel"><h3>Disparar melhor</h3><p>Botão de tiro com auto-mira ao inimigo mais próximo. Toca no mapa para definir alvo manual.</p></div><div class="panel"><h3>Melhorar</h3><p>Investe em reator, filtragem, estufa, rede, drone e oficina.</p></div></div>
    </div></div>`;
    document.getElementById('continueBtn').onclick=()=>{ensureAudio();showBase();};
    document.getElementById('baseBtn').onclick=()=>{ensureAudio();showBase();};
    document.getElementById('newBtn').onclick=()=>{ensureAudio(); if(confirm('Apagar progresso e começar de novo?')){ localStorage.removeItem(SAVE_KEY); Object.assign(state, clone(DEFAULT)); showMenu(); }};
  }

  function custo(id){ const lvl=state.base[id]||0, disc=state.base.oficina||0; return { pecas:Math.max(2,6+lvl*5-disc), dados:Math.max(0,lvl*3-disc)}; }
  function card(id,t,desc){ const c=custo(id), lvl=state.base[id]||0; return `<div class="upgrade"><h4>${t} Nv.${lvl}</h4><small>${desc}</small><div class="cost">Custo: ${c.pecas} peças · ${c.dados} dados</div><div class="actions"><button data-up="${id}">Melhorar</button></div></div>`; }
  
function showBase(){
  mode='base'; const r=state.resources, b=state.base; const m=missions[Math.min(state.completed,missions.length-1)];
  ui.innerHTML=`<div class="screen"><div class="base-card">
    <h1>Base <span>868</span></h1><div class="badge">${m.regiao}</div>
    <p class="subtitle">Dia ${state.day}. Próxima missão: <b>${m.nome}</b>. ${m.intro}</p>
    <div class="base-visual panel"><canvas id="baseScene" class="base-scene"></canvas></div>
    <div class="stats"><div class="stat"><b>${r.energia}</b><span>Energia</span></div><div class="stat"><b>${r.agua}</b><span>Água</span></div><div class="stat"><b>${r.pecas}</b><span>Peças</span></div><div class="stat"><b>${r.dados}</b><span>Dados</span></div><div class="stat"><b>${r.medicina}</b><span>Medicina</span></div><div class="stat"><b>${b.rede}</b><span>Rede</span></div></div>
    <div class="grid2"><div class="panel"><h3>Operações</h3><p>A base é agora apresentada como um bunker técnico com núcleo energético, comando, oficina, enfermaria, estufa e armazenamento. O objetivo é dar mais identidade visual ao teu quartel-general.</p></div><div class="panel"><h3>Objetivo</h3><p>Ativa todos os terminais, levanta a antena 868 MHz e volta ao ponto de extração. Em missão o ecrã abre mais o campo de visão para veres melhor o combate.</p></div></div>
    <h3 style="margin:22px 0 0">Melhorias</h3><div class="upgrades">
    ${card('reator','Reator','Mais bateria de missão e tolerância a falhas.')}${card('filtragem','Filtragem','Mais água recuperada após missões.')}${card('estufa','Estufa medicinal','Gera medicina depois de cada relé.')}${card('rede','Amplificador Mesh','Aumenta alcance do scan e visibilidade dos objetivos.')}${card('drone','Drone auxiliar','Drone causa mais dano e marca inimigos.')}${card('oficina','Oficina','Reduz custos de melhorias futuras.')}
    </div><div class="actions"><button id="launch">Iniciar missão</button><button class="secondary" id="menu">Menu</button><button class="danger" id="reset">Apagar save</button></div>
  </div></div>`;
  document.querySelectorAll('[data-up]').forEach(x=>x.onclick=()=>buy(x.dataset.up));
  document.getElementById('launch').onclick=()=>{ensureAudio(); startMission(m);};
  document.getElementById('menu').onclick=showMenu;
  document.getElementById('reset').onclick=()=>{ if(confirm('Apagar tudo?')){ localStorage.removeItem(SAVE_KEY); Object.assign(state, clone(DEFAULT)); showMenu(); }};
  setTimeout(drawBaseScene, 0);
}

function drawBaseScene(){
  const cv=document.getElementById('baseScene'); if(!cv) return;
  const c=cv.getContext('2d'); const dpr=Math.min(2, window.devicePixelRatio||1);
  const rect=cv.getBoundingClientRect(); const w=Math.max(280, Math.floor(rect.width||860)); const h=Math.max(180, Math.floor(rect.height||280));
  cv.width=Math.floor(w*dpr); cv.height=Math.floor(h*dpr); c.setTransform(dpr,0,0,dpr,0,0);
  const g=c.createLinearGradient(0,0,0,h); g.addColorStop(0,'#132118'); g.addColorStop(1,'#08100c'); c.fillStyle=g; c.fillRect(0,0,w,h);
  // Rock background
  c.fillStyle='#0f1712'; c.fillRect(0,0,w,h);
  for(let i=0;i<34;i++){ c.globalAlpha=.14; c.fillStyle=i%2?'#1a281d':'#101914'; c.beginPath(); c.arc((i*79)%w, (i*53)%h, 18+(i%5)*12, 0, Math.PI*2); c.fill(); }
  c.globalAlpha=1;
  // Bunker shell
  const bx=22, by=26, bw=w-44, bh=h-52, cut=22;
  c.fillStyle='rgba(12,17,15,.95)'; c.strokeStyle='rgba(110,255,188,.35)'; c.lineWidth=2;
  c.beginPath(); c.moveTo(bx+cut,by); c.lineTo(bx+bw-cut,by); c.lineTo(bx+bw,by+cut); c.lineTo(bx+bw,by+bh-cut); c.lineTo(bx+bw-cut,by+bh); c.lineTo(bx+cut,by+bh); c.lineTo(bx,by+bh-cut); c.lineTo(bx,by+cut); c.closePath(); c.fill(); c.stroke();
  // Room layout
  const rooms=[
    {x:bx+16,y:by+18,w:bw*.24,h:bh*.42,name:'COMANDO',accent:'#5fdfff'},
    {x:bx+bw*.26,y:by+18,w:bw*.23,h:bh*.42,name:'OFICINA',accent:'#ffc85b'},
    {x:bx+bw*.51,y:by+18,w:bw*.19,h:bh*.42,name:'ENFERMARIA',accent:'#9cfb7d'},
    {x:bx+bw*.71,y:by+18,w:bw*.13,h:bh*.42,name:'NÚCLEO',accent:'#ff905b'},
    {x:bx+16,y:by+bh*.53,w:bw*.2,h:bh*.26,name:'ARMAZÉM',accent:'#d7ffe9'},
    {x:bx+bw*.22,y:by+bh*.53,w:bw*.36,h:bh*.26,name:'CORREDOR / MESH',accent:'#52ffae'},
    {x:bx+bw*.60,y:by+bh*.53,w:bw*.24,h:bh*.26,name:'ESTUFA',accent:'#7bffb9'}
  ];
  c.font='700 11px system-ui';
  rooms.forEach((r,i)=>{
    c.fillStyle='rgba(15,25,20,.95)'; c.strokeStyle='rgba(255,255,255,.08)'; c.lineWidth=1.5; c.beginPath(); c.roundRect(r.x,r.y,r.w,r.h,12); c.fill(); c.stroke();
    c.fillStyle=r.accent; c.fillRect(r.x,r.y,r.w,6);
    c.fillStyle='rgba(215,255,233,.95)'; c.fillText(r.name, r.x+10, r.y+18);
    // lights
    for(let lx=r.x+14; lx<r.x+r.w-10; lx+=34){ c.fillStyle='rgba(255,244,180,.18)'; c.fillRect(lx,r.y+10,18,4); }
    // detail per room
    if(r.name==='COMANDO'){
      for(let j=0;j<3;j++){ c.fillStyle='rgba(20,30,28,.95)'; c.fillRect(r.x+16+j*46, r.y+36, 36, 28); c.fillStyle='rgba(95,223,255,.45)'; c.fillRect(r.x+19+j*46, r.y+39, 30, 16); }
      c.strokeStyle='rgba(95,223,255,.35)'; c.beginPath(); c.arc(r.x+r.w-34,r.y+54,18,0,Math.PI*2); c.stroke();
      c.fillStyle='rgba(82,255,174,.3)'; c.fillRect(r.x+r.w-56,r.y+78,42,8);
    } else if(r.name==='OFICINA'){
      c.fillStyle='rgba(75,82,84,.85)'; c.fillRect(r.x+18,r.y+42,60,10); c.fillRect(r.x+18,r.y+52,10,26); c.fillRect(r.x+68,r.y+52,10,26);
      c.strokeStyle='rgba(255,200,91,.35)'; c.beginPath(); c.arc(r.x+110,r.y+58,18,0,Math.PI*2); c.stroke(); c.beginPath(); c.moveTo(r.x+96,r.y+74); c.lineTo(r.x+123,r.y+45); c.stroke();
      c.fillStyle='rgba(180,190,195,.8)'; c.fillRect(r.x+r.w-64,r.y+36,42,48);
    } else if(r.name==='ENFERMARIA'){
      c.fillStyle='rgba(220,240,230,.9)'; c.fillRect(r.x+18,r.y+52,58,18); c.fillStyle='rgba(156,251,125,.5)'; c.fillRect(r.x+88,r.y+38,34,34); c.fillStyle='#eafff1'; c.fillRect(r.x+102,r.y+44,6,22); c.fillRect(r.x+94,r.y+52,22,6);
    } else if(r.name==='NÚCLEO'){
      c.fillStyle='rgba(255,144,91,.18)'; c.beginPath(); c.arc(r.x+r.w/2,r.y+55,28,0,Math.PI*2); c.fill(); c.strokeStyle='rgba(255,144,91,.6)'; c.lineWidth=2; c.stroke();
      c.strokeStyle='rgba(255,144,91,.4)'; c.beginPath(); c.moveTo(r.x+r.w/2,r.y+16); c.lineTo(r.x+r.w/2,r.y+98); c.moveTo(r.x+18,r.y+55); c.lineTo(r.x+r.w-18,r.y+55); c.stroke();
    } else if(r.name==='ARMAZÉM'){
      for(let s=0;s<3;s++){ c.fillStyle='rgba(70,82,74,.9)'; c.fillRect(r.x+16+s*34,r.y+34,24,42); c.fillStyle='rgba(130,150,140,.25)'; c.fillRect(r.x+18+s*34,r.y+42,20,8); }
    } else if(r.name==='CORREDOR / MESH'){
      c.strokeStyle='rgba(82,255,174,.28)'; c.lineWidth=2; c.beginPath(); c.moveTo(r.x+16,r.y+r.h/2); c.lineTo(r.x+r.w-18,r.y+r.h/2); c.stroke();
      for(let n=0;n<5;n++){ c.beginPath(); c.arc(r.x+40+n*52,r.y+r.h/2,7,0,Math.PI*2); c.stroke(); }
      c.fillStyle='rgba(95,223,255,.35)'; c.fillRect(r.x+r.w-72,r.y+22,46,16);
    } else if(r.name==='ESTUFA'){
      c.fillStyle='rgba(20,34,24,.95)'; c.fillRect(r.x+14,r.y+34,r.w-28,r.h-46);
      for(let p=0;p<5;p++){ const px=r.x+30+p*28; c.strokeStyle='rgba(123,255,185,.55)'; c.beginPath(); c.moveTo(px,r.y+r.h-16); c.lineTo(px,r.y+48); c.stroke(); c.fillStyle='rgba(82,255,174,.28)'; c.beginPath(); c.ellipse(px,r.y+54,7,12,0,0,Math.PI*2); c.fill(); c.beginPath(); c.ellipse(px-7,r.y+68,6,10,-.4,0,Math.PI*2); c.fill(); c.beginPath(); c.ellipse(px+7,r.y+80,6,10,.4,0,Math.PI*2); c.fill(); }
    }
  });
  // Corridors / doors
  c.strokeStyle='rgba(150,180,165,.25)'; c.lineWidth=5;
  c.beginPath(); c.moveTo(bx+bw*.24, by+bh*.36); c.lineTo(bx+bw*.26, by+bh*.36); c.moveTo(bx+bw*.49, by+bh*.36); c.lineTo(bx+bw*.51, by+bh*.36); c.moveTo(bx+bw*.70, by+bh*.36); c.lineTo(bx+bw*.71, by+bh*.36); c.stroke();
  c.beginPath(); c.moveTo(bx+bw*.18, by+bh*.53); c.lineTo(bx+bw*.18, by+bh*.42); c.moveTo(bx+bw*.58, by+bh*.53); c.lineTo(bx+bw*.58, by+bh*.42); c.moveTo(bx+bw*.84, by+bh*.53); c.lineTo(bx+bw*.84, by+bh*.42); c.stroke();
  // Small figures for life
  const figs=[[bx+bw*.12, by+bh*.68, '#d7ffe9'],[bx+bw*.40, by+bh*.66, '#52ffae'],[bx+bw*.64, by+bh*.18, '#ffc85b']];
  figs.forEach(([fx,fy,col])=>{ c.strokeStyle=col; c.lineWidth=2; c.beginPath(); c.arc(fx,fy-12,5,0,Math.PI*2); c.stroke(); c.beginPath(); c.moveTo(fx,fy-7); c.lineTo(fx,fy+11); c.moveTo(fx-9,fy); c.lineTo(fx+9,fy); c.moveTo(fx,fy+11); c.lineTo(fx-7,fy+24); c.moveTo(fx,fy+11); c.lineTo(fx+7,fy+24); c.stroke(); });
  c.fillStyle='rgba(215,255,233,.88)'; c.font='800 12px system-ui'; c.fillText('BUNKER OPERACIONAL · REDE 868 · OFICINA · ESTUFA · SUPORTE MÉDICO', 34, h-16);
}
function buy(id){ const c=custo(id), r=state.resources; if(r.pecas<c.pecas||r.dados<c.dados){ toast('Faltam recursos. Vai buscar peças e dados.'); beep(120,.1,'sawtooth'); return; } r.pecas-=c.pecas; r.dados-=c.dados; state.base[id]=(state.base[id]||0)+1; save(); beep(560,.1); showBase(); }

  function missionUI(){ return `<div class="hud"><div class="hud-panel"><div class="hud-top"><b>Protocolo 868</b><span id="missionName"></span></div><div class="bars"><div class="bar"><i id="hpBar" style="width:100%"></i></div><div class="bar"><i id="batBar" style="width:100%"></i></div><div class="bar red"><i id="threatBar" style="width:30%"></i></div></div></div><div class="hud-panel objective" id="objectiveText"></div></div><div class="controls"><div class="joystick" id="joystick"><div class="stick" id="stick"></div></div><div class="action-pad"><div class="action-btn primary" id="shootBtn">TIRO</div><div class="action-btn" id="scanBtn">SCAN</div><div class="action-btn big" id="interactBtn">USAR</div></div></div>`; }
  function startMission(m){ mode='mission'; ui.innerHTML=missionUI(); buildMission(m); bindTouchControls(); toast(`${m.nome}: ativa ${m.goal} terminais`,3); }

  function makeObstacle(kind,x,y){ const s= kind==='wall'?rnd(80,46):kind==='rock'?rnd(60,24):kind==='tech'?rnd(52,30):rnd(46,24); return {kind,x,y,w:s*(kind==='wall'?1.8:1),h:s,r:s*.55,rot:rnd(TAU)}; }
  function makeEnemy(type,x,y){ return {type,x,y,r:type==='turret'?23:type==='crawler'?18:19,hp:type==='turret'?70:type==='crawler'?50:46,max:type==='turret'?70:type==='crawler'?50:46,spd:type==='turret'?0:type==='crawler'?95:72,cd:rnd(.7),stun:0,ang:rnd(TAU),alert:false}; }
  function buildMission(m){
    game.t=0; game.mission=m; game.enemies=[]; game.bullets=[]; game.pickups=[]; game.obstacles=[]; game.terminals=[]; game.particles=[]; game.weather=[]; game.decals=[]; game.extraction=false; game.score=0;
    game.player={x:m.w/2,y:m.h-150,r:18,hp:100,maxHp:100,battery:110+state.base.reator*14,maxBattery:110+state.base.reator*14,speed:205,cd:0,scanCd:0,inv:0,alive:true,loot:{energia:0,agua:0,pecas:0,dados:0,medicina:0}};
    game.drone={x:game.player.x-35,y:game.player.y+20,cd:0,t:0}; const visW=W/game.zoom, visH=H/game.zoom; game.cam.x=game.player.x-visW/2; game.cam.y=game.player.y-visH*.60;
    for(let i=0;i<70+m.dif*20;i++){ let x=rnd(m.w-150,75), y=rnd(m.h-180,80); if(dist(x,y,game.player.x,game.player.y)<230) continue; game.obstacles.push(makeObstacle(choice(['rock','wall','tree','tech']),x,y)); }
    const pos=[[.25,.24],[.75,.27],[.52,.48],[.28,.68],[.76,.72]];
    for(let i=0;i<m.goal;i++) game.terminals.push({x:m.w*pos[i][0]+rnd(80,-80),y:m.h*pos[i][1]+rnd(70,-70),r:33,active:false,progress:0,name:['Acoplador','Router','Sonda','Bateria','Bypass'][i]});
    game.terminals.push({x:m.w*.5,y:130,r:52,active:false,progress:0,antenna:true,name:'Antena 868 MHz'});
    for(let i=0;i<7+m.dif*5;i++){ let x,y; do{x=rnd(m.w-160,80);y=rnd(m.h-260,120);}while(dist(x,y,game.player.x,game.player.y)<360); game.enemies.push(makeEnemy(choice(['drone','crawler','turret']),x,y)); }
    const types=['energia','agua','pecas','dados','medicina']; for(let i=0;i<36+m.dif*9;i++) game.pickups.push({x:rnd(m.w-140,70),y:rnd(m.h-220,90),r:11,type:choice(types),v:1+Math.floor(rnd(3)),phase:rnd(TAU),col:false});
    for(let i=0;i<130;i++) game.weather.push({x:rnd(W),y:rnd(H),z:rnd(),sp:rnd(600,220),len:rnd(32,10)});
    document.getElementById('missionName').textContent=m.nome; updateObjective();
  }

  function updateObjective(){
    const active=game.terminals.filter(t=>!t.antenna&&t.active).length, total=game.mission.goal, ant=game.terminals.find(t=>t.antenna);
    if(active<total) game.objective=`Ativa os terminais: ${active}/${total}`;
    else if(!ant.active) game.objective='Terminais ativos. Levanta a antena 868 MHz.';
    else game.objective='Antena online. Volta à zona de extração.';
    const el=document.getElementById('objectiveText'); if(el) el.textContent=game.objective;
  }

  
function worldToScreen(x,y){ return {x:(x-game.cam.x)*game.zoom + W*(1-game.zoom)/2, y:(y-game.cam.y)*game.zoom + H*(1-game.zoom)/2}; }
function screenToWorld(x,y){ return {x:(x-W*(1-game.zoom)/2)/game.zoom + game.cam.x, y:(y-H*(1-game.zoom)/2)/game.zoom + game.cam.y}; }

  function nearestEnemy(range=460){
    if(!game.player) return null; let best=null, bd=range;
    for(const e of game.enemies){ if(e.hp<=0) continue; const d=dist(game.player.x,game.player.y,e.x,e.y); if(d<bd){bd=d;best=e;} }
    return best;
  }
  function fire(auto=true){
    const p=game.player; if(!p||!p.alive||p.cd>0||p.battery<2) return;
    let tx=input.targetX, ty=input.targetY, target=null;
    if(auto){ target=nearestEnemy(520 + state.base.rede*55); if(target){tx=target.x; ty=target.y;} }
    if(tx==null||ty==null){ tx=p.x; ty=p.y-180; }
    let a=angleTo(p.x,p.y,tx,ty);
    p.cd=.16; p.battery=Math.max(0,p.battery-1.8); shake=Math.max(shake,2.2); beep(660,.045,'square',.035);
    game.bullets.push({x:p.x+Math.cos(a)*23,y:p.y+Math.sin(a)*23,vx:Math.cos(a)*640,vy:Math.sin(a)*640,r:5,life:.72,dmg:22+state.base.drone*4,player:true,homing:target});
    for(let i=0;i<5;i++) part(p.x,p.y,C.cyan, rnd(40,10), rnd(TAU), .22);
  }
  function enemyFire(e){ const p=game.player; const a=angleTo(e.x,e.y,p.x,p.y); game.bullets.push({x:e.x,y:e.y,vx:Math.cos(a)*310,vy:Math.sin(a)*310,r:5,life:1.6,dmg:10,enemy:true}); beep(190,.045,'sawtooth',.02); }
  function scan(){ const p=game.player; if(p.scanCd>0||p.battery<6) return; p.scanCd=2.2; p.battery-=6; toast('Scan ativo: alvos e recursos assinalados.',1.2); beep(880,.12,'sine',.05); for(let i=0;i<90;i++) part(p.x,p.y,i%2?C.accent:C.cyan,rnd(260,50),rnd(TAU),.7); }
  function part(x,y,col,spd,ang,life){ game.particles.push({x,y,vx:Math.cos(ang)*spd,vy:Math.sin(ang)*spd,life,max:life,col,r:rnd(4,1)}); }

  function interact(){
    const p=game.player; if(!p) return; let near=null, nd=72;
    for(const t of game.terminals){ const d=dist(p.x,p.y,t.x,t.y); if(d<nd){nd=d;near=t;} }
    if(near){
      if(near.antenna && game.terminals.some(t=>!t.antenna&&!t.active)){ toast('Ainda faltam terminais. A antena não arranca por magia negra.'); return; }
      near.progress += .34; toast(`${near.name}: ${Math.floor(clamp(near.progress,0,1)*100)}%`,.7); beep(420+near.progress*240,.05);
      if(near.progress>=1&&!near.active){ near.active=true; shake=6; toast(near.antenna?'Antena 868 MHz online. Extrai.':'Terminal ativo.'); for(let i=0;i<34;i++) part(near.x,near.y,C.accent,rnd(230,40),rnd(TAU),.6); if(near.antenna) game.extraction=true; updateObjective(); }
      return;
    }
    if(game.extraction && dist(p.x,p.y,game.mission.w/2,game.mission.h-90)<85){ completeMission(); return; }
    toast('Nada para usar aqui.');
  }

  function completeMission(){
    const r=state.resources, l=game.player.loot;
    r.energia+=l.energia+10; r.agua+=l.agua+4+state.base.filtragem*2; r.pecas+=l.pecas+3; r.dados+=l.dados+2; r.medicina+=l.medicina+state.base.estufa;
    state.completed=Math.min(state.completed+1, missions.length-1); state.day++; state.highScore=Math.max(state.highScore, game.score); save(); beep(760,.18); toast('Missão concluída. Recursos recuperados.',2); setTimeout(showBase,700);
  }
  function die(){ if(!game.player.alive) return; game.player.alive=false; shake=12; toast('Foste abaixo. A base recuperou-te, mas perdeste o saque.'); beep(80,.25,'sawtooth',.06); state.day++; save(); setTimeout(showBase,1200); }

  function update(dt){
    if(mode!=='mission'||paused) return; game.t+=dt; const p=game.player; if(!p||!p.alive) return;
    let mx=input.moveX, my=input.moveY; if(input.keys.ArrowLeft||input.keys.a) mx-=1; if(input.keys.ArrowRight||input.keys.d) mx+=1; if(input.keys.ArrowUp||input.keys.w) my-=1; if(input.keys.ArrowDown||input.keys.s) my+=1;
    const ml=Math.hypot(mx,my)||1; mx/=ml; my/=ml; p.x=clamp(p.x+mx*p.speed*dt,40,game.mission.w-40); p.y=clamp(p.y+my*p.speed*dt,40,game.mission.h-40);
    for(const o of game.obstacles){ const d=dist(p.x,p.y,o.x,o.y), rr=p.r+Math.max(o.w,o.h)*.35; if(d<rr){ const a=angleTo(o.x,o.y,p.x,p.y); p.x=o.x+Math.cos(a)*rr; p.y=o.y+Math.sin(a)*rr; } }
    p.cd=Math.max(0,p.cd-dt); p.scanCd=Math.max(0,p.scanCd-dt); p.inv=Math.max(0,p.inv-dt); p.battery=clamp(p.battery+dt*(2+state.base.reator*.45),0,p.maxBattery);
    if(input.shoot) fire(true); if(input.interact){ input.interact=false; interact(); } if(input.scan){ input.scan=false; scan(); }

    for(const pk of game.pickups){ if(pk.col) continue; pk.phase+=dt*3; if(dist(p.x,p.y,pk.x,pk.y)<34){ pk.col=true; p.loot[pk.type]+=pk.v; game.score+=pk.v*8; beep(440,.04); for(let i=0;i<7;i++) part(pk.x,pk.y,C.accent,rnd(95,25),rnd(TAU),.35); } }

    for(const e of game.enemies){ if(e.hp<=0) continue; e.stun=Math.max(0,e.stun-dt); e.cd=Math.max(0,e.cd-dt); const d=dist(e.x,e.y,p.x,p.y); e.alert=e.alert||d<380; if(e.stun<=0){ if(e.type!=='turret'&&e.alert){ const a=angleTo(e.x,e.y,p.x,p.y); e.x+=Math.cos(a)*e.spd*dt; e.y+=Math.sin(a)*e.spd*dt; } if(d<(e.type==='turret'?430:270)&&e.cd<=0){ e.cd=e.type==='turret'?1.1:.9; enemyFire(e); } if(d<p.r+e.r+4&&p.inv<=0){ p.hp-=12; p.inv=.55; shake=7; beep(100,.08,'sawtooth',.05); if(p.hp<=0) die(); } } }
    // Drone companion
    game.drone.t+=dt; game.drone.x=lerp(game.drone.x,p.x-44+Math.sin(game.t*2)*12,.08); game.drone.y=lerp(game.drone.y,p.y+38+Math.cos(game.t*2.4)*8,.08); game.drone.cd=Math.max(0,game.drone.cd-dt);
    const de=nearestEnemy(340+state.base.drone*70); if(de&&game.drone.cd<=0){ game.drone.cd=.7; const a=angleTo(game.drone.x,game.drone.y,de.x,de.y); game.bullets.push({x:game.drone.x,y:game.drone.y,vx:Math.cos(a)*500,vy:Math.sin(a)*500,r:3,life:.75,dmg:8+state.base.drone*5,player:true,homing:de,drone:true}); }

    for(const b of game.bullets){
      b.life-=dt; if(b.homing&&b.homing.hp>0){ const a=angleTo(b.x,b.y,b.homing.x,b.homing.y); b.vx=lerp(b.vx,Math.cos(a)*650,.08); b.vy=lerp(b.vy,Math.sin(a)*650,.08); }
      b.x+=b.vx*dt; b.y+=b.vy*dt;
      if(b.player){ for(const e of game.enemies){ if(e.hp>0&&dist(b.x,b.y,e.x,e.y)<e.r+b.r){ e.hp-=b.dmg; e.stun=Math.max(e.stun,.18); b.life=0; game.score+=12; shake=Math.max(shake,2.5); for(let i=0;i<8;i++) part(b.x,b.y,C.danger,rnd(135,30),rnd(TAU),.35); if(e.hp<=0){ game.score+=60; for(let i=0;i<24;i++) part(e.x,e.y,C.warn,rnd(220,40),rnd(TAU),.55); } break; } } }
      if(b.enemy&&dist(b.x,b.y,p.x,p.y)<p.r+b.r&&p.inv<=0){ p.hp-=b.dmg; p.inv=.45; b.life=0; shake=5; if(p.hp<=0) die(); }
    }
    game.bullets=game.bullets.filter(b=>b.life>0);
    for(const pa of game.particles){ pa.life-=dt; pa.x+=pa.vx*dt; pa.y+=pa.vy*dt; pa.vx*=.96; pa.vy*=.96; } game.particles=game.particles.filter(pa=>pa.life>0);
    const visW=W/game.zoom, visH=H/game.zoom; game.cam.tx=clamp(p.x-visW/2,0,Math.max(0,game.mission.w-visW)); game.cam.ty=clamp(p.y-visH*.60,0,Math.max(0,game.mission.h-visH)); game.cam.x=lerp(game.cam.x,game.cam.tx,.10); game.cam.y=lerp(game.cam.y,game.cam.ty,.10); shake=Math.max(0,shake-dt*16);
    updateHUD();
  }

  function updateHUD(){ const p=game.player; if(!p) return; const hp=document.getElementById('hpBar'), bat=document.getElementById('batBar'), th=document.getElementById('threatBar'); if(hp) hp.style.width=clamp(p.hp/p.maxHp*100,0,100)+'%'; if(bat) bat.style.width=clamp(p.battery/p.maxBattery*100,0,100)+'%'; const alive=game.enemies.filter(e=>e.hp>0).length, total=Math.max(1,game.enemies.length); if(th) th.style.width=clamp(alive/total*100,0,100)+'%'; }

  function draw(){
    ctx.save(); ctx.clearRect(0,0,W,H);
    if(mode==='mission') drawMission(); else drawBackdrop();
    ctx.restore(); requestAnimationFrame(loop);
  }
  function drawBackdrop(){
    const g=ctx.createLinearGradient(0,0,W,H); g.addColorStop(0,'#081a13'); g.addColorStop(.55,'#050906'); g.addColorStop(1,'#010202'); ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
    ctx.strokeStyle='rgba(82,255,174,.07)'; ctx.lineWidth=1; for(let y=0;y<H;y+=38){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); } for(let x=0;x<W;x+=38){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
    for(let i=0;i<24;i++){ const x=(i*97+game.t*8)%W, y=(i*211)%H; ctx.fillStyle=i%3?'rgba(82,255,174,.08)':'rgba(95,223,255,.08)'; ctx.beginPath(); ctx.arc(x,y,1+i%3,0,TAU); ctx.fill(); }
  }
  
function drawMission(){
  const sx=(Math.random()-.5)*shake, sy=(Math.random()-.5)*shake; ctx.translate(sx,sy); const cam=game.cam, m=game.mission;
  const bg=ctx.createLinearGradient(0,0,0,H); bg.addColorStop(0,m.clima==='neve'?'#071217':m.clima==='cinza'?'#11100b':'#07120d'); bg.addColorStop(.55,'#09110c'); bg.addColorStop(1,'#050906'); ctx.fillStyle=bg; ctx.fillRect(0,0,W,H);
  // zoom-out cinematic frame
  ctx.save();
  ctx.translate(W*(1-game.zoom)/2, H*(1-game.zoom)/2);
  ctx.scale(game.zoom, game.zoom);
  ctx.translate(-cam.x,-cam.y);
  ctx.fillStyle=m.clima==='neve'?'#0b171a':m.clima==='cinza'?'#15130d':'#0a1510'; ctx.fillRect(0,0,m.w,m.h);
  // terrain grid and subtle patches
  ctx.strokeStyle=C.grid; for(let x=0;x<m.w;x+=80){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,m.h); ctx.stroke(); } for(let y=0;y<m.h;y+=80){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(m.w,y); ctx.stroke(); }
  for(let i=0;i<26;i++){ ctx.globalAlpha=.10; ctx.fillStyle=i%2?'#132219':'#1a1811'; ctx.beginPath(); ctx.ellipse((i*131)%m.w,(i*173)%m.h,60+(i%5)*22,34+(i%3)*12,(i%7)*.4,0,TAU); ctx.fill(); } ctx.globalAlpha=1;
  // extraction zone
  ctx.save(); ctx.translate(m.w/2,m.h-90); ctx.strokeStyle=game.extraction?C.accent:'rgba(82,255,174,.25)'; ctx.lineWidth=3; ctx.beginPath(); ctx.arc(0,0,62,0,TAU); ctx.stroke(); ctx.fillStyle='rgba(82,255,174,.06)'; ctx.beginPath(); ctx.arc(0,0,62,0,TAU); ctx.fill(); textCenter('EXTRAÇÃO',0,4,12,C.text); ctx.restore();
  for(const o of game.obstacles) drawObstacle(o);
  for(const pk of game.pickups) if(!pk.col) drawPickup(pk);
  for(const t of game.terminals) drawTerminal(t);
  for(const e of game.enemies) if(e.hp>0) drawEnemy(e);
  drawDrone(); drawPlayer();
  for(const b of game.bullets) drawBullet(b);
  for(const pa of game.particles) drawParticle(pa);
  ctx.restore();
  // cinematic vignette
  const vg=ctx.createRadialGradient(W/2,H/2,Math.min(W,H)*.12,W/2,H/2,Math.max(W,H)*.7); vg.addColorStop(0,'rgba(0,0,0,0)'); vg.addColorStop(1,'rgba(0,0,0,.32)'); ctx.fillStyle=vg; ctx.fillRect(0,0,W,H);
  drawWeather(); drawMinimap();
}

  function textCenter(txt,x,y,size,col){ ctx.fillStyle=col; ctx.font=`900 ${size}px system-ui`; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(txt,x,y); }
  
function drawObstacle(o){
  ctx.save(); ctx.translate(o.x,o.y); ctx.rotate(o.rot);
  if(o.kind==='wall'){
    ctx.fillStyle='#1b2520'; ctx.strokeStyle='rgba(180,210,195,.15)'; ctx.lineWidth=2; ctx.beginPath(); ctx.roundRect(-o.w/2,-o.h/2,o.w,o.h,10); ctx.fill(); ctx.stroke();
    ctx.fillStyle='rgba(255,255,255,.05)'; ctx.fillRect(-o.w/2+8,-o.h/2+8,o.w-16,6);
    for(let i=-o.w/2+16;i<o.w/2-8;i+=28){ ctx.fillStyle='rgba(82,255,174,.06)'; ctx.fillRect(i,-2,12,4); }
  } else if(o.kind==='rock'){
    ctx.fillStyle='#20261f'; ctx.strokeStyle='rgba(255,255,255,.10)'; ctx.lineWidth=2; ctx.beginPath(); ctx.ellipse(0,0,o.w*.56,o.h*.46,0,0,TAU); ctx.fill(); ctx.stroke();
    ctx.strokeStyle='rgba(255,255,255,.05)'; ctx.beginPath(); ctx.moveTo(-o.w*.2,-o.h*.1); ctx.lineTo(o.w*.18,o.h*.1); ctx.moveTo(-o.w*.1,o.h*.16); ctx.lineTo(o.w*.22,-o.h*.08); ctx.stroke();
  } else if(o.kind==='tree'){
    ctx.fillStyle='#1d2d21'; ctx.beginPath(); ctx.ellipse(0,4,o.w*.46,o.h*.40,0,0,TAU); ctx.fill(); ctx.fillStyle='#33483a'; ctx.beginPath(); ctx.ellipse(-6,-4,o.w*.28,o.h*.24,0,0,TAU); ctx.fill(); ctx.beginPath(); ctx.ellipse(8,-8,o.w*.26,o.h*.22,0,0,TAU); ctx.fill(); ctx.fillStyle='#3d2f20'; ctx.fillRect(-4,o.h*.12,8,o.h*.22);
  } else {
    ctx.fillStyle='#1a2924'; ctx.strokeStyle='rgba(95,223,255,.22)'; ctx.lineWidth=2; ctx.beginPath(); ctx.roundRect(-o.w/2,-o.h/2,o.w,o.h,10); ctx.fill(); ctx.stroke();
    ctx.fillStyle='rgba(95,223,255,.16)'; ctx.fillRect(-o.w*.28,-o.h*.18,o.w*.56,o.h*.22); ctx.fillStyle='rgba(82,255,174,.14)'; ctx.fillRect(-o.w*.18,o.h*.08,o.w*.36,4);
  }
  ctx.restore();
}
function drawPickup(pk){ ctx.save(); ctx.translate(pk.x,pk.y+Math.sin(pk.phase)*3); const col={energia:C.warn,agua:C.cyan,pecas:'#c7c7c7',dados:C.accent,medicina:'#b4ff7b'}[pk.type]||C.accent; ctx.shadowBlur=16; ctx.shadowColor=col; ctx.fillStyle=col; ctx.beginPath(); ctx.roundRect(-8,-8,16,16,5); ctx.fill(); ctx.shadowBlur=0; ctx.restore(); }
function drawTerminal(t){ ctx.save(); ctx.translate(t.x,t.y); ctx.strokeStyle=t.active?C.accent:'rgba(95,223,255,.45)'; ctx.fillStyle=t.antenna?'rgba(95,223,255,.12)':'rgba(82,255,174,.10)'; ctx.lineWidth=3; ctx.beginPath(); ctx.arc(0,0,t.r,0,TAU); ctx.fill(); ctx.stroke(); if(t.antenna){ ctx.strokeStyle=t.active?C.accent:C.cyan; ctx.beginPath(); ctx.moveTo(0,20); ctx.lineTo(0,-42); ctx.moveTo(0,-26); ctx.lineTo(-23,-4); ctx.moveTo(0,-26); ctx.lineTo(23,-4); ctx.stroke(); } else { ctx.fillStyle=t.active?C.accent:C.cyan; ctx.fillRect(-14,-18,28,36); ctx.fillStyle='#06100c'; ctx.fillRect(-9,-11,18,10); } if(t.progress>0&&!t.active){ ctx.strokeStyle=C.warn; ctx.beginPath(); ctx.arc(0,0,t.r+7,-Math.PI/2,-Math.PI/2+TAU*t.progress); ctx.stroke(); } ctx.restore(); }
function drawEnemy(e){
  ctx.save(); ctx.translate(e.x,e.y); const col=e.type==='turret'?C.warn:e.type==='crawler'?C.danger:'#ff7b8b';
  ctx.shadowBlur=e.alert?18:8; ctx.shadowColor=col; ctx.lineWidth=2;
  if(e.type==='drone'){
    ctx.rotate(game.t*2.5+e.x*.001); ctx.fillStyle='rgba(30,8,14,.92)'; ctx.strokeStyle=col; ctx.beginPath(); ctx.roundRect(-18,-14,36,28,9); ctx.fill(); ctx.stroke();
    for(const s of [[-26,-16], [26,-16], [-26,16], [26,16]]){ ctx.beginPath(); ctx.arc(s[0],s[1],8,0,TAU); ctx.fillStyle='rgba(15,18,17,.95)'; ctx.fill(); ctx.stroke(); }
    ctx.fillStyle='rgba(255,255,255,.12)'; ctx.fillRect(-8,-4,16,8);
  } else if(e.type==='crawler'){
    ctx.rotate(Math.sin(game.t*8+e.x*.02)*.08); ctx.fillStyle='rgba(35,8,12,.95)'; ctx.strokeStyle=col; ctx.beginPath(); ctx.ellipse(0,0,22,15,0,0,TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle='rgba(255,120,135,.18)'; ctx.beginPath(); ctx.ellipse(0,-2,10,6,0,0,TAU); ctx.fill();
    for(let i=-1;i<=1;i+=2){ for(let j=0;j<3;j++){ ctx.beginPath(); ctx.moveTo(i*(5+j*4), 5+j*3); ctx.lineTo(i*(18+j*4), 14+j*4); ctx.moveTo(i*(5+j*4), -5-j*3); ctx.lineTo(i*(18+j*4), -14-j*4); ctx.stroke(); }}
    ctx.fillStyle='#ffb4bf'; ctx.beginPath(); ctx.arc(-7,-3,2.2,0,TAU); ctx.arc(7,-3,2.2,0,TAU); ctx.fill();
  } else {
    const a=angleTo(e.x,e.y,game.player.x,game.player.y); ctx.rotate(a);
    ctx.fillStyle='rgba(28,14,7,.95)'; ctx.strokeStyle=col; ctx.beginPath(); ctx.roundRect(-12,-18,24,36,8); ctx.fill(); ctx.stroke();
    ctx.fillStyle='#27160f'; ctx.beginPath(); ctx.arc(0,-22,8,0,TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle='rgba(255,200,91,.16)'; ctx.fillRect(-7,-25,14,6); ctx.fillStyle='rgba(15,12,10,.95)'; ctx.fillRect(10,-4,18,4); ctx.fillRect(24,-5,8,6);
    ctx.strokeStyle='rgba(255,170,120,.35)'; ctx.beginPath(); ctx.moveTo(-8,15); ctx.lineTo(-12,28); ctx.moveTo(8,15); ctx.lineTo(12,28); ctx.stroke();
  }
  ctx.shadowBlur=0; ctx.fillStyle='rgba(0,0,0,.55)'; ctx.fillRect(-23,-36,46,5); ctx.fillStyle=col; ctx.fillRect(-23,-36,46*(e.hp/e.max),5); ctx.restore();
}
function drawPlayer(){
  const p=game.player; ctx.save(); ctx.translate(p.x,p.y); if(p.inv>0&&Math.floor(game.t*18)%2===0) ctx.globalAlpha=.55;
  const target=nearestEnemy(700) || {x:p.x, y:p.y-100}; const a=angleTo(p.x,p.y, input.targetX ?? target.x, input.targetY ?? target.y); ctx.rotate(a);
  ctx.shadowBlur=16; ctx.shadowColor=C.accent; ctx.fillStyle='#0f1813'; ctx.strokeStyle=C.accent; ctx.lineWidth=2;
  // torso
  ctx.beginPath(); ctx.roundRect(-13,-16,26,32,9); ctx.fill(); ctx.stroke();
  // backpack
  ctx.fillStyle='#17231d'; ctx.fillRect(-9,12,18,10);
  // shoulders
  ctx.fillStyle='#122019'; ctx.fillRect(-17,-9,6,18); ctx.fillRect(11,-9,6,18);
  // head + visor
  ctx.fillStyle='#0b120e'; ctx.beginPath(); ctx.arc(0,-20,10,0,TAU); ctx.fill(); ctx.stroke();
  ctx.fillStyle='rgba(95,223,255,.45)'; ctx.beginPath(); ctx.roundRect(-7,-24,14,7,3); ctx.fill();
  // weapon
  ctx.fillStyle='#2f3935'; ctx.fillRect(11,-3,20,6); ctx.fillRect(27,-4,7,8); ctx.fillRect(16,3,6,7);
  // legs
  ctx.strokeStyle='rgba(82,255,174,.55)'; ctx.lineWidth=3; ctx.beginPath(); ctx.moveTo(-5,16); ctx.lineTo(-7,30); ctx.moveTo(5,16); ctx.lineTo(7,30); ctx.stroke();
  // antenna / details
  ctx.strokeStyle='rgba(95,223,255,.65)'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(-10,-11); ctx.lineTo(-16,-30); ctx.stroke();
  ctx.fillStyle='rgba(82,255,174,.2)'; ctx.beginPath(); ctx.arc(-16,-30,3,0,TAU); ctx.fill();
  ctx.shadowBlur=0; ctx.restore();
}
function drawDrone(){ const d=game.drone; ctx.save(); ctx.translate(d.x,d.y); ctx.shadowBlur=14; ctx.shadowColor=C.cyan; ctx.fillStyle='rgba(95,223,255,.25)'; ctx.strokeStyle=C.cyan; ctx.beginPath(); ctx.arc(0,0,10+Math.sin(game.t*5)*1.5,0,TAU); ctx.fill(); ctx.stroke(); ctx.restore(); }
  function drawBullet(b){ ctx.save(); ctx.translate(b.x,b.y); ctx.shadowBlur=16; ctx.shadowColor=b.enemy?C.danger:(b.drone?C.cyan:C.accent); ctx.fillStyle=b.enemy?C.danger:(b.drone?C.cyan:C.accent); ctx.beginPath(); ctx.arc(0,0,b.r,0,TAU); ctx.fill(); ctx.restore(); }
  function drawParticle(pa){ ctx.save(); ctx.globalAlpha=clamp(pa.life/pa.max,0,1); ctx.fillStyle=pa.col; ctx.beginPath(); ctx.arc(pa.x,pa.y,pa.r,0,TAU); ctx.fill(); ctx.restore(); }
  function drawWeather(){ const m=game.mission; ctx.save(); if(m.clima==='chuva'){ ctx.strokeStyle='rgba(130,210,255,.18)'; for(const w of game.weather){ w.y+=w.sp*.016; w.x+=30*.016; if(w.y>H){w.y=-20;w.x=rnd(W);} ctx.beginPath(); ctx.moveTo(w.x,w.y); ctx.lineTo(w.x-5,w.y+w.len); ctx.stroke(); }} else { ctx.fillStyle=m.clima==='neve'?'rgba(230,250,255,.35)':'rgba(255,190,110,.18)'; for(const w of game.weather){ w.y+=w.sp*.004; w.x+=Math.sin(game.t+w.z*9)*.4; if(w.y>H){w.y=-10;w.x=rnd(W);} ctx.beginPath(); ctx.arc(w.x,w.y,1.2+w.z*2,0,TAU); ctx.fill(); }} ctx.restore(); }
  function drawMinimap(){ const m=game.mission, x=W-94, y=Math.max(80,H*.10), w=80, h=108; ctx.save(); ctx.globalAlpha=.92; ctx.fillStyle='rgba(0,0,0,.38)'; ctx.strokeStyle='rgba(82,255,174,.22)'; ctx.roundRect(x,y,w,h,13); ctx.fill(); ctx.stroke(); const sx=w/m.w, sy=h/m.h; ctx.fillStyle=C.accent; ctx.beginPath(); ctx.arc(x+game.player.x*sx,y+game.player.y*sy,3,0,TAU); ctx.fill(); ctx.fillStyle=C.danger; for(const e of game.enemies) if(e.hp>0){ ctx.beginPath(); ctx.arc(x+e.x*sx,y+e.y*sy,2,0,TAU); ctx.fill(); } ctx.fillStyle=C.cyan; for(const t of game.terminals){ ctx.fillRect(x+t.x*sx-1.5,y+t.y*sy-1.5,3,3); } ctx.restore(); }

  function loop(ts){ const dt=Math.min(.033,(ts-last)/1000||0); last=ts; update(dt); draw(); }

  function bindTouchControls(){
    const joy=document.getElementById('joystick'), stick=document.getElementById('stick'), shoot=document.getElementById('shootBtn'), scanBtn=document.getElementById('scanBtn'), interactBtn=document.getElementById('interactBtn');
    if(joy){ joy.onpointerdown=e=>{ input.joy=true; input.joyId=e.pointerId; joy.setPointerCapture(e.pointerId); const r=joy.getBoundingClientRect(); input.joyCX=r.left+r.width/2; input.joyCY=r.top+r.height/2; moveJoy(e,stick); }; joy.onpointermove=e=>{ if(input.joy&&e.pointerId===input.joyId) moveJoy(e,stick); }; joy.onpointerup=joy.onpointercancel=e=>{ input.joy=false; input.moveX=input.moveY=0; stick.style.transform='translate(0px,0px)'; }; }
    if(shoot){ shoot.onpointerdown=e=>{ ensureAudio(); input.shoot=true; input.shootId=e.pointerId; shoot.setPointerCapture(e.pointerId); shoot.classList.add('active'); fire(true); }; shoot.onpointerup=shoot.onpointercancel=e=>{ input.shoot=false; shoot.classList.remove('active'); }; }
    if(scanBtn) scanBtn.onpointerdown=e=>{ ensureAudio(); input.scan=true; };
    if(interactBtn) interactBtn.onpointerdown=e=>{ ensureAudio(); input.interact=true; };
  }
  function moveJoy(e,stick){ const dx=e.clientX-input.joyCX, dy=e.clientY-input.joyCY, d=Math.hypot(dx,dy), max=42, k=d>max?max/d:1; input.moveX=dx*k/max; input.moveY=dy*k/max; stick.style.transform=`translate(${dx*k}px,${dy*k}px)`; }

  addEventListener('keydown',e=>{ input.keys[e.key]=true; ensureAudio(); if(e.key===' '){input.shoot=true; fire(true);} if(e.key.toLowerCase()==='q') input.scan=true; if(e.key.toLowerCase()==='e') input.interact=true; if(e.key==='Escape'&&mode==='mission'){ paused=!paused; toast(paused?'Pausa':'Retomado',.8); } });
  addEventListener('keyup',e=>{ input.keys[e.key]=false; if(e.key===' ') input.shoot=false; });
  canvas.addEventListener('pointerdown',e=>{ if(mode!=='mission') return; ensureAudio(); const w=screenToWorld(e.clientX,e.clientY); input.targetX=w.x; input.targetY=w.y; fire(false); }, {passive:false});

  showMenu(); requestAnimationFrame(loop);
})();

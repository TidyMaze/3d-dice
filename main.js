import * as THREE from 'three';
import { createScene } from './scene.js';
import { createPhysics } from './physics.js';
import { createAudio } from './audio.js';
import { createDie, DIE_TYPES } from './dice.js';

const COLORS = {
  ruby:     { color: '#b01030', ink: '#ffffff' },
  sapphire: { color: '#1f4fbf', ink: '#ffffff' },
  ivory:    { color: '#efe6d2', ink: '#1a1a1a' },
  onyx:     { color: '#181818', ink: '#e8c25a' },
  emerald:  { color: '#12805a', ink: '#ffffff' },
  amber:    { color: '#e0951a', ink: '#1a1a1a' },
};
const SIDES = { d4: 4, d6: 6, d8: 8, d10: 10, d12: 12, d20: 20 };
const MIN_ROLL_TIME = 0.5;
const MAX_ROLL_TIME = 8; // read anyway if something never falls asleep
const COCKED = 0.97; // top face/vertex must point this straight up, else the die is re-nudged
const MAX_NUDGES = 3;
const HISTORY_SIZE = 8;
const STORE = 'dice:v1';
const HOLD_GLOW = new THREE.Color('#e8b44c');

const $ = (id) => document.getElementById(id);
const counts = Object.fromEntries(DIE_TYPES.map((t) => [t, t === 'd6' ? 2 : 0]));
let colorName = 'ruby';
let modifier = 0;
let muted = false;
let uiHidden = false;
try {
  const saved = JSON.parse(localStorage.getItem(STORE));
  if (saved) {
    for (const t of DIE_TYPES) if (Number.isInteger(saved.counts?.[t])) counts[t] = Math.max(0, Math.min(10, saved.counts[t]));
    if (COLORS[saved.colorName]) colorName = saved.colorName;
    if (Number.isInteger(saved.modifier)) modifier = Math.max(-20, Math.min(20, saved.modifier));
    muted = saved.muted === true;
    uiHidden = saved.uiHidden === true;
  }
} catch { /* storage blocked: defaults */ }
const save = () => { try { localStorage.setItem(STORE, JSON.stringify({ counts, colorName, modifier, muted, uiHidden })); } catch { /* ignore */ } };

let dice = []; // { die, body, held }
let rollTime = null; // seconds since throw, null when idle
let nudges = 0;
let pulseT = 0;
const history = [];

const stage = $('stage');
const sc = createScene(stage);
const audio = createAudio();
const physics = createPhysics({ onImpact: (speed, kind) => { if (!muted) audio.impact(speed, kind); } });

// ---- UI ----
const signed = (n) => (n < 0 ? `−${-n}` : `+${n}`);

function renderCounters() {
  $('counters').innerHTML = DIE_TYPES.map((t) => `
    <div class="row"><b>${t.toUpperCase()}</b>
      <div class="count"><button data-t="${t}" data-d="-1" aria-label="Fewer ${t}">−</button>
      <span>${counts[t]}</span><button data-t="${t}" data-d="1" aria-label="More ${t}">+</button></div></div>`).join('') + `
    <div class="row"><b>MOD</b>
      <div class="count"><button data-t="mod" data-d="-1" aria-label="Lower modifier">−</button>
      <span>${signed(modifier)}</span><button data-t="mod" data-d="1" aria-label="Raise modifier">+</button></div></div>`;
  const n = DIE_TYPES.reduce((s, t) => s + counts[t], 0);
  const max = DIE_TYPES.reduce((s, t) => s + counts[t] * SIDES[t], 0);
  $('range').textContent = n ? `Range ${n + modifier} to ${max + modifier}` : 'Add a die to roll';
}
$('counters').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.t === 'mod') modifier = Math.max(-20, Math.min(20, modifier + Number(b.dataset.d)));
  else counts[b.dataset.t] = Math.max(0, Math.min(10, counts[b.dataset.t] + Number(b.dataset.d)));
  renderCounters();
  save();
});

function renderSwatches() {
  $('swatches').innerHTML = Object.entries(COLORS).map(([n, c]) =>
    `<button class="swatch" data-c="${n}" title="${n}" aria-label="${n}" aria-pressed="${n === colorName}" style="background:${c.color}"></button>`).join('');
}
$('swatches').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  colorName = b.dataset.c;
  renderSwatches();
  save();
});

function renderMute() {
  $('mute').textContent = muted ? 'Sound off' : 'Sound on';
  $('mute').setAttribute('aria-pressed', String(muted));
}
$('mute').addEventListener('click', () => { muted = !muted; renderMute(); save(); });

function renderUi() {
  document.body.classList.toggle('ui-hidden', uiHidden);
  const b = $('ui-toggle');
  b.setAttribute('aria-pressed', String(uiHidden));
  b.setAttribute('aria-label', uiHidden ? 'Show controls' : 'Hide controls');
  b.title = `${uiHidden ? 'Show' : 'Hide'} controls (H)`;
  b.textContent = uiHidden ? '☰' : '◱';
}
const toggleUi = () => { uiHidden = !uiHidden; renderUi(); save(); };
$('ui-toggle').addEventListener('click', toggleUi);

function showResults(values) {
  const total = values.reduce((s, v) => s + v.value, 0) + modifier;
  $('total').innerHTML = `${total}<small>TOTAL</small>`;
  $('mini').textContent = total;
  $('groups').innerHTML = DIE_TYPES.filter((t) => values.some((v) => v.type === t)).map((t) =>
    `<div class="group"><i>${t}</i>${values.filter((v) => v.type === t).map((v) =>
      `<span class="chip pulse${v.held ? ' held' : ''}">${v.value}</span>`).join('')}</div>`).join('') +
    (modifier ? `<div class="group"><i>mod</i><span class="chip">${signed(modifier)}</span></div>` : '');
  const label = DIE_TYPES.map((t) => [t, values.filter((v) => v.type === t).length]).filter(([, n]) => n)
    .map(([t, n]) => `${n}${t}`).join(' + ') + (modifier ? ` ${signed(modifier)}` : '');
  history.unshift({ label, total });
  history.length = Math.min(history.length, HISTORY_SIZE);
  $('history').innerHTML = history.map((h) => `<li><span>${h.label}</span><b>${h.total}</b></li>`).join('');
}

const materials = (mesh) => [mesh.material].flat();

function clearDice() {
  for (const { die, body } of dice) {
    physics.removeDie(body);
    sc.scene.remove(die.mesh);
    die.mesh.geometry.dispose();
    for (const m of materials(die.mesh)) { m.map?.dispose(); m.bumpMap?.dispose(); m.dispose(); }
  }
  dice = [];
  rollTime = null;
}

function clearAll() {
  clearDice();
  $('total').textContent = $('mini').textContent = '–';
  $('groups').innerHTML = '';
}

function setHeld(d, held) {
  d.held = held;
  physics.setHeld(d.body, held);
  for (const m of materials(d.die.mesh)) {
    m.emissive.copy(HOLD_GLOW);
    m.emissiveIntensity = held ? 0.35 : 0;
  }
}

// ---- Roll ----
function startRoll() {
  $('total').textContent = $('mini').textContent = '…';
  $('groups').innerHTML = '';
  $('roll').textContent = 'ROLLING';
  rollTime = 0;
  nudges = 0;
}

function roll() {
  if (rollTime !== null) return;
  audio.unlock();
  // held dice stay; only the others are thrown again
  if (dice.some((d) => d.held)) {
    const free = dice.filter((d) => !d.held);
    if (!free.length) return;
    free.forEach((d, i) => physics.throwDie(d.body, i, free.length));
    startRoll();
    return;
  }
  const types = DIE_TYPES.flatMap((t) => Array(counts[t]).fill(t));
  if (!types.length) return;
  clearDice();
  const { color, ink } = COLORS[colorName];
  types.forEach((t, i) => {
    const die = createDie(t, { color, inkColor: ink, size: 1 });
    sc.scene.add(die.mesh);
    const body = physics.addDie(die);
    physics.throwDie(body, i, types.length);
    dice.push({ die, body, held: false });
  });
  startRoll();
}

function settle() {
  const cocked = dice.filter((d) => !d.held && d.die.upDot(d.body.quaternion) < COCKED);
  if (cocked.length && nudges < MAX_NUDGES && rollTime < MAX_ROLL_TIME) {
    nudges++;
    cocked.forEach((d) => physics.nudge(d.body));
    return;
  }
  rollTime = null;
  pulseT = 0.5;
  $('roll').textContent = dice.some((d) => d.held) ? 'ROLL OTHERS' : 'ROLL';
  showResults(dice.map(({ die, body, held }) => ({ type: die.type, value: die.readValue(body.quaternion), held })));
}

$('roll').addEventListener('click', roll);
$('clear').addEventListener('click', () => { clearAll(); $('roll').textContent = 'ROLL'; });
addEventListener('keydown', (e) => {
  audio.unlock();
  if (e.code === 'Space' && !e.repeat && !e.target.closest('button')) { e.preventDefault(); roll(); }
  if (e.code === 'KeyH' && !e.repeat) toggleUi();
});
addEventListener('pointerdown', () => audio.unlock());

// A tap (not a drag-orbit) on a die toggles hold; on the table it rolls.
const ray = new THREE.Raycaster();
function tap(e) {
  const r = stage.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), sc.camera);
  const hit = ray.intersectObjects(dice.map((d) => d.die.mesh), false)[0];
  const d = hit && dice.find((x) => x.die.mesh === hit.object);
  if (!d) return roll();
  if (rollTime !== null) return;
  setHeld(d, !d.held);
  $('roll').textContent = dice.some((x) => x.held) ? 'ROLL OTHERS' : 'ROLL';
}
let down = null;
stage.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
stage.addEventListener('pointerup', (e) => {
  if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6 && performance.now() - down.t < 400) tap(e);
  down = null;
});

// ---- Loop ----
function resize() { sc.setSize(innerWidth, innerHeight); }
addEventListener('resize', resize);
resize();

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;
  physics.step(dt);
  for (const { die, body } of dice) {
    die.mesh.position.copy(body.position);
    die.mesh.quaternion.copy(body.quaternion);
  }
  if (rollTime !== null) {
    rollTime += dt;
    if ((rollTime > MIN_ROLL_TIME && physics.allAsleep()) || rollTime > MAX_ROLL_TIME) settle();
  }
  if (pulseT > 0) {
    pulseT = Math.max(0, pulseT - dt);
    const s = 1 + 0.12 * Math.sin((1 - pulseT / 0.5) * Math.PI);
    for (const { die, held } of dice) if (!held) die.mesh.scale.setScalar(s);
  }
  sc.render();
  requestAnimationFrame(frame);
}

renderCounters();
renderSwatches();
renderMute();
renderUi();
requestAnimationFrame(frame);

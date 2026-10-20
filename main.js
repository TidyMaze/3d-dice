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
const MIN_ROLL_TIME = 0.5;
const HISTORY_SIZE = 8;

const $ = (id) => document.getElementById(id);
const counts = Object.fromEntries(DIE_TYPES.map((t) => [t, t === 'd6' ? 2 : 0]));
let colorName = 'ruby';
let dice = []; // { die, body }
let rollTime = null; // seconds since throw, null when idle
let pulseT = 0;
const history = [];

const stage = $('stage');
const sc = createScene(stage);
const audio = createAudio();
const physics = createPhysics({ onImpact: (speed, kind) => audio.impact(speed, kind) });

// ---- UI ----
function renderCounters() {
  $('counters').innerHTML = DIE_TYPES.map((t) => `
    <div class="row"><b>${t.toUpperCase()}</b>
      <div class="count"><button data-t="${t}" data-d="-1" aria-label="Fewer ${t}">−</button>
      <span>${counts[t]}</span><button data-t="${t}" data-d="1" aria-label="More ${t}">+</button></div></div>`).join('');
}
$('counters').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  counts[b.dataset.t] = Math.max(0, Math.min(10, counts[b.dataset.t] + Number(b.dataset.d)));
  renderCounters();
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
});

function showResults(values) {
  const total = values.reduce((s, v) => s + v.value, 0);
  $('total').innerHTML = `${total}<small>TOTAL</small>`;
  $('groups').innerHTML = DIE_TYPES.filter((t) => values.some((v) => v.type === t)).map((t) =>
    `<div class="group"><i>${t}</i>${values.filter((v) => v.type === t).map((v) => `<span class="chip pulse">${v.value}</span>`).join('')}</div>`).join('');
  const label = DIE_TYPES.filter((t) => counts[t]).map((t) => `${counts[t]}${t}`).join(' + ');
  history.unshift({ label, total });
  history.length = Math.min(history.length, HISTORY_SIZE);
  $('history').innerHTML = history.map((h) => `<li><span>${h.label}</span><b>${h.total}</b></li>`).join('');
}

function clearDice() {
  for (const { die, body } of dice) {
    physics.removeDie(body);
    sc.scene.remove(die.mesh);
    die.mesh.traverse((o) => { o.geometry?.dispose(); });
  }
  dice = [];
  rollTime = null;
}

function clearAll() {
  clearDice();
  $('total').textContent = '–';
  $('groups').innerHTML = '';
}

// ---- Roll ----
function roll() {
  const types = DIE_TYPES.flatMap((t) => Array(counts[t]).fill(t));
  if (!types.length) return;
  audio.unlock();
  clearDice();
  const { color, ink } = COLORS[colorName];
  types.forEach((t, i) => {
    const die = createDie(t, { color, inkColor: ink, size: 1 });
    sc.scene.add(die.mesh);
    const body = physics.addDie(die);
    physics.throwDie(body, i, types.length);
    dice.push({ die, body });
  });
  $('total').textContent = '…';
  $('groups').innerHTML = '';
  rollTime = 0;
}

function settle() {
  rollTime = null;
  pulseT = 0.5;
  showResults(dice.map(({ die, body }) => ({ type: die.type, value: die.readValue(body.quaternion) })));
}

$('roll').addEventListener('click', roll);
$('clear').addEventListener('click', clearAll);
addEventListener('keydown', (e) => {
  audio.unlock();
  if (e.code === 'Space' && !e.repeat) { e.preventDefault(); roll(); }
});
addEventListener('pointerdown', () => audio.unlock());

// A tap on the table (not a drag-orbit) rolls.
let down = null;
stage.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
stage.addEventListener('pointerup', (e) => {
  if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6 && performance.now() - down.t < 400) roll();
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
    if (rollTime > MIN_ROLL_TIME && physics.allAsleep()) settle();
  }
  if (pulseT > 0) {
    pulseT = Math.max(0, pulseT - dt);
    const s = 1 + 0.12 * Math.sin((1 - pulseT / 0.5) * Math.PI);
    for (const { die } of dice) die.mesh.scale.setScalar(s);
  }
  sc.controls.update();
  sc.render();
  requestAnimationFrame(frame);
}

renderCounters();
renderSwatches();
requestAnimationFrame(frame);

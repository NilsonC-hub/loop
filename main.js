import { LoopAudio } from './audio.js';

const canvas = document.querySelector('#field');
const ctx = canvas.getContext('2d', { alpha: false });
const host = document.querySelector('#loop');
const soundButton = document.querySelector('#sound');
const hint = document.querySelector('#hint');
const status = document.querySelector('#status');
const audio = new LoopAudio();
const TAU = Math.PI * 2;
const COUNT = 21;
const SAMPLES = 112;
const GROUPS = 3;
const SCENES = [
  { name: 'Verdant', bg: '#304e32', back: '#3a5d38', ink: '#d4e5bd', colors: ['#bfdca1', '#80b967', '#5e9851'] },
  { name: 'Undertow', bg: '#779bc4', back: '#82a4ca', ink: '#182f4b', colors: ['#c7e0cc', '#315a85', '#4b78a4'] },
  { name: 'Suspension', bg: '#111111', back: '#191919', ink: '#e9e9e3', colors: ['#f0f0e7', '#d9d9d0', '#b8b9b1'] },
  { name: 'Overtone', bg: '#f3e91c', back: '#e9dd16', ink: '#30352b', colors: ['#663cba', '#cf4337', '#298b52'] },
];
const mod = (v, n) => ((v % n) + n) % n;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = v => v * v * (3 - 2 * v);
const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
let reduced = reducedQuery.matches;
let width = 0, height = 0, unit = 0, dpr = 1;
let time = 0, lastFrame = performance.now(), position = 0, target = 0, velocity = 0;
let paused = false, hidden = false, enabled = false, enabling = false, firstGesture = false, soundTouched = false;
let pendingPluck = false, soundAttempt = 0;
let dragging = false, dragStart = null, pointerId = null, currentScene = 0;
let pointer = { x: .5, y: .5, inside: false, sx: .5, sy: .5, speed: 0 };
let motion = { energy: 0, low: 0, mid: 0, high: 0, onset: 0, kind: 'pluck', pitch: .5, notePulse: 0, phraseProgress: 0 };
let resonance = 0, lastOnset = 0, lastNoteId = 0, rippleId = 0;
let ripples = [];
let latestTrace = null, lastStats = 0, frameMs = 16, drawMs = 0, peakEnergy = 0, peakOnset = 0;
const paths = Array.from({ length: GROUPS * COUNT }, () => new Float32Array((SAMPLES + 1) * 2));
const pointA = new Float64Array(2), pointB = new Float64Array(2);

function resize() {
  width = innerWidth; height = innerHeight; unit = Math.min(width, height);
  dpr = Math.min(devicePixelRatio || 1, 1.5, Math.sqrt(2500000 / (width * height)));
  canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function addRipple(x = pointer.x, y = pointer.y, strength = 1, kind = motion.kind) {
  ripples.push({ x, y, strength, born: time, kind, id: ++rippleId });
  if (ripples.length > 7) ripples.shift();
}

// Every movement has the same topology. The points, not image layers, travel
// between compositions. A horizontal gesture can reverse every intermediate frame.
function shape(scene, group, line, u, t, out) {
  const k = (line - (COUNT - 1) * .5);
  const q = line / (COUNT - 1);
  const a = u * TAU;
  const breath = reduced ? 0 : Math.sin(t * .33) * .012;
  const swell = motion.low * .035 + resonance * .019;
  const note = reduced ? 0 : motion.notePulse;
  const tuning = (motion.pitch - .5) * note;
  const py = (pointer.sy - .5) * .1;
  let x, y;
  if (scene === 0) {
    if (group === 0) {
      const r = .207 + line * .0095;
      const ring = r + breath + swell * Math.sin(a * 2 + t * 1.2) + note * .013;
      const roll = -.18 + Math.sin(t * .15) * .065 + tuning * .13;
      x = width * .48 + Math.cos(a + roll) * ring * unit * 1.24;
      y = height * .53 + Math.sin(a + roll) * ring * unit * .91;
    } else if (group === 1) {
      y = lerp(-height * .3, height * 1.3, u);
      x = width * .24 + unit * (Math.sin(u * 5.3 + .2 + t * .13) * .2 + k * .012);
      x += Math.sin(u * 9 - t * .5) * unit * (motion.mid * .02);
      x += Math.sin(u * 5.3 + motion.pitch * 3) * unit * note * .024;
    } else {
      x = lerp(-width * .25, width * 1.25, u);
      y = height * .58 + unit * (.24 * Math.sin(u * 6.2 - .7 + t * .11) + k * .012);
      y += Math.sin(u * 11 + t * .5) * unit * swell * .6;
      y += Math.sin(u * 6.2 - motion.pitch * 3) * unit * note * .018;
    }
  } else if (scene === 1) {
    if (group === 0) {
      const r = .27 + line * .0105 + breath;
      const wave = Math.sin(a * 3 + t * .5) * (motion.mid * .028 + note * .012);
      x = width * .65 + Math.cos(a - .2) * (r + wave) * unit * 1.14;
      y = height * .83 + Math.sin(a - .2) * (r + wave) * unit;
    } else {
      const sign = group === 1 ? 1 : -1;
      x = lerp(-width * .25, width * 1.25, u);
      y = height * (group === 1 ? .4 : .2) + (u - .5) * unit * sign * 1.25 + k * unit * .013;
      y += Math.sin(u * 6 + t * .42 + group) * unit * (.04 + motion.mid * .13);
      y += Math.sin(u * 14 - t * .8) * unit * motion.high * .018;
      y += Math.sin(u * (5 + motion.pitch * 6) - t * .8) * unit * note * .038;
    }
  } else if (scene === 2) {
    const row = (group * COUNT + line) / (COUNT * GROUPS - 1);
    const depth = .38 + row * .62;
    const spread = lerp(.82, 1.35, row);
    x = width * .5 + (u - .5) * width * spread;
    y = height * (.22 + row * .53);
    y += unit * (Math.sin(u * 7 + t * .3 + row * 2.3) * .125 +
      Math.sin(u * 13 - t * .19 + row * 4.2) * .028) * depth;
    y += Math.sin(u * 19 + row * 9 - t * 3) * unit * motion.high * .018;
    y -= resonance * .016 * unit * Math.sin(u * 8 + row * 5);
    y += Math.sin(u * (5 + motion.pitch * 10) + row * 5) * unit * note * .035;
  } else {
    const tempo = t * .18;
    if (group === 0) {
      const r = .155 + line * .01;
      const tension = Math.sin(a * 3 + t * 2) * resonance * .014 +
        Math.sin(a * 5 - t * 1.3) * motion.high * .018 +
        Math.sin(a * (2 + Math.round(motion.pitch * 3))) * note * .023;
      x = width * .43 + Math.cos(a + .45) * (r + tension) * unit;
      y = height * .53 + Math.sin(a + .45) * (r + tension) * unit * 1.3;
    } else if (group === 1) {
      x = lerp(-width * .2, width * 1.2, u);
      y = height * .49 + Math.sin(u * 6.6 + tempo) * unit * .32 + k * unit * .012;
      y += Math.sin(u * 13 - t) * motion.mid * .04 * unit;
      y += Math.sin(u * 9 + motion.pitch * 4) * note * .035 * unit;
    } else {
      y = lerp(-height * .4, height * 1.4, u);
      x = width * .61 + Math.sin(u * 5.5 - tempo) * unit * .23 + k * unit * .012;
      x += Math.sin(u * 11 + t * 1.6) * resonance * .022 * unit;
      x += Math.sin(u * 7 - motion.pitch * 4) * note * .025 * unit;
    }
  }
  // Slow parallax changes the line field as a whole; local pulls have their own falloff.
  x += (pointer.sx - .5) * unit * .025;
  y += py * unit * (scene === 2 ? .2 : .12);
  out[0] = x; out[1] = y;
}

function buildPaths(a, b, blend) {
  const unfolding = Math.sin(blend * Math.PI);
  const dotness = lerp(a === 2 ? 1 : 0, b === 2 ? 1 : 0, blend);
  for (let g = 0; g < GROUPS; g++) for (let l = 0; l < COUNT; l++) {
    const path = paths[g * COUNT + l];
    for (let j = 0; j <= SAMPLES; j++) {
      const u = j / SAMPLES;
      shape(a, g, l, u, time, pointA);
      if (blend > .0001) shape(b, g, l, u, time, pointB);
      else { pointB[0] = pointA[0]; pointB[1] = pointA[1]; }
      let x = lerp(pointA[0], pointB[0], blend);
      let y = lerp(pointA[1], pointB[1], blend);
      // The intermediate weave opens around the hand instead of dissolving.
      x += Math.sin(u * TAU + g * 1.8) * unit * unfolding * .07;
      y += Math.sin(u * TAU * 1.5 + g) * unit * unfolding * .035;
      const dx = x - pointer.sx * width, dy = y - pointer.sy * height;
      const distance = Math.hypot(dx, dy);
      const pull = Math.exp(-distance * distance / (unit * unit * .07)) * (dragging ? 1 : .22);
      x += (pointer.x - pointer.sx) * width * pull * 1.4;
      y += (pointer.y - .5) * unit * pull * (dragging ? .12 : .02);
      for (const ripple of ripples) {
        const age = time - ripple.born;
        const dist = Math.hypot(x - ripple.x * width, y - ripple.y * height) / unit;
        const wave = Math.sin(dist * 24 - age * 9) *
          Math.exp(-Math.pow(dist - age * .45, 2) * 18) * Math.exp(-age * 2) *
          ripple.strength * (reduced ? 0 : .013) * unit;
        if (ripple.kind === 'air') {
          y += wave * .75;
        } else if (ripple.kind === 'tick') {
          y -= wave * 1.6; x += wave * .25;
        } else {
          x += wave * dx / Math.max(distance, 1);
          y += wave * dy / Math.max(distance, 1);
        }
      }
      path[j * 2] = x; path[j * 2 + 1] = y;
    }
  }
  latestTrace = { a, b, blend, dotness, unfolding };
  return latestTrace;
}

function paper(scene) {
  const s = SCENES[scene];
  ctx.fillStyle = s.bg;
  ctx.fillRect(0, 0, width, height);
  // A second, quieter plane of the same geometry moves under the foreground.
  if (scene === 2) return;
  ctx.strokeStyle = s.back; ctx.lineCap = 'round'; ctx.lineWidth = unit * .025;
  const drift = reduced ? 0 : Math.sin(time * .09 + scene) * .12;
  for (let n = 0; n < 5; n++) {
    ctx.beginPath();
    const cx = width * (.72 + drift), cy = height * .3;
    ctx.ellipse(cx, cy, unit * (.57 + n * .065 + motion.low * .018), unit * (.43 + n * .065 + motion.energy * .014),
      -.6 + time * (reduced ? 0 : .008) + (motion.pitch - .5) * motion.notePulse * .04, 0, TAU);
    ctx.stroke();
  }
}

function transitionClip(blend, side) {
  const x = width * (1.25 - blend * 1.5);
  const wave = Math.sin(blend * Math.PI) * unit * .13;
  ctx.beginPath();
  if (side === 'next') {
    ctx.moveTo(width + 1, -1); ctx.lineTo(x, -1);
    ctx.bezierCurveTo(x - wave, height * .28, x + wave * 1.8, height * .65, x, height + 1);
    ctx.lineTo(width + 1, height + 1);
  } else {
    ctx.moveTo(-1, -1); ctx.lineTo(x, -1);
    ctx.bezierCurveTo(x - wave, height * .28, x + wave * 1.8, height * .65, x, height + 1);
    ctx.lineTo(-1, height + 1);
  }
  ctx.closePath(); ctx.clip();
}

function drawLines(palette, trace) {
  const dot = trace.dotness;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const strokeWidth = clamp(unit / 320, 1.25, 3.8);
  for (let g = GROUPS - 1; g >= 0; g--) {
    const color = SCENES[palette].colors[g];
    ctx.strokeStyle = color; ctx.fillStyle = color;
    if (dot < .995) {
      ctx.globalAlpha = 1 - smooth(dot);
      ctx.lineWidth = strokeWidth;
      for (let l = 0; l < COUNT; l++) {
        const path = paths[g * COUNT + l];
        ctx.beginPath(); ctx.moveTo(path[0], path[1]);
        for (let j = 1; j <= SAMPLES; j++) ctx.lineTo(path[j * 2], path[j * 2 + 1]);
        ctx.stroke();
      }
    }
    if (dot > .005) {
      for (let l = 0; l < COUNT; l++) {
        const path = paths[g * COUNT + l];
        const row = (g * COUNT + l) / (COUNT * GROUPS - 1);
        const radius = (.65 + row * 1.05 + motion.high * .45) * Math.max(.7, unit / 900);
        ctx.globalAlpha = smooth(dot) * (.4 + row * .6);
        ctx.beginPath();
        for (let j = 0; j <= SAMPLES; j++) {
          const x = path[j * 2], y = path[j * 2 + 1];
          ctx.moveTo(x + radius, y); ctx.arc(x, y, radius, 0, TAU);
        }
        ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1;
}

function render() {
  const base = Math.floor(position), phase = mod(position, 1);
  const a = mod(base, SCENES.length), b = (a + 1) % SCENES.length;
  const blend = smooth(phase);
  const trace = buildPaths(a, b, blend);
  if (blend < .001 || blend > .999) {
    const scene = blend < .001 ? a : b;
    paper(scene); drawLines(scene, trace);
  } else {
    ctx.save(); transitionClip(blend, 'current'); paper(a); drawLines(a, trace); ctx.restore();
    ctx.save(); transitionClip(blend, 'next'); paper(b); drawLines(b, trace); ctx.restore();
  }
  if (pointer.inside && !dragging) {
    ctx.strokeStyle = SCENES[currentScene].ink; ctx.globalAlpha = .6; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(pointer.x * width, pointer.y * height, 6 + resonance * 3, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function changeScene(next) {
  if (next === currentScene) return;
  currentScene = next;
  audio.setScene(next);
  const scene = SCENES[next];
  document.documentElement.style.setProperty('--ink', scene.ink);
  document.documentElement.style.setProperty('--ground', scene.bg);
  document.querySelector('meta[name="theme-color"]').content = scene.bg;
  host.dataset.scene = String(next);
  status.textContent = scene.name;
}

function frame(now) {
  const elapsed = Math.min((now - lastFrame) / 1000, .12);
  const dt = Math.min(elapsed, .035);
  frameMs = lerp(frameMs, now - lastFrame, .03);
  lastFrame = now;
  if (!hidden) {
    if (!paused) time += elapsed * (reduced ? .13 : 1);
    if (!dragging) {
      const delta = target - position;
      velocity += delta * 65 * dt;
      velocity *= Math.exp(-13 * dt);
      position += velocity * dt;
      if (Math.abs(delta) < .0001 && Math.abs(velocity) < .001) { position = target; velocity = 0; }
    }
    const sample = audio.sample();
    peakEnergy = Math.max(peakEnergy, Number(sample.energy) || 0);
    peakOnset = Math.max(peakOnset, Number(sample.onset) || 0);
    if (!paused) {
      for (const key of ['energy', 'low', 'mid', 'high', 'onset'])
        motion[key] = lerp(motion[key], clamp(Number(sample[key]) || 0), 1 - Math.exp(-dt * 22));
      motion.kind = sample.kind || 'pluck';
      motion.pitch = lerp(motion.pitch, Number.isFinite(sample.pitch) ? clamp(sample.pitch) : .5, 1 - Math.exp(-dt * 9));
      motion.notePulse = lerp(motion.notePulse, clamp(Number(sample.notePulse) || 0), 1 - Math.exp(-dt * 25));
      motion.phraseProgress = clamp(Number(sample.phraseProgress) || 0);
      if (Number.isFinite(sample.noteId) && sample.noteId !== lastNoteId) {
        lastNoteId = sample.noteId;
        if (enabled && !reduced && sample.notePulse > .05) {
          resonance = Math.max(resonance, sample.notePulse * .8);
          addRipple(.2 + motion.pitch * .6, .5 + (motion.pitch - .5) * .3, .75, motion.kind);
        }
      }
    }
    const onset = Number(sample.onset) || 0;
    if (!paused && !reduced && onset > .24 && lastOnset <= .24) {
      resonance = Math.max(resonance, onset);
      addRipple(.36 + .28 * Math.sin(time * .73), .5 + .16 * Math.cos(time * .41), .5 + onset * .6, motion.kind);
    }
    lastOnset = onset;
    if (!paused) {
      resonance *= Math.exp(-dt * 2.7);
      ripples = ripples.filter(r => time - r.born < 2.5);
    }
    pointer.sx = lerp(pointer.sx, pointer.x, 1 - Math.exp(-dt * 6));
    pointer.sy = lerp(pointer.sy, pointer.y, 1 - Math.exp(-dt * 6));
    pointer.speed *= Math.exp(-dt * 9);
    changeScene(mod(Math.round(position), 4));
    const drawStart = performance.now();
    render();
    drawMs = lerp(drawMs, performance.now() - drawStart, .05);
    if (now - lastStats > 250) {
      host.dataset.phase = position.toFixed(4);
      host.dataset.energy = motion.energy.toFixed(4);
      host.dataset.kind = motion.kind;
      host.dataset.frameMs = frameMs.toFixed(1);
      host.dataset.drawMs = drawMs.toFixed(1);
      host.dataset.peakEnergy = peakEnergy.toFixed(4);
      host.dataset.peakOnset = peakOnset.toFixed(4);
      host.dataset.noteId = String(lastNoteId);
      host.dataset.pitch = motion.pitch.toFixed(3);
      host.dataset.notePulse = motion.notePulse.toFixed(3);
      host.dataset.phrase = motion.phraseProgress.toFixed(3);
      host.dataset.time = time.toFixed(2);
      host.dataset.paused = String(paused);
      lastStats = now;
    }
  }
  requestAnimationFrame(frame);
}

function dismissHint() {
  if (firstGesture) return;
  firstGesture = true;
  hint.classList.add('hidden');
}
function setPointer(event) {
  const x = clamp(event.clientX / width), y = clamp(event.clientY / height);
  pointer.speed = Math.min(1, Math.hypot(x - pointer.x, y - pointer.y) * 30 + pointer.speed * .3);
  pointer.x = x; pointer.y = y; pointer.inside = true;
}
canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0 || pointerId !== null) return;
  setPointer(event); dismissHint();
  pointerId = event.pointerId;
  canvas.setPointerCapture(pointerId);
  canvas.focus({ preventScroll: true });
  dragStart = { x: event.clientX, y: event.clientY, pos: position, lastX: event.clientX, lastY: event.clientY, lastAt: performance.now(), dx: 0, travel: 0 };
  dragging = true; velocity = 0;
  host.dataset.dragging = 'true';
  pendingPluck = false;
  audio.grab();
  if (!soundTouched) void toggleSound();
});
canvas.addEventListener('pointermove', event => {
  setPointer(event);
  if (!dragging || event.pointerId !== pointerId) return;
  const now = performance.now();
  const distance = (event.clientX - dragStart.x) / Math.max(width * .6, 300);
  position = dragStart.pos - distance;
  dragStart.travel = Math.max(dragStart.travel, Math.hypot(event.clientX - dragStart.x, event.clientY - dragStart.y));
  dragStart.dx = event.clientX - dragStart.lastX;
  const seconds = Math.max(.008, (now - dragStart.lastAt) / 1000);
  const pathDelta = Math.hypot(dragStart.dx, event.clientY - dragStart.lastY) / unit;
  velocity = -dragStart.dx / Math.max(width * .6, 300) / seconds;
  // Only actual movement of a held pointer can draw sound. Spring settling,
  // hovering and render frames never advance the musical phrase.
  if (dragStart.travel >= 7 && pathDelta > 0) {
    audio.move(pathDelta, clamp(pathDelta / seconds / .9), mod(Math.round(position), 4));
  }
  dragStart.lastX = event.clientX; dragStart.lastY = event.clientY; dragStart.lastAt = now;
});
function endDrag(event, cancelled = false) {
  if (!dragging || (event && event.pointerId !== pointerId)) return;
  const start = dragStart;
  const moved = position - start.pos;
  const isTap = start.travel < 7;
  dragging = false; host.dataset.dragging = 'false';
  if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
  pointerId = null; dragStart = null;
  if (cancelled) {
    pendingPluck = false;
    target = Math.round(start.pos);
    audio.release(false, mod(target, 4));
  } else if (isTap) {
    target = Math.round(start.pos); velocity = 0;
    resonance = 1; addRipple(pointer.x, pointer.y, 1.5, ['pluck', 'air', 'tick', 'bell'][currentScene]);
    audio.release(false, currentScene);
    if (enabling) pendingPluck = true;
    else audio.ping(currentScene);
  } else {
    const freshFlick = performance.now() - start.lastAt < 100 &&
      Math.abs(velocity) > .5 && Math.abs(moved) > .1 && Math.sign(velocity) === Math.sign(moved);
    target = Math.round(position);
    if (freshFlick && target === Math.round(start.pos)) target += Math.sign(moved);
    velocity = clamp(velocity, -2, 2);
    audio.release(target !== Math.round(start.pos), mod(target, 4));
  }
}
canvas.addEventListener('pointerup', event => endDrag(event));
canvas.addEventListener('pointercancel', event => endDrag(event, true));
canvas.addEventListener('lostpointercapture', event => { if (dragging) endDrag(event, true); });
canvas.addEventListener('pointerleave', () => { if (!dragging) pointer.inside = false; });
window.addEventListener('blur', () => { pendingPluck = false; if (dragging) endDrag(null, true); pointer.inside = false; });

async function toggleSound() {
  const attempt = ++soundAttempt;
  soundTouched = true;
  if (enabled || enabling) {
    pendingPluck = false;
    audio.disable(); enabled = false; enabling = false;
  } else {
    enabling = true;
    try {
      const available = await audio.enable();
      if (attempt !== soundAttempt) return;
      enabled = available;
      if (enabled) {
        audio.setScene(currentScene);
        if (dragging) audio.grab();
        if (pendingPluck && !hidden) audio.ping(currentScene);
      }
      else status.textContent = 'Sound is unavailable. Try again.';
    } catch (error) {
      if (attempt !== soundAttempt) return;
      enabled = false; status.textContent = 'Sound is unavailable. Try again.';
      console.warn('LOOP audio could not start:', error.message);
    } finally {
      if (attempt === soundAttempt) { enabling = false; pendingPluck = false; }
    }
  }
  soundButton.setAttribute('aria-pressed', String(enabled));
  soundButton.setAttribute('aria-label', enabled ? 'Mute sound' : 'Enable sound');
  soundButton.title = enabled ? 'Mute sound · M' : 'Enable sound · M';
  host.dataset.sound = enabled ? 'on' : 'off';
}
soundButton.addEventListener('click', toggleSound);
window.addEventListener('keydown', event => {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.code === 'ArrowRight' || event.code === 'ArrowLeft') {
    event.preventDefault();
    if (dragging) endDrag(null, true);
    target = Math.round(target) + (event.code === 'ArrowRight' ? 1 : -1);
    dismissHint(); audio.release(true, mod(target, 4));
  } else if (event.code === 'Escape') {
    if (dragging) endDrag(null, true);
  } else if (event.code === 'Space' && event.target !== soundButton) {
    event.preventDefault(); paused = !paused;
    status.textContent = paused ? 'Motion paused' : 'Motion resumed';
  } else if (event.code === 'KeyM') {
    event.preventDefault(); toggleSound();
  } else if (event.code === 'KeyF') {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }
});
document.addEventListener('visibilitychange', () => {
  hidden = document.hidden;
  if (hidden) pendingPluck = false;
  if (hidden && dragging) endDrag(null, true);
  lastFrame = performance.now();
});
window.addEventListener('resize', resize);
reducedQuery.addEventListener('change', event => { reduced = event.matches; });
window.addEventListener('pagehide', event => { if (!event.persisted) audio.destroy(); });
resize();
requestAnimationFrame(frame);

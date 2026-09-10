(() => {
  'use strict';

  const TAU = Math.PI * 2;
  const canvas = document.getElementById('shape-canvas');
  const fallback = document.getElementById('fallback');
  const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });

  if (!ctx) {
    canvas.hidden = true;
    fallback.hidden = false;
    return;
  }

  const ui = {
    panelToggle: document.getElementById('panel-toggle'),
    panel: document.getElementById('control-panel'),
    panelClose: document.getElementById('panel-close'),
    mode: document.getElementById('mode-select'),
    performance: document.getElementById('performance-select'),
    speed: document.getElementById('speed-range'),
    speedOutput: document.getElementById('speed-output'),
    detail: document.getElementById('detail-range'),
    detailOutput: document.getElementById('detail-output'),
    interaction: document.getElementById('interaction-toggle'),
    fpsToggle: document.getElementById('fps-toggle'),
    fpsMeter: document.getElementById('fps-meter'),
    pause: document.getElementById('pause-button'),
    fullscreen: document.getElementById('fullscreen-button'),
    reset: document.getElementById('reset-button'),
    qualityStatus: document.getElementById('quality-status')
  };

  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const coarsePointerQuery = window.matchMedia('(pointer: coarse)');

  const MODES = Object.freeze({
    nexus: Object.freeze({ sides: 4, twist: 8.4, wave: 0.42, waveFreq: 8.5, depthPower: 1.28, squash: 0.10, lineBoost: 1.00 }),
    spiral: Object.freeze({ sides: 5, twist: 11.4, wave: 0.55, waveFreq: 10.0, depthPower: 1.12, squash: 0.07, lineBoost: 0.94 }),
    prism: Object.freeze({ sides: 6, twist: 6.2, wave: 0.30, waveFreq: 6.6, depthPower: 1.42, squash: 0.12, lineBoost: 0.92 }),
    orbit: Object.freeze({ sides: 0, twist: 8.8, wave: 0.23, waveFreq: 7.3, depthPower: 1.20, squash: 0.24, lineBoost: 0.90 })
  });

  const AUTO_TIERS = Object.freeze([
    Object.freeze({ name: 'LOW', rings: 48, dpr: 1.10, fps: 30 }),
    Object.freeze({ name: 'MEDIUM', rings: 66, dpr: 1.30, fps: 45 }),
    Object.freeze({ name: 'HIGH', rings: 86, dpr: 1.50, fps: 60 }),
    Object.freeze({ name: 'ULTRA', rings: 104, dpr: 1.65, fps: 60 })
  ]);

  const FIXED_PROFILES = Object.freeze({
    quality: Object.freeze({ name: 'QUALITY', rings: 108, dpr: 1.75, fps: 60 }),
    balanced: Object.freeze({ name: 'BALANCED', rings: 78, dpr: 1.45, fps: 45 }),
    eco: Object.freeze({ name: 'ECO', rings: 50, dpr: 1.10, fps: 30 })
  });

  const DEFAULTS = Object.freeze({
    mode: 'nexus',
    performance: 'auto',
    speed: 1,
    detail: 1,
    interaction: true,
    fpsVisible: false
  });

  const state = {
    width: 1,
    height: 1,
    dpr: 1,
    centerX: 0.5,
    centerY: 0.5,
    radius: 1,
    mode: DEFAULTS.mode,
    performance: DEFAULTS.performance,
    speed: DEFAULTS.speed,
    detail: DEFAULTS.detail,
    interaction: DEFAULTS.interaction,
    fpsVisible: DEFAULTS.fpsVisible,
    autoTier: 2,
    userPaused: false,
    pageVisible: !document.hidden,
    reducedMotion: reducedMotionQuery.matches,
    pointerTargetX: 0,
    pointerTargetY: 0,
    pointerX: 0,
    pointerY: 0,
    rotation: 0,
    rafId: 0,
    previousFrameTime: 0,
    previousRenderTime: 0,
    renderAccumulator: 0,
    renderCostEwma: 2,
    adaptationElapsed: 0,
    adaptationCooldown: 0,
    stableFastWindows: 0,
    fpsFrames: 0,
    fpsElapsed: 0,
    fpsValue: 0,
    lastUiUpdate: 0,
    needsStaticRender: true
  };

  const palette = buildPalette(512);
  const modePaths = new Map();

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function smoothToward(current, target, sharpness, dt) {
    return current + (target - current) * (1 - Math.exp(-sharpness * dt));
  }

  function buildPalette(size) {
    const stops = [
      [0.00, [172, 255, 24]],
      [0.10, [240, 255, 38]],
      [0.22, [255, 184, 24]],
      [0.35, [255, 70, 72]],
      [0.50, [255, 35, 157]],
      [0.66, [183, 55, 255]],
      [0.82, [60, 77, 255]],
      [1.00, [0, 80, 205]]
    ];

    const colors = new Array(size);
    let stopIndex = 0;

    for (let i = 0; i < size; i += 1) {
      const t = i / (size - 1);
      while (stopIndex < stops.length - 2 && t > stops[stopIndex + 1][0]) {
        stopIndex += 1;
      }

      const current = stops[stopIndex];
      const next = stops[stopIndex + 1];
      const localT = (t - current[0]) / (next[0] - current[0]);
      const r = Math.round(lerp(current[1][0], next[1][0], localT));
      const g = Math.round(lerp(current[1][1], next[1][1], localT));
      const b = Math.round(lerp(current[1][2], next[1][2], localT));
      colors[i] = `rgb(${r} ${g} ${b})`;
    }

    return colors;
  }

  function getPolygonPath(sides) {
    if (modePaths.has(sides)) {
      return modePaths.get(sides);
    }

    const path = new Path2D();
    const start = -Math.PI / 2;

    for (let i = 0; i < sides; i += 1) {
      const angle = start + (TAU * i) / sides;
      const x = Math.cos(angle);
      const y = Math.sin(angle);
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    }

    path.closePath();
    modePaths.set(sides, path);
    return path;
  }

  function chooseInitialAutoTier() {
    const area = window.innerWidth * window.innerHeight;
    const cores = navigator.hardwareConcurrency || 4;
    const coarse = coarsePointerQuery.matches;

    if (coarse || area > 3_000_000) return cores <= 4 ? 1 : 2;
    if (cores >= 8 && area < 2_300_000) return 3;
    if (cores <= 4) return 1;
    return 2;
  }

  state.autoTier = chooseInitialAutoTier();

  function activeProfile() {
    if (state.performance === 'auto') {
      return AUTO_TIERS[state.autoTier];
    }
    return FIXED_PROFILES[state.performance];
  }

  function targetFps() {
    if (state.reducedMotion) return 12;
    const profile = activeProfile();
    if (coarsePointerQuery.matches && profile.fps > 45) return 45;
    return profile.fps;
  }

  function ringCount() {
    const profile = activeProfile();
    const count = Math.round(profile.rings * state.detail);
    return clamp(count, 30, 120);
  }

  function desiredDpr() {
    const profile = activeProfile();
    const viewportArea = state.width * state.height;
    const areaPenalty = viewportArea > 3_200_000 ? 0.15 : viewportArea > 2_200_000 ? 0.08 : 0;
    return Math.min(window.devicePixelRatio || 1, Math.max(1, profile.dpr - areaPenalty));
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));

    state.width = width;
    state.height = height;
    state.dpr = desiredDpr();
    state.centerX = width * 0.5;
    state.centerY = height * 0.5;
    state.radius = Math.min(width, height) * (coarsePointerQuery.matches ? 0.43 : 0.46);

    const pixelWidth = Math.max(1, Math.round(width * state.dpr));
    const pixelHeight = Math.max(1, Math.round(height * state.dpr));

    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    state.needsStaticRender = true;

    if (state.userPaused || !state.pageVisible) {
      render(performance.now(), 0);
    }
  }

  function drawCore(cx, cy, radius, rotation, mode, time) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(cx, cy);
    ctx.rotate(rotation * 0.45);

    const motionSpeed = state.reducedMotion ? state.speed * 0.10 : state.speed;
    const pulse = 1 + Math.sin(time * 0.0011 * motionSpeed) * 0.045;
    const coreRadius = radius * 0.068 * pulse;

    ctx.globalAlpha = 0.12;
    ctx.fillStyle = '#b0ff16';
    ctx.beginPath();
    ctx.arc(0, 0, coreRadius * 1.75, 0, TAU);
    ctx.fill();

    ctx.globalAlpha = 0.34;
    ctx.fillStyle = '#dcff2e';

    if (mode.sides === 0) {
      ctx.beginPath();
      ctx.ellipse(0, 0, coreRadius * 1.1, coreRadius * 0.78, rotation, 0, TAU);
      ctx.fill();
    } else {
      ctx.scale(coreRadius, coreRadius);
      ctx.fill(getPolygonPath(mode.sides));
    }

    ctx.restore();
  }

  function renderRings(cx, cy, radius, mode, rings, time) {
    const pointerInfluence = state.interaction ? 1 : 0;
    const px = state.pointerX * pointerInfluence;
    const py = state.pointerY * pointerInfluence;
    const baseSpeed = state.reducedMotion ? state.speed * 0.10 : state.speed;
    const spin = state.rotation;
    const lineBase = (coarsePointerQuery.matches ? 1.05 : 1.18) * mode.lineBoost;
    const path = mode.sides > 0 ? getPolygonPath(mode.sides) : null;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (let i = rings - 1; i >= 0; i -= 1) {
      const z = rings === 1 ? 0 : i / (rings - 1);
      const depth = Math.pow(z, mode.depthPower);
      const scale = 0.045 + depth * 0.955;
      const wave = Math.sin(time * 0.00055 * baseSpeed + z * mode.waveFreq) * mode.wave;
      const rotation = spin + z * mode.twist + wave * 0.34 + px * (0.18 + z * 0.38);
      const breathing = 1 + Math.sin(time * 0.00042 * baseSpeed + z * 4.2) * 0.022;
      const localRadius = radius * scale * breathing;
      const perspectiveX = 1 + px * 0.06 * z;
      const perspectiveY = 1 - py * mode.squash * (0.25 + z * 0.75);
      const centerShiftX = px * radius * 0.052 * (1 - z * 0.45);
      const centerShiftY = py * radius * 0.052 * (1 - z * 0.45);
      const alpha = 0.30 + (1 - z) * 0.48;
      const paletteIndex = Math.round(z * (palette.length - 1));

      ctx.save();
      ctx.translate(cx + centerShiftX, cy + centerShiftY);
      ctx.rotate(rotation);
      ctx.scale(localRadius * perspectiveX, localRadius * perspectiveY);
      ctx.lineWidth = (lineBase + (1 - z) * 0.38) / localRadius;
      ctx.strokeStyle = palette[paletteIndex];
      ctx.globalAlpha = alpha;

      if (mode.sides === 0) {
        ctx.beginPath();
        ctx.ellipse(0, 0, 1, 0.70 + 0.11 * Math.sin(z * 8 + time * 0.0007 * baseSpeed), 0, 0, TAU);
        ctx.stroke();
      } else {
        ctx.stroke(path);
      }

      ctx.restore();
    }

    ctx.restore();
  }

  function renderAccent(cx, cy, radius, mode, time) {
    if (activeProfile().name === 'ECO' || (state.performance === 'auto' && state.autoTier === 0)) {
      return;
    }

    const sides = mode.sides || 4;
    const outer = radius * 0.98;
    const inner = radius * 0.12;
    const rotation = state.rotation + Math.sin(time * 0.00028 * state.speed) * 0.18;
    const path = getPolygonPath(sides);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotation);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.08;
    ctx.strokeStyle = '#6a4bff';
    ctx.lineWidth = 1;

    for (let i = 0; i < sides; i += 1) {
      const angle = -Math.PI / 2 + (TAU * i) / sides;
      const x1 = Math.cos(angle) * inner;
      const y1 = Math.sin(angle) * inner;
      const x2 = Math.cos(angle) * outer;
      const y2 = Math.sin(angle) * outer;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    ctx.globalAlpha = 0.12;
    ctx.scale(radius * 0.98, radius * 0.98);
    ctx.stroke(path);
    ctx.restore();
  }

  function render(time, dt) {
    const width = state.width;
    const height = state.height;
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    state.pointerX = smoothToward(state.pointerX, state.pointerTargetX, 5.7, dt || 0.016);
    state.pointerY = smoothToward(state.pointerY, state.pointerTargetY, 5.7, dt || 0.016);

    const mode = MODES[state.mode];
    const rings = ringCount();
    const interactionOffsetX = state.interaction ? state.pointerX * state.radius * 0.018 : 0;
    const interactionOffsetY = state.interaction ? state.pointerY * state.radius * 0.018 : 0;
    const cx = state.centerX + interactionOffsetX;
    const cy = state.centerY + interactionOffsetY;

    renderAccent(cx, cy, state.radius, mode, time);
    renderRings(cx, cy, state.radius, mode, rings, time);
    drawCore(cx, cy, state.radius, state.rotation, mode, time);

    state.needsStaticRender = false;
  }

  function adaptQuality(dt) {
    if (state.performance !== 'auto' || state.reducedMotion) return;

    state.adaptationElapsed += dt;
    state.adaptationCooldown = Math.max(0, state.adaptationCooldown - dt);
    if (state.adaptationElapsed < 2.5) return;
    state.adaptationElapsed = 0;

    if (state.adaptationCooldown > 0) return;

    const budget = 1000 / targetFps();
    const expensive = state.renderCostEwma > budget * 0.74;
    const comfortablyFast = state.renderCostEwma < budget * 0.24;

    if (expensive && state.autoTier > 0) {
      state.autoTier -= 1;
      state.stableFastWindows = 0;
      state.adaptationCooldown = 8;
      resizeCanvas();
      updateQualityStatus();
      return;
    }

    if (comfortablyFast && state.autoTier < AUTO_TIERS.length - 1) {
      state.stableFastWindows += 1;
      if (state.stableFastWindows >= 3) {
        state.autoTier += 1;
        state.stableFastWindows = 0;
        state.adaptationCooldown = 12;
        resizeCanvas();
        updateQualityStatus();
      }
    } else {
      state.stableFastWindows = 0;
    }
  }

  function updateFps(dt) {
    if (!state.fpsVisible) return;

    state.fpsFrames += 1;
    state.fpsElapsed += dt;
    if (state.fpsElapsed >= 0.6) {
      state.fpsValue = Math.round(state.fpsFrames / state.fpsElapsed);
      state.fpsFrames = 0;
      state.fpsElapsed = 0;
      ui.fpsMeter.value = `${state.fpsValue} FPS`;
      ui.fpsMeter.textContent = `${state.fpsValue} FPS`;
    }
  }

  function loop(now) {
    if (state.userPaused || !state.pageVisible) {
      state.rafId = 0;
      return;
    }

    if (!state.previousFrameTime) {
      state.previousFrameTime = now;
      state.previousRenderTime = now;
      state.renderAccumulator = 0;
    }

    const frameDeltaMs = Math.min(now - state.previousFrameTime, 50);
    const rawDt = frameDeltaMs / 1000;
    state.previousFrameTime = now;
    state.renderAccumulator += frameDeltaMs;

    const motionScale = state.reducedMotion ? 0.10 : 1;
    state.rotation = (state.rotation + rawDt * 0.42 * state.speed * motionScale) % TAU;

    const minInterval = 1000 / targetFps();

    if (state.renderAccumulator >= minInterval - 0.4) {
      const actualRenderInterval = Math.max((now - state.previousRenderTime) / 1000, 0.001);
      const renderStart = performance.now();
      render(now, rawDt);
      const cost = performance.now() - renderStart;
      state.renderCostEwma = state.renderCostEwma * 0.90 + cost * 0.10;
      state.previousRenderTime = now;
      state.renderAccumulator %= minInterval;
      updateFps(actualRenderInterval);
    }

    adaptQuality(rawDt);
    state.rafId = requestAnimationFrame(loop);
  }

  function startLoop() {
    if (state.rafId || state.userPaused || !state.pageVisible) return;
    state.previousFrameTime = 0;
    state.previousRenderTime = 0;
    state.renderAccumulator = 0;
    state.rafId = requestAnimationFrame(loop);
  }

  function stopLoop() {
    if (state.rafId) {
      cancelAnimationFrame(state.rafId);
      state.rafId = 0;
    }
  }

  function setPaused(paused) {
    state.userPaused = paused;
    ui.pause.textContent = paused ? 'Play' : 'Pause';
    ui.pause.setAttribute('aria-pressed', String(paused));

    if (paused) {
      stopLoop();
      render(performance.now(), 0);
    } else {
      startLoop();
    }
  }

  function setPanel(open) {
    ui.panel.hidden = !open;
    ui.panelToggle.hidden = open;
    ui.panelToggle.setAttribute('aria-expanded', String(open));
    ui.panelToggle.setAttribute('aria-label', open ? 'Close animation controls' : 'Open animation controls');

    if (open) {
      ui.panelClose.focus({ preventScroll: true });
    } else {
      ui.panelToggle.focus({ preventScroll: true });
    }
  }

  function updateQualityStatus() {
    const label = state.performance === 'auto'
      ? `AUTO · ${AUTO_TIERS[state.autoTier].name}`
      : FIXED_PROFILES[state.performance].name;
    ui.qualityStatus.textContent = label;
  }

  function updateControlOutputs() {
    ui.speedOutput.value = `${Math.round(state.speed * 100)}%`;
    ui.speedOutput.textContent = `${Math.round(state.speed * 100)}%`;
    ui.detailOutput.value = `${Math.round(state.detail * 100)}%`;
    ui.detailOutput.textContent = `${Math.round(state.detail * 100)}%`;
  }

  function resetSettings() {
    state.mode = DEFAULTS.mode;
    state.performance = DEFAULTS.performance;
    state.speed = DEFAULTS.speed;
    state.detail = DEFAULTS.detail;
    state.interaction = DEFAULTS.interaction;
    state.fpsVisible = DEFAULTS.fpsVisible;
    state.autoTier = chooseInitialAutoTier();
    state.pointerTargetX = 0;
    state.pointerTargetY = 0;
    state.pointerX = 0;
    state.pointerY = 0;
    state.rotation = 0;
    state.renderCostEwma = 2;
    state.adaptationCooldown = 0;
    state.stableFastWindows = 0;

    ui.mode.value = state.mode;
    ui.performance.value = state.performance;
    ui.speed.value = String(Math.round(state.speed * 100));
    ui.detail.value = String(Math.round(state.detail * 100));
    ui.interaction.checked = state.interaction;
    ui.fpsToggle.checked = state.fpsVisible;
    ui.fpsMeter.hidden = true;

    updateControlOutputs();
    updateQualityStatus();
    resizeCanvas();
  }

  function handlePointer(event) {
    if (!state.interaction) return;

    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = ((event.clientY - rect.top) / rect.height) * 2 - 1;
    state.pointerTargetX = clamp(x, -1, 1);
    state.pointerTargetY = clamp(y, -1, 1);

    if (state.userPaused) {
      render(performance.now(), 0.016);
    }
  }

  function handlePointerLeave() {
    state.pointerTargetX = 0;
    state.pointerTargetY = 0;
  }

  function handleVisibility() {
    state.pageVisible = !document.hidden;

    if (!state.pageVisible) {
      stopLoop();
    } else if (!state.userPaused) {
      startLoop();
    } else {
      render(performance.now(), 0);
    }
  }

  function handleReducedMotionChange(event) {
    state.reducedMotion = event.matches;
    state.previousFrameTime = 0;
    state.previousRenderTime = 0;
  }

  function applyPerformanceChange() {
    state.performance = ui.performance.value;
    state.stableFastWindows = 0;
    resizeCanvas();
    updateQualityStatus();
  }

  function requestFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
      return;
    }
    document.documentElement.requestFullscreen?.().catch(() => {});
  }

  function updateFullscreenLabel() {
    ui.fullscreen.textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen';
  }

  ui.panelToggle.addEventListener('click', () => setPanel(true));
  ui.panelClose.addEventListener('click', () => setPanel(false));

  ui.mode.addEventListener('change', () => {
    state.mode = ui.mode.value;
    state.needsStaticRender = true;
    if (state.userPaused) render(performance.now(), 0);
  });

  ui.performance.addEventListener('change', applyPerformanceChange);

  ui.speed.addEventListener('input', () => {
    state.speed = Number(ui.speed.value) / 100;
    updateControlOutputs();
    if (state.userPaused) render(performance.now(), 0);
  });

  ui.detail.addEventListener('input', () => {
    state.detail = Number(ui.detail.value) / 100;
    updateControlOutputs();
    if (state.userPaused) render(performance.now(), 0);
  });

  ui.interaction.addEventListener('change', () => {
    state.interaction = ui.interaction.checked;
    if (!state.interaction) {
      state.pointerTargetX = 0;
      state.pointerTargetY = 0;
    }
  });

  ui.fpsToggle.addEventListener('change', () => {
    state.fpsVisible = ui.fpsToggle.checked;
    ui.fpsMeter.hidden = !state.fpsVisible;
    state.fpsFrames = 0;
    state.fpsElapsed = 0;
  });

  ui.pause.addEventListener('click', () => setPaused(!state.userPaused));
  ui.fullscreen.addEventListener('click', requestFullscreen);
  ui.reset.addEventListener('click', resetSettings);

  canvas.addEventListener('pointermove', handlePointer, { passive: true });
  canvas.addEventListener('pointerleave', handlePointerLeave, { passive: true });
  canvas.addEventListener('pointercancel', handlePointerLeave, { passive: true });

  document.addEventListener('visibilitychange', handleVisibility);
  document.addEventListener('fullscreenchange', updateFullscreenLabel);

  if (typeof reducedMotionQuery.addEventListener === 'function') {
    reducedMotionQuery.addEventListener('change', handleReducedMotionChange);
    coarsePointerQuery.addEventListener('change', resizeCanvas);
  } else {
    reducedMotionQuery.addListener(handleReducedMotionChange);
    coarsePointerQuery.addListener(resizeCanvas);
  }

  document.addEventListener('keydown', (event) => {
    const target = event.target;
    const isFormControl = target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLButtonElement;

    if (event.key === 'Escape' && !ui.panel.hidden) {
      setPanel(false);
      return;
    }

    if (event.code === 'Space' && !isFormControl) {
      event.preventDefault();
      setPaused(!state.userPaused);
    }
  });

  const resizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => resizeCanvas())
    : null;

  if (resizeObserver) {
    resizeObserver.observe(canvas);
  } else {
    window.addEventListener('resize', resizeCanvas, { passive: true });
  }

  updateControlOutputs();
  updateQualityStatus();
  resizeCanvas();
  render(performance.now(), 0);
  startLoop();
})();

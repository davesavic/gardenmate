/**
 * GardenRenderer - Canvas 2D procedural plant rendering
 * Designed for independent instantiation per window (main + widget)
 */
class GardenRenderer {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.plants = [];
    this.dirty = true;
    this.animFrameId = null;
    this.selectedPlantID = null;
    this.placementMode = false;
    this.placementSpeciesID = null;
    this.placementPos = null;

    // Drag state
    this.dragging = null;

    // Widget mode options
    this.isWidget = options.isWidget || false;
    this.viewportTransform = options.viewportTransform || null;

    // Scene state
    this.dpr = window.devicePixelRatio || 1;
    this.vw = 0;
    this.vh = 0;
    this.horizonFrac = 0.30;
    this.particles = [];
    this.fireflies = null;
    this.reducedMotion = window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
    this._lastTs = 0;
    this._skyTimer = setInterval(() => { this.dirty = true; }, 60000);

    this._onResize = this._onResize.bind(this);
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onStateChanged = this._onStateChanged.bind(this);
    this._onPlacementStart = this._onPlacementStart.bind(this);

    this._init();
  }

  _init() {
    this._resizeCanvas();
    window.addEventListener('resize', this._onResize);
    this.canvas.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mouseup', this._onMouseUp);

    // Subscribe to Wails events (if available)
    if (window.runtime && window.runtime.EventsOn) {
      window.runtime.EventsOn('garden:state-changed', this._onStateChanged);
    }

    // Listen for placement mode from UI
    window.addEventListener('placement:start', this._onPlacementStart);

    // Load initial state
    this._loadInitialState();
  }

  async _loadInitialState() {
    try {
      if (window.wails && window.wails.GetGardenState) {
        const state = await window.wails.GetGardenState();
        this._applyState(state);
      }
    } catch (e) {
      console.error('[GardenRenderer] Failed to load initial state:', e);
    }
  }

  _onStateChanged(data) {
    this._applyState(data);
    this.dirty = true;
  }

  _applyState(state) {
    if (!state || !state.plants) return;
    this.plants = state.plants;
    this.dirty = true;
  }

  _onPlacementStart(e) {
    this.placementMode = true;
    this.placementSpeciesID = e.detail.speciesID;
    this.canvas.style.cursor = 'crosshair';
  }

  _endPlacement() {
    this.placementMode = false;
    this.placementSpeciesID = null;
    this.placementPos = null;
    this.canvas.style.cursor = 'default';
    window.dispatchEvent(new CustomEvent('placement:end'));
  }

  _resizeCanvas() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.vw = rect.width;
    this.vh = rect.height;
    this.canvas.width = Math.max(1, Math.round(rect.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * this.dpr));
    this.dirty = true;
  }

  _onResize() {
    this._resizeCanvas();
  }

  _viewSize() {
    return {
      w: this.vw || this.canvas.width,
      h: this.vh || this.canvas.height
    };
  }

  _getCanvasPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }

  _worldToCanvas(wx, wy) {
    const { w, h } = this._viewSize();
    const hy = h * this.horizonFrac;
    return {
      x: (wx / 900) * w,
      y: hy + (wy / 600) * (h - hy)
    };
  }

  _depthScale(wy) {
    return 0.8 + (wy / 600) * 0.35;
  }

  _toWorld(pos) {
    const { w, h } = this._viewSize();
    const hy = h * this.horizonFrac;
    return {
      x: (pos.x / w) * 900,
      y: ((pos.y - hy) / (h - hy)) * 600
    };
  }

  _findPlantAt(x, y) {
    for (let i = this.plants.length - 1; i >= 0; i--) {
      const p = this.plants[i];
      const radius = this._getPlantRadius(p) * this._depthScale(p.pos_y);
      const dx = x - p.pos_x;
      const dy = y - p.pos_y;
      if (dx * dx + dy * dy <= radius * radius) {
        return p;
      }
    }
    return null;
  }

  _getPlantRadius(plant) {
    if (plant.is_dead) return 25;
    if (plant.stage === 0) return 15;
    if (plant.stage <= 2) return 25;
    return 35;
  }

  _onMouseDown(e) {
    const pos = this._getCanvasPos(e);

    if (this.placementMode) {
      this._placePlant(pos);
      return;
    }

    const world = this._toWorld(pos);
    const plant = this._findPlantAt(world.x, world.y);
    if (plant) {
      this.selectedPlantID = plant.id;
      window.dispatchEvent(new CustomEvent('plant:selected', { detail: { plant } }));
      this.dragging = {
        plant,
        offsetX: world.x - plant.pos_x,
        offsetY: world.y - plant.pos_y,
        startX: plant.pos_x,
        startY: plant.pos_y,
        moved: false
      };
      this.canvas.style.cursor = 'grabbing';
      this.dirty = true;
    } else {
      this.selectedPlantID = null;
      window.dispatchEvent(new CustomEvent('plant:deselected'));
      this.dirty = true;
    }
  }

  async _placePlant(pos) {
    if (!this.placementSpeciesID) return;
    try {
      if (window.wails && window.wails.AddPlant) {
        const world = this._toWorld(pos);
        const wx = Math.max(0, Math.min(900, world.x));
        const wy = Math.max(0, Math.min(600, world.y));
        await window.wails.AddPlant(this.placementSpeciesID, '', wx, wy);
      }
    } catch (e) {
      console.error('[GardenRenderer] AddPlant failed:', e);
    }
    this._endPlacement();
  }

  _onMouseMove(e) {
    if (this.placementMode) {
      this.placementPos = this._getCanvasPos(e);
      this.dirty = true;
      return;
    }
    if (!this.dragging) return;
    const world = this._toWorld(this._getCanvasPos(e));
    const wx = world.x - this.dragging.offsetX;
    const wy = world.y - this.dragging.offsetY;

    this.dragging.plant.pos_x = Math.max(0, Math.min(900, wx));
    this.dragging.plant.pos_y = Math.max(0, Math.min(600, wy));
    this.dragging.moved = true;
    this.dirty = true;
  }

  async _onMouseUp(e) {
    if (this.dragging) {
      const plant = this.dragging.plant;
      if (this.dragging.moved && (plant.pos_x !== this.dragging.startX || plant.pos_y !== this.dragging.startY)) {
        try {
          if (window.wails && window.wails.MovePlant) {
            await window.wails.MovePlant(plant.id, plant.pos_x, plant.pos_y);
          }
        } catch (e) {
          console.error('[GardenRenderer] MovePlant failed:', e);
        }
      }
      this.dragging = null;
      this.canvas.style.cursor = 'default';
    }
  }

  // --- Rendering ---

  startRender() {
    const loop = (ts) => {
      const animating = this.particles.length > 0 || this._nightAmbient();
      if (animating && ts - this._lastTs > 33) {
        this._stepEffects(Math.min(ts - this._lastTs, 100));
        this._lastTs = ts;
        this.dirty = true;
      }
      if (this.dirty) {
        this._draw();
        this.dirty = false;
      }
      this.animFrameId = requestAnimationFrame(loop);
    };
    this.animFrameId = requestAnimationFrame(loop);
  }

  stopRender() {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this._skyTimer) {
      clearInterval(this._skyTimer);
      this._skyTimer = null;
    }
  }

  // --- Care effects ---

  spawnCareEffect(type, plantID) {
    const plant = this.plants.find(p => p.id === plantID);
    if (!plant || this.reducedMotion) return;

    const count = type === 'water' ? 14 : 12;
    for (let i = 0; i < count; i++) {
      if (type === 'water') {
        this.particles.push({
          type,
          wx: plant.pos_x + (Math.random() - 0.5) * 50,
          wy: plant.pos_y - 70 - Math.random() * 30,
          vx: (Math.random() - 0.5) * 8,
          vy: 40 + Math.random() * 50,
          floor: plant.pos_y + (Math.random() - 0.5) * 16,
          life: 1,
          decay: 0.9 + Math.random() * 0.5
        });
      } else {
        this.particles.push({
          type,
          wx: plant.pos_x + (Math.random() - 0.5) * 44,
          wy: plant.pos_y + (Math.random() - 0.5) * 10,
          vx: (Math.random() - 0.5) * 14,
          vy: -22 - Math.random() * 30,
          life: 1,
          decay: 0.7 + Math.random() * 0.5
        });
      }
    }
    this.dirty = true;
  }

  _stepEffects(dtMs) {
    const dt = dtMs / 1000;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.wx += p.vx * dt;
      p.wy += p.vy * dt;
      if (p.type === 'water') {
        p.vy += 160 * dt;
        if (p.wy >= p.floor) {
          p.life -= 4 * dt;
          p.vy = 0;
          p.vx = 0;
        }
      } else {
        p.vy *= 1 - 0.6 * dt;
        p.life -= p.decay * dt;
      }
      p.life -= 0.35 * dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }

    if (this._nightAmbient() && this.fireflies) {
      for (const f of this.fireflies) {
        f.t += dt * f.speed;
        f.x01 += Math.cos(f.t) * 0.0004;
        f.y01 += Math.sin(f.t * 1.3) * 0.0003;
      }
    }
  }

  _nightAmbient() {
    return !this.isWidget && !this.reducedMotion && this._skyPhase().night > 0.6;
  }

  // --- Sky ---

  _skyPhase(now = new Date()) {
    const hr = now.getHours() + now.getMinutes() / 60;
    // Piecewise blend between day (0) and night (1), with dawn/dusk hue
    let night, warm;
    if (hr < 5) { night = 1; warm = 0; }
    else if (hr < 7.5) { night = 1 - (hr - 5) / 2.5; warm = 1 - Math.abs(hr - 6.25) / 1.25; }
    else if (hr < 17.5) { night = 0; warm = 0; }
    else if (hr < 20.5) { night = (hr - 17.5) / 3; warm = 1 - Math.abs(hr - 19) / 1.5; }
    else { night = 1; warm = 0; }
    return { night: Math.max(0, Math.min(1, night)), warm: Math.max(0, Math.min(1, warm)) };
  }

  _mix(a, b, t) {
    return [
      Math.round(a[0] + (b[0] - a[0]) * t),
      Math.round(a[1] + (b[1] - a[1]) * t),
      Math.round(a[2] + (b[2] - a[2]) * t)
    ];
  }

  _rgb(c, alpha = 1) {
    return alpha >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
  }

  _skyColors() {
    const { night, warm } = this._skyPhase();
    const dayTop = [126, 168, 178];
    const dayBot = [196, 208, 168];
    const nightTop = [11, 18, 30];
    const nightBot = [24, 38, 33];
    const warmTop = [64, 52, 78];
    const warmBot = [206, 137, 84];

    let top = this._mix(dayTop, nightTop, night);
    let bot = this._mix(dayBot, nightBot, night);
    top = this._mix(top, warmTop, warm * 0.7);
    bot = this._mix(bot, warmBot, warm * 0.7);
    return { top, bot, night, warm };
  }

  _seeded(n) {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  _draw() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const { w, h } = this._viewSize();
    const hy = h * this.horizonFrac;
    const sky = this._skyColors();

    ctx.clearRect(0, 0, w, h);

    if (!this.isWidget) {
      // Sky
      const skyGrad = ctx.createLinearGradient(0, 0, 0, hy * 1.4);
      skyGrad.addColorStop(0, this._rgb(sky.top));
      skyGrad.addColorStop(1, this._rgb(sky.bot));
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, w, hy + 2);

      // Stars
      if (sky.night > 0.45) {
        const starAlpha = (sky.night - 0.45) / 0.55;
        for (let i = 0; i < 60; i++) {
          const sx = this._seeded(i) * w;
          const sy = this._seeded(i + 100) * hy * 0.85;
          const r = 0.4 + this._seeded(i + 200) * 0.9;
          ctx.fillStyle = `rgba(235, 238, 220, ${starAlpha * (0.25 + this._seeded(i + 300) * 0.55)})`;
          ctx.beginPath();
          ctx.arc(sx, sy, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Distant hedge silhouettes
      ctx.fillStyle = this._rgb(this._mix([38, 62, 42], [16, 26, 20], sky.night), 0.9);
      ctx.beginPath();
      ctx.moveTo(0, hy);
      for (let i = 0; i <= 8; i++) {
        const bx = (i / 8) * w;
        const bh = 8 + this._seeded(i + 40) * 18;
        ctx.quadraticCurveTo(bx - w / 16, hy - bh, bx, hy - 2);
      }
      ctx.lineTo(w, hy);
      ctx.closePath();
      ctx.fill();
    }

    // Garden bed
    const bedAlpha = this.isWidget ? 0.82 : 1;
    const soilTop = this._mix([62, 46, 31], [38, 29, 21], sky.night * 0.7);
    const soilBot = this._mix([41, 30, 20], [24, 18, 13], sky.night * 0.7);
    const bed = ctx.createLinearGradient(0, hy, 0, h);
    bed.addColorStop(0, this._rgb(soilTop, bedAlpha));
    bed.addColorStop(1, this._rgb(soilBot, bedAlpha));
    ctx.fillStyle = bed;
    ctx.fillRect(0, hy, w, h - hy);

    // Soil speckle
    for (let i = 0; i < 90; i++) {
      const sx = this._seeded(i + 500) * w;
      const sy = hy + this._seeded(i + 600) * (h - hy);
      const light = this._seeded(i + 700) > 0.5;
      ctx.fillStyle = light ? 'rgba(220, 200, 170, 0.05)' : 'rgba(0, 0, 0, 0.12)';
      ctx.beginPath();
      ctx.arc(sx, sy, 0.8 + this._seeded(i + 800) * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // Horizon light
    ctx.fillStyle = `rgba(233, 168, 87, ${0.05 + sky.warm * 0.12})`;
    ctx.fillRect(0, hy - 1, w, 2);

    // Fireflies
    if (this._nightAmbient()) {
      if (!this.fireflies) {
        this.fireflies = [];
        for (let i = 0; i < 7; i++) {
          this.fireflies.push({
            x01: this._seeded(i + 900),
            y01: 0.4 + this._seeded(i + 950) * 0.5,
            t: this._seeded(i + 990) * 6.28,
            speed: 0.6 + this._seeded(i + 1000) * 0.8
          });
        }
      }
      for (const f of this.fireflies) {
        const glow = 0.35 + 0.65 * Math.abs(Math.sin(f.t * 1.7));
        const fx = ((f.x01 % 1) + 1) % 1 * w;
        const fy = hy + (((f.y01 % 1) + 1) % 1) * (h - hy) * 0.9;
        const halo = ctx.createRadialGradient(fx, fy, 0, fx, fy, 7);
        halo.addColorStop(0, `rgba(240, 200, 110, ${0.5 * glow})`);
        halo.addColorStop(1, 'rgba(240, 200, 110, 0)');
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(fx, fy, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(250, 226, 156, ${0.85 * glow})`;
        ctx.beginPath();
        ctx.arc(fx, fy, 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Selection glow (under plant)
    if (this.selectedPlantID) {
      const plant = this.plants.find(p => p.id === this.selectedPlantID);
      if (plant) {
        const c = this._worldToCanvas(plant.pos_x, plant.pos_y);
        const r = (this._getPlantRadius(plant) + 14) * this._depthScale(plant.pos_y);
        const glow = ctx.createRadialGradient(c.x, c.y, r * 0.2, c.x, c.y, r);
        glow.addColorStop(0, 'rgba(233, 168, 87, 0.22)');
        glow.addColorStop(1, 'rgba(233, 168, 87, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Plants, sorted so nearer (lower) plants draw over farther ones
    const sorted = [...this.plants].sort((a, b) => a.pos_y - b.pos_y);
    for (const plant of sorted) {
      const c = this._worldToCanvas(plant.pos_x, plant.pos_y);
      if (c.x < -60 || c.x > w + 60 || c.y < -60 || c.y > h + 60) continue;

      const scale = this._depthScale(plant.pos_y);

      // Ground shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
      ctx.beginPath();
      ctx.ellipse(c.x, c.y + 3 * scale, 16 * scale, 4.5 * scale, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.scale(scale, scale);
      if (plant.is_dead) {
        this._drawDeadPot(ctx, 0, 0);
      } else {
        this._drawPlantBody(ctx, plant);
      }
      ctx.restore();
    }

    // Selection ring
    if (this.selectedPlantID) {
      const plant = this.plants.find(p => p.id === this.selectedPlantID);
      if (plant) {
        const c = this._worldToCanvas(plant.pos_x, plant.pos_y);
        const r = (this._getPlantRadius(plant) + 6) * this._depthScale(plant.pos_y);
        ctx.strokeStyle = 'rgba(233, 168, 87, 0.85)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 5]);
        ctx.beginPath();
        ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Care particles
    for (const p of this.particles) {
      const c = this._worldToCanvas(p.wx, p.wy);
      const a = Math.max(0, Math.min(1, p.life));
      if (p.type === 'water') {
        ctx.fillStyle = `rgba(111, 177, 216, ${a * 0.9})`;
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, 1.6, 2.6, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = p.type === 'treat'
          ? `rgba(240, 226, 190, ${a * 0.9})`
          : `rgba(${160 + Math.round(73 * a)}, ${194}, ${113}, ${a * 0.9})`;
        ctx.beginPath();
        ctx.arc(c.x, c.y, 1.4 + a, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Placement ghost
    if (this.placementMode && this.placementPos) {
      const gx = this.placementPos.x;
      const gy = Math.max(hy + 4, this.placementPos.y);
      ctx.strokeStyle = 'rgba(233, 168, 87, 0.8)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(gx, gy, 15, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(233, 168, 87, 0.5)';
      ctx.beginPath();
      ctx.arc(gx, gy, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawPlantBody(ctx, plant) {
    const stage = plant.stage || 0;
    const growth = plant.growth_progress || 0;

    // Get visual params
    const vp = plant.visual_params || {};
    const stemColor = vp.stem_color || '#4a6a2a';
    const leafColor = this._adjustColorForSun(vp.leaf_color || '#2d5a1e', plant.sun || 1);
    const leafShape = vp.leaf_shape || 'oval';
    const flowerColor = vp.flower_color || '#ffffff';
    const flowerShape = vp.flower_shape || 'round';

    // Health effects
    const droopFactor = (plant.water || 1) < 0.3 ? (1 - plant.water) * 0.3 : 0;

    switch (stage) {
      case 0: this._drawSeed(ctx, growth, stemColor); break;
      case 1: this._drawSprout(ctx, growth, stemColor, leafColor, leafShape, droopFactor); break;
      case 2: this._drawGrowing(ctx, growth, stemColor, leafColor, leafShape, droopFactor); break;
      case 3: this._drawMature(ctx, growth, stemColor, leafColor, leafShape, droopFactor); break;
      case 4: this._drawFlowering(ctx, growth, stemColor, leafColor, leafShape, flowerColor, flowerShape, droopFactor); break;
    }

    // Pest brown spots
    if (plant.pests && plant.pests.length > 0) {
      for (const pest of plant.pests) {
        if (pest.severity > 0.05) {
          this._drawPestSpots(ctx, pest.severity, plant.id);
        }
      }
    }
  }

  _drawSeed(ctx, growth, color) {
    const radius = 8 + growth * 4;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();

    // Small indicator dot
    ctx.fillStyle = '#8bc34a';
    ctx.beginPath();
    ctx.arc(2, -radius + 2, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawSprout(ctx, growth, stemColor, leafColor, leafShape, droop) {
    const stemHeight = 10 + growth * 15;

    // Stem
    ctx.strokeStyle = stemColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -stemHeight);
    ctx.stroke();

    // Two small leaves
    const leafSize = 5 + growth * 5;
    const leafAngle = Math.PI / 4 + droop;

    ctx.fillStyle = leafColor;
    this._drawLeaf(ctx, -2, -stemHeight * 0.7, leafSize, -leafAngle, leafShape);
    this._drawLeaf(ctx, 2, -stemHeight * 0.7, leafSize, leafAngle, leafShape);
  }

  _drawGrowing(ctx, growth, stemColor, leafColor, leafShape, droop) {
    const stemHeight = 25 + growth * 20;

    // Stem
    ctx.strokeStyle = stemColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -stemHeight);
    ctx.stroke();

    // More leaves
    const leafSize = 8 + growth * 8;
    ctx.fillStyle = leafColor;

    for (let i = 0; i < 4; i++) {
      const y = -stemHeight * (0.3 + i * 0.2);
      const angle = (i % 2 === 0 ? 1 : -1) * (Math.PI / 3 + droop * (i + 1));
      this._drawLeaf(ctx, 0, y, leafSize, angle, leafShape);
    }
  }

  _drawMature(ctx, growth, stemColor, leafColor, leafShape, droop) {
    const stemHeight = 45 + growth * 10;

    // Trunk
    ctx.strokeStyle = stemColor;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -stemHeight);
    ctx.stroke();

    // Full set of leaves
    const leafSize = 12 + growth * 3;
    ctx.fillStyle = leafColor;

    const leafCount = 6;
    for (let i = 0; i < leafCount; i++) {
      const y = -stemHeight * (0.15 + i * 0.12);
      const angle = (i % 2 === 0 ? 1 : -1) * (Math.PI / 3 + droop * (i + 1) * 0.5);
      this._drawLeaf(ctx, 0, y, leafSize, angle, leafShape);
    }

    // Canopy crown
    ctx.fillStyle = this._lightenColor(leafColor, 1.2);
    ctx.beginPath();
    ctx.arc(0, -stemHeight, 10 + growth * 5, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawFlowering(ctx, growth, stemColor, leafColor, leafShape, flowerColor, flowerShape, droop) {
    this._drawMature(ctx, growth, stemColor, leafColor, leafShape, droop);

    // Flowers
    const flowerCount = 2 + Math.floor(growth * 3);
    for (let i = 0; i < flowerCount; i++) {
      const angle = (i / flowerCount) * Math.PI * 2;
      const rx = Math.cos(angle) * 20;
      const ry = -50 + Math.sin(angle) * 10;

      ctx.fillStyle = flowerColor;
      ctx.beginPath();

      switch (flowerShape) {
        case 'star':
          this._drawStar(ctx, rx, ry, 5, 4, 5);
          break;
        case 'pointed':
          this._drawStar(ctx, rx, ry, 4, 3, 5);
          break;
        case 'fan':
          this._drawLeaf(ctx, rx, ry, 6, angle, 'fan');
          break;
        case 'compound':
          ctx.arc(rx, ry, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#ffff88';
          ctx.arc(rx, ry, 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = flowerColor;
          break;
        default: // round
          ctx.arc(rx, ry, 4, 0, Math.PI * 2);
          ctx.fill();
      }
    }
  }

  _drawLeaf(ctx, x, y, size, angle, shape) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle - Math.PI / 2);

    switch (shape) {
      case 'pointed':
        ctx.beginPath();
        ctx.moveTo(0, -size * 1.5);
        ctx.lineTo(-size * 0.5, size * 0.3);
        ctx.lineTo(0, 0);
        ctx.lineTo(size * 0.5, size * 0.3);
        ctx.closePath();
        ctx.fill();
        break;
      case 'round':
        ctx.beginPath();
        ctx.ellipse(0, -size * 0.3, size * 0.5, size, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'oval':
        ctx.beginPath();
        ctx.ellipse(0, -size * 0.5, size * 0.35, size, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'heart':
        ctx.beginPath();
        ctx.moveTo(0, size * 0.3);
        ctx.bezierCurveTo(-size * 0.6, -size * 0.3, -size * 0.7, -size, 0, -size * 0.2);
        ctx.bezierCurveTo(size * 0.7, -size, size * 0.6, -size * 0.3, 0, size * 0.3);
        ctx.fill();
        break;
      case 'split':
        ctx.beginPath();
        ctx.ellipse(-size * 0.2, -size * 0.5, size * 0.4, size, 0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -size * 1.2);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(size * 0.2, -size * 0.5, size * 0.4, size, -0.2, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'spiky':
        this._drawStar(ctx, 0, -size * 0.5, 5, size * 0.6, size * 0.3);
        break;
      case 'fan':
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(-size, -size, 0, -size * 1.5);
        ctx.quadraticCurveTo(size, -size, 0, 0);
        ctx.fill();
        break;
      case 'elongated':
        ctx.beginPath();
        ctx.ellipse(0, -size * 0.4, size * 0.25, size * 1.2, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'trap':
        ctx.beginPath();
        ctx.moveTo(0, size * 0.3);
        ctx.bezierCurveTo(-size * 0.5, -size * 0.2, -size * 0.3, -size, 0, -size * 0.5);
        ctx.bezierCurveTo(size * 0.3, -size, size * 0.5, -size * 0.2, 0, size * 0.3);
        ctx.fill();
        break;
      case 'compound':
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath();
          ctx.ellipse(i * size * 0.25, -size * 0.5, size * 0.2, size * 0.7, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      default:
        ctx.beginPath();
        ctx.ellipse(0, -size * 0.3, size * 0.5, size, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.restore();
  }

  _drawStar(ctx, x, y, points, outerR, innerR) {
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 === 0 ? outerR : innerR;
      const angle = (i * Math.PI) / points - Math.PI / 2;
      const px = x + Math.cos(angle) * r;
      const py = y + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }

  _drawDeadPot(ctx, x, y) {
    ctx.save();
    ctx.translate(x, y);

    // Wilted stem drooping over the rim
    ctx.strokeStyle = '#6b5a3e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -4);
    ctx.quadraticCurveTo(1, -18, 9, -14);
    ctx.stroke();
    ctx.fillStyle = '#7a6647';
    ctx.beginPath();
    ctx.ellipse(10, -13, 3.5, 2, 0.6, 0, Math.PI * 2);
    ctx.fill();

    // Pot body (trapezoid)
    ctx.fillStyle = '#a34f36';
    ctx.beginPath();
    ctx.moveTo(-15, -5);
    ctx.lineTo(-12, 15);
    ctx.lineTo(12, 15);
    ctx.lineTo(15, -5);
    ctx.closePath();
    ctx.fill();

    // Pot rim
    ctx.fillStyle = '#c96a4c';
    ctx.beginPath();
    ctx.rect(-17, -8, 34, 6);
    ctx.fill();

    // Dirt
    ctx.fillStyle = '#3d2c1e';
    ctx.beginPath();
    ctx.ellipse(0, -4, 14, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  _drawPestSpots(ctx, severity, plantID = 0) {
    ctx.fillStyle = `rgba(101, 67, 33, ${severity * 0.8})`;
    for (let i = 0; i < Math.floor(severity * 8); i++) {
      const rx = (this._seeded(plantID * 17 + i) - 0.5) * 40;
      const ry = -10 - this._seeded(plantID * 31 + i + 50) * 40;
      ctx.beginPath();
      ctx.arc(rx, ry, 1.5 + severity * 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _adjustColorForSun(hex, sun) {
    if (sun >= 0.3) return hex;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const factor = 0.4 + sun * 2;
    const nr = Math.round(r * factor);
    const ng = Math.round(g * factor);
    const nb = Math.round(b * factor);
    return `rgb(${nr},${ng},${nb})`;
  }

  _lightenColor(hex, factor) {
    const r = Math.min(255, parseInt(hex.slice(1, 3), 16) * factor);
    const g = Math.min(255, parseInt(hex.slice(3, 5), 16) * factor);
    const b = Math.min(255, parseInt(hex.slice(5, 7), 16) * factor);
    return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
  }
}

if (typeof window !== 'undefined') {
  window.GardenRenderer = GardenRenderer;
}

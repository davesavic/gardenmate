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
    const sid = plant.species_id || 'pothos';
    const art = PLANT_ART[sid] || PLANT_ART['pothos'];
    const stage = plant.stage || 0;
    const growth = plant.growth_progress || 0;
    const sun = plant.sun != null ? plant.sun : 0;
    const water = plant.water != null ? plant.water : 1;
    const droop = water < 0.3 ? (1 - water) * 0.3 : 0;

    const leafColor = this._adjustColorForSun(art.leaf, sun);
    const bark = art.bark || art.stem;

    if (stage === 0) {
      this._drawSeedGeneric(ctx, growth, art.seed);
      this._drawPestSpotsStub(ctx, plant);
      return;
    }

    if (stage === 1) {
      this._drawSproutGeneric(ctx, growth, bark, leafColor, droop);
      this._drawPestSpotsStub(ctx, plant);
      return;
    }

    // Juvenile → adult: same silhouette, growing in size
    const stageScale = { 2: 0.55, 3: 0.85, 4: 1.0, 5: 1.0 };
    const scale = (stageScale[Math.min(stage, 5)] || 1.0) + growth * 0.1;

    switch (art.form) {
      case 'sword_rosette': this._drawSwordRosette(ctx, art, scale, droop, leafColor); break;
      case 'fountain': this._drawFountain(ctx, art, scale, droop, leafColor); break;
      case 'trailing': this._drawTrailing(ctx, art, scale, droop, leafColor); break;
      case 'clump': this._drawClump(ctx, art, scale, droop, bark, leafColor); break;
      case 'monstera': this._drawMonstera(ctx, art, scale, droop, bark, leafColor); break;
      case 'pinnate_stems': this._drawPinnateStems(ctx, art, scale, droop, bark, leafColor); break;
      case 'single_upright': this._drawSingleUpright(ctx, art, scale, droop, bark, leafColor); break;
      case 'bonsai': this._drawBonsai(ctx, art, scale, growth, droop, bark, leafColor); break;
      case 'trap_rosette': this._drawTrapRosette(ctx, art, scale, growth, droop, leafColor); break;
      case 'orchid': this._drawOrchid(ctx, art, scale, droop, bark, leafColor); break;
      case 'paddle_fan': this._drawPaddleFan(ctx, art, scale, droop, bark, leafColor); break;
      case 'rose_cane': this._drawRoseCane(ctx, art, scale, droop, bark, leafColor); break;
      case 'rosette_head': this._drawRosetteHead(ctx, art, scale, droop, leafColor); break;
      case 'root_veg': this._drawRootVeg(ctx, art, scale, droop, leafColor); break;
      case 'staked_vine': this._drawStakedVine(ctx, art, scale, droop, bark, leafColor); break;
      case 'big_fan': this._drawBigFan(ctx, art, scale, droop, bark, leafColor); break;
      case 'bush': this._drawBush(ctx, art, scale, droop, bark, leafColor); break;
      case 'sprawling': this._drawSprawling(ctx, art, scale, droop, bark, leafColor); break;
      case 'tree': this._drawTree(ctx, art, scale, growth, droop, bark, leafColor); break;
      default: this._drawClump(ctx, art, scale, droop, bark, leafColor);
    }

    // Flowers (stages 4+)
    if (stage >= 4 && art.flower) {
      this._drawFlowers(ctx, art, scale, stage === 5);
    }

    // Fruit (stage 5: fruiting)
    if (stage === 5 && art.fruit) {
      this._drawFruit(ctx, art, scale);
    }

    this._drawPestSpotsStub(ctx, plant);
  }

  _drawSeedGeneric(ctx, growth, seedColor) {
    const r = 8 + growth * 4;
    ctx.fillStyle = seedColor || '#6b8e4a';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#8bc34a';
    ctx.beginPath();
    ctx.arc(2, -r + 2, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawSproutGeneric(ctx, growth, stemColor, leafColor, droop) {
    const stemHeight = 10 + growth * 12;
    ctx.strokeStyle = stemColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -stemHeight);
    ctx.stroke();
    const sz = 5 + growth * 4;
    const a = Math.PI / 4 + droop;
    this._drawSimpleLeaf(ctx, -2, -stemHeight * 0.7, sz, sz * 0.5, -a, leafColor, 'oval');
    this._drawSimpleLeaf(ctx, 2, -stemHeight * 0.7, sz, sz * 0.5, a, leafColor, 'oval');
  }

  /* ---- form drawing functions ---- */

  _drawSwordRosette(ctx, art, s, droop, leaf) {
    const h = art.height * s;
    const count = art.leafCount || 6;
    const spread = (art.spread || 0.35) - droop * 0.25;
    for (let i = 0; i < count; i++) {
      const a = (i / (count - 1) - 0.5) * spread * Math.PI;
      this._drawBlade(ctx, 0, 0, h * 0.25, h * 0.85, art.width || 3.5, a, leaf);
    }
  }

  _drawBlade(ctx, bx, by, baseOff, length, w, angle, color) {
    ctx.save();
    ctx.translate(bx, by - baseOff);
    ctx.rotate(angle);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-w * 0.3, 0);
    ctx.quadraticCurveTo(-w, -length * 0.6, 0, -length);
    ctx.quadraticCurveTo(w, -length * 0.6, w * 0.3, 0);
    ctx.closePath();
    ctx.fill();
    // lighter centre stripe
    ctx.strokeStyle = this._lightenColor(color, 1.35);
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(0, -2);
    ctx.lineTo(0, -length * 0.75);
    ctx.stroke();
    ctx.restore();
  }

  _drawFountain(ctx, art, s, droop, leaf) {
    const h = art.height * s;
    const n = art.leafCount || 10;
    for (let i = 0; i < n; i++) {
      const a = (i / (n - 1) - 0.5) * 1.6 - droop * 0.4;
      const len = h * (0.65 + this._seeded(i + 30) * 0.35);
      this._drawBlade(ctx, 0, 0, 2, len, art.width || 2.2, a, leaf);
    }
    if (art.stolonColor && s > 0.65) {
      for (let j = 0; j < 3; j++) {
        const sa = (1.8 + j * 0.4) * (j % 2 === 0 ? 1 : -1);
        const sx = Math.cos(sa) * h * 0.7;
        const sy = -Math.sin(sa) * h * 0.5;
        ctx.strokeStyle = art.stolonColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, -4);
        ctx.quadraticCurveTo(sx * 0.5, sy * 0.6, sx, sy);
        ctx.stroke();
        ctx.fillStyle = leaf;
        ctx.beginPath();
        ctx.arc(sx, sy, 4 * s, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  _drawTrailing(ctx, art, s, droop, leaf) {
    const h = art.height * s;
    ctx.strokeStyle = art.stem;
    ctx.lineWidth = 1.5 * s;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(6 * s, -h * 0.4, 2 * s, -h * 0.8);
    ctx.stroke();
    const n = art.leafCount || 5;
    const vari = art.variegated || null;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const lx = 2 * s + Math.sin(t * Math.PI) * 6 * s;
      const ly = -h * 0.8 * t;
      const angle = (i % 2 === 0 ? 1 : -1) * (1.3 - droop);
      const sz = 7 * s * (0.8 + t * 0.4);
      if (vari) {
        const g = ctx.createRadialGradient(lx + sz * 0.25, ly - sz * 0.3, sz * 0.1, lx, ly - sz * 0.2, sz);
        g.addColorStop(0, vari);
        g.addColorStop(1, leaf);
        ctx.fillStyle = g;
      } else {
        ctx.fillStyle = leaf;
      }
      ctx.save();
      ctx.translate(lx, ly);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(0, -sz);
      ctx.quadraticCurveTo(-sz * 0.5, -sz * 0.2, 0, 0);
      ctx.quadraticCurveTo(sz * 0.5, -sz * 0.2, 0, -sz);
      ctx.fill();
      ctx.restore();
    }
  }

  _drawClump(ctx, art, s, droop, bark, leaf) {
    const h = art.height * s;
    const n = art.leafCount || 6;
    const ang = art.spread || 0.9;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const a = (t - 0.5) * ang * Math.PI - droop * 0.3;
      const ox = Math.sin(a) * 2 * s;
      ctx.strokeStyle = bark;
      ctx.lineWidth = 1.6 * s;
      ctx.beginPath();
      ctx.moveTo(ox, 0);
      ctx.lineTo(ox, -h * 0.5);
      ctx.stroke();
      this._drawSimpleLeaf(ctx, ox, -h * 0.5, h * 0.32, h * 0.14, a, leaf, art.leafStyle || 'oval');
    }
    if (s > 0.6 && art.canopy) {
      ctx.fillStyle = this._lightenColor(leaf, 1.15);
      ctx.beginPath();
      ctx.arc(0, -h * 0.45, h * 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawSimpleLeaf(ctx, x, y, len, wid, angle, color, style) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle - Math.PI / 2);
    ctx.fillStyle = color;
    ctx.beginPath();
    switch (style) {
      case 'round':
        ctx.ellipse(0, -len * 0.3, wid * 0.7, len, 0, 0, Math.PI * 2);
        break;
      case 'pointed':
        ctx.moveTo(0, -len * 1.2);
        ctx.lineTo(-wid, len * 0.2);
        ctx.lineTo(0, 0);
        ctx.lineTo(wid, len * 0.2);
        ctx.closePath();
        break;
      case 'elongated':
        ctx.ellipse(0, -len * 0.35, wid * 0.4, len, 0, 0, Math.PI * 2);
        break;
      case 'heart':
        ctx.moveTo(0, len * 0.2);
        ctx.bezierCurveTo(-wid * 0.9, -len * 0.2, -wid, -len * 0.8, 0, -len * 0.15);
        ctx.bezierCurveTo(wid, -len * 0.8, wid * 0.9, -len * 0.2, 0, len * 0.2);
        break;
      case 'fan':
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(-wid, -len, 0, -len * 1.3);
        ctx.quadraticCurveTo(wid, -len, 0, 0);
        break;
      case 'compound':
        for (let j = -1; j <= 1; j++) {
          ctx.beginPath();
          ctx.ellipse(j * wid * 0.3, -len * 0.4, wid * 0.25, len * 0.65, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
        return;
      case 'split':
        ctx.beginPath();
        ctx.ellipse(-wid * 0.25, -len * 0.45, wid * 0.35, len * 0.8, 0.25, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(wid * 0.25, -len * 0.45, wid * 0.35, len * 0.8, -0.25, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return;
      default: // oval
        ctx.ellipse(0, -len * 0.4, wid * 0.45, len, 0, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.restore();
  }

  _drawMonstera(ctx, art, s, droop, bark, leaf) {
    const h = art.height * s;
    const n = art.leafCount || 5;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const a = (t - 0.5) * 1.4 - droop * 0.25;
      ctx.strokeStyle = bark;
      ctx.lineWidth = 1.8 * s;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(Math.sin(a) * 6 * s, -h * 0.3, Math.sin(a) * 3 * s, -h * (0.4 + t * 0.35));
      ctx.stroke();
      const lx = Math.sin(a) * 3 * s;
      const ly = -h * (0.4 + t * 0.35);
      const sz = h * 0.28;
      const wid = h * 0.16;
      ctx.save();
      ctx.translate(lx, ly);
      ctx.rotate(a - Math.PI / 2);
      ctx.fillStyle = leaf;
      ctx.beginPath();
      ctx.ellipse(-wid * 0.25, -sz * 0.4, wid * 0.45, sz, 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = this._adjustColorForSun(leaf, 0.7);
      ctx.lineWidth = 0.5;
      ctx.moveTo(0, -sz * 0.2);
      ctx.lineTo(wid * 0.3, -sz * 0.9);
      ctx.moveTo(0, -sz * 0.2);
      ctx.lineTo(-wid * 0.3, -sz * 0.9);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(wid * 0.25, -sz * 0.4, wid * 0.45, sz, -0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  _drawPinnateStems(ctx, art, s, droop, bark, leaf) {
    const h = art.height * s;
    const stems = art.stemCount || 4;
    for (let i = 0; i < stems; i++) {
      const t = (i / (stems - 1) - 0.5);
      const a = t * 0.8 - droop * 0.2;
      ctx.strokeStyle = bark;
      ctx.lineWidth = 2 * s;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.sin(a) * 6 * s, -h * 0.8);
      ctx.stroke();
      const lx = Math.sin(a) * 6 * s;
      const ly = -h * 0.82;
      const ln = art.leafPerStem || 5;
      for (let j = 0; j < ln; j++) {
        const lt = (j / (ln - 1) - 0.5);
        const la = a + lt * 1.6;
        this._drawSimpleLeaf(ctx, lx, ly + j * 2, 8 * s, 3.5 * s, la, leaf, art.leafStyle || 'oval');
      }
    }
  }

  _drawSingleUpright(ctx, art, s, droop, bark, leaf) {
    const h = art.height * s;
    ctx.strokeStyle = bark;
    ctx.lineWidth = 3 * s;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -h * 0.85);
    ctx.stroke();
    const n = art.leafCount || 5;
    for (let i = 0; i < n; i++) {
      const la = (i % 2 === 0 ? 1 : -1) * (1.1 - droop * 0.3 * (i + 1));
      const ly = -h * (0.25 + i * 0.13);
      this._drawSimpleLeaf(ctx, 0, ly, 10 * s, 5 * s, la, leaf, art.leafStyle || 'oval');
    }
    if (s > 0.65) {
      ctx.fillStyle = this._lightenColor(leaf, 1.2);
      ctx.beginPath();
      ctx.arc(0, -h * 0.88, 6 * s, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawBonsai(ctx, art, s, growth, droop, bark, leaf) {
    const h = art.height * s;
    ctx.fillStyle = this._lightenColor(bark, 0.85);
    ctx.beginPath();
    ctx.rect(-4 * s, -2, 8 * s, 4);
    ctx.fill();
    ctx.strokeStyle = this._lightenColor(bark, 0.7);
    ctx.lineWidth = 3.5 * s;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-3, -h * 0.5, -1, -h);
    ctx.stroke();
    // branch
    ctx.lineWidth = 2.2 * s;
    ctx.beginPath();
    ctx.moveTo(-1, -h * 0.7);
    ctx.quadraticCurveTo(6 * s, -h * 0.75, 8 * s, -h * 0.95);
    ctx.stroke();
    // canopy pads
    const padN = 3 + Math.floor(growth * 2);
    for (let i = 0; i < padN; i++) {
      const px = (this._seeded(i + 70) - 0.5) * 18 * s;
      const py = -h * (0.5 + i * 0.15);
      ctx.fillStyle = leaf;
      ctx.beginPath();
      ctx.ellipse(px, py, 10 * s + i * 2, 8 * s - i, 0.1 * i, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = this._lightenColor(leaf, 0.7);
      ctx.lineWidth = 0.4;
      ctx.stroke();
    }
  }

  _drawTrapRosette(ctx, art, s, growth, droop, leaf) {
    const h = art.height * s;
    const count = art.leafCount || 6;
    const rosetteH = h * 0.3;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + this._seeded(i + 80) * 0.3;
      this._drawTrapLeaf(ctx, 0, 0, a, rosetteH, 4 * s, leaf);
    }
    // flower stalk
    if (s > 0.55) {
      ctx.strokeStyle = '#5a7a3a';
      ctx.lineWidth = 1.2 * s;
      ctx.beginPath();
      ctx.moveTo(0, -rosetteH * 0.3);
      ctx.lineTo(0, -h * 0.95);
      ctx.stroke();
    }
  }

  _drawTrapLeaf(ctx, x, y, angle, len, wid, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, -len * 0.4);
    ctx.bezierCurveTo(-wid * 0.5, -len * 0.6, -wid * 0.4, -len, 0, -len);
    ctx.bezierCurveTo(wid * 0.4, -len, wid * 0.5, -len * 0.6, 0, -len * 0.4);
    ctx.fill();
    ctx.strokeStyle = this._lightenColor(color, 1.3);
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(0, -len * 0.35);
    ctx.lineTo(0, -len * 0.95);
    ctx.stroke();
    // teeth
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      ctx.moveTo(-wid * 0.2 - k * 0.3, -len * 0.55 - k * 3);
      ctx.lineTo(-wid * 0.3 - k * 0.3, -len * 0.6 - k * 3);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawOrchid(ctx, art, s, droop, bark, leaf) {
    const h = art.height * s;
    const ln = art.leafCount || 3;
    for (let i = 0; i < ln; i++) {
      const a = (i / (ln - 1) - 0.5) * 1.4;
      this._drawSimpleLeaf(ctx, 0, -4, h * 0.45, h * 0.12, a, leaf, 'elongated');
    }
    // arching flower spike
    if (s > 0.5) {
      ctx.strokeStyle = bark;
      ctx.lineWidth = 1.5 * s;
      ctx.beginPath();
      ctx.moveTo(0, -h * 0.15);
      ctx.quadraticCurveTo(10 * s, -h * 0.8, 6 * s, -h * 1.05);
      ctx.stroke();
    }
  }

  _drawPaddleFan(ctx, art, s, droop, bark, leaf) {
    const h = art.height * s;
    const n = art.leafCount || 4;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const a = (t - 0.5) * 1.1;
      ctx.strokeStyle = bark;
      ctx.lineWidth = 1.8 * s;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.sin(a) * 4 * s, -h * 0.7);
      ctx.stroke();
      this._drawSimpleLeaf(ctx, Math.sin(a) * 4 * s, -h * 0.7, h * 0.35, h * 0.1, a, leaf, 'fan');
    }
    if (s > 0.7) {
      // bird-of-paradise crane flower spike — caller handles flower drawing
    }
  }

  _drawRoseCane(ctx, art, s, droop, bark, leaf) {
    const h = art.height * s;
    const stems = art.stemCount || 3;
    for (let j = 0; j < stems; j++) {
      const sx = (j - 1) * 5 * s;
      ctx.strokeStyle = bark;
      ctx.lineWidth = 2 * s;
      ctx.beginPath();
      ctx.moveTo(sx * 1.8, 0);
      ctx.quadraticCurveTo(sx, -h * 0.5, sx * 1.2, -h * 0.85);
      ctx.stroke();
      // thorns
      ctx.strokeStyle = '#5c3a2a';
      ctx.lineWidth = 0.7;
      for (let k = 0; k < 3; k++) {
        const ty = -h * (0.2 + k * 0.2);
        ctx.beginPath();
        ctx.moveTo(sx * 1.4, ty);
        ctx.lineTo(sx * 1.4 + (k % 2 === 0 ? 2 : -2), ty - 2);
        ctx.stroke();
      }
      const ln = 3;
      for (let li = 0; li < ln; li++) {
        const a = (li % 2 === 0 ? 1 : -1) * (0.8 - droop * 0.3);
        this._drawSimpleLeaf(ctx, sx * 1.2, -h * (0.45 + li * 0.14), 7 * s, 3.5 * s, a, leaf, 'compound');
      }
    }
  }

  _drawRosetteHead(ctx, art, s, droop, leaf) {
    const r = art.height * s * 0.35;
    const count = art.leafCount || 10;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + (s > 0.5 ? 0.2 : 0);
      const rad = art.leafStyle === 'round' ? 1.0 : 0.7;
      const ra = i / count;
      ctx.save();
      ctx.translate(Math.cos(a) * r * rad * 0.5, -r * rad * 0.6);
      ctx.rotate(a - Math.PI / 2);
      ctx.fillStyle = (ra > 0.5 && art.outerLeaf) ? art.outerLeaf : leaf;
      ctx.beginPath();
      if (art.leafStyle === 'round') {
        ctx.ellipse(0, -r * 0.7, r * 0.5, r * 0.8, 0.1, 0, Math.PI * 2);
      } else {
        ctx.moveTo(0, -r * 0.9);
        ctx.quadraticCurveTo(-r * 0.4, -r * 0.3, 0, 0);
        ctx.quadraticCurveTo(r * 0.4, -r * 0.3, 0, -r * 0.9);
      }
      ctx.fill();
      if (art.ribbed) {
        ctx.strokeStyle = this._lightenColor(leaf, 0.8);
        ctx.lineWidth = 0.4;
        ctx.beginPath();
        ctx.moveTo(0, -r * 0.1);
        ctx.lineTo(0, -r * 0.85);
        ctx.stroke();
      }
      ctx.restore();
    }
    // centre bud
    ctx.fillStyle = this._lightenColor(leaf, 1.5);
    ctx.beginPath();
    ctx.arc(0, -r * 0.15, r * 0.2, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawRootVeg(ctx, art, s, droop, leaf) {
    const h = art.height * s;
    const raw = art.raw || false;
    if (s > 0.4 && !raw) {
      const rootH = h * 0.35;
      const rootW = h * 0.18;
      const g = ctx.createLinearGradient(-rootW, 0, rootW, 0);
      g.addColorStop(0, art.rootDark || '#a33');
      g.addColorStop(0.5, art.rootColor || '#e55');
      g.addColorStop(1, art.rootDark || '#a33');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(0, rootH * 0.4, rootW, rootH, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = this._adjustColorForSun(art.rootColor || '#e55', 0.6);
      ctx.lineWidth = 0.5;
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        ctx.moveTo(-rootW * 0.3, rootH * (0.1 + k * 0.12));
        ctx.lineTo(-rootW * 0.1, rootH * (0.08 + k * 0.12));
        ctx.stroke();
      }
    }
    // feathery tops
    const n = art.leafCount || 5;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const a = (t - 0.5) * 1.2 - droop * 0.3;
      const lx = Math.sin(a) * 2;
      ctx.strokeStyle = this._lightenColor(leaf, 0.85);
      ctx.lineWidth = 1.2 * s;
      ctx.beginPath();
      ctx.moveTo(lx, 0);
      ctx.quadraticCurveTo(lx + Math.sin(a * 0.7) * 3 * s, -h * 0.4, lx + Math.sin(a * 0.7) * 2 * s, -h * 0.7);
      ctx.stroke();
      // leaflets
      ctx.fillStyle = leaf;
      for (let j = 0; j < 6; j++) {
        const fy = -h * (0.1 + j * 0.08);
        const fl = (j % 2 === 0 ? 1 : -1) * 0.6;
        this._drawSimpleLeaf(ctx, lx + Math.sin(a * 0.7) * 2 * s, fy, 4 * s, 1.8 * s, a + fl, leaf, 'elongated');
      }
    }
  }

  _drawStakedVine(ctx, art, s, droop, bark, leaf) {
    const h = art.height * s;
    // stake
    ctx.strokeStyle = '#c4a46c';
    ctx.lineWidth = 2 * s;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -h * 0.95);
    ctx.stroke();
    // vine winding around stake
    ctx.strokeStyle = bark;
    ctx.lineWidth = 1.5 * s;
    ctx.beginPath();
    ctx.moveTo(-2, 0);
    for (let i = 1; i <= 8; i++) {
      const vy = -i * h * 0.11;
      const vx = (i % 2 === 0) ? 4 * s : -4 * s;
      ctx.lineTo(vx, vy);
    }
    ctx.stroke();
    // five-part leaves
    const ln = art.leafCount || 4;
    for (let i = 0; i < ln; i++) {
      const ly = -h * (0.2 + i * 0.18);
      const lx = (i % 2 === 0) ? -5 * s : 5 * s;
      this._drawSimpleLeaf(ctx, lx, ly, 8 * s, 4 * s, (i % 2 === 0 ? 1 : -1) * 0.8, leaf, art.leafStyle || 'compound');
    }
  }

  _drawBigFan(ctx, art, s, droop, bark, leaf) {
    const h = art.height * s;
    const n = art.leafCount || 4;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const a = (t - 0.5) * 1.3 - droop * 0.25;
      ctx.strokeStyle = bark;
      ctx.lineWidth = 2 * s;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.sin(a) * 5 * s, -h * 0.55);
      ctx.stroke();
      this._drawSimpleLeaf(ctx, Math.sin(a) * 5 * s, -h * 0.55, h * 0.38, h * 0.16, a, leaf, 'fan');
    }
  }

  _drawBush(ctx, art, s, droop, bark, leaf) {
    const h = art.height * s;
    // main stem trifurcated
    ctx.strokeStyle = bark;
    ctx.lineWidth = 2.5 * s;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -h * 0.4);
    ctx.stroke();
    for (let b = -1; b <= 1; b++) {
      ctx.beginPath();
      ctx.moveTo(0, -h * 0.35);
      ctx.quadraticCurveTo(b * 8 * s, -h * 0.6, b * 6 * s, -h * 0.85);
      ctx.stroke();
    }
    // dense foliage
    const cn = art.leafCount || 12;
    for (let i = 0; i < cn; i++) {
      const a = this._seeded(i + 90) * Math.PI * 2;
      const r = h * 0.25 * (0.6 + this._seeded(i + 100) * 0.4);
      const lx = Math.cos(a) * r;
      const ly = -h * 0.55 + Math.sin(a) * r * 0.5;
      this._drawSimpleLeaf(ctx, lx, ly, 6 * s, 3 * s, a, leaf, art.leafStyle || 'oval');
    }
    if (s > 0.6) {
      ctx.fillStyle = this._lightenColor(leaf, 1.1);
      ctx.beginPath();
      ctx.arc(0, -h * 0.55, h * 0.22, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawSprawling(ctx, art, s, droop, bark, leaf) {
    const h = art.height * s;
    const vines = art.stemCount || 4;
    for (let v = 0; v < vines; v++) {
      const va = (v / (vines - 1) - 0.5) * 2.2;
      const vx = Math.sin(va) * 14 * s;
      const vy = -h * 0.6 - Math.cos(va) * 10 * s;
      ctx.strokeStyle = bark;
      ctx.lineWidth = 1.8 * s;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(vx * 0.6, -20, vx, vy);
      ctx.stroke();
      const ln = art.leafPerStem || 3;
      for (let li = 0; li < ln; li++) {
        const lt = (li / (ln - 1) - 0.5);
        const la = va * 0.5 + lt * 0.8;
        const sx = vx * (0.3 + li * 0.25);
        const sy = vy * (0.3 + li * 0.35);
        this._drawSimpleLeaf(ctx, sx, sy, 8 * s, 4 * s, la, leaf, art.leafStyle || 'oval');
      }
    }
  }

  _drawTree(ctx, art, s, growth, droop, bark, leaf) {
    const h = art.height * s;
    // trunk with root flare
    const rw = 5 * s;
    ctx.fillStyle = this._lightenColor(bark, 0.8);
    ctx.beginPath();
    ctx.rect(-rw, -4, rw * 2, 5);
    ctx.fill();
    // tapered trunk
    ctx.strokeStyle = bark;
    ctx.lineWidth = 4.5 * s;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -h * 0.55);
    ctx.stroke();
    // branches
    ctx.lineWidth = 2.8 * s;
    for (let b = -1; b <= 1; b += 2) {
      ctx.beginPath();
      ctx.moveTo(0, -h * 0.4);
      ctx.quadraticCurveTo(b * 14 * s, -h * 0.5, b * 12 * s, -h * 0.65);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(b * 6 * s, -h * 0.5);
      ctx.quadraticCurveTo(b * 10 * s, -h * 0.65, b * 14 * s, -h * 0.78);
      ctx.stroke();
    }
    // sub-branches
    ctx.lineWidth = 1.4 * s;
    for (let sb = -2; sb <= 2; sb++) {
      const sx = sb * 5 * s;
      const sy = -h * 0.6;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(sx + sb * 3, sy - 5, sx + sb * 4, sy - 14);
      ctx.stroke();
    }
    // canopy cloud
    ctx.fillStyle = leaf;
    const cn = art.leafCount || 8;
    for (let i = 0; i < cn; i++) {
      const cx = (this._seeded(i + 110) - 0.5) * 24 * s;
      const cy = -h * 0.58 - this._seeded(i + 120) * h * 0.3;
      ctx.beginPath();
      ctx.arc(cx, cy, 5 * s + this._seeded(i + 130) * 3 * s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = this._lightenColor(leaf, 1.25);
    ctx.beginPath();
    ctx.arc(0, -h * 0.65, 12 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawFlowers(ctx, art, scale, fruiting) {
    const f = art.flower;
    if (fruiting && art.fruit && !f.keepFlowers) return;
    const n = f.count || 3;
    const sp = f.spread || 14;
    const h = (f.height || 50) * scale;
    const sizes = Array.isArray(f.size) ? f.size : [f.size || 4];
    ctx.fillStyle = f.color;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this._seeded(i + 140) * 0.5;
      const rx = Math.cos(a) * sp * scale;
      const ry = (-h * 0.65) + Math.sin(a) * 6 * scale;
      const sz = sizes[i % sizes.length] * scale;
      ctx.beginPath();
      switch (f.shape || 'round') {
        case 'star':
          this._drawStar(ctx, rx, ry, 5, sz, sz * 0.55);
          break;
        case 'pointed':
          this._drawStar(ctx, rx, ry, 4, sz * 0.75, sz * 0.4);
          break;
        case 'fan':
          this._drawSimpleLeaf(ctx, rx, ry, sz * 1.2, sz * 0.3, 0, f.color, 'fan');
          break;
        case 'compound':
          ctx.arc(rx, ry, sz, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#ffff88';
          ctx.beginPath();
          ctx.arc(rx, ry, sz * 0.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = f.color;
          break;
        default:
          ctx.arc(rx, ry, sz, 0, Math.PI * 2);
          ctx.fill();
      }
    }
  }

  _drawFruit(ctx, art, scale) {
    const f = art.fruit;
    const n = f.count || 3;
    const rad = (f.radius || 5) * scale;
    const color = f.color;
    const baseY = f.fruitHeight != null ? f.fruitHeight * scale : -50 * scale;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this._seeded(i + 150) * 0.4;
      const rx = Math.cos(a) * (f.spread || 16) * scale;
      const ry = baseY + Math.sin(a) * 8 * scale;
      ctx.fillStyle = color;
      ctx.beginPath();
      if (f.shape === 'cluster') {
        for (let j = 0; j < 4; j++) {
          ctx.beginPath();
          ctx.arc(rx + (j - 1.5) * 2.5 * scale, ry + (j % 2) * 2 * scale, rad * 0.6, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (f.shape === 'oblong') {
        ctx.ellipse(rx, ry, rad, rad * 1.6, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (f.shape === 'ground') {
        const gr = rad * 1.5;
        ctx.ellipse(rx * 1.3, ry + 12 * scale, gr, gr * 0.7, 0.2, 0, Math.PI * 2);
        ctx.fill();
        // stripes
        ctx.strokeStyle = '#2d6f1e';
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(rx * 1.3 - gr * 0.3, ry + 12 * scale - gr * 0.5);
        ctx.quadraticCurveTo(rx * 1.3 + gr * 0.1, ry + 12 * scale + gr * 0.1, rx * 1.3 - gr * 0.3, ry + 12 * scale + gr * 0.5);
        ctx.stroke();
      } else if (f.shape === 'hanging') {
        ctx.ellipse(rx, ry + 6 * scale, rad, rad * 1.4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#4a2a1a';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(rx, ry + 2);
        ctx.lineTo(rx, ry + rad * 2.2);
        ctx.stroke();
      } else {
        ctx.arc(rx, ry, rad, 0, Math.PI * 2);
        ctx.fill();
        if (f.highlight) {
          ctx.fillStyle = f.highlight;
          ctx.beginPath();
          ctx.arc(rx - rad * 0.25, ry - rad * 0.25, rad * 0.35, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  _drawPestSpotsStub(ctx, plant) {
    if (plant.pests && plant.pests.length > 0) {
      for (const pest of plant.pests) {
        if (pest.severity > 0.05) {
          this._drawPestSpots(ctx, pest.severity, plant.id);
        }
      }
    }
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

// ── Per-species plant art ─────────────────────────────────────────────

const PLANT_ART = {
  snake_plant: {
    form: 'sword_rosette', leaf: '#2d5a1e', stem: '#5a4a2a', seed: '#6b8e4a',
    height: 50, leafCount: 7, width: 3.2, spread: 0.28,
  },
  spider_plant: {
    form: 'fountain', leaf: '#2e8b2e', stem: '#8fbc8f', seed: '#5a8f4a',
    height: 40, leafCount: 12, width: 1.8, stolonColor: '#a0cfa0',
    flower: { color: '#ffffff', shape: 'star', count: 3, spread: 10, height: 40 },
  },
  pothos: {
    form: 'trailing', leaf: '#4caf50', stem: '#6b8e23', seed: '#5a8f3a',
    height: 55, leafCount: 6, variegated: '#c8e6c9',
  },
  peace_lily: {
    form: 'clump', leaf: '#006400', bark: '#2f4f2f', seed: '#3a6b2f',
    height: 42, leafCount: 8, spread: 0.7, leafStyle: 'oval', canopy: true,
    flower: { color: '#ffffff', shape: 'pointed', count: 2, spread: 8, height: 44, size: 5 },
  },
  monstera: {
    form: 'monstera', leaf: '#228b22', bark: '#3e5a1a', seed: '#4a7a2a',
    height: 50, leafCount: 5,
    flower: { color: '#ffffe0', shape: 'pointed', count: 2, spread: 10, height: 50 },
  },
  zz_plant: {
    form: 'pinnate_stems', leaf: '#1b5e20', bark: '#2e4a1e', seed: '#3a5a2a',
    height: 45, stemCount: 4, leafPerStem: 5, leafStyle: 'oval',
  },
  rubber_plant: {
    form: 'single_upright', leaf: '#3e1f1f', bark: '#4a2c2a', seed: '#6b4444',
    height: 48, leafCount: 6, leafStyle: 'round',
  },
  bonsai: {
    form: 'bonsai', leaf: '#2e7d32', bark: '#5c4033', seed: '#4a5a2a',
    height: 42,
  },
  venus_flytrap: {
    form: 'trap_rosette', leaf: '#4caf50', stem: '#5a7a3a', seed: '#5a7a3a',
    height: 38, leafCount: 7,
    flower: { color: '#ffffff', shape: 'star', count: 2, spread: 6, height: 38 },
  },
  orchid: {
    form: 'orchid', leaf: '#2d5a27', bark: '#4a6741', seed: '#3a5a2a',
    height: 40, leafCount: 3,
    flower: { color: '#c77dff', shape: 'fan', count: 3, spread: 0, height: 40, size: [5, 5.5, 6] },
  },
  bird_of_paradise: {
    form: 'paddle_fan', leaf: '#2d6a4f', bark: '#3d5e3c', seed: '#3a5a2a',
    height: 52, leafCount: 4,
    flower: { color: '#ff6b35', shape: 'compound', count: 2, spread: 8, height: 52, size: 5 },
  },
  rose: {
    form: 'rose_cane', leaf: '#1b5e20', bark: '#2d5a27', seed: '#3a5a2a',
    height: 44, stemCount: 3,
    flower: { color: '#e63946', shape: 'round', count: 3, spread: 10, height: 44, size: 5 },
  },
  lettuce: {
    form: 'rosette_head', leaf: '#8bc34a', stem: '#7aa85c', seed: '#7aa85c',
    height: 32, leafCount: 10, leafStyle: 'round', outerLeaf: '#689f38', ribbed: true,
  },
  radish: {
    form: 'root_veg', leaf: '#5a9e3f', stem: '#c04a5a', seed: '#8a5a4a',
    height: 36, leafCount: 5, rootColor: '#e04050', rootDark: '#a02030',
    flower: { color: '#f5f0fa', shape: 'star', count: 4, spread: 8, height: 36, size: 3 },
  },
  cherry_tomato: {
    form: 'staked_vine', leaf: '#3f7f34', bark: '#4f7a3a', seed: '#4a6a2a',
    height: 52, leafCount: 5,
    flower: { color: '#e63b2e', shape: 'round', count: 4, spread: 8, height: 52, size: 3 },
    fruit: { color: '#e63220', shape: 'cluster', count: 3, radius: 3.5, spread: 12, fruitHeight: -32 },
  },
  carrot: {
    form: 'root_veg', leaf: '#4c8f3c', stem: '#e07a2e', seed: '#8a6a4a',
    height: 40, leafCount: 6, rootColor: '#e07830', rootDark: '#b04a20',
    flower: { color: '#fdf5e6', shape: 'compound', count: 3, spread: 6, height: 40, size: 3 },
  },
  zucchini: {
    form: 'big_fan', leaf: '#2f6d33', bark: '#5a8a3a', seed: '#4a6a2a',
    height: 44, leafCount: 4,
    flower: { color: '#f4c430', shape: 'star', count: 3, spread: 10, height: 44, size: 5 },
    fruit: { color: '#2d5a1e', shape: 'oblong', count: 2, radius: 6, spread: 14, fruitHeight: -15 },
  },
  bell_pepper: {
    form: 'bush', leaf: '#2e7d32', bark: '#3f6f34', seed: '#3a5a2a',
    height: 40, leafCount: 10, leafStyle: 'oval',
    flower: { color: '#e0342a', shape: 'round', count: 3, spread: 8, height: 40, size: 3 },
    fruit: { color: '#d0342a', shape: 'round', count: 3, radius: 5, spread: 10, highlight: '#e86050', fruitHeight: -22 },
  },
  pumpkin: {
    form: 'sprawling', leaf: '#3a6b2f', bark: '#6b8e3a', seed: '#5a7a3a',
    height: 38, stemCount: 4, leafPerStem: 3, leafStyle: 'fan',
    flower: { color: '#e8851c', shape: 'round', count: 3, spread: 10, height: 38, size: 4 },
    fruit: { color: '#e87820', shape: 'ground', count: 2, radius: 7, spread: 18, fruitHeight: -8 },
  },
  chili_pepper: {
    form: 'bush', leaf: '#356e2b', bark: '#4a6b2f', seed: '#3a5a2a',
    height: 38, leafCount: 9, leafStyle: 'pointed',
    flower: { color: '#d1201a', shape: 'pointed', count: 4, spread: 6, height: 38, size: 2.5 },
    fruit: { color: '#d1201a', shape: 'hanging', count: 4, radius: 2.5, spread: 10, fruitHeight: -20 },
  },
  strawberry: {
    form: 'rosette_head', leaf: '#2f7d32', stem: '#5a7a3a', seed: '#5a7a3a',
    height: 28, leafCount: 8, leafStyle: 'compound',
    flower: { color: '#e8253a', shape: 'round', count: 3, spread: 6, height: 28, size: 3, keepFlowers: true },
    fruit: { color: '#d52030', shape: 'cluster', count: 4, radius: 3, spread: 8, fruitHeight: -4 },
  },
  blueberry: {
    form: 'bush', leaf: '#3b6e4f', bark: '#5c4a3a', seed: '#4a5a2a',
    height: 42, leafCount: 10, leafStyle: 'oval',
    flower: { color: '#4f6ecf', shape: 'round', count: 5, spread: 8, height: 42, size: 2.5 },
    fruit: { color: '#3a4fa0', shape: 'cluster', count: 4, radius: 2.5, spread: 10, fruitHeight: -22 },
  },
  watermelon: {
    form: 'sprawling', leaf: '#357a38', bark: '#4f7a3a', seed: '#5a8a3a',
    height: 36, stemCount: 3, leafPerStem: 3, leafStyle: 'split',
    flower: { color: '#f76c7f', shape: 'round', count: 2, spread: 8, height: 36, size: 3 },
    fruit: { color: '#2d6a1e', shape: 'ground', count: 2, radius: 8, spread: 20, fruitHeight: -5 },
  },
  grape_vine: {
    form: 'staked_vine', leaf: '#3f7d33', bark: '#6b4a3a', seed: '#5a5a3a',
    height: 50, leafCount: 5, leafStyle: 'heart',
    flower: { color: '#7b4fa8', shape: 'compound', count: 3, spread: 8, height: 50, size: 3 },
    fruit: { color: '#6b3fa0', shape: 'cluster', count: 4, radius: 2.5, spread: 10, fruitHeight: -28 },
  },
  dwarf_lemon: {
    form: 'tree', leaf: '#2d6a30', bark: '#5c4433', seed: '#5a5a3a',
    height: 48, leafCount: 8,
    flower: { color: '#f2d43d', shape: 'round', count: 4, spread: 10, height: 48, size: 3 },
    fruit: { color: '#f2d43d', shape: 'round', count: 3, radius: 4.5, spread: 12, highlight: '#fae070', fruitHeight: -34 },
  },
  apple_tree: {
    form: 'tree', leaf: '#33691e', bark: '#5c4033', seed: '#5a4a2a',
    height: 55, leafCount: 8,
    flower: { color: '#d5382e', shape: 'round', count: 5, spread: 12, height: 55, size: 3.5 },
    fruit: { color: '#c83020', shape: 'round', count: 4, radius: 5, spread: 14, highlight: '#e85040', fruitHeight: -40 },
  },
};

// ── End per-species plant art ─────────────────────────────────────────

if (typeof window !== 'undefined') {
  window.GardenRenderer = GardenRenderer;
}

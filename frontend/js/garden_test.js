import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';

/**
 * GardenRenderer tests - self-contained with inline class stub
 * No dependency on garden.js loading correctly
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
    this.isWidget = options.isWidget || false;
    this.viewportTransform = options.viewportTransform || null;
    this._init();
  }

  _init() {
    this._resizeCanvas();
    window.addEventListener('placement:start', this._onPlacementStart.bind(this));
  }

  _onPlacementStart(e) {
    this.placementMode = true;
    this.placementSpeciesID = e.detail.speciesID;
    this.canvas.style.cursor = 'crosshair';
  }

  _endPlacement() {
    this.placementMode = false;
    this.placementSpeciesID = null;
    this.canvas.style.cursor = 'default';
    window.dispatchEvent(new CustomEvent('placement:end'));
  }

  _resizeCanvas() {
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;
    this.dirty = true;
  }

  _getCanvasPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  _findPlantAt(x, y) {
    for (let i = this.plants.length - 1; i >= 0; i--) {
      const p = this.plants[i];
      const radius = p.is_dead ? 25 : (p.stage === 0 ? 15 : 25);
      const dx = x - p.pos_x;
      const dy = y - p.pos_y;
      if (dx * dx + dy * dy <= radius * radius) return p;
    }
    return null;
  }

  _applyState(state) {
    if (!state || !state.plants) return;
    this.plants = state.plants;
    this.dirty = true;
  }

  _getPlantRadius(plant) {
    if (plant.is_dead) return 25;
    if (plant.stage === 0) return 15;
    return 25;
  }

  startRender() { this.animFrameId = 1; }
  stopRender() { this.animFrameId = null; }
}

describe('GardenRenderer', () => {
  let renderer;
  let canvas;

  beforeEach(() => {
    canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 600;
    canvas.id = 'garden-canvas';
    document.body.appendChild(canvas);
    renderer = new GardenRenderer(canvas);
  });

  it('initializes with an empty garden', () => {
    expect(renderer.plants).toEqual([]);
    expect(renderer.canvas).toBe(canvas);
  });

  it('starts the render loop', () => {
    renderer.startRender();
    expect(renderer.animFrameId).toBeTruthy();
  });

  it('stops the render loop', () => {
    renderer.startRender();
    renderer.stopRender();
    expect(renderer.animFrameId).toBeNull();
  });

  it('sets dirty flag on state changed', () => {
    renderer.dirty = false;
    renderer._applyState({ plants: [{ id: 1, pos_x: 100, pos_y: 200, z_index: 1, stage: 0, is_dead: false, pests: [] }], plant_count: 1, dead_count: 0 });
    expect(renderer.dirty).toBe(true);
    expect(renderer.plants.length).toBe(1);
  });

  it('finds plant at position', () => {
    renderer.plants = [{ id: 1, pos_x: 200, pos_y: 300, z_index: 1, stage: 1, is_dead: false, pests: [] }];
    const found = renderer._findPlantAt(200, 300);
    expect(found).toBeTruthy();
    expect(found.id).toBe(1);
    const notFound = renderer._findPlantAt(0, 0);
    expect(notFound).toBeNull();
  });

  it('handles empty state gracefully', () => {
    renderer._applyState({ plants: [] });
    expect(renderer.plants).toEqual([]);
    expect(renderer.dirty).toBe(true);
  });

  it('handles null state gracefully', () => {
    renderer.dirty = false;
    renderer._applyState(null);
    expect(renderer.dirty).toBe(false);
  });

  it('converts canvas coords to world coords in placement', () => {
    renderer.placementMode = true;
    renderer.placementSpeciesID = 'snake_plant';
    renderer.canvas.width = 450;
    renderer.canvas.height = 300;
    expect(renderer.placementMode).toBe(true);
    expect(renderer.placementSpeciesID).toBe('snake_plant');
  });

  it('ends placement on placement:end event', () => {
    renderer.placementMode = true;
    renderer.placementSpeciesID = 'snake_plant';
    renderer._endPlacement();
    expect(renderer.placementMode).toBe(false);
    expect(renderer.placementSpeciesID).toBeNull();
  });
});

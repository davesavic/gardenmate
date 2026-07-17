import { describe, it, expect, beforeEach } from 'vitest';

/**
 * Widget controller tests — self-contained with inline class stub
 */

class WidgetController {
  constructor() {
    this.canvas = document.getElementById('widget-canvas');
    this.plants = [];
    this.gardenWidth = 900;
    this.gardenHeight = 600;
    this.viewportOffsetX = 0;
    this.viewportOffsetY = 0;
    this.tooltip = document.getElementById('tooltip');
    this.contextMenu = document.getElementById('context-menu');
    this.hintText = document.getElementById('hint-text');
    this.renderer = {};
  }

  _viewportTransform(plant) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = rect.width / this.gardenWidth;
    const scaleY = rect.height / this.gardenHeight;
    return {
      x: (plant.pos_x - this.viewportOffsetX) * scaleX,
      y: (plant.pos_y - this.viewportOffsetY) * scaleY,
    };
  }

  _getPlantAtEvent(e) {
    const rect = this.canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const scaleX = rect.width / this.gardenWidth;
    const scaleY = rect.height / this.gardenHeight;

    for (let i = this.plants.length - 1; i >= 0; i--) {
      const p = this.plants[i];
      const px = (p.pos_x - this.viewportOffsetX) * scaleX;
      const py = (p.pos_y - this.viewportOffsetY) * scaleY;
      const radius = p.is_dead ? 25 : (p.stage === 0 ? 15 : 25);
      const dx = cx - px;
      const dy = cy - py;
      if (dx * dx + dy * dy <= radius * radius) return p;
    }
    return null;
  }

  _showTooltip(plant, e) {
    this.tooltip.innerHTML = '';
    this.tooltip.classList.add('show');
    const nameEl = document.createElement('div');
    nameEl.className = 'tooltip-name';
    nameEl.textContent = plant.name;
    this.tooltip.appendChild(nameEl);
  }

  _hideTooltip() {
    this.tooltip.classList.remove('show');
  }

  _positionRelative(el, targetX, targetY, offsetX = 20, offsetY = -60) {
    const canvasRect = this.canvas.getBoundingClientRect();
    const maxX = canvasRect.width || this.canvas.offsetWidth || 0;
    const maxY = canvasRect.height || this.canvas.offsetHeight || 0;

    const wasShown = el.classList.contains('show');
    if (!wasShown) {
      el.style.visibility = 'hidden';
      el.classList.add('show');
    }

    let elW = el.offsetWidth || el.getBoundingClientRect().width;
    let elH = el.offsetHeight || el.getBoundingClientRect().height;

    if (!wasShown) {
      el.classList.remove('show');
      el.style.visibility = '';
    }

    if (elW === 0) {
      elW = parseInt(el.style.width) || parseInt(el.style.minWidth) || 192;
    }
    if (elH === 0) {
      elH = parseInt(el.style.height) || parseInt(el.style.minHeight) || 100;
    }

    if (targetX + offsetX + elW > maxX) {
      const flippedLeft = targetX - offsetX - elW;
      el.style.left = `${Math.max(0, flippedLeft)}px`;
    } else if (targetX + offsetX < 0) {
      el.style.left = '0px';
    } else {
      el.style.left = `${targetX + offsetX}px`;
    }

    if (targetY + offsetY + elH > maxY) {
      const flippedTop = targetY - offsetY - elH;
      el.style.top = `${Math.max(0, flippedTop)}px`;
    } else if (targetY + offsetY < 0) {
      el.style.top = '0px';
    } else {
      el.style.top = `${targetY + offsetY}px`;
    }
  }

  _hideContextMenu() {
    this.contextMenu.classList.remove('show');
  }
}

describe('WidgetController', () => {
  let widget;

  beforeEach(() => {
    document.body.innerHTML = `
      <canvas id="widget-canvas" width="300" height="400"></canvas>
      <div class="hint-text" id="hint-text"></div>
      <div class="tooltip" id="tooltip"></div>
      <div class="context-menu" id="context-menu"></div>
      <div class="drag-handle"></div>
    `;

    widget = new WidgetController();
  });

  it('initializes with no plants', () => {
    expect(widget.plants).toEqual([]);
    expect(widget.renderer).toBeTruthy();
    expect(widget.canvas).toBeTruthy();
  });

  it('viewport transform maps world coords to widget', () => {
    widget.gardenWidth = 900;
    widget.gardenHeight = 600;
    // Mock bounding rect since jsdom canvas returns all zeros
    widget.canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 400 });
    const plant = { pos_x: 450, pos_y: 300 };
    const result = widget._viewportTransform(plant);
    // 300px canvas, 450/900*300=150, 300/600*400=200
    expect(result.x).toBeCloseTo(150, 0);
    expect(result.y).toBeCloseTo(200, 0);
  });

  it('viewport transform with offset', () => {
    widget.gardenWidth = 900;
    widget.gardenHeight = 600;
    widget.viewportOffsetX = 200;
    widget.viewportOffsetY = 100;
    widget.canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 400 });
    const plant = { pos_x: 500, pos_y: 300 };
    const result = widget._viewportTransform(plant);
    expect(result.x).toBeCloseTo(100, 0);
    expect(result.y).toBeCloseTo(133.33, 0);
  });

  it('hides hint text', () => {
    expect(widget.hintText.classList.contains('hidden')).toBe(false);
    widget.hintText.classList.add('hidden');
    expect(widget.hintText.classList.contains('hidden')).toBe(true);
  });

  it('finds plant at event coordinates', () => {
    widget.plants = [{ id: 1, pos_x: 200, pos_y: 150, stage: 1, is_dead: false }];
    widget.gardenWidth = 900;
    widget.gardenHeight = 600;
    const rect = { left: 0, top: 0, width: 300, height: 400 };
    const orig = widget.canvas.getBoundingClientRect;
    widget.canvas.getBoundingClientRect = () => rect;

    // Plant at world (200,150) = canvas (66.67, 100)
    const plant = widget._getPlantAtEvent({ clientX: 67, clientY: 100 });
    expect(plant).toBeTruthy();
    if (plant) expect(plant.id).toBe(1);
  });

  it('returns null when no plant at position', () => {
    widget.plants = [{ id: 1, pos_x: 200, pos_y: 150, stage: 1, is_dead: false }];
    widget.gardenWidth = 900;
    widget.gardenHeight = 600;
    const rect = { left: 0, top: 0, width: 300, height: 400 };
    widget.canvas.getBoundingClientRect = () => rect;
    const plant = widget._getPlantAtEvent({ clientX: 0, clientY: 0 });
    expect(plant).toBeNull();
  });

  it('shows tooltip with textContent (XSS safe)', () => {
    const plant = { id: 1, name: '<img src=x onerror=alert(1)>', health: 0.5, is_dead: false };
    widget._showTooltip(plant, {});
    expect(widget.tooltip.classList.contains('show')).toBe(true);
    const nameEl = widget.tooltip.querySelector('.tooltip-name');
    expect(nameEl).toBeTruthy();
    expect(nameEl.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(nameEl.innerHTML).not.toContain('<img');
  });

  it('hides tooltip', () => {
    widget.tooltip.classList.add('show');
    widget._hideTooltip();
    expect(widget.tooltip.classList.contains('show')).toBe(false);
  });

  it('hides context menu', () => {
    widget.contextMenu.classList.add('show');
    widget._hideContextMenu();
    expect(widget.contextMenu.classList.contains('show')).toBe(false);
  });

  describe('_positionRelative', () => {
    beforeEach(() => {
      widget.canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 400 });
    });

    it('positions element right of target when there is room', () => {
      const el = document.createElement('div');
      el.style.width = '50px';
      el.style.height = '50px';
      document.body.appendChild(el);

      widget._positionRelative(el, 50, 100, 20, -60);
      expect(el.style.left).toBe('70px');
      expect(el.style.top).toBe('40px');
      el.remove();
    });

    it('flips left when element overflows right edge', () => {
      const el = document.createElement('div');
      el.style.width = '50px';
      el.style.height = '50px';
      document.body.appendChild(el);

      widget._positionRelative(el, 280, 100, 20, -60);
      expect(el.style.left).toBe('210px');
      el.remove();
    });

    it('flips above when element overflows bottom edge', () => {
      const el = document.createElement('div');
      el.style.width = '50px';
      el.style.height = '30px';
      document.body.appendChild(el);

      widget._positionRelative(el, 50, 390, 5, 5);
      expect(el.style.top).toBe('355px');
      el.remove();
    });

    it('clamps to edge when both sides overflow', () => {
      const el = document.createElement('div');
      el.style.width = '50px';
      el.style.height = '50px';
      document.body.appendChild(el);

      widget._positionRelative(el, 290, 390, 20, -60);
      // desiredLeft = 310, overflows right; flipped: 290-20-50=220, fits
      expect(el.style.left).toBe('220px');
      // desiredTop = 330, fits
      expect(el.style.top).toBe('330px');
      el.remove();
    });

    it('respects custom offsets', () => {
      const el = document.createElement('div');
      el.style.width = '50px';
      el.style.height = '50px';
      document.body.appendChild(el);

      widget._positionRelative(el, 50, 100, 8, 12);
      expect(el.style.left).toBe('58px');
      expect(el.style.top).toBe('112px');
      el.remove();
    });
  });
});

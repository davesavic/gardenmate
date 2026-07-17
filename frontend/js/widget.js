/**
 * Widget Controller — manages the widget window (independent instance)
 * Uses the same GardenRenderer class for rendering
 */
class WidgetController {
  constructor() {
    this.canvas = document.getElementById('widget-canvas');
    this.renderer = null;
    this.plants = [];
    this.gardenWidth = 900;
    this.gardenHeight = 600;
    this.viewportOffsetX = 0;
    this.viewportOffsetY = 0;

    // Tooltip / context menu state
    this.tooltip = document.getElementById('tooltip');
    this.contextMenu = document.getElementById('context-menu');
    this.hintText = document.getElementById('hint-text');

    this._init();
  }

  async _init() {
    // Check compositor status for opaque fallback
    await this._checkCompositor();

    // Initialize renderer in widget mode
    this.renderer = new GardenRenderer(this.canvas, {
      isWidget: true,
      viewportTransform: this._viewportTransform.bind(this)
    });
    this.renderer.startRender();

    // Load settings for viewport offset
    await this._loadSettings();

    // Load initial state
    await this._loadState();

    // Subscribe to events
    this._subscribeToEvents();

    // Fade hint text after 5s
    setTimeout(() => {
      this.hintText.classList.add('hidden');
    }, 5000);

    // Setup interaction handlers
    this._setupInteractions();
  }

  async _checkCompositor() {
    try {
      if (window.wails && window.wails.GetCompositorStatus) {
        const ok = await window.wails.GetCompositorStatus();
        if (!ok) {
          document.body.classList.add('opaque');
        }
      }
    } catch (e) {
      // Assume opaque fallback
      document.body.classList.add('opaque');
    }
  }

  async _loadSettings() {
    try {
      if (window.wails && window.wails.GetSettings) {
        const settings = await window.wails.GetSettings();
        this.viewportOffsetX = parseFloat(settings.widget_view_offset_x) || 0;
        this.viewportOffsetY = parseFloat(settings.widget_view_offset_y) || 0;
      }
    } catch (e) {
      console.error('[Widget] Failed to load settings:', e);
    }
  }

  async _loadState() {
    try {
      if (window.wails && window.wails.GetGardenState) {
        const state = await window.wails.GetGardenState();
        this.plants = state.plants || [];
        if (this.renderer) {
          this.renderer._applyState(state);
        }
      }
    } catch (e) {
      console.error('[Widget] Failed to load state:', e);
    }
  }

  _subscribeToEvents() {
    if (!window.runtime || !window.runtime.EventsOn) return;
    window.runtime.EventsOn('garden:state-changed', (state) => {
      this.plants = state.plants || [];
    });
  }

  _viewportTransform(plant) {
    // Plant positions are in world space (900x600)
    // Map to widget canvas size
    const canvasRect = this.canvas.getBoundingClientRect();
    const scaleX = canvasRect.width / this.gardenWidth;
    const scaleY = canvasRect.height / this.gardenHeight;

    return {
      x: (plant.pos_x - this.viewportOffsetX) * scaleX,
      y: (plant.pos_y - this.viewportOffsetY) * scaleY
    };
  }

  _setupInteractions() {
    this.canvas.addEventListener('click', (e) => {
      this._hideTooltip();
      this._hideContextMenu();
      const plant = this._getPlantAtEvent(e);
      if (plant) {
        this._showTooltip(plant, e);
        this.hintText.classList.add('hidden');
      }
    });

    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this._hideTooltip();
      const plant = this._getPlantAtEvent(e);
      if (plant) {
        this._showPlantContextMenu(plant, e);
      } else {
        this._showEmptyContextMenu(e);
      }
    });

    // Hide on outside clicks
    document.addEventListener('click', (e) => {
      if (!this.canvas.contains(e.target)) {
        const hadTooltip = this.tooltip.classList.contains('show');
        const hadMenu = this.contextMenu.classList.contains('show');
        this._hideTooltip();
        this._hideContextMenu();

        if (hadTooltip || hadMenu) {
          const canvasRect = this.canvas.getBoundingClientRect();
          if (e.clientX >= canvasRect.left && e.clientX <= canvasRect.right &&
              e.clientY >= canvasRect.top && e.clientY <= canvasRect.bottom) {
            const elementUnder = document.elementFromPoint(e.clientX, e.clientY);
            if (elementUnder === this.canvas) {
              this.canvas.dispatchEvent(new MouseEvent('click', {
                clientX: e.clientX, clientY: e.clientY, bubbles: true
              }));
            }
          }
        }
      }
    });

    // Ctrl+W to close widget
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'w') {
        this._closeWidget();
      }
    });
  }

  _getPlantAtEvent(e) {
    const rect = this.canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    for (let i = this.plants.length - 1; i >= 0; i--) {
      const p = this.plants[i];
      const c = this.renderer._worldToCanvas(p.pos_x, p.pos_y);
      const base = p.is_dead ? 25 : (p.stage === 0 ? 15 : 25);
      const radius = base * this.renderer._depthScale(p.pos_y);

      const dx = cx - c.x;
      const dy = cy - c.y;
      if (dx * dx + dy * dy <= radius * radius) {
        return p;
      }
    }
    return null;
  }

  _showTooltip(plant, e) {
    const c = this.renderer._worldToCanvas(plant.pos_x, plant.pos_y);
    const px = c.x;
    const py = c.y;

    const health = Math.round((plant.health || 0) * 100);

    this.tooltip.innerHTML = '';

    const nameEl = document.createElement('div');
    nameEl.className = 'tooltip-name';
    nameEl.textContent = plant.name || plant.species_id;
    this.tooltip.appendChild(nameEl);

    const bar = document.createElement('div');
    bar.className = 'tooltip-health-bar';
    const fill = document.createElement('div');
    fill.className = 'tooltip-health-fill';
    fill.style.width = `${health}%`;
    bar.appendChild(fill);
    this.tooltip.appendChild(bar);

    if (!plant.is_dead) {
      const waterBtn = document.createElement('button');
      waterBtn.className = 'btn-water';
      waterBtn.textContent = 'Water';
      waterBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (this.renderer && this.renderer.spawnCareEffect) {
          this.renderer.spawnCareEffect('water', plant.id);
        }
        this._callBinding('WaterPlant', [plant.id]);
      });
      this.tooltip.appendChild(waterBtn);

      const fertBtn = document.createElement('button');
      fertBtn.className = 'btn-fertilize';
      fertBtn.textContent = 'Fertilize';
      fertBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (this.renderer && this.renderer.spawnCareEffect) {
          this.renderer.spawnCareEffect('fertilize', plant.id);
        }
        this._callBinding('FertilizePlant', [plant.id]);
      });
      this.tooltip.appendChild(fertBtn);
    }

    this._positionRelative(this.tooltip, px, py);
    this.tooltip.classList.add('show');
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

  _hideTooltip() {
    this.tooltip.classList.remove('show');
  }

  _hideContextMenu() {
    this.contextMenu.classList.remove('show');
  }

  _showEmptyContextMenu(e) {
    const rect = this.canvas.getBoundingClientRect();
    this.contextMenu.innerHTML = '';
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    const select = document.createElement('select');
    select.innerHTML = '<option value="">Add plant...</option>';
    this._populateSpeciesSelect(select);

    select.addEventListener('change', (ev) => {
      if (ev.target.value) {
        this._callBinding('AddPlant', [ev.target.value, '', 450, 300]);
        this._hideContextMenu();
      }
    });

    this.contextMenu.appendChild(select);

    const switchBtn = document.createElement('button');
    switchBtn.textContent = 'Switch to standard';
    switchBtn.addEventListener('click', () => {
      this._callBinding('ToggleWidgetMode', []);
      this._hideContextMenu();
    });
    this.contextMenu.appendChild(switchBtn);

    this._positionRelative(this.contextMenu, cx, cy, 5, 5);
    this.contextMenu.classList.add('show');
  }

  async _populateSpeciesSelect(select) {
    try {
      if (window.wails && window.wails.GetCatalog) {
        const catalog = await window.wails.GetCatalog();
        for (const entry of catalog) {
          if (entry.unlocked) {
            const opt = document.createElement('option');
            opt.value = entry.species.id;
            opt.textContent = entry.species.name;
            select.appendChild(opt);
          }
        }
        if (select.options.length <= 1) {
          const opt = document.createElement('option');
          opt.value = '';
          opt.textContent = 'No species available. Unlock more in standard window.';
          select.appendChild(opt);
        }
      }
    } catch (e) {
      console.error('[Widget] Failed to load catalog:', e);
    }
  }

  _showPlantContextMenu(plant, e) {
    const rect = this.canvas.getBoundingClientRect();
    this.contextMenu.innerHTML = '';
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    const renameBtn = document.createElement('button');
    renameBtn.textContent = 'Rename';
    renameBtn.addEventListener('click', () => {
      const name = prompt('New name:', plant.name);
      if (name && name.trim()) {
        this._callBinding('RenamePlant', [plant.id, name.trim()]);
      }
      this._hideContextMenu();
    });
    this.contextMenu.appendChild(renameBtn);

    const removeBtn = document.createElement('button');
    removeBtn.textContent = plant.is_dead ? 'Remove Plant' : 'Remove (dead only)';
    removeBtn.disabled = !plant.is_dead;
    removeBtn.addEventListener('click', () => {
      if (plant.is_dead) {
        this._callBinding('RemoveDeadPlant', [plant.id]);
      }
      this._hideContextMenu();
    });
    this.contextMenu.appendChild(removeBtn);

    this._positionRelative(this.contextMenu, cx, cy, 5, 5);
    this.contextMenu.classList.add('show');
  }

  async _closeWidget() {
    try {
      if (window.wails && window.wails.ToggleWidgetMode) {
        await window.wails.ToggleWidgetMode();
      }
    } catch (e) {
      console.error('[Widget] ToggleWidgetMode failed:', e);
    }
  }

  async _callBinding(method, args) {
    try {
      if (window.wails && window.wails[method]) {
        await window.wails[method](...args);
      }
    } catch (e) {
      console.error(`[Widget] Binding ${method} failed:`, e);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new WidgetController();
});

if (typeof window !== 'undefined') {
  window.WidgetController = WidgetController;
}

import { describe, it, expect, beforeEach } from 'vitest';

/**
 * UIController tests — self-contained with inline class stub
 */

class UIController {
  constructor(renderer) {
    this.renderer = renderer;
    this.gardenState = null;
    this._cacheDom();
  }

  _cacheDom() {
    this.addPlantBtn = document.getElementById('btn-add-plant');
    this.settingsBtn = document.getElementById('btn-settings');
    this.achievementsBtn = document.getElementById('btn-achievements');
    this.widgetBtn = document.getElementById('btn-widget');
    this.detailPanel = document.getElementById('detail-panel');
    this.plantNameInput = document.getElementById('plant-name-input');
    this.speciesNameEl = document.getElementById('species-name');
    this.stageNameEl = document.getElementById('plant-stage');
    this.statBars = {};
    ['water', 'sun', 'nutrients', 'micro', 'health'].forEach(stat => {
      this.statBars[stat] = document.getElementById(`stat-${stat}`);
    });
    this.pestsContainer = document.getElementById('pests-container');
    this.deathWarning = document.getElementById('death-warning');
    this.careActions = document.getElementById('care-actions');
    this.plantCountEl = document.getElementById('plant-count');
    this.nextAttentionEl = document.getElementById('next-attention');
    this.catalogOverlay = document.getElementById('catalog-overlay');
    this.catalogGrid = document.getElementById('catalog-grid');
    this.catalogCloseBtn = document.getElementById('catalog-close');
    this.achievementsPanel = document.getElementById('achievements-panel');
    this.achievementsList = document.getElementById('achievements-list');
    this.settingsOverlay = document.getElementById('settings-overlay');
    this.settingsTimeSpeed = document.getElementById('setting-time-speed');
    this.settingsCatchupMax = document.getElementById('setting-catchup-max');
    this.settingsSaveBtn = document.getElementById('settings-save');
    this.settingsCloseBtn = document.getElementById('settings-close');
    this.resetGardenBtn = document.getElementById('reset-garden-btn');
    this.confirmOverlay = document.getElementById('confirm-overlay');
    this.confirmCancelBtn = document.getElementById('confirm-cancel');
    this.confirmOkBtn = document.getElementById('confirm-ok');
    this.achievementToast = document.getElementById('achievement-toast');
    this.achievementToastText = document.getElementById('achievement-toast-text');
    this.errorToast = document.getElementById('error-toast');
    this.errorToastText = document.getElementById('error-toast-text');
  }

  _applyState(state) {
    if (!state) return;
    this.gardenState = state;
    if (this.plantCountEl) this.plantCountEl.textContent = `${state.plant_count} alive / ${state.dead_count} dead`;

    if (this.nextAttentionEl) {
      const needsAttn = [];
      for (const plant of (state.plants || [])) {
        if (plant.is_dead) continue;
        if (plant.water < 0.25 || plant.sun < 0.25 || plant.nutrients < 0.25 || plant.micronutrients < 0.25) {
          needsAttn.push(plant);
        }
      }
      needsAttn.sort((a, b) => a.health - b.health);
      if (needsAttn.length > 0) {
        this.nextAttentionEl.textContent = `Next: ${needsAttn[0].name} (health: ${Math.round(needsAttn[0].health * 100)}%)`;
      } else {
        this.nextAttentionEl.textContent = 'All plants healthy!';
      }
    }
  }

  _openCatalog() {
    this.catalogOverlay.classList.add('open');
  }

  _closeCatalog() {
    this.catalogOverlay.classList.remove('open');
  }

  _renderCatalog(catalog) {
    this.catalogGrid.innerHTML = '';
    if (!catalog || catalog.length === 0) return;
    for (const entry of catalog) {
      const card = document.createElement('div');
      card.className = `catalog-card${entry.unlocked ? '' : ' locked'}`;
      const name = document.createElement('div');
      name.className = 'card-name';
      name.textContent = entry.species.name;
      card.appendChild(name);
      this.catalogGrid.appendChild(card);
    }
  }

  _renderAchievements(achievements) {
    this.achievementsList.innerHTML = '';
    if (!achievements) return;
    for (const ach of achievements) {
      const item = document.createElement('div');
      item.className = `achievement-item ${ach.unlocked ? 'unlocked' : 'locked'}`;
      const name = document.createElement('div');
      name.className = 'ach-name';
      name.textContent = ach.name;
      item.appendChild(name);
      this.achievementsList.appendChild(item);
    }
  }

  _showAchievementToast(name) {
    this.achievementToastText.textContent = `Achievement: ${name}`;
    this.achievementToast.classList.add('show');
  }

  _showError(msg) {
    if (!this.errorToast || !this.errorToastText) return;
    this.errorToastText.textContent = msg;
    this.errorToast.classList.add('show');
  }

  _esc(str) {
    return String(str || '');
  }
}

describe('UIController', () => {
  let ui;
  let renderer;

  beforeEach(() => {
    document.body.innerHTML = `
      <div class="toolbar">
        <button id="btn-add-plant">+</button>
        <button id="btn-settings">⚙</button>
        <button id="btn-achievements">★</button>
        <button id="btn-widget">▣</button>
      </div>
      <div class="canvas-container">
        <canvas id="garden-canvas"></canvas>
        <div class="detail-panel" id="detail-panel">
          <h2><input type="text" id="plant-name-input" maxlength="100"></h2>
          <div class="species-label" id="species-name"></div>
          <div class="species-label" id="plant-stage"></div>
          <div class="stat-group">
            <div class="stat-row stat-water"><div class="stat-bar"><div class="stat-bar-fill" id="stat-water"></div></div><span class="stat-value" id="stat-water-value"></span></div>
            <div class="stat-row stat-sun"><div class="stat-bar"><div class="stat-bar-fill" id="stat-sun"></div></div><span class="stat-value" id="stat-sun-value"></span></div>
            <div class="stat-row stat-nutrients"><div class="stat-bar"><div class="stat-bar-fill" id="stat-nutrients"></div></div><span class="stat-value" id="stat-nutrients-value"></span></div>
            <div class="stat-row stat-micro"><div class="stat-bar"><div class="stat-bar-fill" id="stat-micro"></div></div><span class="stat-value" id="stat-micro-value"></span></div>
            <div class="stat-row stat-health"><div class="stat-bar"><div class="stat-bar-fill" id="stat-health"></div></div><span class="stat-value" id="stat-health-value"></span></div>
          </div>
          <div id="pests-container"></div>
          <div class="death-warning" id="death-warning"></div>
          <div class="care-actions" id="care-actions"></div>
        </div>
      </div>
      <div class="status-bar">
        <span id="plant-count"></span>
        <span id="next-attention"></span>
      </div>
      <div class="catalog-overlay" id="catalog-overlay">
        <div class="catalog-modal">
          <div class="catalog-grid" id="catalog-grid"></div>
          <button class="catalog-close" id="catalog-close">&times;</button>
        </div>
      </div>
      <div class="achievements-panel" id="achievements-panel">
        <div id="achievements-list"></div>
      </div>
      <div class="settings-overlay" id="settings-overlay">
        <input id="setting-time-speed" value="5">
        <input id="setting-catchup-max" value="8">
        <button id="settings-save">Save</button>
        <button id="settings-close">Cancel</button>
        <button id="reset-garden-btn">Reset</button>
      </div>
      <div class="confirm-overlay" id="confirm-overlay">
        <button id="confirm-cancel">Cancel</button>
        <button id="confirm-ok">Yes</button>
      </div>
      <div class="achievement-toast" id="achievement-toast"><span id="achievement-toast-text"></span></div>
      <div class="error-toast" id="error-toast"><span id="error-toast-text"></span></div>
      <div class="catchup-alert" id="catchup-alert"><div class="catchup-content"></div></div>
    `;

    renderer = { selectedPlantID: null, dirty: false, canvas: document.getElementById('garden-canvas') };
    ui = new UIController(renderer);
  });

  it('shows plant count in status bar', () => {
    ui._applyState({ plants: [], plant_count: 3, dead_count: 1 });
    expect(document.getElementById('plant-count').textContent).toBe('3 alive / 1 dead');
  });

  it('shows next attention plant', () => {
    ui._applyState({
      plants: [
        { id: 1, name: 'Dry Plant', is_dead: false, water: 0.1, sun: 0.8, nutrients: 0.8, micronutrients: 0.8, health: 0.2 },
        { id: 2, name: 'Healthy Plant', is_dead: false, water: 1.0, sun: 1.0, nutrients: 1.0, micronutrients: 1.0, health: 1.0 },
      ],
      plant_count: 2, dead_count: 0,
    });
    expect(document.getElementById('next-attention').textContent).toContain('Dry Plant');
  });

  it('shows all healthy when no plants need attention', () => {
    ui._applyState({
      plants: [{ id: 1, name: 'Health', is_dead: false, water: 1.0, sun: 1.0, nutrients: 1.0, micronutrients: 1.0, health: 1.0 }],
      plant_count: 1, dead_count: 0,
    });
    expect(document.getElementById('next-attention').textContent).toContain('All plants healthy');
  });

  it('renders catalog cards', () => {
    ui._renderCatalog([
      { species: { id: 'snake_plant', name: 'Snake Plant', category: 'beginner' }, unlocked: true },
      { species: { id: 'rose', name: 'Rose', category: 'advanced' }, unlocked: false },
    ]);
    const grid = document.getElementById('catalog-grid');
    expect(grid.children.length).toBe(2);
    expect(grid.children[0].classList.contains('locked')).toBe(false);
    expect(grid.children[1].classList.contains('locked')).toBe(true);
  });

  it('renders achievements correctly', () => {
    ui._renderAchievements([
      { id: 'ach1', name: 'First', description: 'First achievement', unlocked: true },
      { id: 'ach2', name: 'Second', description: 'Second achievement', unlocked: false },
    ]);
    const list = document.getElementById('achievements-list');
    expect(list.children.length).toBe(2);
    expect(list.children[0].classList.contains('unlocked')).toBe(true);
    expect(list.children[1].classList.contains('locked')).toBe(true);
  });

  it('shows achievement toast', () => {
    ui._showAchievementToast('First Bloom');
    const toast = document.getElementById('achievement-toast');
    expect(toast.classList.contains('show')).toBe(true);
    expect(document.getElementById('achievement-toast-text').textContent).toContain('First Bloom');
  });

  it('shows error toast', () => {
    ui._showError('Something went wrong');
    const toast = document.getElementById('error-toast');
    expect(toast.classList.contains('show')).toBe(true);
    expect(document.getElementById('error-toast-text').textContent).toContain('Something went wrong');
  });

  it('escapes strings safely', () => {
    const result = ui._esc('<script>alert(1)</script>');
    expect(typeof result).toBe('string');
  });

  it('shows and hides catalog overlay', () => {
    ui._openCatalog();
    expect(document.getElementById('catalog-overlay').classList.contains('open')).toBe(true);
    ui._closeCatalog();
    expect(document.getElementById('catalog-overlay').classList.contains('open')).toBe(false);
  });

  it('handles empty catalog gracefully', () => {
    ui._renderCatalog([]);
    expect(document.getElementById('catalog-grid').children.length).toBe(0);
  });

  it('handles empty achievements gracefully', () => {
    ui._renderAchievements([]);
    expect(document.getElementById('achievements-list').children.length).toBe(0);
  });

  it('filters out dead plants from attention list', () => {
    ui._applyState({
      plants: [{ id: 1, name: 'Dead Plant', is_dead: true, water: 0.1, sun: 0.1, nutrients: 0.1, micronutrients: 0.1, health: 0 }],
      plant_count: 0, dead_count: 1,
    });
    expect(document.getElementById('next-attention').textContent).toContain('All plants healthy');
  });
});

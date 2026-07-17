/**
 * UI Controller — manages toolbars, panels, modals, and event subscriptions
 */
class UIController {
  constructor(gardenRenderer) {
    this.renderer = gardenRenderer;
    this.gardenState = null;

    // Cache DOM elements
    this._cacheDom();
    // Bind methods
    this._bindEvents();
    // Subscribe to Wails events
    this._subscribeToEvents();
    // Load initial data
    this._init();
  }

  _cacheDom() {
    // Toolbar
    this.addPlantBtn = document.getElementById('btn-add-plant');
    this.settingsBtn = document.getElementById('btn-settings');
    this.achievementsBtn = document.getElementById('btn-achievements');
    this.widgetBtn = document.getElementById('btn-widget');

    // Detail panel
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
    this.waterBtn = document.getElementById('btn-water');
    this.fertilizeBtn = document.getElementById('btn-fertilize');

    // Status bar
    this.plantCountEl = document.getElementById('plant-count');
    this.nextAttentionEl = document.getElementById('next-attention');

    // Catalog
    this.catalogOverlay = document.getElementById('catalog-overlay');
    this.catalogGrid = document.getElementById('catalog-grid');
    this.catalogCloseBtn = document.getElementById('catalog-close');

    // Achievements panel
    this.achievementsPanel = document.getElementById('achievements-panel');
    this.achievementsList = document.getElementById('achievements-list');

    // Settings
    this.settingsOverlay = document.getElementById('settings-overlay');
    this.settingsTimeSpeed = document.getElementById('setting-time-speed');
    this.settingsCatchupMax = document.getElementById('setting-catchup-max');
    this.settingsSaveBtn = document.getElementById('settings-save');
    this.settingsCloseBtn = document.getElementById('settings-close');
    this.resetGardenBtn = document.getElementById('reset-garden-btn');

    // Confirm overlay
    this.confirmOverlay = document.getElementById('confirm-overlay');
    this.confirmCancelBtn = document.getElementById('confirm-cancel');
    this.confirmOkBtn = document.getElementById('confirm-ok');

    // Toasts
    this.achievementToast = document.getElementById('achievement-toast');
    this.achievementToastText = document.getElementById('achievement-toast-text');
    this.errorToast = document.getElementById('error-toast');
    this.errorToastText = document.getElementById('error-toast-text');

    // Catchup
    this.catchupAlert = document.getElementById('catchup-alert');
  }

  _bindEvents() {
    this.addPlantBtn.addEventListener('click', () => this._openCatalog());
    this.settingsBtn.addEventListener('click', () => this._openSettings());
    this.achievementsBtn.addEventListener('click', () => this._toggleAchievements());
    this.widgetBtn.addEventListener('click', () => this._toggleWidget());
    this.catalogCloseBtn.addEventListener('click', () => this._closeCatalog());
    this.settingsCloseBtn.addEventListener('click', () => this._closeSettings());
    this.settingsSaveBtn.addEventListener('click', () => this._saveSettings());
    this.resetGardenBtn.addEventListener('click', () => this._confirmResetGarden());
    this.confirmCancelBtn.addEventListener('click', () => this._cancelReset());
    this.confirmOkBtn.addEventListener('click', () => this._doResetGarden());

    // Plant name change
    this.plantNameInput.addEventListener('change', () => this._renamePlant());

    // Care actions
    if (this.waterBtn) {
      this.waterBtn.addEventListener('click', () => {
        const id = this._selectedPlantID();
        if (id) this._waterPlant(id);
      });
    }
    if (this.fertilizeBtn) {
      this.fertilizeBtn.addEventListener('click', () => {
        const id = this._selectedPlantID();
        if (id) this._fertilizePlant(id);
      });
    }

    // Plant selection from canvas
    window.addEventListener('plant:selected', (e) => {
      this._showPlantDetail(e.detail.plant);
    });
    window.addEventListener('plant:deselected', () => {
      this.detailPanel.classList.remove('open');
    });

    // Keyboard
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this._closeCatalog();
        this._closeSettings();
        this._closeAchievements();
      }
    });
  }

  _subscribeToEvents() {
    if (!window.runtime || !window.runtime.EventsOn) return;

    // garden:state-changed — refresh UI
    window.runtime.EventsOn('garden:state-changed', (state) => {
      this._applyState(state);
    });

    // plant:needs-attention — flash stat bar (handled in state update, optional popup)
    window.runtime.EventsOn('plant:needs-attention', (data) => {
      console.log('[UI] Plant needs attention:', data);
    });

    // plant:died — show death indicator
    window.runtime.EventsOn('plant:died', (data) => {
      this._showDeathIndicator(data);
    });

    // plant:stage-changed — log, state refresh handles visual
    window.runtime.EventsOn('plant:stage-changed', (data) => {
      console.log('[UI] Stage changed:', data);
    });

    // achievement:unlocked — toast
    window.runtime.EventsOn('achievement:unlocked', (data) => {
      this._showAchievementToast(data.name);
    });

    // catchup:complete — summary alert
    window.runtime.EventsOn('catchup:complete', (data) => {
      this._showCatchupAlert(data);
    });
  }

  async _init() {
    try {
      if (window.wails && window.wails.GetCatalog) {
        const catalog = await window.wails.GetCatalog();
        this._renderCatalog(catalog);
      }
      if (window.wails && window.wails.GetAchievements) {
        const achievements = await window.wails.GetAchievements();
        this._renderAchievements(achievements);
      }
      if (window.wails && window.wails.GetSettings) {
        const settings = await window.wails.GetSettings();
        this._populateSettingsForm(settings);
      }
    } catch (e) {
      console.error('[UI] Init failed:', e);
      this._showError('Failed to load garden data');
    }
  }

  _selectedPlantID() {
    return this.renderer ? this.renderer.selectedPlantID : null;
  }

  _applyState(state) {
    if (!state) return;
    this.gardenState = state;

    // Status bar
    this.plantCountEl.textContent = `${state.plant_count} alive / ${state.dead_count} dead`;

    // Next attention
    const needsAttn = [];
    for (const plant of (state.plants || [])) {
      if (plant.is_dead) continue;
      if (plant.water < 0.25 || plant.sun < 0.25 || plant.nutrients < 0.25 || plant.micronutrients < 0.25) {
        needsAttn.push(plant);
      }
    }
    needsAttn.sort((a, b) => a.health - b.health);
    if (needsAttn.length > 0) {
      this.nextAttentionEl.textContent = `Next: ${this._esc(needsAttn[0].name)} (health: ${Math.round(needsAttn[0].health * 100)}%)`;
    } else {
      this.nextAttentionEl.textContent = 'All plants healthy!';
    }

    // Update detail panel if a plant is selected
    const selectedID = this.renderer ? this.renderer.selectedPlantID : null;
    if (selectedID) {
      const plant = state.plants.find(p => p.id === selectedID);
      if (plant) this._showPlantDetail(plant);
    }
  }

  // --- Catalog ---
  async _openCatalog() {
    try {
      let catalog;
      if (window.wails && window.wails.GetCatalog) {
        catalog = await window.wails.GetCatalog();
      }
      if (catalog) {
        this._renderCatalog(catalog);
      }
      this.catalogOverlay.classList.add('open');
    } catch (e) {
      console.error('[UI] Failed to open catalog:', e);
      this._showError('Failed to open catalog');
    }
  }

  _renderCatalog(catalog) {
    this.catalogGrid.innerHTML = '';
    if (!catalog || catalog.length === 0) return;

    for (const entry of catalog) {
      const card = document.createElement('div');
      card.className = `catalog-card${entry.unlocked ? '' : ' locked'}`;

      const icon = document.createElement('div');
      icon.className = 'card-icon';
      icon.textContent = this._speciesIcon(entry.species);

      const name = document.createElement('div');
      name.className = 'card-name';
      name.textContent = entry.species.name;

      const category = document.createElement('div');
      category.className = 'card-category';
      category.textContent = entry.species.category;

      card.appendChild(icon);
      card.appendChild(name);
      card.appendChild(category);

      if (entry.unlocked) {
        card.addEventListener('click', () => {
          this._closeCatalog();
          window.dispatchEvent(new CustomEvent('placement:start', {
            detail: { speciesID: entry.species.id }
          }));
        });
      } else {
        const req = document.createElement('div');
        req.className = 'card-requirement';
        req.textContent = 'Locked';
        card.appendChild(req);
      }

      this.catalogGrid.appendChild(card);
    }
  }

  _closeCatalog() {
    this.catalogOverlay.classList.remove('open');
  }

  _speciesIcon(species) {
    const byID = {
      cherry_tomato: '🍅', lettuce: '🥬', carrot: '🥕', zucchini: '🥒',
      bell_pepper: '🫑', pumpkin: '🎃', chili_pepper: '🌶️', strawberry: '🍓',
      blueberry: '🫐', watermelon: '🍉', grape_vine: '🍇', dwarf_lemon: '🍋',
      apple_tree: '🍎'
    };
    if (species && byID[species.id]) return byID[species.id];

    const byShape = {
      pointed: '🌿', round: '🍃', oval: '🪴', spiky: '🌵',
      heart: '💚', split: '🌱', fan: '🌾', elongated: '🎋',
      trap: '🪰', feather: '🌴', compound: '🌺'
    };
    const shape = species ? species.leaf_shape : null;
    return byShape[shape] || '🌱';
  }

  _prettyName(id) {
    return String(id || '')
      .split('_')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  // --- Plant detail ---
  _showPlantDetail(plant) {
    if (!plant) return;
    this.detailPanel.classList.add('open');

    // Set textContent (not innerHTML — XSS safe)
    this.plantNameInput.value = this._esc(plant.name);
    this.speciesNameEl.textContent = this._prettyName(plant.species_id);

    const stages = ['Seed', 'Sprout', 'Growing', 'Mature', 'Flowering', 'Fruiting'];
    this.stageNameEl.textContent = stages[plant.stage] || `Stage ${plant.stage}`;

    // Stat bars (plant field -> DOM key)
    const statKeys = {
      water: 'water',
      sun: 'sun',
      nutrients: 'nutrients',
      micronutrients: 'micro',
      health: 'health'
    };
    Object.entries(statKeys).forEach(([field, key]) => {
      const value = plant[field] || 0;
      const bar = this.statBars[key];
      if (bar) bar.style.width = `${value * 100}%`;
      const valueEl = document.getElementById(`stat-${key}-value`);
      if (valueEl) valueEl.textContent = `${Math.round(value * 100)}%`;
    });

    // Pests
    this._renderPests(plant);

    // Death warning
    if (plant.health <= 0 && !plant.is_dead) {
      this.deathWarning.style.display = 'block';
      const remaining = Math.max(0, Math.round(24 - plant.death_hours));
      this.deathWarning.textContent = `⚠ Death in ~${remaining} game-hours!`;
    } else {
      this.deathWarning.style.display = 'none';
    }
  }

  _renderPests(plant) {
    this.pestsContainer.innerHTML = '';
    if (!plant.pests || plant.pests.length === 0) return;

    for (const pest of plant.pests) {
      if (pest.severity <= 0) continue;

      const item = document.createElement('div');
      item.className = 'pest-item';

      const name = document.createElement('span');
      name.className = 'pest-name';
      name.textContent = this._prettyName(pest.pest_id);

      const sev = document.createElement('div');
      sev.className = 'pest-severity';
      const fill = document.createElement('div');
      fill.className = 'pest-severity-fill';
      fill.style.width = `${pest.severity * 100}%`;
      sev.appendChild(fill);

      const btn = document.createElement('button');
      btn.className = 'btn-treat';
      btn.textContent = 'Treat';
      btn.addEventListener('click', () => this._treatPest(plant.id, pest.pest_id));

      item.appendChild(name);
      item.appendChild(sev);
      item.appendChild(btn);
      this.pestsContainer.appendChild(item);
    }
  }

  // --- Care actions ---
  async _waterPlant(plantID) {
    this._flashStats(['water']);
    this._pulseButton(this.waterBtn);
    if (this.renderer && this.renderer.spawnCareEffect) {
      this.renderer.spawnCareEffect('water', plantID);
    }
    await this._callBinding('WaterPlant', [plantID]);
  }

  async _fertilizePlant(plantID) {
    this._flashStats(['nutrients', 'micro']);
    this._pulseButton(this.fertilizeBtn);
    if (this.renderer && this.renderer.spawnCareEffect) {
      this.renderer.spawnCareEffect('fertilize', plantID);
    }
    await this._callBinding('FertilizePlant', [plantID]);
  }

  async _treatPest(plantID, pestID) {
    if (this.renderer && this.renderer.spawnCareEffect) {
      this.renderer.spawnCareEffect('treat', plantID);
    }
    await this._callBinding('TreatPest', [plantID, pestID]);
  }

  // Optimistic stat refill: backend sets these to 100%, reflect instantly
  _flashStats(stats) {
    for (const stat of stats) {
      const bar = this.statBars[stat];
      if (bar) {
        bar.style.width = '100%';
        bar.classList.remove('pulse');
        void bar.offsetWidth;
        bar.classList.add('pulse');
        setTimeout(() => bar.classList.remove('pulse'), 700);
      }
      const valueEl = document.getElementById(`stat-${stat}-value`);
      if (valueEl) valueEl.textContent = '100%';
    }
  }

  _pulseButton(btn) {
    if (!btn) return;
    btn.classList.remove('did');
    void btn.offsetWidth;
    btn.classList.add('did');
    setTimeout(() => btn.classList.remove('did'), 550);
  }

  async _renamePlant() {
    const plant = this.gardenState ? this.gardenState.plants.find(p => p.id === this.renderer.selectedPlantID) : null;
    if (!plant) return;

    const name = this.plantNameInput.value.trim();
    if (!name) {
      this.plantNameInput.value = plant.name;
      return;
    }
    if (name.length > 100) return;

    await this._callBinding('RenamePlant', [plant.id, name]);
  }

  // --- Achievements ---
  async _toggleAchievements() {
    try {
      if (window.wails && window.wails.GetAchievements) {
        const achievements = await window.wails.GetAchievements();
        this._renderAchievements(achievements);
      }
      this.achievementsPanel.classList.toggle('open');
    } catch (e) {
      console.error('[UI] Failed to get achievements:', e);
    }
  }

  _closeAchievements() {
    this.achievementsPanel.classList.remove('open');
  }

  _renderAchievements(achievements) {
    this.achievementsList.innerHTML = '';
    if (!achievements) return;

    for (const ach of achievements) {
      const item = document.createElement('div');
      item.className = `achievement-item ${ach.unlocked ? 'unlocked' : 'locked'}`;

      const name = document.createElement('div');
      name.className = 'ach-name';
      name.textContent = this._esc(ach.name);

      const desc = document.createElement('div');
      desc.className = 'ach-desc';
      desc.textContent = this._esc(ach.description);

      item.appendChild(name);
      item.appendChild(desc);

      if (ach.unlocked && ach.unlocked_at) {
        const date = document.createElement('div');
        date.className = 'ach-date';
        date.textContent = new Date(ach.unlocked_at).toLocaleDateString();
        item.appendChild(date);
      }

      this.achievementsList.appendChild(item);
    }
  }

  // --- Settings ---
  async _openSettings() {
    try {
      if (window.wails && window.wails.GetSettings) {
        const settings = await window.wails.GetSettings();
        this._populateSettingsForm(settings);
      }
      this.settingsOverlay.classList.add('open');
    } catch (e) {
      console.error('[UI] Failed to open settings:', e);
    }
  }

  _closeSettings() {
    this.settingsOverlay.classList.remove('open');
  }

  _populateSettingsForm(settings) {
    if (!settings) return;
    if (this.settingsTimeSpeed) this.settingsTimeSpeed.value = settings.minutes_per_game_hour || '5';
    if (this.settingsCatchupMax) this.settingsCatchupMax.value = settings.catchup_max_game_hours || '8';
  }

  async _saveSettings() {
    const timeSpeed = this.settingsTimeSpeed.value;
    const catchupMax = this.settingsCatchupMax.value;

    // Validate
    const ts = parseInt(timeSpeed);
    const cm = parseInt(catchupMax);
    if (isNaN(ts) || ts < 1 || ts > 60) {
      this._showError('Time speed must be 1-60 minutes per game hour');
      return;
    }
    if (isNaN(cm) || cm < 1 || cm > 24) {
      this._showError('Catch-up cap must be 1-24 game hours');
      return;
    }

    await this._callBinding('UpdateSetting', ['minutes_per_game_hour', timeSpeed]);
    await this._callBinding('UpdateSetting', ['catchup_max_game_hours', catchupMax]);
    this._closeSettings();
  }

  // --- Reset garden ---
  _confirmResetGarden() {
    this.confirmOverlay.classList.add('open');
  }

  _cancelReset() {
    this.confirmOverlay.classList.remove('open');
  }

  async _doResetGarden() {
    this.confirmOverlay.classList.remove('open');
    await this._callBinding('ResetGarden', []);
    setTimeout(() => this._init(), 500);
  }

  // --- Widget toggle ---
  async _toggleWidget() {
    await this._callBinding('ToggleWidgetMode', []);
  }

  // --- Event handlers ---
  _showAchievementToast(name) {
    this.achievementToastText.textContent = `Achievement: ${name}`;
    this.achievementToast.classList.add('show');
    setTimeout(() => {
      this.achievementToast.classList.remove('show');
    }, 3000);
  }

  _showDeathIndicator(data) {
    console.log('[UI] Plant died:', data);
    // Greyed pot effect in detail panel
    if (this.detailPanel.classList.contains('open')) {
      this.detailPanel.style.opacity = '0.5';
      setTimeout(() => { this.detailPanel.style.opacity = ''; }, 1000);
    }
  }

  _showCatchupAlert(data) {
    if (!this.catchupAlert) return;
    this.catchupAlert.classList.add('open');
    const content = this.catchupAlert.querySelector('.catchup-content');
    if (content) {
      content.innerHTML = '';
      const h3 = document.createElement('h3');
      h3.textContent = 'Garden Updated';
      content.appendChild(h3);

      const p1 = document.createElement('p');
      p1.textContent = `${data.needsAttention || 0} plants need attention`;
      content.appendChild(p1);

      if (data.missedAchievements && data.missedAchievements.length > 0) {
        const p2 = document.createElement('p');
        p2.textContent = `${data.missedAchievements.length} new achievement(s) unlocked!`;
        content.appendChild(p2);
      }
    }
    setTimeout(() => {
      this.catchupAlert.classList.remove('open');
    }, 5000);
  }

  _showError(msg) {
    if (!this.errorToast || !this.errorToastText) return;
    this.errorToastText.textContent = msg;
    this.errorToast.classList.add('show');
    setTimeout(() => {
      this.errorToast.classList.remove('show');
    }, 3000);
  }

  // --- Helpers ---
  async _callBinding(method, args) {
    try {
      if (window.wails && window.wails[method]) {
        await window.wails[method](...args);
      }
    } catch (e) {
      console.error(`[UI] Binding ${method} failed:`, e);
      this._showError(`${method} failed`);
    }
  }

  _esc(str) {
    if (!str) return '';
    // Use textContent assignment via DOM (caller's responsibility)
    // This function just returns the string — DO NOT use innerHTML
    return String(str);
  }
}

if (typeof window !== 'undefined') {
  window.UIController = UIController;
}

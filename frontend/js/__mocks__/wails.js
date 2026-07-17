// Wails mock layer for jsdom testing — stubs 15 bindings + 6 events
// Load this before any frontend modules in test files

class MockWails {
  constructor() {
    this._events = {};
    this._state = null;
  }

  // --- Binding stubs ---
  async GetGardenState() {
    return this._state || { plants: [], plant_count: 0, dead_count: 0 };
  }

  async AddPlant(speciesID, name, posX, posY) {
    const plant = {
      id: Math.floor(Math.random() * 10000) + 1000,
      species_id: speciesID,
      name: name || speciesID,
      pos_x: posX,
      pos_y: posY,
      z_index: 0,
      water: 1.0, sun: 1.0, nutrients: 1.0, micronutrients: 1.0,
      health: 1.0, is_dead: false, death_hours: 0, game_hours_alive: 0,
      growth_progress: 0, stage: 0, pests: [],
    };
    if (!this._state) this._state = { plants: [], plant_count: 0, dead_count: 0 };
    this._state.plants.push(plant);
    this._state.plant_count = this._state.plants.filter(p => !p.is_dead).length;
    this._emit('garden:state-changed', this._state);
    return plant;
  }

  async MovePlant(plantID, posX, posY) {
    const plant = this._findPlant(plantID);
    if (plant) {
      plant.pos_x = posX;
      plant.pos_y = posY;
    }
    this._emit('garden:state-changed', this._state);
  }

  async WaterPlant(plantID) {
    const plant = this._findPlant(plantID);
    if (plant) plant.water = 1.0;
    this._emit('garden:state-changed', this._state);
  }

  async FertilizePlant(plantID) {
    const plant = this._findPlant(plantID);
    if (plant) { plant.nutrients = 1.0; plant.micronutrients = 1.0; }
    this._emit('garden:state-changed', this._state);
  }

  async TreatPest(plantID, pestID) {
    const plant = this._findPlant(plantID);
    if (plant) {
      const pest = plant.pests.find(p => p.pest_id === pestID);
      if (pest) pest.severity = 0;
    }
    this._emit('garden:state-changed', this._state);
  }

  async RemoveDeadPlant(plantID) {
    const plant = this._findPlant(plantID);
    if (plant) plant.is_dead = true;
    this._emit('garden:state-changed', this._state);
  }

  async ReplantPlant(plantID, speciesID) {
    const plant = this._findPlant(plantID);
    if (plant) {
      plant.species_id = speciesID;
      plant.is_dead = false;
      plant.water = 1.0; plant.sun = 1.0; plant.nutrients = 1.0; plant.micronutrients = 1.0;
      plant.health = 1.0; plant.death_hours = 0;
      plant.growth_progress = 0; plant.stage = 0;
    }
    this._emit('garden:state-changed', this._state);
    return plant;
  }

  async RenamePlant(plantID, name) {
    const plant = this._findPlant(plantID);
    if (plant) plant.name = name;
    this._emit('garden:state-changed', this._state);
  }

  async GetCatalog() {
    return [
      { species: { id: 'snake_plant', name: 'Snake Plant', category: 'beginner', leaf_shape: 'pointed' }, unlocked: true },
      { species: { id: 'pothos', name: 'Golden Pothos', category: 'beginner', leaf_shape: 'heart' }, unlocked: true },
      { species: { id: 'rose', name: 'Rose', category: 'advanced', leaf_shape: 'compound' }, unlocked: false },
    ];
  }

  async GetAchievements() {
    return [
      { id: 'grow_first_mature', name: 'Green Thumb', description: 'Grow to maturity', unlocked: false },
      { id: 'grow_first_flower', name: 'First Bloom', description: 'Grow to flowering', unlocked: true, unlocked_at: new Date().toISOString() },
    ];
  }

  async ToggleWidgetMode() { this._emit('widget:toggle'); }
  async UpdateSetting(key, value) { return; }
  async GetSettings() {
    return { minutes_per_game_hour: '5', catchup_max_game_hours: '8', tick_interval_seconds: '30' };
  }
  async ResetGarden() {
    this._state = { plants: [], plant_count: 0, dead_count: 0 };
    this._emit('garden:state-changed', this._state);
  }
  async GetCompositorStatus() { return true; }

  // --- Internal ---
  _findPlant(id) {
    if (!this._state) return null;
    return this._state.plants.find(p => p.id === id) || null;
  }

  _emit(name, data) {
    if (this._events[name]) {
      for (const cb of this._events[name]) cb(data);
    }
  }
}

class MockRuntime {
  EventsOn(name, callback) {
    if (!window.mockWails) return;
    if (!window.mockWails._events[name]) window.mockWails._events[name] = [];
    window.mockWails._events[name].push(callback);
  }
}

// Install mocks globally before tests
if (typeof window !== 'undefined') {
  window.mockWails = new MockWails();
  window.wails = new Proxy({}, {
    get(target, prop) {
      if (window.mockWails[prop]) {
        return (...args) => window.mockWails[prop](...args);
      }
      return async () => {};
    }
  });
  window.runtime = new MockRuntime();
}

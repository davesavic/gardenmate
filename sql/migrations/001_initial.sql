-- 001_initial.sql - GardenMate Initial Schema;

CREATE TABLE IF NOT EXISTS achievements (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    condition_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS species (
    id                   TEXT PRIMARY KEY,
    name                 TEXT NOT NULL,
    category             TEXT NOT NULL CHECK (category IN ('beginner', 'intermediate', 'advanced', 'vegetable', 'fruit')),
    water_rate           REAL NOT NULL DEFAULT 0.0,
    sun_rate             REAL NOT NULL DEFAULT 0.0,
    nutrient_rate        REAL NOT NULL DEFAULT 0.0,
    micro_rate           REAL NOT NULL DEFAULT 0.0,
    growth_hours         TEXT NOT NULL DEFAULT '[]',
    visual_params        TEXT NOT NULL DEFAULT '{}',
    unlock_achievement_id TEXT,
    is_active            INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (unlock_achievement_id) REFERENCES achievements(id)
);

CREATE TABLE IF NOT EXISTS pest_types (
    id                  TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    base_spawn_rate      REAL NOT NULL DEFAULT 0.0,
    severity_growth_rate REAL NOT NULL DEFAULT 0.0
);

CREATE TABLE IF NOT EXISTS species_pests (
    species_id  TEXT NOT NULL,
    pest_type_id TEXT NOT NULL,
    PRIMARY KEY (species_id, pest_type_id),
    FOREIGN KEY (species_id) REFERENCES species(id),
    FOREIGN KEY (pest_type_id) REFERENCES pest_types(id)
);

CREATE TABLE IF NOT EXISTS plants (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    species_id      TEXT,
    name            TEXT NOT NULL DEFAULT '',
    pos_x           REAL NOT NULL DEFAULT 0.0,
    pos_y           REAL NOT NULL DEFAULT 0.0,
    z_index         INTEGER NOT NULL DEFAULT 0,
    water           REAL NOT NULL DEFAULT 1.0,
    sun             REAL NOT NULL DEFAULT 1.0,
    nutrients       REAL NOT NULL DEFAULT 1.0,
    micronutrients  REAL NOT NULL DEFAULT 1.0,
    health          REAL NOT NULL DEFAULT 1.0,
    is_dead         INTEGER NOT NULL DEFAULT 0,
    death_hours     REAL NOT NULL DEFAULT 0.0,
    game_hours_alive REAL NOT NULL DEFAULT 0.0,
    growth_progress REAL NOT NULL DEFAULT 0.0,
    stage           INTEGER NOT NULL DEFAULT 0,
    planted_at      TEXT NOT NULL DEFAULT (datetime('now')),
    last_tick_at    TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (species_id) REFERENCES species(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS plant_pests (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    plant_id    INTEGER NOT NULL,
    pest_id     TEXT NOT NULL,
    severity    REAL NOT NULL DEFAULT 0.0,
    treated_at  TEXT,
    FOREIGN KEY (plant_id) REFERENCES plants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS player_achievements (
    achievement_id TEXT NOT NULL PRIMARY KEY,
    unlocked_at    TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (achievement_id) REFERENCES achievements(id)
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
);

-- Seed pest types
INSERT OR IGNORE INTO pest_types (id, name, base_spawn_rate, severity_growth_rate) VALUES
    ('aphids',       'Aphids',        0.015, 0.008),
    ('fungus_gnats', 'Fungus Gnats',  0.010, 0.006),
    ('spider_mites', 'Spider Mites',  0.008, 0.012);

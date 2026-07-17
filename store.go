package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

type StoreService struct {
	db  *sql.DB
	mu  sync.Mutex
}

func NewStore(dbPath string) (*StoreService, error) {
	if err := os.MkdirAll(filepath.Dir(dbPath), 0o755); err != nil {
		return nil, fmt.Errorf("mkdir %s: %w", filepath.Dir(dbPath), err)
	}

	dsn := fmt.Sprintf("file:%s?_journal_mode=WAL&_synchronous=NORMAL", dbPath)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}

	if _, err := db.Exec("PRAGMA busy_timeout = 5000"); err != nil {
		db.Close()
		return nil, fmt.Errorf("pragma busy_timeout: %w", err)
	}
	if _, err := db.Exec("PRAGMA journal_mode = WAL"); err != nil {
		db.Close()
		return nil, fmt.Errorf("pragma journal_mode: %w", err)
	}
	if _, err := db.Exec("PRAGMA wal_autocheckpoint = 1000"); err != nil {
		db.Close()
		return nil, fmt.Errorf("pragma wal_autocheckpoint: %w", err)
	}

	db.SetMaxOpenConns(1)

	migrationPath := filepath.Join("sql", "migrations", "001_initial.sql")
	migrationSQL, err := os.ReadFile(migrationPath)
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("read migration: %w", err)
	}

	for _, stmt := range strings.Split(string(migrationSQL), ";") {
		stmt = strings.TrimSpace(stmt)
		if stmt == "" || strings.HasPrefix(stmt, "--") {
			continue
		}
		if _, err := db.Exec(stmt); err != nil {
			db.Close()
			return nil, fmt.Errorf("migration exec: %w\nsql: %s", err, stmt)
		}
	}

	return &StoreService{db: db}, nil
}

func parseTime(s string) (time.Time, error) {
	t, err := time.Parse("2006-01-02 15:04:05", s)
	if err != nil {
		t, err = time.Parse(time.RFC3339, s)
		if err != nil {
			return time.Time{}, err
		}
	}
	return t, nil
}

func (s *StoreService) LoadGarden() (*Garden, error) {
	g := &Garden{
		Plants:               []*PlantInstance{},
		UnlockedAchievements: make(map[string]time.Time),
		Settings:             make(map[string]string),
	}

	rows, err := s.db.Query(`SELECT id, species_id, name, pos_x, pos_y, z_index,
		water, sun, nutrients, micronutrients, health,
		is_dead, death_hours, game_hours_alive, growth_progress, stage,
		planted_at, last_tick_at FROM plants ORDER BY z_index`)
	if err != nil {
		return nil, fmt.Errorf("load plants: %w", err)
	}

	plantsByID := make(map[int64]*PlantInstance)
	var plantIDs []int64

	for rows.Next() {
		p := &PlantInstance{}
		var speciesID sql.NullString
		var plantedAt, lastTickAt string
		var isDead int

		if err := rows.Scan(&p.ID, &speciesID, &p.Name, &p.PosX, &p.PosY, &p.ZIndex,
			&p.Water, &p.Sun, &p.Nutrients, &p.Micronutrients, &p.Health,
			&isDead, &p.DeathHours, &p.GameHoursAlive, &p.GrowthProgress, &p.Stage,
			&plantedAt, &lastTickAt); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan plant: %w", err)
		}

		if speciesID.Valid {
			p.SpeciesID = speciesID.String
		}
		p.IsDead = isDead != 0
		p.PlantedAt, _ = parseTime(plantedAt)
		p.LastTickAt, _ = parseTime(lastTickAt)
		p.Pests = []PestInstance{}

		plantsByID[p.ID] = p
		plantIDs = append(plantIDs, p.ID)
		g.Plants = append(g.Plants, p)
	}

	if err := rows.Close(); err != nil {
		return nil, err
	}

	if err := s.loadAllPests(plantsByID); err != nil {
		return nil, err
	}

	return g, nil
}

func (s *StoreService) loadAllPests(plantsByID map[int64]*PlantInstance) error {
	if len(plantsByID) == 0 {
		return nil
	}

	rows, err := s.db.Query(
		`SELECT id, plant_id, pest_id, severity, treated_at FROM plant_pests ORDER BY plant_id, id`,
	)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var p PestInstance
		var treatedAt sql.NullString
		if err := rows.Scan(&p.ID, &p.PlantID, &p.PestID, &p.Severity, &treatedAt); err != nil {
			return err
		}
		if treatedAt.Valid {
			t, err := parseTime(treatedAt.String)
			if err == nil {
				p.TreatedAt = &t
			}
		}
		if plant, ok := plantsByID[p.PlantID]; ok {
			plant.Pests = append(plant.Pests, p)
		}
	}
	return rows.Err()
}



func (s *StoreService) LoadSettings() (map[string]string, error) {
	settings := make(map[string]string)

	rows, err := s.db.Query(`SELECT key, value FROM settings`)
	if err != nil {
		return nil, fmt.Errorf("load settings: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		settings[k] = v
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if len(settings) == 0 {
		defaults := map[string]string{
			"minutes_per_game_hour":   "5",
			"catchup_max_game_hours":  "8",
			"tick_interval_seconds":   "30",
			"widget_pos_x":            "100",
			"widget_pos_y":            "100",
			"widget_width":            "300",
			"widget_height":           "400",
			"widget_view_offset_x":    "0",
			"widget_view_offset_y":    "0",
			"species_version":         "1",
			"schema_version":          "1",
		}
		for k, v := range defaults {
			if _, err := s.db.Exec(
				`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`,
				k, v,
			); err != nil {
				return nil, fmt.Errorf("seed setting %s: %w", k, err)
			}
		}
		return defaults, nil
	}

	return settings, nil
}

func (s *StoreService) LoadAchievements() (map[string]time.Time, error) {
	achievements := make(map[string]time.Time)

	rows, err := s.db.Query(`SELECT achievement_id, unlocked_at FROM player_achievements`)
	if err != nil {
		return nil, fmt.Errorf("load achievements: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var id, unlockedAt string
		if err := rows.Scan(&id, &unlockedAt); err != nil {
			return nil, err
		}
		t, err := parseTime(unlockedAt)
		if err != nil {
			return nil, fmt.Errorf("parse achievement unlocked_at for %s: %w", id, err)
		}
		achievements[id] = t
	}

	return achievements, rows.Err()
}

func (s *StoreService) SaveAll(garden *Garden) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	for _, plant := range garden.Plants {
		if err := s.upsertPlantInTx(tx, plant); err != nil {
			return err
		}
		if err := s.syncPlantPestsInTx(tx, plant); err != nil {
			return err
		}
	}

	for achievementID, unlockedAt := range garden.UnlockedAchievements {
		if _, err := tx.Exec(
			`INSERT OR REPLACE INTO player_achievements (achievement_id, unlocked_at) VALUES (?, ?)`,
			achievementID, unlockedAt.Format("2006-01-02 15:04:05"),
		); err != nil {
			return fmt.Errorf("save achievement %s: %w", achievementID, err)
		}
	}

	for k, v := range garden.Settings {
		if _, err := tx.Exec(
			`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`,
			k, v,
		); err != nil {
			return fmt.Errorf("save setting %s: %w", k, err)
		}
	}

	return tx.Commit()
}

func (s *StoreService) upsertPlantInTx(tx *sql.Tx, plant *PlantInstance) error {
	_, err := tx.Exec(
		`INSERT OR REPLACE INTO plants
		(id, species_id, name, pos_x, pos_y, z_index, water, sun, nutrients, micronutrients,
		 health, is_dead, death_hours, game_hours_alive, growth_progress, stage, planted_at, last_tick_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		plant.ID,
		nullableString(plant.SpeciesID),
		plant.Name,
		plant.PosX,
		plant.PosY,
		plant.ZIndex,
		plant.Water,
		plant.Sun,
		plant.Nutrients,
		plant.Micronutrients,
		plant.Health,
		boolToInt(plant.IsDead),
		plant.DeathHours,
		plant.GameHoursAlive,
		plant.GrowthProgress,
		plant.Stage,
		plant.PlantedAt.Format("2006-01-02 15:04:05"),
		plant.LastTickAt.Format("2006-01-02 15:04:05"),
	)
	if err != nil {
		return fmt.Errorf("upsert plant %d: %w", plant.ID, err)
	}
	return nil
}

func (s *StoreService) syncPlantPestsInTx(tx *sql.Tx, plant *PlantInstance) error {
	if _, err := tx.Exec(`DELETE FROM plant_pests WHERE plant_id = ?`, plant.ID); err != nil {
		return fmt.Errorf("delete pests for plant %d: %w", plant.ID, err)
	}
	for i := range plant.Pests {
		pest := &plant.Pests[i]
		var treatedAt interface{}
		if pest.TreatedAt != nil {
			treatedAt = pest.TreatedAt.Format("2006-01-02 15:04:05")
		}
		var id interface{}
		if pest.ID != 0 {
			id = pest.ID
		}
		result, err := tx.Exec(
			`INSERT INTO plant_pests (id, plant_id, pest_id, severity, treated_at) VALUES (?, ?, ?, ?, ?)`,
			id, plant.ID, pest.PestID, pest.Severity, treatedAt,
		)
		if err != nil {
			return fmt.Errorf("insert pest for plant %d: %w", plant.ID, err)
		}
		if pest.ID == 0 {
			newID, err := result.LastInsertId()
			if err != nil {
				return fmt.Errorf("pest id for plant %d: %w", plant.ID, err)
			}
			pest.ID = newID
		}
	}
	return nil
}

func (s *StoreService) SavePlant(plant *PlantInstance) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	if err := s.upsertPlantInTx(tx, plant); err != nil {
		return err
	}
	if err := s.syncPlantPestsInTx(tx, plant); err != nil {
		return err
	}

	return tx.Commit()
}

func (s *StoreService) InsertPlant(speciesID, name string, posX, posY float64) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now().Format("2006-01-02 15:04:05")
	result, err := s.db.Exec(
		`INSERT INTO plants (species_id, name, pos_x, pos_y, z_index)
		VALUES (?, ?, ?, ?,
			COALESCE((SELECT MAX(z_index) FROM plants), 0) + 1)`,
		nullableString(speciesID), name, posX, posY,
	)
	if err != nil {
		return 0, fmt.Errorf("insert plant: %w", err)
	}

	id, err := result.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("last insert id: %w", err)
	}

	if _, err := s.db.Exec(
		`UPDATE plants SET planted_at = ?, last_tick_at = ? WHERE id = ?`,
		now, now, id,
	); err != nil {
		return 0, fmt.Errorf("update timestamps: %w", err)
	}

	return id, nil
}

func (s *StoreService) DeletePlant(plantID int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, err := s.db.Exec(`DELETE FROM plants WHERE id = ?`, plantID); err != nil {
		return fmt.Errorf("delete plant %d: %w", plantID, err)
	}
	return nil
}

func (s *StoreService) SeedSpecies(manifest *SpeciesManifest) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	var versionStr string
	err := s.db.QueryRow(
		`SELECT value FROM settings WHERE key = 'species_version'`,
	).Scan(&versionStr)
	if err == nil {
		if versionStr == fmt.Sprintf("%d", manifest.Version) {
			return nil
		}
	}

	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	for _, pt := range manifest.PestTypes {
		if _, err := tx.Exec(
			`INSERT OR IGNORE INTO pest_types (id, name, base_spawn_rate, severity_growth_rate) VALUES (?, ?, ?, ?)`,
			pt.ID, pt.Name, pt.BaseSpawnRate, pt.SeverityGrowthRate,
		); err != nil {
			return fmt.Errorf("seed pest_type %s: %w", pt.ID, err)
		}
	}

	for _, a := range manifest.Achievements {
		condJSON, err := json.Marshal(map[string]interface{}{
			"type":   a.Type,
			"params": a.Params,
		})
		if err != nil {
			return fmt.Errorf("marshal condition for achievement %s: %w", a.ID, err)
		}
		if _, err := tx.Exec(
			`INSERT OR REPLACE INTO achievements (id, name, description, condition_json) VALUES (?, ?, ?, ?)`,
			a.ID, a.Name, a.Description, string(condJSON),
		); err != nil {
			return fmt.Errorf("seed achievement %s: %w", a.ID, err)
		}
	}

	currentSpeciesIDs := make(map[string]bool)
	for i := range manifest.Species {
		sp := &manifest.Species[i]

		growthJSON, err := json.Marshal(sp.GrowthHours)
		if err != nil {
			return fmt.Errorf("marshal growth_hours for %s: %w", sp.ID, err)
		}
		visualJSON, err := json.Marshal(sp.VisualParams)
		if err != nil {
			return fmt.Errorf("marshal visual_params for %s: %w", sp.ID, err)
		}

		var unlockID interface{}
		if sp.UnlockAchievementID != nil {
			unlockID = *sp.UnlockAchievementID
		}

		if _, err := tx.Exec(
			`INSERT OR REPLACE INTO species
			(id, name, category, water_rate, sun_rate, nutrient_rate, micro_rate,
			 growth_hours, visual_params, unlock_achievement_id, is_active)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
			sp.ID, sp.Name, sp.Category,
			sp.WaterRate, sp.SunRate, sp.NutrientRate, sp.MicroRate,
			string(growthJSON), string(visualJSON), unlockID,
		); err != nil {
			return fmt.Errorf("seed species %s: %w", sp.ID, err)
		}

		currentSpeciesIDs[sp.ID] = true
	}

	activeIDs := make([]string, 0, len(currentSpeciesIDs))
	for id := range currentSpeciesIDs {
		activeIDs = append(activeIDs, id)
	}

	if len(activeIDs) > 0 {
		placeholders := make([]string, len(activeIDs))
		args := make([]interface{}, len(activeIDs))
		for i, id := range activeIDs {
			placeholders[i] = "?"
			args[i] = id
		}
		if _, err := tx.Exec(
			fmt.Sprintf(
				`UPDATE species SET is_active = 0 WHERE id NOT IN (%s)`,
				strings.Join(placeholders, ","),
			),
			args...,
		); err != nil {
			return fmt.Errorf("soft-delete old species: %w", err)
		}
	}

	if _, err := tx.Exec(`DELETE FROM species_pests WHERE species_id IN (SELECT id FROM species WHERE is_active = 1)`); err != nil {
		return fmt.Errorf("clear species_pests: %w", err)
	}

	for _, sp := range manifest.SpeciesPests {
		if _, err := tx.Exec(
			`INSERT INTO species_pests (species_id, pest_type_id) VALUES (?, ?)`,
			sp.SpeciesID, sp.PestTypeID,
		); err != nil {
			return fmt.Errorf("seed species_pest %s/%s: %w", sp.SpeciesID, sp.PestTypeID, err)
		}
	}

	if _, err := tx.Exec(
		`INSERT OR REPLACE INTO settings (key, value) VALUES ('species_version', ?)`,
		fmt.Sprintf("%d", manifest.Version),
	); err != nil {
		return fmt.Errorf("update species_version: %w", err)
	}

	return tx.Commit()
}

func (s *StoreService) ResetGarden() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`DELETE FROM plant_pests`); err != nil {
		return fmt.Errorf("delete plant_pests: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM plants`); err != nil {
		return fmt.Errorf("delete plants: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM player_achievements`); err != nil {
		return fmt.Errorf("delete player_achievements: %w", err)
	}

	defaults := map[string]string{
		"minutes_per_game_hour": "5",
		"catchup_max_game_hours": "8",
		"tick_interval_seconds":  "30",
		"widget_pos_x":           "100",
		"widget_pos_y":           "100",
		"widget_width":           "300",
		"widget_height":          "400",
		"widget_view_offset_x":   "0",
		"widget_view_offset_y":   "0",
	}
	for k, v := range defaults {
		if _, err := tx.Exec(
			`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`,
			k, v,
		); err != nil {
			return fmt.Errorf("seed setting %s: %w", k, err)
		}
	}

	return tx.Commit()
}

func (s *StoreService) Close() error {
	return s.db.Close()
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func nullableString(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

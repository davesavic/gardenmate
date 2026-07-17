package main

import (
	"os"
	"testing"
)

func newTestStore(t *testing.T) *StoreService {
	t.Helper()
	dbPath := ":memory:"
	store, err := NewStore(dbPath)
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	t.Cleanup(func() { store.Close() })
	return store
}

func seedTestSpecies(t *testing.T, store *StoreService) *PlantService {
	t.Helper()
	data, err := os.ReadFile("testdata/test_species.json")
	if err != nil {
		t.Fatalf("read test data: %v", err)
	}
	ps, err := LoadSpecies(data)
	if err != nil {
		t.Fatalf("LoadSpecies: %v", err)
	}
	if err := store.SeedSpecies(ps.GetManifest()); err != nil {
		t.Fatalf("SeedSpecies: %v", err)
	}
	return ps
}

func TestNewStore(t *testing.T) {
	store := newTestStore(t)
	if store.db == nil {
		t.Fatal("db is nil")
	}
}

func TestInsertAndLoadPlant(t *testing.T) {
	store := newTestStore(t)
	seedTestSpecies(t, store)

	id, err := store.InsertPlant("test_plant", "My Plant", 100, 200)
	if err != nil {
		t.Fatalf("InsertPlant: %v", err)
	}
	if id <= 0 {
		t.Errorf("expected positive id, got %d", id)
	}

	garden, err := store.LoadGarden()
	if err != nil {
		t.Fatalf("LoadGarden: %v", err)
	}
	if len(garden.Plants) != 1 {
		t.Fatalf("expected 1 plant, got %d", len(garden.Plants))
	}

	plant := garden.Plants[0]
	if plant.ID != id {
		t.Errorf("expected id %d, got %d", id, plant.ID)
	}
	if plant.Name != "My Plant" {
		t.Errorf("expected name 'My Plant', got %q", plant.Name)
	}
	if plant.SpeciesID != "test_plant" {
		t.Errorf("expected species 'test_plant', got %q", plant.SpeciesID)
	}
}

func TestSavePlant(t *testing.T) {
	store := newTestStore(t)
	seedTestSpecies(t, store)

	id, _ := store.InsertPlant("test_plant", "Test", 100, 200)
	garden, _ := store.LoadGarden()
	plant := garden.Plants[0]

	plant.Water = 0.5
	plant.Name = "Updated Name"

	if err := store.SavePlant(plant); err != nil {
		t.Fatalf("SavePlant: %v", err)
	}

	garden2, err := store.LoadGarden()
	if err != nil {
		t.Fatalf("LoadGarden after save: %v", err)
	}
	if len(garden2.Plants) != 1 {
		t.Fatalf("expected 1 plant after save, got %d", len(garden2.Plants))
	}
	p2 := garden2.Plants[0]
	if p2.Water != 0.5 {
		t.Errorf("expected water=0.5, got %f", p2.Water)
	}
	if p2.Name != "Updated Name" {
		t.Errorf("expected name 'Updated Name', got %q", p2.Name)
	}

	_ = id
}

func TestLoadDeadPlants(t *testing.T) {
	store := newTestStore(t)
	seedTestSpecies(t, store)

	id, _ := store.InsertPlant("test_plant", "Live", 100, 200)
	garden, _ := store.LoadGarden()
	plant := garden.Plants[0]
	plant.IsDead = true
	store.SavePlant(plant)

	garden2, err := store.LoadGarden()
	if err != nil {
		t.Fatalf("LoadGarden: %v", err)
	}
	if len(garden2.Plants) != 1 {
		t.Fatalf("expected 1 plant (dead), got %d", len(garden2.Plants))
	}
	if !garden2.Plants[0].IsDead {
		t.Error("expected dead plant to be loaded")
	}

	_ = id
}

func TestSaveAll(t *testing.T) {
	store := newTestStore(t)
	seedTestSpecies(t, store)

	store.InsertPlant("test_plant", "P1", 100, 200)
	store.InsertPlant("test_plant_fast", "P2", 300, 400)

	garden, _ := store.LoadGarden()
	garden.Plants[0].Water = 0.3
	garden.Plants[1].Nutrients = 0.7
	garden.UnlockedAchievements["test_ach"] = garden.Plants[0].PlantedAt
	garden.Settings["test_key"] = "test_value"

	if err := store.SaveAll(garden); err != nil {
		t.Fatalf("SaveAll: %v", err)
	}

	garden2, _ := store.LoadGarden()
	if len(garden2.Plants) != 2 {
		t.Fatalf("expected 2 plants, got %d", len(garden2.Plants))
	}
	if garden2.Plants[0].Water != 0.3 {
		t.Errorf("expected water=0.3, got %f", garden2.Plants[0].Water)
	}
	if garden2.Plants[1].Nutrients != 0.7 {
		t.Errorf("expected nutrients=0.7, got %f", garden2.Plants[1].Nutrients)
	}

	achievements, _ := store.LoadAchievements()
	if _, ok := achievements["test_ach"]; !ok {
		t.Error("test_ach should be unlocked")
	}

	settings, _ := store.LoadSettings()
	if settings["test_key"] != "test_value" {
		t.Errorf("expected test_key=test_value, got %q", settings["test_key"])
	}
}

func TestSaveAllNewPestsOnMultiplePlants(t *testing.T) {
	store := newTestStore(t)
	seedTestSpecies(t, store)

	store.InsertPlant("test_plant", "P1", 100, 200)
	store.InsertPlant("test_plant", "P2", 300, 400)

	garden, _ := store.LoadGarden()
	garden.Plants[0].Pests = append(garden.Plants[0].Pests, PestInstance{
		PlantID: garden.Plants[0].ID, PestID: "aphids", Severity: 0.05,
	})
	garden.Plants[1].Pests = append(garden.Plants[1].Pests, PestInstance{
		PlantID: garden.Plants[1].ID, PestID: "spider_mites", Severity: 0.05,
	})

	if err := store.SaveAll(garden); err != nil {
		t.Fatalf("SaveAll with new pests: %v", err)
	}

	if err := store.SaveAll(garden); err != nil {
		t.Fatalf("SaveAll second time: %v", err)
	}

	garden2, err := store.LoadGarden()
	if err != nil {
		t.Fatalf("LoadGarden: %v", err)
	}
	for i, p := range garden2.Plants {
		if len(p.Pests) != 1 {
			t.Errorf("plant %d: expected 1 pest, got %d", i, len(p.Pests))
		}
	}
}

func TestLoadSettingsDefaults(t *testing.T) {
	store := newTestStore(t)
	settings, err := store.LoadSettings()
	if err != nil {
		t.Fatalf("LoadSettings: %v", err)
	}

	requiredKeys := []string{
		"minutes_per_game_hour", "catchup_max_game_hours", "tick_interval_seconds",
		"widget_pos_x", "widget_pos_y", "widget_width", "widget_height",
		"widget_view_offset_x", "widget_view_offset_y",
		"species_version", "schema_version",
	}

	for _, key := range requiredKeys {
		if _, ok := settings[key]; !ok {
			t.Errorf("missing required setting: %q", key)
		}
	}

	if settings["minutes_per_game_hour"] != "5" {
		t.Errorf("expected default 5, got %q", settings["minutes_per_game_hour"])
	}
}

func TestResetGarden(t *testing.T) {
	store := newTestStore(t)
	seedTestSpecies(t, store)

	store.InsertPlant("test_plant", "P1", 100, 200)
	garden, _ := store.LoadGarden()
	garden.UnlockedAchievements["test_ach"] = garden.Plants[0].PlantedAt
	store.SaveAll(garden)

	if err := store.ResetGarden(); err != nil {
		t.Fatalf("ResetGarden: %v", err)
	}

	garden2, _ := store.LoadGarden()
	if len(garden2.Plants) != 0 {
		t.Errorf("expected 0 plants after reset, got %d", len(garden2.Plants))
	}

	achievements, _ := store.LoadAchievements()
	if len(achievements) != 0 {
		t.Errorf("expected 0 achievements after reset, got %d", len(achievements))
	}

	settings, _ := store.LoadSettings()
	if settings["minutes_per_game_hour"] != "5" {
		t.Error("default settings should be restored after reset")
	}
}

func TestSeedSpeciesIdempotent(t *testing.T) {
	store := newTestStore(t)
	seedTestSpecies(t, store)

	seedTestSpecies(t, store)

	garden, _ := store.LoadGarden()
	if len(garden.Plants) != 0 {
		t.Error("seeding twice should not create duplicate plants")
	}
}

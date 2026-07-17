package main

import (
	"os"
	"testing"
)

func TestLoadSpecies(t *testing.T) {
	data, err := os.ReadFile("testdata/test_species.json")
	if err != nil {
		t.Fatalf("read test data: %v", err)
	}
	ps, err := LoadSpecies(data)
	if err != nil {
		t.Fatalf("LoadSpecies: %v", err)
	}
	if ps.SpeciesCount() != 2 {
		t.Errorf("expected 2 species, got %d", ps.SpeciesCount())
	}
	manifest := ps.GetManifest()
	if manifest.Version != 1 {
		t.Errorf("expected version 1, got %d", manifest.Version)
	}
	if len(manifest.Achievements) != 4 {
		t.Errorf("expected 4 achievements, got %d", len(manifest.Achievements))
	}
	if len(manifest.PestTypes) != 2 {
		t.Errorf("expected 2 pest types, got %d", len(manifest.PestTypes))
	}
}

func TestGetByID(t *testing.T) {
	data, _ := os.ReadFile("testdata/test_species.json")
	ps, _ := LoadSpecies(data)

	sp := ps.GetByID("test_plant")
	if sp == nil {
		t.Fatal("test_plant not found")
	}
	if sp.Name != "Test Plant" {
		t.Errorf("expected 'Test Plant', got %q", sp.Name)
	}
	if sp.Category != "beginner" {
		t.Errorf("expected 'beginner', got %q", sp.Category)
	}

	if sp := ps.GetByID("nonexistent"); sp != nil {
		t.Error("expected nil for unknown species")
	}
}

func TestGetUnlocked(t *testing.T) {
	data, _ := os.ReadFile("testdata/test_species.json")
	ps, _ := LoadSpecies(data)

	// No achievements unlocked
	unlocked := make(map[string]bool)
	species := ps.GetUnlocked(unlocked)
	if len(species) != 1 {
		t.Errorf("expected 1 unlocked species (starter), got %d", len(species))
	}

	// Unlock the achievement
	unlocked["test_ach"] = true
	species = ps.GetUnlocked(unlocked)
	if len(species) != 2 {
		t.Errorf("expected 2 unlocked species, got %d", len(species))
	}
}

func TestGetByCategory(t *testing.T) {
	data, _ := os.ReadFile("testdata/test_species.json")
	ps, _ := LoadSpecies(data)

	beginner := ps.GetByCategory("beginner")
	if len(beginner) != 1 {
		t.Errorf("expected 1 beginner species, got %d", len(beginner))
	}

	intermediate := ps.GetByCategory("intermediate")
	if len(intermediate) != 1 {
		t.Errorf("expected 1 intermediate species, got %d", len(intermediate))
	}

	advanced := ps.GetByCategory("advanced")
	if len(advanced) != 0 {
		t.Errorf("expected 0 advanced species, got %d", len(advanced))
	}
}

func TestSpeciesValidate(t *testing.T) {
	s := Species{
		ID:          "test",
		Name:        "Test",
		GrowthHours: []float64{1, 2, 3, 4},
	}
	if err := s.Validate(); err == nil {
		t.Error("expected error for 4-element growth_hours")
	}

	s2 := Species{
		ID:          "test",
		Name:        "Test",
		GrowthHours: []float64{1, 2, 3, 4, 5},
		WaterRate:   -0.01,
	}
	if err := s2.Validate(); err == nil {
		t.Error("expected error for negative water_rate")
	}

	s3 := Species{
		ID:          "",
		Name:        "Test",
		GrowthHours: []float64{1, 2, 3, 4, 5},
	}
	if err := s3.Validate(); err == nil {
		t.Error("expected error for empty id")
	}

	s4 := Species{
		ID:          "test",
		Name:        "",
		GrowthHours: []float64{1, 2, 3, 4, 5},
	}
	if err := s4.Validate(); err == nil {
		t.Error("expected error for empty name")
	}

	s5 := Species{
		ID:          "test",
		Name:        "Test",
		GrowthHours: []float64{1, 2, 3, 4, 5, 6},
	}
	if err := s5.Validate(); err != nil {
		t.Errorf("expected 6-element growth_hours to be valid, got %v", err)
	}
	if s5.MaxStage() != 5 {
		t.Errorf("expected MaxStage 5 for 6-element growth_hours, got %d", s5.MaxStage())
	}

	s6 := Species{
		ID:          "test",
		Name:        "Test",
		GrowthHours: []float64{1, 2, 3, 4, 5, 6, 7},
	}
	if err := s6.Validate(); err == nil {
		t.Error("expected error for 7-element growth_hours")
	}
}

func TestSpeciesManifestPests(t *testing.T) {
	data, _ := os.ReadFile("testdata/test_species.json")
	ps, _ := LoadSpecies(data)

	manifest := ps.GetManifest()
	if len(manifest.SpeciesPests) == 0 {
		t.Error("expected SpeciesPests to be populated")
	}
}

func TestLoadRealSpeciesManifest(t *testing.T) {
	data, err := os.ReadFile("species.json")
	if err != nil {
		t.Fatalf("read species.json: %v", err)
	}
	ps, err := LoadSpecies(data)
	if err != nil {
		t.Fatalf("LoadSpecies on real manifest: %v", err)
	}
	if ps.SpeciesCount() < 26 {
		t.Errorf("expected at least 26 species, got %d", ps.SpeciesCount())
	}

	manifest := ps.GetManifest()
	pestIDs := make(map[string]bool)
	for _, pt := range manifest.PestTypes {
		pestIDs[pt.ID] = true
	}
	for _, want := range []string{"caterpillars", "slugs", "whiteflies", "leaf_miners"} {
		if !pestIDs[want] {
			t.Errorf("missing pest type %q", want)
		}
	}

	achIDs := make(map[string]bool)
	for _, a := range manifest.Achievements {
		achIDs[a.ID] = true
	}
	for _, s := range ps.GetAll() {
		if s.UnlockAchievementID != nil && !achIDs[*s.UnlockAchievementID] {
			t.Errorf("species %q references unknown achievement %q", s.ID, *s.UnlockAchievementID)
		}
	}

	if veg := ps.GetByCategory("vegetable"); len(veg) < 8 {
		t.Errorf("expected at least 8 vegetables, got %d", len(veg))
	}
	if fruit := ps.GetByCategory("fruit"); len(fruit) < 6 {
		t.Errorf("expected at least 6 fruits, got %d", len(fruit))
	}
}

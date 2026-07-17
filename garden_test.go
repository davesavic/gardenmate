package main

import (
	"math"
	"testing"
	"time"
)

func newTestGarden() *Garden {
	return &Garden{
		Plants:               []*PlantInstance{},
		UnlockedAchievements: make(map[string]time.Time),
		Settings:             make(map[string]string),
	}
}

func TestAddPlant(t *testing.T) {
	g := newTestGarden()

	plant, err := g.AddPlant("snake_plant", "My Plant", 100, 200)
	if err != nil {
		t.Fatalf("AddPlant: %v", err)
	}
	if plant.Name != "My Plant" {
		t.Errorf("expected 'My Plant', got %q", plant.Name)
	}
	if plant.Water != 1.0 {
		t.Errorf("expected water=1.0, got %f", plant.Water)
	}
	if plant.Nutrients != 1.0 {
		t.Errorf("expected nutrients=1.0, got %f", plant.Nutrients)
	}
	if plant.Micronutrients != 1.0 {
		t.Errorf("expected micronutrients=1.0, got %f", plant.Micronutrients)
	}
}

func TestAddPlantClamping(t *testing.T) {
	g := newTestGarden()

	plant, err := g.AddPlant("snake_plant", "Test", 1000, -50)
	if err != nil {
		t.Fatalf("AddPlant: %v", err)
	}
	if plant.PosX != CanvasWidth {
		t.Errorf("expected pos_x clamped to %f, got %f", CanvasWidth, plant.PosX)
	}
	if plant.PosY != 0 {
		t.Errorf("expected pos_y clamped to 0, got %f", plant.PosY)
	}
}

func TestAddPlantNaN(t *testing.T) {
	g := newTestGarden()

	_, err := g.AddPlant("snake_plant", "Test", math.NaN(), 100)
	if err == nil {
		t.Error("expected error for NaN position")
	}

	_, err = g.AddPlant("snake_plant", "Test", 100, math.Inf(1))
	if err == nil {
		t.Error("expected error for Inf position")
	}
}

func TestMovePlant(t *testing.T) {
	g := newTestGarden()
	plant, _ := g.AddPlant("snake_plant", "Test", 100, 100)

	if err := g.MovePlant(plant.ID, 200, 300); err != nil {
		t.Fatalf("MovePlant: %v", err)
	}
	if plant.PosX != 200 || plant.PosY != 300 {
		t.Errorf("expected (200,300), got (%f,%f)", plant.PosX, plant.PosY)
	}
}

func TestMovePlantNaN(t *testing.T) {
	g := newTestGarden()
	plant, _ := g.AddPlant("snake_plant", "Test", 100, 100)

	if err := g.MovePlant(plant.ID, math.NaN(), 100); err == nil {
		t.Error("expected error for NaN move")
	}
}

func TestZIndex(t *testing.T) {
	g := newTestGarden()
	p1, _ := g.AddPlant("snake_plant", "Test1", 100, 100)
	p2, _ := g.AddPlant("snake_plant", "Test2", 200, 200)

	if p1.ZIndex >= p2.ZIndex {
		t.Errorf("expected p2 z_index > p1, got %d >= %d", p1.ZIndex, p2.ZIndex)
	}

	g.MovePlant(p1.ID, 300, 300)
	if p1.ZIndex <= p2.ZIndex {
		t.Errorf("expected moved plant to have highest z_index, got %d <= %d", p1.ZIndex, p2.ZIndex)
	}
}

func TestWaterPlant(t *testing.T) {
	g := newTestGarden()
	plant, _ := g.AddPlant("snake_plant", "Test", 100, 100)
	plant.Water = 0.3

	if err := g.WaterPlant(plant.ID); err != nil {
		t.Fatalf("WaterPlant: %v", err)
	}
	if plant.Water != 1.0 {
		t.Errorf("expected water=1.0, got %f", plant.Water)
	}
}

func TestFertilizePlant(t *testing.T) {
	g := newTestGarden()
	plant, _ := g.AddPlant("snake_plant", "Test", 100, 100)
	plant.Nutrients = 0.3
	plant.Micronutrients = 0.3

	if err := g.FertilizePlant(plant.ID); err != nil {
		t.Fatalf("FertilizePlant: %v", err)
	}
	if plant.Nutrients != 1.0 {
		t.Errorf("expected nutrients=1.0, got %f", plant.Nutrients)
	}
	if plant.Micronutrients != 1.0 {
		t.Errorf("expected micronutrients=1.0, got %f", plant.Micronutrients)
	}
}

func TestRemovePlant(t *testing.T) {
	g := newTestGarden()
	plant, _ := g.AddPlant("snake_plant", "Test", 100, 100)

	if err := g.RemovePlant(plant.ID); err != nil {
		t.Fatalf("RemovePlant: %v", err)
	}
	if !plant.IsDead {
		t.Error("expected plant to be dead")
	}
	// Plant should still exist (empty pot)
	found := g.FindPlant(plant.ID)
	if found == nil {
		t.Error("expected to find dead plant (empty pot)")
	}
}

func TestReplantPlant(t *testing.T) {
	g := newTestGarden()
	plant, _ := g.AddPlant("snake_plant", "Test", 100, 100)
	g.RemovePlant(plant.ID)

	replanted, err := g.ReplantPlant(plant.ID, "pothos")
	if err != nil {
		t.Fatalf("ReplantPlant: %v", err)
	}
	if replanted.ID != plant.ID {
		t.Errorf("expected same ID %d, got %d", plant.ID, replanted.ID)
	}
	if replanted.SpeciesID != "pothos" {
		t.Errorf("expected species 'pothos', got %q", replanted.SpeciesID)
	}
	if replanted.IsDead {
		t.Error("replanted plant should be alive")
	}
	if replanted.Water != 1.0 || replanted.Sun != 1.0 || replanted.Nutrients != 1.0 || replanted.Micronutrients != 1.0 {
		t.Error("replanted plant should have all stats at 1.0")
	}
}

func TestReplantLivingPlant(t *testing.T) {
	g := newTestGarden()
	plant, _ := g.AddPlant("snake_plant", "Test", 100, 100)

	_, err := g.ReplantPlant(plant.ID, "pothos")
	if err == nil {
		t.Error("expected error when replanting living plant")
	}
}

func TestRenamePlant(t *testing.T) {
	g := newTestGarden()
	plant, _ := g.AddPlant("snake_plant", "Test", 100, 100)

	if err := g.RenamePlant(plant.ID, "New Name"); err != nil {
		t.Fatalf("RenamePlant: %v", err)
	}
	if plant.Name != "New Name" {
		t.Errorf("expected 'New Name', got %q", plant.Name)
	}

	// Empty name
	if err := g.RenamePlant(plant.ID, ""); err == nil {
		t.Error("expected error for empty name")
	}

	// Too long
	longName := ""
	for i := 0; i < 200; i++ {
		longName += "a"
	}
	if err := g.RenamePlant(plant.ID, longName); err == nil {
		t.Error("expected error for long name")
	}
}

func TestTreatPest(t *testing.T) {
	g := newTestGarden()
	plant, _ := g.AddPlant("snake_plant", "Test", 100, 100)
	plant.Pests = append(plant.Pests, PestInstance{
		PestID:   "aphids",
		Severity: 0.8,
	})

	if err := g.TreatPest(plant.ID, "aphids"); err != nil {
		t.Fatalf("TreatPest: %v", err)
	}
	if plant.Pests[0].Severity != 0 {
		t.Errorf("expected severity=0 after treatment, got %f", plant.Pests[0].Severity)
	}
	if plant.Pests[0].TreatedAt == nil {
		t.Error("expected TreatedAt to be set")
	}
}

func TestToState(t *testing.T) {
	g := newTestGarden()
	p1, _ := g.AddPlant("snake_plant", "Plant1", 100, 100)
	g.RemovePlant(p1.ID)
	p2, _ := g.AddPlant("pothos", "Plant2", 200, 200)

	state := g.ToState()
	if len(state.Plants) != 2 {
		t.Errorf("expected 2 plants in state, got %d", len(state.Plants))
	}
	if state.PlantCount != 1 {
		t.Errorf("expected 1 live plant, got %d", state.PlantCount)
	}
	if state.DeadCount != 1 {
		t.Errorf("expected 1 dead plant, got %d", state.DeadCount)
	}

	_ = p2
}

func TestGetVisible(t *testing.T) {
	g := newTestGarden()
	g.AddPlant("snake_plant", "A", 100, 100)
	g.AddPlant("snake_plant", "B", 50, 50)
	// Plant at edge is culled (pos_x = 900 is valid but pos_x = 1000 gets clamped to 900)
	plant3, _ := g.AddPlant("snake_plant", "C", 900, 600)

	visible := g.GetVisible(200, 200)
	// Only A (100,100) and B (50,50) should be visible
	if len(visible) < 2 {
		t.Errorf("expected at least 2 visible plants in 200x200 viewport, got %d", len(visible))
	}

	_ = plant3

	// C (900,600) should NOT be in 200x200
	for _, v := range visible {
		if v.PosX > 200 || v.PosY > 200 {
			t.Error("plant outside viewport returned")
		}
	}
}

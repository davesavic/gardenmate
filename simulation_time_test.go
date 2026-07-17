package main

import (
	"testing"
	"time"
)

func newTimeTestGarden(clock *mockClock) *Garden {
	return &Garden{
		Plants: []*PlantInstance{{
			ID: 1, SpeciesID: "test_plant", Water: 1.0, Sun: 1.0,
			Nutrients: 1.0, Micronutrients: 1.0, Health: 1.0,
			LastTickAt: clock.Now(), Pests: []PestInstance{},
		}},
		UnlockedAchievements: make(map[string]time.Time),
		Settings: map[string]string{
			"tick_interval_seconds":  "30",
			"minutes_per_game_hour":  "5",
			"catchup_max_game_hours": "8",
		},
	}
}

func TestTickUsesRealElapsedGameHours(t *testing.T) {
	clock := &mockClock{now: time.Now()}
	garden := newTimeTestGarden(clock)
	species := map[string]*Species{"test_plant": {
		ID: "test_plant", WaterRate: 0.02, SunRate: 0, NutrientRate: 0, MicroRate: 0,
		GrowthHours: []float64{5, 10, 15, 20, 25},
	}}
	sim := NewSimulation(garden, species, clock, newMockTicker(), nil, NewNotifyService(), &AchievementService{}, &NoopEventEmitter{})

	clock.Advance(30 * time.Second)
	sim.applyTick()

	got := garden.Plants[0].Water
	want := 1.0 - 0.02*0.1
	if got > want+0.0001 || got < want-0.0001 {
		t.Errorf("30s real tick should be 0.1 game hours: water=%.6f, want %.6f", got, want)
	}
}

func TestCatchupNoDecayOnImmediateRestart(t *testing.T) {
	clock := &mockClock{now: time.Now()}
	garden := newTimeTestGarden(clock)
	species := map[string]*Species{"test_plant": {
		ID: "test_plant", WaterRate: 0.1, SunRate: 0, NutrientRate: 0.08, MicroRate: 0.05,
		GrowthHours: []float64{5, 10, 15, 20, 25},
	}}
	store := newTestStore(t)
	sim := NewSimulation(garden, species, clock, newMockTicker(), store, NewNotifyService(), &AchievementService{}, &NoopEventEmitter{})

	sim.runCatchUp()

	p := garden.Plants[0]
	if p.Water < 0.999 {
		t.Errorf("catch-up decayed stats despite zero elapsed time: water=%.4f", p.Water)
	}
}

func TestCatchupDecaysProportionallyAndCaps(t *testing.T) {
	clock := &mockClock{now: time.Now()}
	garden := newTimeTestGarden(clock)
	species := map[string]*Species{"test_plant": {
		ID: "test_plant", WaterRate: 0.05, SunRate: 0, NutrientRate: 0, MicroRate: 0,
		GrowthHours: []float64{5, 10, 15, 20, 25},
	}}
	store := newTestStore(t)
	sim := NewSimulation(garden, species, clock, newMockTicker(), store, NewNotifyService(), &AchievementService{}, &NoopEventEmitter{})

	// 20 real minutes offline = 4 game hours at 5 min/game-hour
	clock.Advance(20 * time.Minute)
	sim.runCatchUp()

	got := garden.Plants[0].Water
	want := 1.0 - 0.05*4
	if got > want+0.001 || got < want-0.001 {
		t.Errorf("4 game-hour gap: water=%.4f, want %.4f", got, want)
	}

	// Reset, then a huge gap must cap at catchup_max_game_hours (8)
	garden.Plants[0].Water = 1.0
	garden.Plants[0].LastTickAt = clock.Now()
	clock.Advance(100 * time.Hour)
	sim.runCatchUp()

	got = garden.Plants[0].Water
	want = 1.0 - 0.05*8
	if got > want+0.001 || got < want-0.001 {
		t.Errorf("capped gap: water=%.4f, want %.4f", got, want)
	}
}

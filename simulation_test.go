package main

import (
	"context"
	"testing"
	"time"
)

type mockClock struct {
	now time.Time
}

func (m *mockClock) Now() time.Time                  { return m.now }
func (m *mockClock) Since(t time.Time) time.Duration { return m.now.Sub(t) }
func (m *mockClock) Advance(d time.Duration)         { m.now = m.now.Add(d) }

type mockTicker struct {
	c chan time.Time
}

func newMockTicker() *mockTicker {
	return &mockTicker{c: make(chan time.Time, 1)}
}

func (m *mockTicker) C() <-chan time.Time { return m.c }
func (m *mockTicker) Stop()               {}
func (m *mockTicker) Tick()               { m.c <- time.Now() }

type mockStore struct {
	plants        []*PlantInstance
	saveCalled    int
	saveAllCalled int
}

func (ms *mockStore) SaveAll(g *Garden) error {
	ms.saveAllCalled++
	return nil
}

func (ms *mockStore) SavePlant(p *PlantInstance) error {
	ms.saveCalled++
	return nil
}

func TestSimulationTickDepletion(t *testing.T) {
	clock := &mockClock{now: time.Now()}
	ticker := newMockTicker()
	emitter := &NoopEventEmitter{}
	notifier := NewNotifyService()
	achievements := &AchievementService{}

	garden := &Garden{
		Plants: []*PlantInstance{
			{
				ID:             1,
				SpeciesID:      "test_plant",
				Name:           "Test",
				Water:          1.0,
				Sun:            1.0,
				Nutrients:      1.0,
				Micronutrients: 1.0,
				Health:         1.0,
				LastTickAt:     clock.Now(),
				Pests:          []PestInstance{},
			},
		},
		UnlockedAchievements: make(map[string]time.Time),
		Settings: map[string]string{
			"tick_interval_seconds":  "30",
			"minutes_per_game_hour":  "5",
			"catchup_max_game_hours": "8",
		},
	}

	species := map[string]*Species{
		"test_plant": {
			ID:                  "test_plant",
			WaterRate:           0.02,
			SunRate:             0.01,
			NutrientRate:        0.01,
			MicroRate:           0.005,
			GrowthHours:         []float64{5, 10, 15, 20, 25},
			PestVulnerabilities: []string{},
		},
	}

	sim := NewSimulation(garden, species, clock, ticker, nil, notifier, achievements, emitter)

	sim.applyTick()

	plant := garden.Plants[0]
	if plant.Water > 0.999 || plant.Water < 0.997 {
		t.Errorf("expected water ~0.998, got %f", plant.Water)
	}
}

func TestSimulationSunRegeneration(t *testing.T) {
	clock := &mockClock{now: time.Now()}
	ticker := newMockTicker()
	emitter := &NoopEventEmitter{}
	notifier := NewNotifyService()
	achievements := &AchievementService{}

	garden := &Garden{
		Plants: []*PlantInstance{
			{
				ID:             1,
				SpeciesID:      "test_plant",
				Name:           "Test",
				Water:          1.0,
				Sun:            0.5,
				Nutrients:      1.0,
				Micronutrients: 1.0,
				Health:         1.0,
				LastTickAt:     clock.Now(),
				Pests:          []PestInstance{},
			},
		},
		UnlockedAchievements: make(map[string]time.Time),
		Settings: map[string]string{
			"tick_interval_seconds":  "30",
			"minutes_per_game_hour":  "5",
			"catchup_max_game_hours": "8",
		},
	}

	species := map[string]*Species{
		"test_plant": {
			ID:                  "test_plant",
			SunRate:             0.01,
			WaterRate:           0.02,
			NutrientRate:        0.01,
			MicroRate:           0.005,
			GrowthHours:         []float64{5, 10, 15, 20, 25},
			PestVulnerabilities: []string{},
		},
	}

	sim := NewSimulation(garden, species, clock, ticker, nil, notifier, achievements, emitter)

	for i := 0; i < 100; i++ {
		sim.applyTick()
	}

	plant := garden.Plants[0]
	if plant.Sun < 0.9 {
		t.Errorf("expected sun to be near 1.0 after many ticks, got %f", plant.Sun)
	}
}

func TestSimulationHealthFormula(t *testing.T) {
	clock := &mockClock{now: time.Now()}
	ticker := newMockTicker()
	emitter := &NoopEventEmitter{}
	notifier := NewNotifyService()
	achievements := &AchievementService{}

	garden := &Garden{
		Plants: []*PlantInstance{
			{
				ID:             1,
				SpeciesID:      "test_plant",
				Name:           "Test",
				Water:          0.5,
				Sun:            0.5,
				Nutrients:      0.5,
				Micronutrients: 0.5,
				Health:         1.0,
				LastTickAt:     clock.Now(),
				Pests: []PestInstance{
					{PestID: "aphids", Severity: 0.3},
				},
			},
		},
		UnlockedAchievements: make(map[string]time.Time),
		Settings: map[string]string{
			"tick_interval_seconds":  "30",
			"minutes_per_game_hour":  "5",
			"catchup_max_game_hours": "8",
		},
	}

	species := map[string]*Species{
		"test_plant": {
			ID:                  "test_plant",
			WaterRate:           0.02,
			SunRate:             0.01,
			NutrientRate:        0.01,
			MicroRate:           0.005,
			GrowthHours:         []float64{5, 10, 15, 20, 25},
			PestVulnerabilities: []string{},
		},
	}

	sim := NewSimulation(garden, species, clock, ticker, nil, notifier, achievements, emitter)

	sim.applyTick()

	plant := garden.Plants[0]
	expectedHealth := clamp01(min4(plant.Water, plant.Sun, plant.Nutrients, plant.Micronutrients) * (1.0 - 0.3))

	if plant.Health < expectedHealth-0.05 || plant.Health > expectedHealth+0.05 {
		t.Errorf("expected health ~%f, got %f", expectedHealth, plant.Health)
	}
}

func TestSimulationDeath(t *testing.T) {
	clock := &mockClock{now: time.Now()}
	ticker := newMockTicker()
	emitter := &NoopEventEmitter{}
	notifier := NewNotifyService()
	achievements := &AchievementService{}

	plant := &PlantInstance{
		ID:             1,
		SpeciesID:      "test_plant",
		Name:           "Test",
		Water:          0.0,
		Sun:            0.0,
		Nutrients:      0.0,
		Micronutrients: 0.0,
		Health:         0.0,
		DeathHours:     0,
		LastTickAt:     clock.Now(),
		Pests:          []PestInstance{},
	}

	garden := &Garden{
		Plants:               []*PlantInstance{plant},
		UnlockedAchievements: make(map[string]time.Time),
		Settings: map[string]string{
			"tick_interval_seconds":  "30",
			"minutes_per_game_hour":  "5",
			"catchup_max_game_hours": "8",
		},
	}

	species := map[string]*Species{
		"test_plant": {
			ID:                  "test_plant",
			WaterRate:           0.02,
			SunRate:             0.01,
			NutrientRate:        0.01,
			MicroRate:           0.005,
			GrowthHours:         []float64{5, 10, 15, 20, 25},
			PestVulnerabilities: []string{},
		},
	}

	sim := NewSimulation(garden, species, clock, ticker, nil, notifier, achievements, emitter)

	for i := 0; i < 250; i++ {
		sim.applyTick()
	}

	if !plant.IsDead {
		t.Error("plant should be dead after 24+ game hours at health=0")
	}
}

func TestSimulationDeathRecovery(t *testing.T) {
	clock := &mockClock{now: time.Now()}
	ticker := newMockTicker()
	emitter := &NoopEventEmitter{}
	notifier := NewNotifyService()
	achievements := &AchievementService{}

	plant := &PlantInstance{
		ID:             1,
		SpeciesID:      "test_plant",
		Name:           "Test",
		Water:          0.0,
		Sun:            0.0,
		Nutrients:      0.0,
		Micronutrients: 0.0,
		Health:         0.0,
		DeathHours:     10,
		LastTickAt:     clock.Now(),
		Pests:          []PestInstance{},
	}

	garden := &Garden{
		Plants:               []*PlantInstance{plant},
		UnlockedAchievements: make(map[string]time.Time),
		Settings: map[string]string{
			"tick_interval_seconds":  "30",
			"minutes_per_game_hour":  "5",
			"catchup_max_game_hours": "8",
		},
	}

	species := map[string]*Species{
		"test_plant": {
			ID:                  "test_plant",
			WaterRate:           0.02,
			SunRate:             0.01,
			NutrientRate:        0.01,
			MicroRate:           0.005,
			GrowthHours:         []float64{5, 10, 15, 20, 25},
			PestVulnerabilities: []string{},
		},
	}

	sim := NewSimulation(garden, species, clock, ticker, nil, notifier, achievements, emitter)

	for i := 0; i < 30; i++ {
		sim.applyTick()
	}
	if plant.DeathHours <= 10 {
		t.Error("death hours should increase")
	}

	plant.Water = 1.0
	plant.Sun = 1.0
	plant.Nutrients = 1.0
	plant.Micronutrients = 1.0
	sim.applyTick()

	if plant.DeathHours != 0 {
		t.Errorf("death hours should reset after recovery, got %f", plant.DeathHours)
	}
}

func TestSimulationStageGrowth(t *testing.T) {
	clock := &mockClock{now: time.Now()}
	ticker := newMockTicker()
	emitter := &NoopEventEmitter{}
	notifier := NewNotifyService()
	achievements := &AchievementService{}

	plant := &PlantInstance{
		ID:             1,
		SpeciesID:      "test_plant",
		Name:           "Test",
		Water:          1.0,
		Sun:            1.0,
		Nutrients:      1.0,
		Micronutrients: 1.0,
		Health:         1.0,
		GrowthProgress: 0.95,
		Stage:          0,
		LastTickAt:     clock.Now(),
		Pests:          []PestInstance{},
	}

	garden := &Garden{
		Plants:               []*PlantInstance{plant},
		UnlockedAchievements: make(map[string]time.Time),
		Settings: map[string]string{
			"tick_interval_seconds":  "30",
			"minutes_per_game_hour":  "5",
			"catchup_max_game_hours": "8",
		},
	}

	species := map[string]*Species{
		"test_plant": {
			ID:                  "test_plant",
			WaterRate:           0.02,
			SunRate:             0.01,
			NutrientRate:        0.01,
			MicroRate:           0.005,
			GrowthHours:         []float64{5, 10, 15, 20, 25},
			PestVulnerabilities: []string{},
		},
	}

	sim := NewSimulation(garden, species, clock, ticker, nil, notifier, achievements, emitter)

	sim.applyTick()
	if plant.Stage == 1 {
		t.Error("should not advance to stage 1 yet")
	}

	plant.GrowthProgress = 0.99
	sim.applyTick()
	if plant.Stage != 1 {
		t.Error("should advance to stage 1")
	}
	if plant.GrowthProgress != 0 {
		t.Error("growth_progress should reset after stage change")
	}
}

func TestSimulationRunContext(t *testing.T) {
	clock := &mockClock{now: time.Now()}
	ticker := newMockTicker()
	emitter := &NoopEventEmitter{}
	notifier := NewNotifyService()
	achievements := &AchievementService{}

	garden := &Garden{
		Plants:               []*PlantInstance{},
		UnlockedAchievements: make(map[string]time.Time),
		Settings: map[string]string{
			"tick_interval_seconds": "30",
			"minutes_per_game_hour": "5",
		},
	}

	species := map[string]*Species{}

	sim := NewSimulation(garden, species, clock, ticker, nil, notifier, achievements, emitter)

	ctx, cancel := context.WithCancel(context.Background())

	done := make(chan struct{})
	go func() {
		sim.Run(ctx)
		close(done)
	}()

	time.Sleep(10 * time.Millisecond)
	cancel()

	select {
	case <-done:
	case <-time.After(1 * time.Second):
		t.Error("simulation Run() did not return after ctx cancel")
	}
}

func TestDeathCap(t *testing.T) {
	clock := &mockClock{now: time.Now()}
	ticker := newMockTicker()
	emitter := &NoopEventEmitter{}
	notifier := NewNotifyService()
	achievements := &AchievementService{}

	garden := &Garden{
		Plants:               []*PlantInstance{},
		UnlockedAchievements: make(map[string]time.Time),
		Settings: map[string]string{
			"tick_interval_seconds": "30",
			"minutes_per_game_hour": "5",
		},
	}

	species := map[string]*Species{}

	sim := NewSimulation(garden, species, clock, ticker, nil, notifier, achievements, emitter)

	cap := sim.deathCap()
	expected := 24.0 - 2.0*(30.0/(5.0*60.0))
	if cap < expected-0.01 || cap > expected+0.01 {
		t.Errorf("expected deathCap ~%f, got %f", expected, cap)
	}
}

func TestPestRatesFromManifest(t *testing.T) {
	clock := &mockClock{now: time.Now()}
	ticker := newMockTicker()
	emitter := &NoopEventEmitter{}
	notifier := NewNotifyService()
	achievements := &AchievementService{}

	plant := &PlantInstance{
		ID:        1,
		SpeciesID: "test_plant",
		Pests:     []PestInstance{},
	}
	garden := &Garden{
		Plants:               []*PlantInstance{plant},
		UnlockedAchievements: make(map[string]time.Time),
		Settings: map[string]string{
			"tick_interval_seconds": "30",
			"minutes_per_game_hour": "5",
		},
	}
	species := map[string]*Species{
		"test_plant": {
			ID:                  "test_plant",
			GrowthHours:         []float64{5, 10, 15, 20, 25},
			PestVulnerabilities: []string{"caterpillars"},
		},
	}

	sim := NewSimulation(garden, species, clock, ticker, nil, notifier, achievements, emitter)
	sim.SetPestTypes(map[string]*PestType{
		"caterpillars": {ID: "caterpillars", Name: "Caterpillars", BaseSpawnRate: 1.0, SeverityGrowthRate: 0.02},
	})

	// BaseSpawnRate 1.0 guarantees a spawn
	sim.maybeSpawnPest(plant, "caterpillars")
	if len(plant.Pests) != 1 {
		t.Fatalf("expected pest to spawn with rate 1.0, got %d pests", len(plant.Pests))
	}
	if plant.Pests[0].Severity != 0.05 {
		t.Errorf("expected initial severity 0.05, got %f", plant.Pests[0].Severity)
	}

	// Vulnerable species uses manifest severity growth rate
	sim.updatePestSeverity(plant, "caterpillars", 1.0)
	want := 0.05 + 0.02
	if plant.Pests[0].Severity < want-1e-9 || plant.Pests[0].Severity > want+1e-9 {
		t.Errorf("expected severity %f from manifest rate, got %f", want, plant.Pests[0].Severity)
	}
}

func TestPestRatesFallbackWithoutManifest(t *testing.T) {
	clock := &mockClock{now: time.Now()}
	ticker := newMockTicker()
	emitter := &NoopEventEmitter{}
	notifier := NewNotifyService()
	achievements := &AchievementService{}

	plant := &PlantInstance{
		ID:        1,
		SpeciesID: "test_plant",
		Pests:     []PestInstance{{PlantID: 1, PestID: "aphids", Severity: 0.05}},
	}
	garden := &Garden{
		Plants:               []*PlantInstance{plant},
		UnlockedAchievements: make(map[string]time.Time),
		Settings: map[string]string{
			"tick_interval_seconds": "30",
			"minutes_per_game_hour": "5",
		},
	}
	species := map[string]*Species{
		"test_plant": {
			ID:                  "test_plant",
			GrowthHours:         []float64{5, 10, 15, 20, 25},
			PestVulnerabilities: []string{"aphids"},
		},
	}

	sim := NewSimulation(garden, species, clock, ticker, nil, notifier, achievements, emitter)

	// Without SetPestTypes, legacy hardcoded rate applies (0.008 for vulnerable)
	sim.updatePestSeverity(plant, "aphids", 1.0)
	want := 0.05 + 0.008
	if plant.Pests[0].Severity < want-1e-9 || plant.Pests[0].Severity > want+1e-9 {
		t.Errorf("expected severity %f from fallback rate, got %f", want, plant.Pests[0].Severity)
	}
}

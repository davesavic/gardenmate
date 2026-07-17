package main

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"math/rand"
	"sync"
	"time"
)

const (
	sunRegenRate          = 0.15
	maxMidRunGap          = 30 * time.Minute
	pestCooldownGameHours = 24.0
	deathThreshold        = 24.0
	growthThreshold       = 0.2
)

type Clock interface {
	Now() time.Time
	Since(t time.Time) time.Duration
}

type RealClock struct{}

func (RealClock) Now() time.Time                 { return time.Now() }
func (RealClock) Since(t time.Time) time.Duration { return time.Since(t) }

type Ticker interface {
	C() <-chan time.Time
	Stop()
}

type RealTicker struct {
	t *time.Ticker
}

func (rt *RealTicker) C() <-chan time.Time { return rt.t.C }
func (rt *RealTicker) Stop()               { rt.t.Stop() }

func newRealTicker(d time.Duration) *RealTicker {
	return &RealTicker{t: time.NewTicker(d)}
}

type EventEmitter interface {
	EmitStateChanged(state GardenState)
	EmitNeedsAttention(plantID int64, stat string, value float64)
	EmitDied(plantID int64, speciesID string, posX, posY float64)
	EmitStageChanged(plantID int64, oldStage, newStage int)
	EmitAchievementUnlocked(achievementID, name string)
	EmitCatchupComplete(needsAttention int, missedAchievements []string, stageChanges int)
}

type NoopEventEmitter struct{}

func (NoopEventEmitter) EmitStateChanged(state GardenState)                           {}
func (NoopEventEmitter) EmitNeedsAttention(plantID int64, stat string, value float64) {}
func (NoopEventEmitter) EmitDied(plantID int64, speciesID string, posX, posY float64) {}
func (NoopEventEmitter) EmitStageChanged(plantID int64, oldStage, newStage int)       {}
func (NoopEventEmitter) EmitAchievementUnlocked(achievementID, name string)           {}
func (NoopEventEmitter) EmitCatchupComplete(needsAttention int, missedAchievements []string, stageChanges int) {
}

type SimulationService struct {
	garden              *Garden
	species             map[string]*Species
	pestTypes           map[string]*PestType
	clock               Clock
	ticker              Ticker
	tickerMu            sync.Mutex
	store               *StoreService
	notifier            *NotifyService
	achievements        *AchievementService
	emitter             EventEmitter
	isCatchingUp        bool
	missedAchievements  []string
	catchupStageChanges int
	countedForAttention []int64
	rand                *rand.Rand
}

func NewSimulation(
	garden *Garden,
	species map[string]*Species,
	clock Clock,
	ticker Ticker,
	store *StoreService,
	notifier *NotifyService,
	achievements *AchievementService,
	emitter EventEmitter,
) *SimulationService {
	return &SimulationService{
		garden:       garden,
		species:      species,
		clock:        clock,
		ticker:       ticker,
		store:        store,
		notifier:     notifier,
		achievements: achievements,
		emitter:      emitter,
		rand:         rand.New(rand.NewSource(clock.Now().UnixNano())),
	}
}

func (sim *SimulationService) Run(ctx context.Context) {
	slog.Debug("simulation loop started")
	defer slog.Debug("simulation loop stopped")

	for {
		select {
		case <-sim.ticker.C():
			sim.applyTick()
		case <-ctx.Done():
			return
		}
	}
}

func (sim *SimulationService) applyTick() {
	garden := sim.garden
	garden.Lock()
	defer garden.Unlock()

	settings := garden.Settings
	tickInterval := parseFloatSetting(settings, "tick_interval_seconds", 30)
	minutesPerGameHour := parseFloatSetting(settings, "minutes_per_game_hour", 5)
	gameHoursElapsed := tickInterval / (minutesPerGameHour * 60)

	now := sim.clock.Now()

	for _, plant := range garden.Plants {
		if plant.IsDead {
			continue
		}

		realElapsed := now.Sub(plant.LastTickAt)
		if realElapsed < 0 {
			realElapsed = 0
		}
		if realElapsed > maxMidRunGap {
			slog.Warn("large mid-run clock gap capped", "plantID", plant.ID, "gap", realElapsed)
			realElapsed = maxMidRunGap
		}

		gapHours := realElapsed.Minutes() / minutesPerGameHour
		if gapHours > 0 {
			gameHoursElapsed = gapHours
		}

		sp := sim.species[plant.SpeciesID]
		if sp == nil {
			continue
		}

		plant.Water = clamp01(plant.Water - sp.WaterRate*gameHoursElapsed)
		plant.Sun = clamp01(plant.Sun - sp.SunRate*gameHoursElapsed)
		plant.Nutrients = clamp01(plant.Nutrients - sp.NutrientRate*gameHoursElapsed)
		plant.Micronutrients = clamp01(plant.Micronutrients - sp.MicroRate*gameHoursElapsed)

		plant.Sun = clamp01(plant.Sun + sunRegenRate*gameHoursElapsed)

		var pestPenalty float64
		for _, pestType := range sp.PestVulnerabilities {
			if !sim.isCatchingUp {
				sim.maybeSpawnPest(plant, pestType)
			}
			sim.updatePestSeverity(plant, pestType, gameHoursElapsed)
		}
		for _, p := range plant.Pests {
			pestPenalty += p.Severity
		}
		pestPenalty = clamp01(pestPenalty)

		plant.Health = clamp01(min4(plant.Water, plant.Sun, plant.Nutrients, plant.Micronutrients) * (1 - pestPenalty))

		if !sim.isCatchingUp {
			plant.GameHoursAlive += gameHoursElapsed
		}

		if min4(plant.Water, plant.Sun, plant.Nutrients, plant.Micronutrients) > growthThreshold {
			if plant.Stage < sp.MaxStage() {
				totalGrowthHours := sp.GrowthHours[plant.Stage]
				if totalGrowthHours > 0 {
					plant.GrowthProgress += gameHoursElapsed / totalGrowthHours
					if plant.GrowthProgress >= 1.0 {
						plant.GrowthProgress = 0
						oldStage := plant.Stage
						plant.Stage++
						if !sim.isCatchingUp {
							sim.emitter.EmitStageChanged(plant.ID, oldStage, plant.Stage)
						} else {
							sim.catchupStageChanges++
						}
					}
				}
			} else {
				totalGrowthHours := sp.GrowthHours[sp.MaxStage()]
				if totalGrowthHours > 0 {
					plant.GrowthProgress += gameHoursElapsed / totalGrowthHours
					if plant.GrowthProgress >= 1.0 {
						plant.GrowthProgress = 0
					}
				}
			}
		}

		if plant.Health <= 0 {
			plant.DeathHours += gameHoursElapsed
			if !sim.isCatchingUp && plant.DeathHours >= deathThreshold {
				plant.IsDead = true
				sim.emitter.EmitDied(plant.ID, plant.SpeciesID, plant.PosX, plant.PosY)
			}
		} else {
			plant.DeathHours = 0
		}

		plant.LastTickAt = now
	}

	if !sim.isCatchingUp && sim.store != nil {
		if err := sim.store.SaveAll(garden); err != nil {
			slog.Error("SaveAll failed in tick", "error", err)
		}
	}

	if !sim.isCatchingUp {
		sim.notifier.DecrementSuppression()
		sim.notifier.CheckThresholds(garden.Plants, sim.species)
	}

	newUnlocks := sim.achievements.CheckAndUnlock(garden, sim.species, garden.UnlockedAchievements, now)
	for _, ach := range newUnlocks {
		garden.UnlockedAchievements[ach.ID] = now
		if !sim.isCatchingUp {
			sim.emitter.EmitAchievementUnlocked(ach.ID, ach.Name)
		} else {
			sim.missedAchievements = append(sim.missedAchievements, ach.ID)
		}
	}

	if !sim.isCatchingUp {
		sim.emitter.EmitStateChanged(garden.ToState())
	}
}

func (sim *SimulationService) runCatchUp() {
	sim.isCatchingUp = true
	sim.resetCatchupState()

	defer func() {
		sim.isCatchingUp = false
	}()

	garden := sim.garden
	garden.RLock()
	settings := garden.Settings
	var lastTick time.Time
	for _, plant := range garden.Plants {
		if plant.IsDead {
			continue
		}
		if plant.LastTickAt.After(lastTick) {
			lastTick = plant.LastTickAt
		}
	}
	garden.RUnlock()

	catchupMax := parseFloatSetting(settings, "catchup_max_game_hours", 8)
	minutesPerGameHour := parseFloatSetting(settings, "minutes_per_game_hour", 5)

	if lastTick.IsZero() {
		catchupMax = 0
	} else {
		realGap := sim.clock.Since(lastTick)
		if realGap < 0 {
			realGap = 0
		}
		gapGameHours := realGap.Minutes() / minutesPerGameHour
		if gapGameHours < catchupMax {
			catchupMax = gapGameHours
		}
	}

	var totalGameHours float64
	var needsAttentionCount int

	for totalGameHours < catchupMax {
		gameHoursStep := 1.0
		if totalGameHours+gameHoursStep > catchupMax {
			gameHoursStep = catchupMax - totalGameHours
		}

		garden.Lock()

		for _, plant := range garden.Plants {
			if plant.IsDead {
				continue
			}

			sp := sim.species[plant.SpeciesID]
			if sp == nil {
				continue
			}

			plant.Water = clamp01(plant.Water - sp.WaterRate*gameHoursStep)
			plant.Sun = clamp01(plant.Sun - sp.SunRate*gameHoursStep)
			plant.Nutrients = clamp01(plant.Nutrients - sp.NutrientRate*gameHoursStep)
			plant.Micronutrients = clamp01(plant.Micronutrients - sp.MicroRate*gameHoursStep)

			plant.Sun = clamp01(plant.Sun + sunRegenRate*gameHoursStep)

			for _, pestType := range sp.PestVulnerabilities {
				sim.updatePestSeverity(plant, pestType, gameHoursStep)
			}

			var pestPenalty float64
			for _, p := range plant.Pests {
				pestPenalty += p.Severity
			}
			pestPenalty = clamp01(pestPenalty)

			plant.Health = clamp01(min4(plant.Water, plant.Sun, plant.Nutrients, plant.Micronutrients) * (1 - pestPenalty))

			if min4(plant.Water, plant.Sun, plant.Nutrients, plant.Micronutrients) > growthThreshold {
				if plant.Stage < sp.MaxStage() {
					totalGrowthHours := sp.GrowthHours[plant.Stage]
					if totalGrowthHours > 0 {
						plant.GrowthProgress += gameHoursStep / totalGrowthHours
						if plant.GrowthProgress >= 1.0 {
							plant.GrowthProgress = 0
							oldStage := plant.Stage
							plant.Stage++
							sim.catchupStageChanges++
							_ = oldStage
						}
					}
				} else {
					totalGrowthHours := sp.GrowthHours[sp.MaxStage()]
					if totalGrowthHours > 0 {
						plant.GrowthProgress += gameHoursStep / totalGrowthHours
						if plant.GrowthProgress >= 1.0 {
							plant.GrowthProgress = 0
						}
					}
				}
			}

			if plant.Health <= 0 {
				plant.DeathHours += gameHoursStep
				cap := sim.deathCap()
				if plant.DeathHours > cap {
					plant.DeathHours = cap
				}
			} else {
				plant.DeathHours = 0
			}

			if plant.Water < 0.25 || plant.Sun < 0.25 || plant.Nutrients < 0.25 || plant.Micronutrients < 0.25 {
				if !containsID(sim.countedForAttention, plant.ID) {
					sim.countedForAttention = append(sim.countedForAttention, plant.ID)
					needsAttentionCount++
				}
			}

			plant.LastTickAt = sim.clock.Now()
		}

		now := sim.clock.Now()
		newUnlocks := sim.achievements.CheckAndUnlock(garden, sim.species, garden.UnlockedAchievements, now)
		for _, ach := range newUnlocks {
			garden.UnlockedAchievements[ach.ID] = now
			sim.missedAchievements = append(sim.missedAchievements, ach.ID)
		}

		garden.Unlock()

		totalGameHours += gameHoursStep
	}

	garden.Lock()
	if sim.store != nil {
		if err := sim.store.SaveAll(garden); err != nil {
			slog.Error("SaveAll failed after catch-up", "error", err)
		}
	}
	garden.Unlock()

	sim.notifier.SuppressFor(3)

	sim.notifier.SendCatchupSummary(needsAttentionCount)

	missedIDs := make([]string, len(sim.missedAchievements))
	copy(missedIDs, sim.missedAchievements)
	sim.emitter.EmitCatchupComplete(needsAttentionCount, missedIDs, sim.catchupStageChanges)
}

func (sim *SimulationService) deathCap() float64 {
	tickInterval := parseFloatSetting(sim.garden.Settings, "tick_interval_seconds", 30)
	minutesPerGameHour := parseFloatSetting(sim.garden.Settings, "minutes_per_game_hour", 5)
	tickGameHours := tickInterval / (minutesPerGameHour * 60)

	return 24 - 2*tickGameHours
}

// SetPestTypes provides per-pest spawn and severity rates from the manifest.
// When unset, hardcoded defaults are used.
func (sim *SimulationService) SetPestTypes(pestTypes map[string]*PestType) {
	sim.pestTypes = pestTypes
}

func (sim *SimulationService) maybeSpawnPest(plant *PlantInstance, pestID string) {
	for _, p := range plant.Pests {
		if p.PestID == pestID {
			return
		}
	}

	baseRate := 0.01
	if pt, ok := sim.pestTypes[pestID]; ok && pt.BaseSpawnRate > 0 {
		baseRate = pt.BaseSpawnRate
	}

	if sim.rand.Float64() < baseRate {
		pest := PestInstance{
			PlantID:  plant.ID,
			PestID:   pestID,
			Severity: 0.05,
		}
		plant.Pests = append(plant.Pests, pest)
	}
}

func (sim *SimulationService) updatePestSeverity(plant *PlantInstance, pestID string, gameHoursElapsed float64) {
	for i := range plant.Pests {
		if plant.Pests[i].PestID == pestID {
			if plant.Pests[i].TreatedAt != nil {
				treatedGameHours := sim.clock.Since(*plant.Pests[i].TreatedAt).Minutes() /
					parseFloatSetting(sim.garden.Settings, "minutes_per_game_hour", 5)
				if treatedGameHours < pestCooldownGameHours {
					return
				}
			}

			growthRate := 0.005
			vulnerable := false
			for _, sp := range sim.species[plant.SpeciesID].PestVulnerabilities {
				if sp == pestID {
					vulnerable = true
					break
				}
			}
			if pt, ok := sim.pestTypes[pestID]; ok && pt.SeverityGrowthRate > 0 {
				growthRate = pt.SeverityGrowthRate
				if !vulnerable {
					growthRate *= 0.6
				}
			} else if vulnerable {
				growthRate = 0.008
			}
			plant.Pests[i].Severity = clamp01(plant.Pests[i].Severity + growthRate*gameHoursElapsed)
			return
		}
	}
}

func (sim *SimulationService) resetCatchupState() {
	sim.missedAchievements = nil
	sim.catchupStageChanges = 0
	sim.countedForAttention = nil
}

func clamp01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

func min4(a, b, c, d float64) float64 {
	m := a
	if b < m {
		m = b
	}
	if c < m {
		m = c
	}
	if d < m {
		m = d
	}
	return m
}

func parseFloatSetting(settings map[string]string, key string, defaultVal float64) float64 {
	s, ok := settings[key]
	if !ok {
		return defaultVal
	}
	var v float64
	if _, err := fmt.Sscanf(s, "%f", &v); err != nil {
		return defaultVal
	}
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return defaultVal
	}
	return v
}

func containsID(ids []int64, id int64) bool {
	for _, x := range ids {
		if x == id {
			return true
		}
	}
	return false
}

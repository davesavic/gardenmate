package main

import (
	"testing"
	"time"
)

func TestAchievementGrowToStage(t *testing.T) {
	as := &AchievementService{
		byID: make(map[string]*Achievement),
		definitions: []Achievement{
			{ID: "reach_stage_3", Name: "Mature", Type: "grow_to_stage", Params: map[string]interface{}{"stage": float64(3)}},
			{ID: "reach_stage_4", Name: "Flowering", Type: "grow_to_stage", Params: map[string]interface{}{"stage": float64(4)}},
		},
	}

	garden := &Garden{
		Plants: []*PlantInstance{
			{ID: 1, Stage: 2, IsDead: false},
		},
		UnlockedAchievements: make(map[string]time.Time),
	}

	// No achievement should unlock at stage 2
	unlocks := as.CheckAndUnlock(garden, nil, garden.UnlockedAchievements, time.Now())
	if len(unlocks) != 0 {
		t.Errorf("expected 0 unlocks at stage 2, got %d", len(unlocks))
	}

	// Advance to stage 3
	garden.Plants[0].Stage = 3
	unlocks = as.CheckAndUnlock(garden, nil, garden.UnlockedAchievements, time.Now())
	if len(unlocks) != 1 {
		t.Fatalf("expected 1 unlock at stage 3, got %d", len(unlocks))
	}
	if unlocks[0].ID != "reach_stage_3" {
		t.Errorf("expected 'reach_stage_3', got %q", unlocks[0].ID)
	}

	// Mark as already unlocked
	garden.UnlockedAchievements["reach_stage_3"] = time.Now()
	unlocks = as.CheckAndUnlock(garden, nil, garden.UnlockedAchievements, time.Now())
	if len(unlocks) != 0 {
		t.Errorf("expected 0 unlocks after marking, got %d", len(unlocks))
	}

	// Dead plant should not trigger achievement
	garden.Plants[0].IsDead = true
	garden.Plants[0].Stage = 4
	delete(garden.UnlockedAchievements, "reach_stage_4")
	unlocks = as.CheckAndUnlock(garden, nil, garden.UnlockedAchievements, time.Now())
	if len(unlocks) != 0 {
		t.Errorf("expected 0 unlocks for dead plant, got %d", len(unlocks))
	}
}

func TestAchievementKeepAliveGameHours(t *testing.T) {
	as := &AchievementService{
		byID: make(map[string]*Achievement),
		definitions: []Achievement{
			{ID: "hours_ach", Name: "Hours", Type: "keep_alive_game_hours", Params: map[string]interface{}{"species_id": "snake_plant", "hours": float64(100)}},
		},
	}

	garden := &Garden{
		Plants: []*PlantInstance{
			{ID: 1, SpeciesID: "snake_plant", GameHoursAlive: 50, IsDead: false},
		},
		UnlockedAchievements: make(map[string]time.Time),
	}

	unlocks := as.CheckAndUnlock(garden, nil, garden.UnlockedAchievements, time.Now())
	if len(unlocks) != 0 {
		t.Errorf("expected 0 unlocks at 50 hours, got %d", len(unlocks))
	}

	garden.Plants[0].GameHoursAlive = 100
	unlocks = as.CheckAndUnlock(garden, nil, garden.UnlockedAchievements, time.Now())
	if len(unlocks) != 1 {
		t.Errorf("expected 1 unlock at 100 hours, got %d", len(unlocks))
	}
}

func TestIsUnlockAchievementMet(t *testing.T) {
	as := &AchievementService{}

	// nil (starter) always unlocked
	if !as.IsUnlockAchievementMet(nil, nil) {
		t.Error("starter (nil) should be unlocked")
	}

	achID := "some_ach"
	if as.IsUnlockAchievementMet(&achID, nil) {
		t.Error("should not be unlocked with nil map")
	}
	if as.IsUnlockAchievementMet(&achID, map[string]time.Time{}) {
		t.Error("should not be unlocked with empty map")
	}

	unlocked := map[string]time.Time{"some_ach": time.Now()}
	if !as.IsUnlockAchievementMet(&achID, unlocked) {
		t.Error("should be unlocked")
	}
}

func TestKeepAliveDays(t *testing.T) {
	as := &AchievementService{
		byID: make(map[string]*Achievement),
		definitions: []Achievement{
			{ID: "days_ach", Name: "Days", Type: "keep_alive_days", Params: map[string]interface{}{"days": float64(1)}},
		},
	}

	now := time.Now()
	threeDaysAgo := now.Add(-72 * time.Hour)

	starters := []string{"snake_plant", "spider_plant", "pothos"}

	t.Run("all alive long enough", func(t *testing.T) {
		garden := &Garden{
			Plants: []*PlantInstance{
				{ID: 1, SpeciesID: "snake_plant", IsDead: false, PlantedAt: threeDaysAgo},
				{ID: 2, SpeciesID: "spider_plant", IsDead: false, PlantedAt: threeDaysAgo},
				{ID: 3, SpeciesID: "pothos", IsDead: false, PlantedAt: threeDaysAgo},
			},
			UnlockedAchievements: make(map[string]time.Time),
		}

		unlocks := as.CheckAndUnlock(garden, nil, garden.UnlockedAchievements, now)
		if len(unlocks) != 1 {
			t.Errorf("expected 1 unlock, got %d", len(unlocks))
		}
	})

	t.Run("not all alive", func(t *testing.T) {
		garden := &Garden{
			Plants: []*PlantInstance{
				{ID: 1, SpeciesID: "snake_plant", IsDead: true, PlantedAt: threeDaysAgo},
				{ID: 2, SpeciesID: "spider_plant", IsDead: false, PlantedAt: threeDaysAgo},
				{ID: 3, SpeciesID: "pothos", IsDead: false, PlantedAt: threeDaysAgo},
			},
			UnlockedAchievements: make(map[string]time.Time),
		}

		unlocks := as.CheckAndUnlock(garden, nil, garden.UnlockedAchievements, now)
		if len(unlocks) != 0 {
			t.Errorf("expected 0 unlocks (not all alive), got %d", len(unlocks))
		}
	})

	t.Run("not long enough", func(t *testing.T) {
		recent := now.Add(-1 * time.Hour)
		garden := &Garden{
			Plants: []*PlantInstance{
				{ID: 1, SpeciesID: "snake_plant", IsDead: false, PlantedAt: recent},
				{ID: 2, SpeciesID: "spider_plant", IsDead: false, PlantedAt: recent},
				{ID: 3, SpeciesID: "pothos", IsDead: false, PlantedAt: recent},
			},
			UnlockedAchievements: make(map[string]time.Time),
		}

		unlocks := as.CheckAndUnlock(garden, nil, garden.UnlockedAchievements, now)
		if len(unlocks) != 0 {
			t.Errorf("expected 0 unlocks (too recent), got %d", len(unlocks))
		}
	})

	_ = starters
}

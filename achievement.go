package main

import (
	"fmt"
	"log/slog"
	"time"
)

type AchievementService struct {
	definitions []Achievement
	byID        map[string]*Achievement
}

func NewAchievementService(manifest *SpeciesManifest) *AchievementService {
	as := &AchievementService{
		definitions: manifest.Achievements,
		byID:        make(map[string]*Achievement),
	}
	for i := range manifest.Achievements {
		as.byID[manifest.Achievements[i].ID] = &manifest.Achievements[i]
	}
	return as
}

func (as *AchievementService) CheckAndUnlock(garden *Garden, species map[string]*Species, alreadyUnlocked map[string]time.Time, now time.Time) []Achievement {
	var newUnlocks []Achievement

	for i := range as.definitions {
		ach := &as.definitions[i]

		if _, ok := alreadyUnlocked[ach.ID]; ok {
			continue
		}

		if as.evaluateCondition(ach, garden, species, now) {
			newUnlocks = append(newUnlocks, *ach)
		}
	}

	return newUnlocks
}

func (as *AchievementService) evaluateCondition(ach *Achievement, garden *Garden, species map[string]*Species, now time.Time) bool {
	switch ach.Type {
	case "grow_to_stage":
		stage, ok := getNumberParam(ach.Params, "stage")
		if !ok {
			return false
		}
		targetStage := int(stage)
		for _, plant := range garden.Plants {
			if !plant.IsDead && plant.Stage >= targetStage {
				return true
			}
		}
		return false

	case "keep_alive_game_hours":
		speciesID, _ := getStringParam(ach.Params, "species_id")
		hours, ok := getNumberParam(ach.Params, "hours")
		if !ok || speciesID == "" {
			return false
		}
		for _, plant := range garden.Plants {
			if !plant.IsDead && plant.SpeciesID == speciesID && plant.GameHoursAlive >= hours {
				return true
			}
		}
		return false

	case "keep_alive_days":
		days, ok := getNumberParam(ach.Params, "days")
		if !ok {
			return false
		}
		starters := []string{"snake_plant", "spider_plant", "pothos"}
		var latestPlantedAt time.Time
		allAlive := true

		for _, starterID := range starters {
			found := false
			for _, plant := range garden.Plants {
				if !plant.IsDead && plant.SpeciesID == starterID {
					found = true
					if plant.PlantedAt.After(latestPlantedAt) {
						latestPlantedAt = plant.PlantedAt
					}
					break
				}
			}
			if !found {
				allAlive = false
				break
			}
		}

		if allAlive && !latestPlantedAt.IsZero() {
			duration := now.Sub(latestPlantedAt)
			return duration.Hours() >= days*24
		}
		return false

	case "treat_pests":
		count, ok := getNumberParam(ach.Params, "count")
		if !ok {
			return false
		}
		countStr, ok := garden.Settings["pests_treated_total"]
		if !ok {
			return false
		}
		var treatedCount int
		if _, err := fmt.Sscanf(countStr, "%d", &treatedCount); err != nil {
			return false
		}
		return float64(treatedCount) >= count

	default:
		slog.Warn("unknown achievement condition type", "type", ach.Type, "id", ach.ID)
		return false
	}
}

func (as *AchievementService) IsUnlockAchievementMet(achID *string, unlocked map[string]time.Time) bool {
	if achID == nil {
		return true
	}
	_, ok := unlocked[*achID]
	return ok
}

func (as *AchievementService) GetDefinition(id string) *Achievement {
	return as.byID[id]
}

func (as *AchievementService) GetAllDefinitions() []Achievement {
	return as.definitions
}

func getNumberParam(params map[string]interface{}, key string) (float64, bool) {
	v, ok := params[key]
	if !ok {
		return 0, false
	}
	switch n := v.(type) {
	case float64:
		return n, true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	default:
		return 0, false
	}
}

func getStringParam(params map[string]interface{}, key string) (string, bool) {
	v, ok := params[key]
	if !ok {
		return "", false
	}
	s, ok := v.(string)
	return s, ok
}

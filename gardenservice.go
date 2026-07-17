package main

import (
	"fmt"
	"math"
	"time"
)

// GardenService is the Wails v3 service that exposes garden operations to the frontend.
// Exported methods become auto-generated bindings.
type GardenService struct {
	garden       *Garden
	store        *StoreService
	plantService *PlantService
	achievements *AchievementService
	sim          *SimulationService
	emitter      EventEmitter
	compositorOK bool
}

// emitStateChangedLocked emits the current garden state.
// Caller must hold the garden lock (read or write).
func (gs *GardenService) emitStateChangedLocked() {
	if gs.emitter == nil {
		return
	}
	gs.emitter.EmitStateChanged(gs.garden.ToState())
}

// --- Binding methods (exported = frontend-accessible) ---

// GetGardenState returns the full garden snapshot including dead plants.
func (gs *GardenService) GetGardenState() GardenState {
	gs.garden.RLock()
	defer gs.garden.RUnlock()
	return gs.garden.ToState()
}

// AddPlant creates a new plant. If name is empty, the species name is used.
func (gs *GardenService) AddPlant(speciesID, name string, posX, posY float64) (*PlantInstance, error) {
	if math.IsNaN(posX) || math.IsNaN(posY) || math.IsInf(posX, 0) || math.IsInf(posY, 0) {
		return nil, fmt.Errorf("invalid position values")
	}

	sp := gs.plantService.GetByID(speciesID)
	if sp == nil {
		return nil, fmt.Errorf("unknown species: %q", speciesID)
	}

	if name == "" {
		name = sp.Name
	}

	gs.garden.Lock()

	if sp.UnlockAchievementID != nil {
		if _, ok := gs.garden.UnlockedAchievements[*sp.UnlockAchievementID]; !ok {
			gs.garden.Unlock()
			return nil, fmt.Errorf("species %q is locked", speciesID)
		}
	}

	id, err := gs.store.InsertPlant(speciesID, name, posX, posY)
	if err != nil {
		gs.garden.Unlock()
		return nil, fmt.Errorf("insert plant: %w", err)
	}

	plant, err := gs.garden.AddPlant(speciesID, name, posX, posY)
	if err != nil {
		gs.garden.Unlock()
		return nil, err
	}
	plant.ID = id

	gs.emitStateChangedLocked()
	gs.garden.Unlock()
	return plant, nil
}

// MovePlant moves a plant to new coordinates.
func (gs *GardenService) MovePlant(plantID int64, posX, posY float64) error {
	gs.garden.Lock()
	defer gs.garden.Unlock()

	if err := gs.garden.MovePlant(plantID, posX, posY); err != nil {
		return err
	}

	plant := gs.garden.FindPlant(plantID)
	if plant == nil {
		return fmt.Errorf("plant %d not found", plantID)
	}

	if err := gs.store.SavePlant(plant); err != nil {
		return err
	}
	gs.emitStateChangedLocked()
	return nil
}

// WaterPlant sets water to full.
func (gs *GardenService) WaterPlant(plantID int64) error {
	gs.garden.Lock()
	defer gs.garden.Unlock()

	if err := gs.garden.WaterPlant(plantID); err != nil {
		return err
	}

	plant := gs.garden.FindPlant(plantID)
	if plant == nil {
		return fmt.Errorf("plant %d not found", plantID)
	}

	if err := gs.store.SavePlant(plant); err != nil {
		return err
	}
	gs.emitStateChangedLocked()
	return nil
}

// FertilizePlant restores nutrients and micronutrients.
func (gs *GardenService) FertilizePlant(plantID int64) error {
	gs.garden.Lock()
	defer gs.garden.Unlock()

	if err := gs.garden.FertilizePlant(plantID); err != nil {
		return err
	}

	plant := gs.garden.FindPlant(plantID)
	if plant == nil {
		return fmt.Errorf("plant %d not found", plantID)
	}

	if err := gs.store.SavePlant(plant); err != nil {
		return err
	}
	gs.emitStateChangedLocked()
	return nil
}

// TreatPest treats a pest on a plant.
func (gs *GardenService) TreatPest(plantID int64, pestID string) error {
	gs.garden.Lock()
	defer gs.garden.Unlock()

	if err := gs.garden.TreatPest(plantID, pestID); err != nil {
		return err
	}

	currentStr := gs.garden.Settings["pests_treated_total"]
	current := 0
	fmt.Sscanf(currentStr, "%d", &current)
	current++
	gs.garden.Settings["pests_treated_total"] = fmt.Sprintf("%d", current)

	plant := gs.garden.FindPlant(plantID)
	if plant == nil {
		return fmt.Errorf("plant %d not found", plantID)
	}

	if err := gs.store.SavePlant(plant); err != nil {
		return err
	}
	gs.emitStateChangedLocked()
	return nil
}

// RemoveDeadPlant soft-deletes a dead plant (is_dead=true).
func (gs *GardenService) RemoveDeadPlant(plantID int64) error {
	gs.garden.Lock()
	defer gs.garden.Unlock()

	plant := gs.garden.FindPlant(plantID)
	if plant == nil {
		return fmt.Errorf("plant %d not found", plantID)
	}
	if !plant.IsDead {
		return fmt.Errorf("cannot remove living plant %d", plantID)
	}

	if err := gs.garden.RemovePlant(plantID); err != nil {
		return err
	}

	if err := gs.store.SavePlant(plant); err != nil {
		return err
	}
	gs.emitStateChangedLocked()
	return nil
}

// ReplantPlant replaces a dead plant with a new species in the same row.
func (gs *GardenService) ReplantPlant(plantID int64, speciesID string) (*PlantInstance, error) {
	sp := gs.plantService.GetByID(speciesID)
	if sp == nil {
		return nil, fmt.Errorf("unknown species: %q", speciesID)
	}

	gs.garden.Lock()
	defer gs.garden.Unlock()

	plant, err := gs.garden.ReplantPlant(plantID, speciesID)
	if err != nil {
		return nil, err
	}

	if err := gs.store.SavePlant(plant); err != nil {
		return nil, fmt.Errorf("save replanted plant: %w", err)
	}

	gs.emitStateChangedLocked()
	return plant, nil
}

// RenamePlant sets the plant's display name.
func (gs *GardenService) RenamePlant(plantID int64, name string) error {
	gs.garden.Lock()
	defer gs.garden.Unlock()

	if err := gs.garden.RenamePlant(plantID, name); err != nil {
		return err
	}

	plant := gs.garden.FindPlant(plantID)
	if plant == nil {
		return fmt.Errorf("plant %d not found", plantID)
	}

	if err := gs.store.SavePlant(plant); err != nil {
		return err
	}
	gs.emitStateChangedLocked()
	return nil
}

// CatalogEntry is returned by GetCatalog.
type CatalogEntry struct {
	Species  Species `json:"species"`
	Unlocked bool    `json:"unlocked"`
}

// GetCatalog returns all species with unlock status.
func (gs *GardenService) GetCatalog() []CatalogEntry {
	allSpecies := gs.plantService.GetAll()
	entries := make([]CatalogEntry, 0, len(allSpecies))

	for _, sp := range allSpecies {
		isUnlocked := gs.achievements.IsUnlockAchievementMet(sp.UnlockAchievementID, gs.garden.UnlockedAchievements)
		entries = append(entries, CatalogEntry{
			Species:  sp,
			Unlocked: isUnlocked,
		})
	}
	return entries
}

// AchievementInfo is returned by GetAchievements.
type AchievementInfo struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Unlocked    bool   `json:"unlocked"`
}

// GetAchievements returns all achievement definitions with unlock status.
func (gs *GardenService) GetAchievements() []AchievementInfo {
	allDefs := gs.achievements.GetAllDefinitions()
	infos := make([]AchievementInfo, 0, len(allDefs))

	for _, def := range allDefs {
		_, isUnlocked := gs.garden.UnlockedAchievements[def.ID]
		infos = append(infos, AchievementInfo{
			ID:          def.ID,
			Name:        def.Name,
			Description: def.Description,
			Unlocked:    isUnlocked,
		})
	}
	return infos
}

// ToggleWidgetMode is a placeholder for widget toggle.
func (gs *GardenService) ToggleWidgetMode() error {
	return nil
}

// UpdateSetting validates and persists a setting.
func (gs *GardenService) UpdateSetting(key, value string) error {
	if !isWritableSetting(key) {
		return fmt.Errorf("setting %q is read-only or unknown", key)
	}
	if isNumericSetting(key) {
		var v float64
		if _, err := fmt.Sscanf(value, "%f", &v); err != nil {
			return fmt.Errorf("non-numeric value for setting %q: %s", key, value)
		}
	}

	gs.garden.Lock()
	gs.garden.Settings[key] = value
	gs.garden.Unlock()

	gs.garden.RLock()
	defer gs.garden.RUnlock()
	return gs.store.SaveAll(gs.garden)
}

// GetSettings returns all settings.
func (gs *GardenService) GetSettings() map[string]string {
	gs.garden.RLock()
	defer gs.garden.RUnlock()
	result := make(map[string]string, len(gs.garden.Settings))
	for k, v := range gs.garden.Settings {
		result[k] = v
	}
	return result
}

// ResetGarden clears all plants, achievements, and re-seeds default settings.
func (gs *GardenService) ResetGarden() error {
	if err := gs.store.ResetGarden(); err != nil {
		return fmt.Errorf("reset garden: %w", err)
	}

	gs.garden.Lock()
	gs.garden.Plants = nil
	gs.garden.UnlockedAchievements = make(map[string]time.Time)
	settings, err := gs.store.LoadSettings()
	if err != nil {
		gs.garden.Unlock()
		return err
	}
	gs.garden.Settings = settings
	gs.emitStateChangedLocked()
	gs.garden.Unlock()
	return nil
}

// GetCompositorStatus returns the compositor/transparency detection result.
func (gs *GardenService) GetCompositorStatus() bool {
	return gs.compositorOK
}

// writable settings keys
var writableSettings = map[string]bool{
	"minutes_per_game_hour":  true,
	"catchup_max_game_hours": true,
	"tick_interval_seconds":  true,
	"widget_pos_x":           true,
	"widget_pos_y":           true,
	"widget_width":           true,
	"widget_height":          true,
	"widget_view_offset_x":   true,
	"widget_view_offset_y":   true,
}

var numericSettings = map[string]bool{
	"minutes_per_game_hour":  true,
	"catchup_max_game_hours": true,
	"tick_interval_seconds":  true,
	"widget_pos_x":           true,
	"widget_pos_y":           true,
	"widget_width":           true,
	"widget_height":          true,
	"widget_view_offset_x":   true,
	"widget_view_offset_y":   true,
}

func isWritableSetting(key string) bool {
	return writableSettings[key]
}

func isNumericSetting(key string) bool {
	return numericSettings[key]
}

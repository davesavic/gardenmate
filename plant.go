package main

import (
	"encoding/json"
	"fmt"
	"math"
)

// SpeciesManifest holds all parsed data from species.json
type SpeciesManifest struct {
	Version      int            `json:"version"`
	Species      []Species      `json:"species"`
	PestTypes    []PestType     `json:"pest_types"`
	SpeciesPests []SpeciesPest  `json:"species_pests"`  // populated at runtime from pest_vulnerabilities
	Achievements []Achievement  `json:"achievements"`
}

// Species represents a plant species definition
type Species struct {
	ID                    string          `json:"id"`
	Name                  string          `json:"name"`
	Category              string          `json:"category"`
	UnlockAchievementID   *string         `json:"unlock_achievement_id"`
	WaterRate             float64         `json:"water_rate"`
	SunRate               float64         `json:"sun_rate"`
	NutrientRate          float64         `json:"nutrient_rate"`
	MicroRate             float64         `json:"micro_rate"`
	GrowthHours           []float64       `json:"growth_hours"`
	VisualParams          VisualParams    `json:"visual_params"`
	PestVulnerabilities   []string        `json:"pest_vulnerabilities"`
}

// VisualParams holds rendering instructions for a species
type VisualParams struct {
	StemColor    string  `json:"stem_color"`
	LeafShape    string  `json:"leaf_shape"`
	LeafColor    string  `json:"leaf_color"`
	FlowerColor  *string `json:"flower_color"`
	FlowerShape  *string `json:"flower_shape"`
}

// PestType represents a pest definition
type PestType struct {
	ID                 string  `json:"id"`
	Name               string  `json:"name"`
	BaseSpawnRate      float64 `json:"base_spawn_rate"`
	SeverityGrowthRate float64 `json:"severity_growth_rate"`
}

// SpeciesPest links a species to a pest type (runtime-derived from pest_vulnerabilities)
type SpeciesPest struct {
	SpeciesID  string `json:"species_id"`
	PestTypeID string `json:"pest_type_id"`
}

// Achievement represents an achievement definition
type Achievement struct {
	ID          string             `json:"id"`
	Name        string             `json:"name"`
	Description string             `json:"description"`
	Type        string             `json:"type"`
	Params      map[string]interface{} `json:"params"`
}

// PlantService holds loaded species data (read-only after startup, no mutex needed)
type PlantService struct {
	manifest *SpeciesManifest
	byID     map[string]*Species
}

// LoadSpecies parses the embedded species.json.
// It also populates SpeciesPests from each species' pest_vulnerabilities.
// It validates ALL species after parsing.
func LoadSpecies(data []byte) (*PlantService, error) {
	var manifest SpeciesManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return nil, fmt.Errorf("failed to parse species.json: %w", err)
	}

	// Build pest type lookup for validation
	pestTypeIDs := make(map[string]bool)
	for _, pt := range manifest.PestTypes {
		pestTypeIDs[pt.ID] = true
	}

	// Validate pest_types
	for _, pt := range manifest.PestTypes {
		if pt.ID == "" {
			return nil, fmt.Errorf("pest_type has empty id")
		}
		if pt.Name == "" {
			return nil, fmt.Errorf("pest_type %q has empty name", pt.ID)
		}
	}

	// Validate achievements
	for _, a := range manifest.Achievements {
		if a.ID == "" {
			return nil, fmt.Errorf("achievement has empty id")
		}
		if a.Name == "" {
			return nil, fmt.Errorf("achievement %q has empty name", a.ID)
		}
		if a.Type == "" {
			return nil, fmt.Errorf("achievement %q has empty type", a.ID)
		}
	}

	ps := &PlantService{
		manifest: &manifest,
		byID:     make(map[string]*Species),
	}

	// Build SpeciesPests from each species' pest_vulnerabilities
	for _, s := range manifest.Species {
		for _, pestID := range s.PestVulnerabilities {
			if !pestTypeIDs[pestID] {
				return nil, fmt.Errorf("species %q references unknown pest type %q", s.ID, pestID)
			}
			manifest.SpeciesPests = append(manifest.SpeciesPests, SpeciesPest{
				SpeciesID:  s.ID,
				PestTypeID: pestID,
			})
		}
	}

	// Index and validate
	for i := range manifest.Species {
		sp := &manifest.Species[i]
		if err := sp.Validate(); err != nil {
			return nil, fmt.Errorf("species %q validation failed: %w", sp.ID, err)
		}
		if _, exists := ps.byID[sp.ID]; exists {
			return nil, fmt.Errorf("duplicate species id %q", sp.ID)
		}
		ps.byID[sp.ID] = sp
	}

	return ps, nil
}

// Validate checks species invariants
func (s *Species) Validate() error {
	if s.ID == "" {
		return fmt.Errorf("species id is required")
	}
	if s.Name == "" {
		return fmt.Errorf("species name is required")
	}
	if len(s.GrowthHours) != 5 {
		return fmt.Errorf("growth_hours must have exactly 5 entries, got %d", len(s.GrowthHours))
	}
	for i, h := range s.GrowthHours {
		if h <= 0 {
			return fmt.Errorf("growth_hours[%d] must be positive, got %f", i, h)
		}
	}
	if s.WaterRate < 0 {
		return fmt.Errorf("water_rate must be >= 0, got %f", s.WaterRate)
	}
	if s.SunRate < 0 {
		return fmt.Errorf("sun_rate must be >= 0, got %f", s.SunRate)
	}
	if s.NutrientRate < 0 {
		return fmt.Errorf("nutrient_rate must be >= 0, got %f", s.NutrientRate)
	}
	if s.MicroRate < 0 {
		return fmt.Errorf("micro_rate must be >= 0, got %f", s.MicroRate)
	}
	if math.IsNaN(s.WaterRate) || math.IsNaN(s.SunRate) || math.IsNaN(s.NutrientRate) || math.IsNaN(s.MicroRate) {
		return fmt.Errorf("rates must not be NaN")
	}
	if math.IsInf(s.WaterRate, 0) || math.IsInf(s.SunRate, 0) || math.IsInf(s.NutrientRate, 0) || math.IsInf(s.MicroRate, 0) {
		return fmt.Errorf("rates must not be Inf")
	}
	return nil
}

// SpeciesCount returns the total number of species
func (ps *PlantService) SpeciesCount() int {
	return len(ps.manifest.Species)
}

// GetByID looks up a species by ID (returns nil if not found)
func (ps *PlantService) GetByID(id string) *Species {
	return ps.byID[id]
}

// GetAll returns all species
func (ps *PlantService) GetAll() []Species {
	return ps.manifest.Species
}

// GetManifest returns the full manifest
func (ps *PlantService) GetManifest() *SpeciesManifest {
	return ps.manifest
}

// GetUnlocked returns species filtered by unlocked achievements.
// A species is unlocked if its UnlockAchievementID is nil (starter) or the referenced achievement is in the map.
func (ps *PlantService) GetUnlocked(unlocked map[string]bool) []Species {
	var result []Species
	for _, s := range ps.manifest.Species {
		if s.UnlockAchievementID == nil {
			result = append(result, s)
		} else if unlocked[*s.UnlockAchievementID] {
			result = append(result, s)
		}
	}
	return result
}

// GetByCategory returns species filtered by category
func (ps *PlantService) GetByCategory(category string) []Species {
	var result []Species
	for _, s := range ps.manifest.Species {
		if s.Category == category {
			result = append(result, s)
		}
	}
	return result
}

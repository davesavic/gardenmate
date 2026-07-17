package main

import (
	"fmt"
	"math"
	"sync"
	"time"
)

type PlantInstance struct {
	ID             int64
	SpeciesID      string
	Name           string
	PosX           float64
	PosY           float64
	ZIndex         int64
	Water          float64
	Sun            float64
	Nutrients      float64
	Micronutrients float64
	Health         float64
	IsDead         bool
	DeathHours     float64
	GameHoursAlive float64
	GrowthProgress float64
	Stage          int
	PlantedAt      time.Time
	LastTickAt     time.Time
	Pests          []PestInstance
}

type PestInstance struct {
	ID        int64
	PlantID   int64
	PestID    string
	Severity  float64
	TreatedAt *time.Time
}

type GardenState struct {
	Plants     []PlantState `json:"plants"`
	PlantCount int          `json:"plant_count"`
	DeadCount  int          `json:"dead_count"`
}

type PlantState struct {
	ID             int64       `json:"id"`
	SpeciesID      string      `json:"species_id"`
	Name           string      `json:"name"`
	PosX           float64     `json:"pos_x"`
	PosY           float64     `json:"pos_y"`
	ZIndex         int64       `json:"z_index"`
	Water          float64     `json:"water"`
	Sun            float64     `json:"sun"`
	Nutrients      float64     `json:"nutrients"`
	Micronutrients float64     `json:"micronutrients"`
	Health         float64     `json:"health"`
	IsDead         bool        `json:"is_dead"`
	DeathHours     float64     `json:"death_hours"`
	GameHoursAlive float64     `json:"game_hours_alive"`
	GrowthProgress float64     `json:"growth_progress"`
	Stage          int         `json:"stage"`
	Pests          []PestState `json:"pests"`
}

type PestState struct {
	PestID   string  `json:"pest_id"`
	Severity float64 `json:"severity"`
}

type Garden struct {
	mu                   sync.RWMutex
	Plants               []*PlantInstance
	UnlockedAchievements map[string]time.Time
	Settings             map[string]string
}

const (
	CanvasWidth       = 900.0
	CanvasHeight      = 600.0
	MaxPlantNameLength = 100
)

func (g *Garden) Lock() {
	g.mu.Lock()
}

func (g *Garden) Unlock() {
	g.mu.Unlock()
}

func (g *Garden) RLock() {
	g.mu.RLock()
}

func (g *Garden) RUnlock() {
	g.mu.RUnlock()
}

func (g *Garden) FindPlant(id int64) *PlantInstance {
	for _, p := range g.Plants {
		if p.ID == id {
			return p
		}
	}
	return nil
}

func (g *Garden) AddPlant(speciesID, name string, posX, posY float64) (*PlantInstance, error) {
	if math.IsNaN(posX) || math.IsNaN(posY) || math.IsInf(posX, 0) || math.IsInf(posY, 0) {
		return nil, fmt.Errorf("invalid position: NaN or Inf")
	}

	posX = clamp(posX, 0, CanvasWidth)
	posY = clamp(posY, 0, CanvasHeight)

	now := time.Now()

	plant := &PlantInstance{
		SpeciesID:      speciesID,
		Name:           name,
		PosX:           posX,
		PosY:           posY,
		ZIndex:         g.nextZIndex(),
		Water:          1.0,
		Sun:            1.0,
		Nutrients:      1.0,
		Micronutrients: 1.0,
		Health:         1.0,
		Stage:          0,
		PlantedAt:      now,
		LastTickAt:     now,
		Pests:          []PestInstance{},
	}
	g.Plants = append(g.Plants, plant)
	return plant, nil
}

func (g *Garden) nextZIndex() int64 {
	maxZ := int64(0)
	for _, p := range g.Plants {
		if p.ZIndex > maxZ {
			maxZ = p.ZIndex
		}
	}
	return maxZ + 1
}

func (g *Garden) RemovePlant(id int64) error {
	plant := g.FindPlant(id)
	if plant == nil {
		return fmt.Errorf("plant %d not found", id)
	}
	plant.IsDead = true
	return nil
}

func (g *Garden) ReplantPlant(id int64, speciesID string) (*PlantInstance, error) {
	plant := g.FindPlant(id)
	if plant == nil {
		return nil, fmt.Errorf("plant %d not found", id)
	}
	if !plant.IsDead {
		return nil, fmt.Errorf("plant %d is still alive, cannot replant", id)
	}

	plant.SpeciesID = speciesID
	plant.Water = 1.0
	plant.Sun = 1.0
	plant.Nutrients = 1.0
	plant.Micronutrients = 1.0
	plant.Health = 1.0
	plant.IsDead = false
	plant.DeathHours = 0
	plant.GameHoursAlive = 0
	plant.GrowthProgress = 0
	plant.Stage = 0
	plant.PlantedAt = time.Now()
	plant.LastTickAt = time.Now()
	plant.Pests = []PestInstance{}

	return plant, nil
}

func (g *Garden) MovePlant(id int64, x, y float64) error {
	if math.IsNaN(x) || math.IsNaN(y) || math.IsInf(x, 0) || math.IsInf(y, 0) {
		return fmt.Errorf("invalid position: NaN or Inf")
	}

	plant := g.FindPlant(id)
	if plant == nil {
		return fmt.Errorf("plant %d not found", id)
	}

	plant.PosX = clamp(x, 0, CanvasWidth)
	plant.PosY = clamp(y, 0, CanvasHeight)
	plant.ZIndex = g.nextZIndex()
	return nil
}

func (g *Garden) WaterPlant(id int64) error {
	plant := g.FindPlant(id)
	if plant == nil {
		return fmt.Errorf("plant %d not found", id)
	}
	if plant.IsDead {
		return nil
	}
	plant.Water = 1.0
	return nil
}

func (g *Garden) FertilizePlant(id int64) error {
	plant := g.FindPlant(id)
	if plant == nil {
		return fmt.Errorf("plant %d not found", id)
	}
	if plant.IsDead {
		return nil
	}
	plant.Nutrients = 1.0
	plant.Micronutrients = 1.0
	return nil
}

func (g *Garden) TreatPest(id int64, pestID string) error {
	plant := g.FindPlant(id)
	if plant == nil {
		return fmt.Errorf("plant %d not found", id)
	}
	for i := range plant.Pests {
		if plant.Pests[i].PestID == pestID {
			now := time.Now()
			plant.Pests[i].Severity = 0
			plant.Pests[i].TreatedAt = &now
			return nil
		}
	}
	return fmt.Errorf("pest %q not found on plant %d", pestID, id)
}

func (g *Garden) RenamePlant(id int64, name string) error {
	if len(name) == 0 {
		return fmt.Errorf("plant name cannot be empty")
	}
	if len(name) > MaxPlantNameLength {
		return fmt.Errorf("plant name too long (max %d chars)", MaxPlantNameLength)
	}

	plant := g.FindPlant(id)
	if plant == nil {
		return fmt.Errorf("plant %d not found", id)
	}
	plant.Name = name
	return nil
}

func (g *Garden) GetVisible(canvasWidth, canvasHeight float64) []*PlantInstance {
	var visible []*PlantInstance
	for _, p := range g.Plants {
		if p.PosX >= 0 && p.PosX <= canvasWidth && p.PosY >= 0 && p.PosY <= canvasHeight {
			visible = append(visible, p)
		}
	}
	return visible
}

func (g *Garden) GetWidgetVisible(widgetWidth, widgetHeight, offsetX, offsetY float64) []*PlantInstance {
	var visible []*PlantInstance
	for _, p := range g.Plants {
		if p.PosX >= offsetX && p.PosX <= offsetX+widgetWidth &&
			p.PosY >= offsetY && p.PosY <= offsetY+widgetHeight {
			visible = append(visible, p)
		}
	}
	return visible
}

func (g *Garden) ToState() GardenState {
	state := GardenState{
		Plants: make([]PlantState, 0, len(g.Plants)),
	}
	var deadCount int
	for _, p := range g.Plants {
		ps := PlantState{
			ID:             p.ID,
			SpeciesID:      p.SpeciesID,
			Name:           p.Name,
			PosX:           p.PosX,
			PosY:           p.PosY,
			ZIndex:         p.ZIndex,
			Water:          p.Water,
			Sun:            p.Sun,
			Nutrients:      p.Nutrients,
			Micronutrients: p.Micronutrients,
			Health:         p.Health,
			IsDead:         p.IsDead,
			DeathHours:     p.DeathHours,
			GameHoursAlive: p.GameHoursAlive,
			GrowthProgress: p.GrowthProgress,
			Stage:          p.Stage,
			Pests:          make([]PestState, 0, len(p.Pests)),
		}
		for _, pest := range p.Pests {
			ps.Pests = append(ps.Pests, PestState{
				PestID:   pest.PestID,
				Severity: pest.Severity,
			})
		}
		if p.IsDead {
			deadCount++
		}
		state.Plants = append(state.Plants, ps)
	}
	state.PlantCount = len(g.Plants) - deadCount
	state.DeadCount = deadCount
	return state
}

func clamp(v, min, max float64) float64 {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}

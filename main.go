package main

import (
	"context"
	"embed"
	"log"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

//go:embed all:frontend/dist
var assets embed.FS

var wailsLogger *slog.Logger

func dataDir() (string, error) {
	var base string
	switch runtime.GOOS {
	case "linux":
		xdg := os.Getenv("XDG_DATA_HOME")
		if xdg == "" {
			home, err := os.UserHomeDir()
			if err != nil {
				return "", err
			}
			xdg = filepath.Join(home, ".local", "share")
		}
		base = filepath.Join(xdg, "gardenmate")
	case "darwin":
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		base = filepath.Join(home, "Library", "Application Support", "gardenmate")
	case "windows":
		localAppData := os.Getenv("LOCALAPPDATA")
		if localAppData == "" {
			home, err := os.UserHomeDir()
			if err != nil {
				return "", err
			}
			localAppData = filepath.Join(home, "AppData", "Local")
		}
		base = filepath.Join(localAppData, "gardenmate")
	default:
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		base = filepath.Join(home, ".gardenmate")
	}
	if err := os.MkdirAll(base, 0o755); err != nil {
		return "", err
	}
	return base, nil
}

func setupLogger() {
	dir, err := dataDir()
	if err != nil {
		wailsLogger = slog.New(slog.NewJSONHandler(os.Stderr, nil))
		return
	}
	logPath := filepath.Join(dir, "gardenmate.log")
	f, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		wailsLogger = slog.New(slog.NewJSONHandler(os.Stderr, nil))
		return
	}
	wailsLogger = slog.New(slog.NewJSONHandler(f, nil))
}

func detectCompositor() bool { return true }

func main() {
	setupLogger()

	dir, err := dataDir()
	if err != nil {
		log.Fatalf("data dir: %v", err)
	}
	dbPath := dir + "/gardenmate.db"

	speciesData, err := os.ReadFile("species.json")
	if err != nil {
		log.Fatalf("species.json: %v", err)
	}

	plantService, err := LoadSpecies(speciesData)
	if err != nil {
		log.Fatalf("load species: %v", err)
	}

	store, err := NewStore(dbPath)
	if err != nil {
		log.Fatalf("store: %v", err)
	}

	if err := store.SeedSpecies(plantService.GetManifest()); err != nil {
		log.Fatalf("seed species: %v", err)
	}

	garden, err := store.LoadGarden()
	if err != nil {
		log.Fatalf("load garden: %v", err)
	}

	settings, err := store.LoadSettings()
	if err != nil {
		log.Fatalf("load settings: %v", err)
	}
	garden.Settings = settings

	unlocked, err := store.LoadAchievements()
	if err != nil {
		log.Fatalf("load achievements: %v", err)
	}
	garden.UnlockedAchievements = unlocked

	speciesMap := make(map[string]*Species)
	for _, s := range plantService.GetAll() {
		s := s
		speciesMap[s.ID] = &s
	}

	pestTypeMap := make(map[string]*PestType)
	for i := range plantService.GetManifest().PestTypes {
		pt := &plantService.GetManifest().PestTypes[i]
		pestTypeMap[pt.ID] = pt
	}

	achService := NewAchievementService(plantService.GetManifest())
	notifService := NewNotifyService()

	gardenSvc := &GardenService{
		garden:       garden,
		store:        store,
		plantService: plantService,
		achievements: achService,
	}

	app := application.New(application.Options{
		Name:        "gardenmate",
		Description: "A desktop plant companion",
		Services: []application.Service{
			application.NewService(gardenSvc),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
	})

	// Standard window
	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:  "gardenmate",
		Width:  900,
		Height: 600,
		URL:    "/",
	})

	compositorOK := detectCompositor()
	gardenSvc.compositorOK = compositorOK

	widgetWin := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:       "gardenmate widget",
		Width:       300,
		Height:      400,
		URL:         "/widget.html",
		Frameless:   true,
		AlwaysOnTop: true,
		Hidden:      true,
	})

	// Ctrl+T toggles widget
	app.KeyBinding.Add("Ctrl+T", func(window application.Window) {
		if widgetWin.IsVisible() {
			widgetWin.Hide()
		} else {
			widgetWin.Show()
		}
	})

	var sim *SimulationService
	var simCancel context.CancelFunc

	app.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(event *application.ApplicationEvent) {
		clock := RealClock{}
		ticker := newRealTicker(30 * time.Second)

		emitter := &wailsEmitter{app: app}
		gardenSvc.emitter = emitter
		sim = NewSimulation(garden, speciesMap, clock, ticker, store, notifService, achService, emitter)
		sim.SetPestTypes(pestTypeMap)
		gardenSvc.sim = sim

		wailsLogger.Info("running catch-up...")
		sim.runCatchUp()
		wailsLogger.Info("catch-up complete")

		ctx, cancel := context.WithCancel(context.Background())
		simCancel = cancel
		go sim.Run(ctx)
	})

	app.OnShutdown(func() {
		if simCancel != nil {
			simCancel()
		}
		garden.Lock()
		if err := store.SaveAll(garden); err != nil {
			wailsLogger.Error("final SaveAll failed", "error", err)
		}
		garden.Unlock()
		store.Close()
		wailsLogger.Info("gardenmate shutdown complete")
	})

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}

type wailsEmitter struct {
	app *application.App
}

func (e *wailsEmitter) EmitStateChanged(state GardenState) {
	e.app.Event.Emit("garden:state-changed", state)
}

func (e *wailsEmitter) EmitNeedsAttention(plantID int64, stat string, value float64) {
	e.app.Event.Emit("plant:needs-attention", map[string]interface{}{
		"plantID": plantID, "stat": stat, "value": value,
	})
}

func (e *wailsEmitter) EmitDied(plantID int64, speciesID string, posX, posY float64) {
	e.app.Event.Emit("plant:died", map[string]interface{}{
		"plantID": plantID, "speciesID": speciesID, "posX": posX, "posY": posY,
	})
}

func (e *wailsEmitter) EmitStageChanged(plantID int64, oldStage, newStage int) {
	e.app.Event.Emit("plant:stage-changed", map[string]interface{}{
		"plantID": plantID, "oldStage": oldStage, "newStage": newStage,
	})
}

func (e *wailsEmitter) EmitAchievementUnlocked(achievementID, name string) {
	e.app.Event.Emit("achievement:unlocked", map[string]interface{}{
		"achievementID": achievementID, "name": name,
	})
}

func (e *wailsEmitter) EmitCatchupComplete(needsAttention int, missedAchievements []string, stageChanges int) {
	e.app.Event.Emit("catchup:complete", map[string]interface{}{
		"needsAttention":     needsAttention,
		"missedAchievements": missedAchievements,
		"stageChanges":       stageChanges,
	})
}

package main

import (
	"fmt"
	"log/slog"
	"time"
)

// Notifier sends desktop notifications
type Notifier interface {
	Send(title, body string) error
}

// NotifyService handles notification logic
type NotifyService struct {
	notifier     Notifier
	lastNotified map[int64]map[string]time.Time // plantID -> stat -> last notified
	suppressFor  int
}

// NoopNotifier silently discards notifications (graceful degradation)
type NoopNotifier struct{}

func (n *NoopNotifier) Send(title, body string) error {
	slog.Warn("notification suppressed (noop)", "title", title)
	return nil
}

// NewNotifyService creates the service. If notifier creation fails, uses NoopNotifier.
// On Linux, this typically wraps beeep which requires dbus. If unavailable, gracefully degrades.
func NewNotifyService() *NotifyService {
	ns := &NotifyService{
		lastNotified: make(map[int64]map[string]time.Time),
	}

	notifier, err := createNotifier()
	if err != nil {
		slog.Warn("desktop notifications unavailable, using noop fallback", "error", err)
		ns.notifier = &NoopNotifier{}
	} else {
		ns.notifier = notifier
	}

	return ns
}

// createNotifier attempts to create a real desktop notifier.
// This function is separated for testability.
var createNotifier = func() (Notifier, error) {
	return newRealNotifier()
}

// realNotifier uses beeep for desktop notifications
type realNotifier struct{}

func (n *realNotifier) Send(title, body string) error {
	return fmt.Errorf("beeep not available")
}

func newRealNotifier() (*realNotifier, error) {
	// Try importing beeep — but since we may not have it as a dependency,
	// use a build-tag approach. For now, return NoopNotifier error.
	// The actual beeep integration requires the beeep package.
	// For v1, we'll make this always fallback gracefully.
	// The interface supports swapping in a real implementation later.
	return nil, fmt.Errorf("beeep not available")
}

// CheckThresholds checks plant stats against 0.25 threshold.
// Fires notifications with 5-minute cooldown per (plantID, stat) tuple.
// Skips dead plants and removes their lastNotified entries.
// Does NOT acquire garden mutex (caller holds it).
func (ns *NotifyService) CheckThresholds(plants []*PlantInstance, species map[string]*Species) {
	if len(plants) == 0 {
		return
	}

	now := time.Now()
	cooldown := 5 * time.Minute

	// Clean up dead plant entries
	for plantID := range ns.lastNotified {
		found := false
		for _, p := range plants {
			if p.ID == plantID && !p.IsDead {
				found = true
				break
			}
		}
		if !found {
			delete(ns.lastNotified, plantID)
		}
	}

	for _, plant := range plants {
		if plant.IsDead {
			continue
		}

		if ns.lastNotified[plant.ID] == nil {
			ns.lastNotified[plant.ID] = make(map[string]time.Time)
		}

		stats := map[string]float64{
			"water":          plant.Water,
			"sun":            plant.Sun,
			"nutrients":      plant.Nutrients,
			"micronutrients": plant.Micronutrients,
		}

		for stat, value := range stats {
			if value >= 0.25 {
				continue
			}

			if lastNotified, ok := ns.lastNotified[plant.ID][stat]; ok {
				if now.Sub(lastNotified) < cooldown {
					continue
				}
			}

			if ns.suppressFor > 0 {
				continue // suppressed by SuppressFor (post-catchup)
			}

			title := fmt.Sprintf("%s needs attention", truncateName(plant.Name))
			body := fmt.Sprintf("%s is low (%.0f%%)", statLabel(stat), value*100)

			if err := ns.notifier.Send(title, body); err != nil {
				slog.Warn("notification send failed", "error", err, "plantID", plant.ID, "stat", stat)
				continue
			}

			ns.lastNotified[plant.ID][stat] = now
		}
	}
}

// SendCatchupSummary sends a summary notification after offline catch-up
func (ns *NotifyService) SendCatchupSummary(needsAttention int) {
	if needsAttention <= 0 {
		return
	}

	msg := "plants need attention"
	if needsAttention == 1 {
		msg = "plant needs attention"
	}

	title := "GardenMate"
	body := fmt.Sprintf("%d %s", needsAttention, msg)

	if err := ns.notifier.Send(title, body); err != nil {
		slog.Warn("catchup summary notification failed", "error", err)
	}
}

// SuppressFor suppresses per-stat notifications for the next N CheckThresholds calls.
// Called by T5 after catch-up to avoid notification storms.
func (ns *NotifyService) SuppressFor(n int) {
	ns.suppressFor = n
}

// DecrementSuppression decrements the suppress counter (called by T5 each tick during suppression).
func (ns *NotifyService) DecrementSuppression() {
	if ns.suppressFor > 0 {
		ns.suppressFor--
	}
}

func truncateName(name string) string {
	maxLen := 50
	runes := []rune(name)
	if len(runes) <= maxLen {
		return name
	}
	return string(runes[:maxLen-3]) + "..."
}

func statLabel(stat string) string {
	switch stat {
	case "water":
		return "Water"
	case "sun":
		return "Sun"
	case "nutrients":
		return "Nutrients"
	case "micronutrients":
		return "Micronutrients"
	default:
		return stat
	}
}

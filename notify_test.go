package main

import (
	"testing"
	"time"
)

type testNotifier struct {
	calls []call
}

type call struct {
	title string
	body  string
}

func (tn *testNotifier) Send(title, body string) error {
	tn.calls = append(tn.calls, call{title: title, body: body})
	return nil
}

func TestNotifyCheckThresholds(t *testing.T) {
	ns := &NotifyService{
		notifier:     &testNotifier{},
		lastNotified: make(map[int64]map[string]time.Time),
	}

	plants := []*PlantInstance{
		{
			ID:             1,
			Name:           "Test Plant",
			Water:          0.2,
			Sun:            0.8,
			Nutrients:      0.8,
			Micronutrients: 0.8,
		},
	}

	ns.CheckThresholds(plants, nil)

	notifier := ns.notifier.(*testNotifier)
	if len(notifier.calls) != 1 {
		t.Fatalf("expected 1 notification, got %d", len(notifier.calls))
	}
	if notifier.calls[0].title != "Test Plant needs attention" {
		t.Errorf("unexpected title: %q", notifier.calls[0].title)
	}
}

func TestNotifyCooldown(t *testing.T) {
	ns := &NotifyService{
		notifier:     &testNotifier{},
		lastNotified: make(map[int64]map[string]time.Time),
	}

	plants := []*PlantInstance{
		{ID: 1, Name: "Test Plant", Water: 0.2, Sun: 0.8, Nutrients: 0.8, Micronutrients: 0.8},
	}

	// First call
	ns.CheckThresholds(plants, nil)
	notifier := ns.notifier.(*testNotifier)
	if len(notifier.calls) != 1 {
		t.Fatalf("expected 1 notification, got %d", len(notifier.calls))
	}

	// Second call immediately (cooldown active)
	ns.CheckThresholds(plants, nil)
	if len(notifier.calls) != 1 {
		t.Errorf("expected still 1 notification (cooldown), got %d", len(notifier.calls))
	}
}

func TestNotifySkipDeadPlants(t *testing.T) {
	ns := &NotifyService{
		notifier:     &testNotifier{},
		lastNotified: make(map[int64]map[string]time.Time),
	}

	plants := []*PlantInstance{
		{ID: 1, Name: "Dead Plant", Water: 0.1, IsDead: true},
		{ID: 2, Name: "Alive Plant", Water: 0.2, Sun: 0.8, Nutrients: 0.8, Micronutrients: 0.8},
	}

	ns.CheckThresholds(plants, nil)

	notifier := ns.notifier.(*testNotifier)
	if len(notifier.calls) != 1 {
		t.Fatalf("expected 1 notification (only alive), got %d", len(notifier.calls))
	}
	if notifier.calls[0].title != "Alive Plant needs attention" {
		t.Errorf("expected alive plant notification, got %q", notifier.calls[0].title)
	}
}

func TestNotifySuppressFor(t *testing.T) {
	ns := &NotifyService{
		notifier:     &testNotifier{},
		lastNotified: make(map[int64]map[string]time.Time),
	}

	plants := []*PlantInstance{
		{ID: 1, Name: "Test Plant", Water: 0.1, Sun: 0.1, Nutrients: 0.1, Micronutrients: 0.1},
	}

	ns.SuppressFor(1)

	// First call: suppressed
	ns.CheckThresholds(plants, nil)
	notifier := ns.notifier.(*testNotifier)
	if len(notifier.calls) != 0 {
		t.Errorf("expected 0 notifications (suppressed), got %d", len(notifier.calls))
	}

	// Decrement suppression and try again
	ns.DecrementSuppression()
	ns.CheckThresholds(plants, nil)
	if len(notifier.calls) == 0 {
		t.Error("expected notifications after suppression ends")
	}
}

func TestSendCatchupSummary(t *testing.T) {
	ns := &NotifyService{
		notifier: &testNotifier{},
	}

	ns.SendCatchupSummary(0)
	notifier := ns.notifier.(*testNotifier)
	if len(notifier.calls) != 0 {
		t.Errorf("expected 0 calls for 0 plants, got %d", len(notifier.calls))
	}

	ns.SendCatchupSummary(3)
	if len(notifier.calls) != 1 {
		t.Fatalf("expected 1 call, got %d", len(notifier.calls))
	}
	if notifier.calls[0].body != "3 plants need attention" {
		t.Errorf("unexpected body: %q", notifier.calls[0].body)
	}
}

func TestNoopNotifier(t *testing.T) {
	noop := &NoopNotifier{}
	if err := noop.Send("test", "test body"); err != nil {
		t.Errorf("NoopNotifier should not return error: %v", err)
	}
}

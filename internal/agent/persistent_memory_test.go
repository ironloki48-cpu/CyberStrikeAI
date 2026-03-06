package agent

import (
	"database/sql"
	"fmt"
	"strings"
	"testing"

	_ "github.com/mattn/go-sqlite3"
	"go.uber.org/zap"
)

func newTestPersistentMemory(t *testing.T) *PersistentMemory {
	t.Helper()

	db, err := sql.Open("sqlite3", "file::memory:?cache=shared")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})

	pm, err := NewPersistentMemory(db, zap.NewNop())
	if err != nil {
		t.Fatalf("create persistent memory: %v", err)
	}
	return pm
}

func TestPersistentMemoryStoreFull_NonEntityScopesByConversationAndCategory(t *testing.T) {
	pm := newTestPersistentMemory(t)

	e1, err := pm.StoreFull("same-key", "v1", MemoryCategoryFact, "conv-a", "", MemoryConfidenceMedium, MemoryStatusActive)
	if err != nil {
		t.Fatalf("store e1: %v", err)
	}
	e2, err := pm.StoreFull("same-key", "v2", MemoryCategoryFact, "conv-b", "", MemoryConfidenceMedium, MemoryStatusActive)
	if err != nil {
		t.Fatalf("store e2: %v", err)
	}
	if e1.ID == e2.ID {
		t.Fatalf("expected different records for different conversations when entity is empty")
	}

	e2Updated, err := pm.StoreFull("same-key", "v2-updated", MemoryCategoryFact, "conv-b", "", MemoryConfidenceMedium, MemoryStatusActive)
	if err != nil {
		t.Fatalf("update e2: %v", err)
	}
	if e2.ID != e2Updated.ID {
		t.Fatalf("expected in-conversation upsert to update existing record")
	}

	e3, err := pm.StoreFull("global-key", "fact-value", MemoryCategoryFact, "", "", MemoryConfidenceMedium, MemoryStatusActive)
	if err != nil {
		t.Fatalf("store e3: %v", err)
	}
	e4, err := pm.StoreFull("global-key", "note-value", MemoryCategoryNote, "", "", MemoryConfidenceMedium, MemoryStatusActive)
	if err != nil {
		t.Fatalf("store e4: %v", err)
	}
	if e3.ID == e4.ID {
		t.Fatalf("expected different records for same key across categories without conversation/entity")
	}

	all, err := pm.ListAll("", 100)
	if err != nil {
		t.Fatalf("list all: %v", err)
	}

	var sameKeyCount, globalKeyCount int
	for _, entry := range all {
		if entry.Key == "same-key" {
			sameKeyCount++
		}
		if entry.Key == "global-key" {
			globalKeyCount++
		}
	}
	if sameKeyCount != 2 {
		t.Fatalf("expected 2 same-key records, got %d", sameKeyCount)
	}
	if globalKeyCount != 2 {
		t.Fatalf("expected 2 global-key records, got %d", globalKeyCount)
	}
}

func TestPersistentMemoryBuildContextBlock_IsTrimmedAndNoIDs(t *testing.T) {
	pm := newTestPersistentMemory(t)

	for i := 0; i < 11; i++ {
		_, err := pm.StoreFull(
			fmt.Sprintf("fact-%02d", i),
			fmt.Sprintf("value-%02d", i),
			MemoryCategoryFact,
			"conv-ctx",
			"",
			MemoryConfidenceMedium,
			MemoryStatusActive,
		)
		if err != nil {
			t.Fatalf("store fact entry %d: %v", i, err)
		}
	}

	for i := 0; i < 14; i++ {
		_, err := pm.StoreFull(
			fmt.Sprintf("tool-%02d", i),
			"done",
			MemoryCategoryToolRun,
			"conv-ctx",
			"",
			MemoryConfidenceMedium,
			MemoryStatusConfirmed,
		)
		if err != nil {
			t.Fatalf("store tool run entry %d: %v", i, err)
		}
	}

	for i := 0; i < 2; i++ {
		_, err := pm.StoreFull(
			fmt.Sprintf("dismissed-%02d", i),
			"ignore",
			MemoryCategoryVulnerability,
			"conv-ctx",
			"",
			MemoryConfidenceLow,
			MemoryStatusFalsePositive,
		)
		if err != nil {
			t.Fatalf("store dismissed entry %d: %v", i, err)
		}
	}

	ctx := pm.BuildContextBlock()
	if ctx == "" {
		t.Fatalf("expected non-empty context block")
	}
	if strings.Contains(ctx, "(id:") {
		t.Fatalf("context block should not include raw IDs")
	}
	if !strings.Contains(ctx, "... 3 more fact entries") {
		t.Fatalf("expected fact truncation marker in context block")
	}
	if !strings.Contains(ctx, "... 2 more completed tool runs") {
		t.Fatalf("expected tool-run truncation marker in context block")
	}
}

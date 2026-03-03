package mcp

import (
	"context"
	"testing"
	"time"

	"cyberstrike-ai/internal/config"

	"go.uber.org/zap"
)

func TestExternalMCPManager_AddOrUpdateConfig(t *testing.T) {
	logger := zap.NewNop()
	manager := NewExternalMCPManager(logger)

	// test adding stdio configuration
	stdioCfg := config.ExternalMCPServerConfig{
		Command:     "python3",
		Args:        []string{"/path/to/script.py"},
		Transport:   "stdio",
		Description: "Test stdio MCP",
		Timeout:     30,
		Enabled:     true,
	}

	err := manager.AddOrUpdateConfig("test-stdio", stdioCfg)
	if err != nil {
		t.Fatalf("failed to add stdio configuration: %v", err)
	}

	// test adding HTTP configuration
	httpCfg := config.ExternalMCPServerConfig{
		Transport:   "http",
		URL:         "http://127.0.0.1:8081/mcp",
		Description: "Test HTTP MCP",
		Timeout:     30,
		Enabled:     false,
	}

	err = manager.AddOrUpdateConfig("test-http", httpCfg)
	if err != nil {
		t.Fatalf("failed to add HTTP configuration: %v", err)
	}

	// verify configurations were saved
	configs := manager.GetConfigs()
	if len(configs) != 2 {
		t.Fatalf("expected 2 configurations, got %d", len(configs))
	}

	if configs["test-stdio"].Command != stdioCfg.Command {
		t.Errorf("stdio configuration command does not match")
	}

	if configs["test-http"].URL != httpCfg.URL {
		t.Errorf("HTTP configuration URL does not match")
	}
}

func TestExternalMCPManager_RemoveConfig(t *testing.T) {
	logger := zap.NewNop()
	manager := NewExternalMCPManager(logger)

	cfg := config.ExternalMCPServerConfig{
		Command:   "python3",
		Transport: "stdio",
		Enabled:   false,
	}

	manager.AddOrUpdateConfig("test-remove", cfg)

	// remove configuration
	err := manager.RemoveConfig("test-remove")
	if err != nil {
		t.Fatalf("failed to remove configuration: %v", err)
	}

	configs := manager.GetConfigs()
	if _, exists := configs["test-remove"]; exists {
		t.Error("configuration should have been removed")
	}
}

func TestExternalMCPManager_GetStats(t *testing.T) {
	logger := zap.NewNop()
	manager := NewExternalMCPManager(logger)

	// add multiple configurations
	manager.AddOrUpdateConfig("enabled1", config.ExternalMCPServerConfig{
		Command: "python3",
		Enabled: true,
	})

	manager.AddOrUpdateConfig("enabled2", config.ExternalMCPServerConfig{
		URL:     "http://127.0.0.1:8081/mcp",
		Enabled: true,
	})

	manager.AddOrUpdateConfig("disabled1", config.ExternalMCPServerConfig{
		Command:  "python3",
		Enabled:  false,
		Disabled: true, // explicitly set as disabled
	})

	stats := manager.GetStats()

	if stats["total"].(int) != 3 {
		t.Errorf("expected total 3, got %d", stats["total"])
	}

	if stats["enabled"].(int) != 2 {
		t.Errorf("expected enabled 2, got %d", stats["enabled"])
	}

	if stats["disabled"].(int) != 1 {
		t.Errorf("expected disabled 1, got %d", stats["disabled"])
	}
}

func TestExternalMCPManager_LoadConfigs(t *testing.T) {
	logger := zap.NewNop()
	manager := NewExternalMCPManager(logger)

	externalMCPConfig := config.ExternalMCPConfig{
		Servers: map[string]config.ExternalMCPServerConfig{
			"loaded1": {
				Command: "python3",
				Enabled: true,
			},
			"loaded2": {
				URL:     "http://127.0.0.1:8081/mcp",
				Enabled: false,
			},
		},
	}

	manager.LoadConfigs(&externalMCPConfig)

	configs := manager.GetConfigs()
	if len(configs) != 2 {
		t.Fatalf("expected 2 configurations, got %d", len(configs))
	}

	if configs["loaded1"].Command != "python3" {
		t.Error("configuration 1 failed to load")
	}

	if configs["loaded2"].URL != "http://127.0.0.1:8081/mcp" {
		t.Error("configuration 2 failed to load")
	}
}

// TestLazySDKClient_InitializeFails verifies that Initialize fails and sets error status for invalid configurations
func TestLazySDKClient_InitializeFails(t *testing.T) {
	logger := zap.NewNop()
	// use a non-existent HTTP address, Initialize should fail
	cfg := config.ExternalMCPServerConfig{
		Transport: "http",
		URL:       "http://127.0.0.1:19999/nonexistent",
		Timeout:   2,
	}
	c := newLazySDKClient(cfg, logger)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	err := c.Initialize(ctx)
	if err == nil {
		t.Fatal("expected error when connecting to invalid server")
	}
	if c.GetStatus() != "error" {
		t.Errorf("expected status error, got %s", c.GetStatus())
	}
	c.Close()
}

func TestExternalMCPManager_StartStopClient(t *testing.T) {
	logger := zap.NewNop()
	manager := NewExternalMCPManager(logger)

	// add a disabled configuration
	cfg := config.ExternalMCPServerConfig{
		Command:   "python3",
		Transport: "stdio",
		Enabled:   false,
	}

	manager.AddOrUpdateConfig("test-start-stop", cfg)

	// try to start (may fail as there is no real server)
	err := manager.StartClient("test-start-stop")
	if err != nil {
		t.Logf("start failed (possibly no server): %v", err)
	}

	// stop
	err = manager.StopClient("test-start-stop")
	if err != nil {
		t.Fatalf("stop failed: %v", err)
	}

	// verify configuration was updated to disabled
	configs := manager.GetConfigs()
	if configs["test-start-stop"].Enabled {
		t.Error("configuration should have been disabled")
	}
}

func TestExternalMCPManager_CallTool(t *testing.T) {
	logger := zap.NewNop()
	manager := NewExternalMCPManager(logger)

	// test calling a non-existent tool
	_, _, err := manager.CallTool(context.Background(), "nonexistent::tool", map[string]interface{}{})
	if err == nil {
		t.Error("should return an error")
	}

	// test invalid tool name format
	_, _, err = manager.CallTool(context.Background(), "invalid-tool-name", map[string]interface{}{})
	if err == nil {
		t.Error("should return an error (invalid format)")
	}
}

func TestExternalMCPManager_GetAllTools(t *testing.T) {
	logger := zap.NewNop()
	manager := NewExternalMCPManager(logger)

	ctx := context.Background()
	tools, err := manager.GetAllTools(ctx)
	if err != nil {
		t.Fatalf("failed to get tool list: %v", err)
	}

	// if no clients are connected, should return empty list
	if len(tools) != 0 {
		t.Logf("got %d tools", len(tools))
	}
}

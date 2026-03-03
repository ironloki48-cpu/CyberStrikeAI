package main

import (
	"cyberstrike-ai/internal/app"
	"cyberstrike-ai/internal/config"
	"cyberstrike-ai/internal/logger"
	"flag"
	"fmt"
)

func main() {
	var configPath = flag.String("config", "config.yaml", "path to config file")
	flag.Parse()

	// Load config
	cfg, err := config.Load(*configPath)
	if err != nil {
		fmt.Printf("failed to load config: %v\n", err)
		return
	}

	// Initialize logger
	log := logger.New(cfg.Log.Level, cfg.Log.Output)

	// Create application
	application, err := app.New(cfg, log)
	if err != nil {
		log.Fatal("application initialization failed", "error", err)
	}

	// Start server
	if err := application.Run(); err != nil {
		log.Fatal("server startup failed", "error", err)
	}
}


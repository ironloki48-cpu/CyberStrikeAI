package config

import "testing"

func TestOpenAIConfig_ApplyModelDefaults_FillsMissingModels(t *testing.T) {
	cfg := &OpenAIConfig{}
	cfg.ApplyModelDefaults("qwen-default")

	if cfg.Model != "qwen-default" {
		t.Fatalf("expected model to default to qwen-default, got %q", cfg.Model)
	}
	if cfg.ToolModel != "qwen-default" {
		t.Fatalf("expected tool_model to inherit model, got %q", cfg.ToolModel)
	}
	if cfg.SummaryModel != "qwen-default" {
		t.Fatalf("expected summary_model to inherit model, got %q", cfg.SummaryModel)
	}
}

func TestOpenAIConfig_ApplyModelDefaults_PreservesExplicitModels(t *testing.T) {
	cfg := &OpenAIConfig{
		Model:        "main-a",
		ToolModel:    "tool-b",
		SummaryModel: "summary-c",
	}
	cfg.ApplyModelDefaults("fallback")

	if cfg.Model != "main-a" {
		t.Fatalf("expected explicit model to be preserved, got %q", cfg.Model)
	}
	if cfg.ToolModel != "tool-b" {
		t.Fatalf("expected explicit tool_model to be preserved, got %q", cfg.ToolModel)
	}
	if cfg.SummaryModel != "summary-c" {
		t.Fatalf("expected explicit summary_model to be preserved, got %q", cfg.SummaryModel)
	}
}

func TestConfig_ApplyModelDefaults_DoesNotForceEmbeddingModel(t *testing.T) {
	cfg := &Config{
		OpenAI: OpenAIConfig{
			Model: "local-main",
		},
		Knowledge: KnowledgeConfig{
			Enabled: true,
			Embedding: EmbeddingConfig{
				Model: "",
			},
		},
	}

	cfg.ApplyModelDefaults()

	if cfg.OpenAI.ToolModel != "local-main" {
		t.Fatalf("expected tool_model to inherit main model, got %q", cfg.OpenAI.ToolModel)
	}
	if cfg.OpenAI.SummaryModel != "local-main" {
		t.Fatalf("expected summary_model to inherit main model, got %q", cfg.OpenAI.SummaryModel)
	}
	if cfg.Knowledge.Embedding.Model != "" {
		t.Fatalf("expected embedding model to stay empty (disabled), got %q", cfg.Knowledge.Embedding.Model)
	}
}

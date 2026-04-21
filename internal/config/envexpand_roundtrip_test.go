package config

import (
	"os"
	"path/filepath"
	"testing"
)

// TestLoad_PreservesEnvTemplates verifies that config.Load does NOT expand
// ${VAR} / ${VAR:-default} references in ExternalMCP server configs. The
// invariant guards against the secret-leak regression: if Load expanded
// templates eagerly, every subsequent saveConfig() round-trip would rewrite
// config.yaml with resolved secret values, defeating the purpose of using
// environment references. Expansion must happen lazily at connection time
// inside internal/mcp (createSDKClient).
func TestLoad_PreservesEnvTemplates(t *testing.T) {
	t.Setenv("CSAI_TEST_TOKEN", "super-secret-token")
	t.Setenv("CSAI_TEST_CMD", "python3")

	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "config.yaml")

	// Minimal config that exercises every env-var-bearing field on
	// ExternalMCPServerConfig. Credentials deliberately use templates.
	yaml := `
server:
  host: 127.0.0.1
  port: 0
openai:
  api_key: "test"
  base_url: "http://example.com"
  model: "test-model"
agent: {}
security: {}
database:
  path: "` + filepath.Join(dir, "data.db") + `"
auth:
  password: "test-password-12345"
log:
  level: info
  output: stdout
mcp:
  enabled: false
external_mcp:
  servers:
    templated-stdio:
      command: "${CSAI_TEST_CMD}"
      args:
        - "--token"
        - "${CSAI_TEST_TOKEN}"
        - "${MISSING_VAR:-fallback}"
      env:
        API_KEY: "${CSAI_TEST_TOKEN}"
      external_mcp_enable: true
    templated-http:
      transport: http
      url: "https://${MISSING_VAR:-example.com}/mcp"
      headers:
        Authorization: "Bearer ${CSAI_TEST_TOKEN}"
      external_mcp_enable: true
`
	if err := os.WriteFile(cfgPath, []byte(yaml), 0600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	cfg, err := Load(cfgPath)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	stdio, ok := cfg.ExternalMCP.Servers["templated-stdio"]
	if !ok {
		t.Fatal("templated-stdio server missing after Load")
	}
	if stdio.Command != "${CSAI_TEST_CMD}" {
		t.Errorf("Command was expanded at Load time: %q", stdio.Command)
	}
	if len(stdio.Args) < 3 || stdio.Args[1] != "${CSAI_TEST_TOKEN}" {
		t.Errorf("Args[1] was expanded at Load time: %#v", stdio.Args)
	}
	if stdio.Args[2] != "${MISSING_VAR:-fallback}" {
		t.Errorf("Args[2] default-template was expanded at Load time: %q", stdio.Args[2])
	}
	if stdio.Env["API_KEY"] != "${CSAI_TEST_TOKEN}" {
		t.Errorf("Env[API_KEY] was expanded at Load time: %q", stdio.Env["API_KEY"])
	}

	http, ok := cfg.ExternalMCP.Servers["templated-http"]
	if !ok {
		t.Fatal("templated-http server missing after Load")
	}
	if http.URL != "https://${MISSING_VAR:-example.com}/mcp" {
		t.Errorf("URL was expanded at Load time: %q", http.URL)
	}
	if http.Headers["Authorization"] != "Bearer ${CSAI_TEST_TOKEN}" {
		t.Errorf("Headers[Authorization] was expanded at Load time: %q", http.Headers["Authorization"])
	}

	// Expanding a copy must not mutate the stored config. This catches a
	// reviewer-flagged bug where the previous wiring mutated in place and
	// then saveConfig() would persist the resolved secret.
	stdioCopy := stdio
	ExpandConfigEnv(&stdioCopy)
	if stdioCopy.Command != "python3" {
		t.Errorf("ExpandConfigEnv did not resolve Command on the copy: %q", stdioCopy.Command)
	}
	if stdioCopy.Env["API_KEY"] != "super-secret-token" {
		t.Errorf("ExpandConfigEnv did not resolve Env on the copy: %q", stdioCopy.Env["API_KEY"])
	}
	// Re-read from the map — the original must still be templated.
	reread := cfg.ExternalMCP.Servers["templated-stdio"]
	if reread.Command != "${CSAI_TEST_CMD}" {
		t.Errorf("stored config was mutated by copy expansion: Command=%q", reread.Command)
	}
	if reread.Env["API_KEY"] != "${CSAI_TEST_TOKEN}" {
		t.Errorf("stored config Env map was mutated by copy expansion: Env[API_KEY]=%q", reread.Env["API_KEY"])
	}
}

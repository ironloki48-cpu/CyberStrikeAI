package config

import (
	"os"
	"strings"
)

// expandEnvVar expands ${VAR} and ${VAR:-default} environment variable references
// inside s. Syntax matches the official MCP config format (supported by Claude
// Desktop / Cursor / VS Code mcpServers).
func expandEnvVar(s string) string {
	var b strings.Builder
	i := 0
	for i < len(s) {
		idx := strings.Index(s[i:], "${")
		if idx < 0 {
			b.WriteString(s[i:])
			break
		}
		b.WriteString(s[i : i+idx])
		i += idx + 2 // skip ${

		end := strings.IndexByte(s[i:], '}')
		if end < 0 {
			// No closing brace - preserve the literal ${ and stop scanning.
			b.WriteString("${")
			continue
		}
		expr := s[i : i+end]
		i += end + 1 // skip }

		varName := expr
		defaultVal := ""
		hasDefault := false
		if colonIdx := strings.Index(expr, ":-"); colonIdx >= 0 {
			varName = expr[:colonIdx]
			defaultVal = expr[colonIdx+2:]
			hasDefault = true
		}

		val := os.Getenv(varName)
		if val == "" && hasDefault {
			val = defaultVal
		}
		b.WriteString(val)
	}
	return b.String()
}

// ExpandConfigEnv expands every ${VAR} / ${VAR:-default} reference in the
// env-var-bearing fields of an ExternalMCPServerConfig (Command, Args, Env
// values, URL, Headers values). This lets MCP server definitions keep secrets
// out of the repo by referencing environment variables instead.
//
// Args, Env, and Headers are allocated fresh before being written into cfg.
// A naive in-place rewrite of those fields would mutate the slice / map the
// caller passed in, which is a correctness hazard when the caller is working
// on a *struct copy* of a value stored in a map (see internal/mcp createSDKClient):
// Go's struct-by-value semantics do not extend to slices and maps, so the
// backing storage is still shared with the stored config. Mutating it would
// leak resolved secrets back into the caller's state — precisely the bug this
// function is supposed to prevent. Reallocating keeps expansion scoped to
// the copy.
func ExpandConfigEnv(cfg *ExternalMCPServerConfig) {
	cfg.Command = expandEnvVar(cfg.Command)

	if len(cfg.Args) > 0 {
		newArgs := make([]string, len(cfg.Args))
		for i, arg := range cfg.Args {
			newArgs[i] = expandEnvVar(arg)
		}
		cfg.Args = newArgs
	}

	if len(cfg.Env) > 0 {
		newEnv := make(map[string]string, len(cfg.Env))
		for k, v := range cfg.Env {
			newEnv[k] = expandEnvVar(v)
		}
		cfg.Env = newEnv
	}

	cfg.URL = expandEnvVar(cfg.URL)

	if len(cfg.Headers) > 0 {
		newHeaders := make(map[string]string, len(cfg.Headers))
		for k, v := range cfg.Headers {
			newHeaders[k] = expandEnvVar(v)
		}
		cfg.Headers = newHeaders
	}
}

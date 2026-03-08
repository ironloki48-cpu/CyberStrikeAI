package openai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"cyberstrike-ai/internal/config"

	"go.uber.org/zap"
)

// Client is a unified HTTP client for interacting with OpenAI-compatible models.
type Client struct {
	httpClient *http.Client
	config     *config.OpenAIConfig
	logger     *zap.Logger
}

// APIError represents a non-200 error returned by the OpenAI API.
type APIError struct {
	StatusCode int
	Body       string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("openai api error: status=%d body=%s", e.StatusCode, e.Body)
}

// NewClient creates a new OpenAI client.
func NewClient(cfg *config.OpenAIConfig, httpClient *http.Client, logger *zap.Logger) *Client {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	if logger == nil {
		logger = zap.NewNop()
	}
	return &Client{
		httpClient: httpClient,
		config:     cfg,
		logger:     logger,
	}
}

// UpdateConfig dynamically updates the OpenAI configuration.
func (c *Client) UpdateConfig(cfg *config.OpenAIConfig) {
	c.config = cfg
}

// ChatCompletion calls the /chat/completions endpoint.
func (c *Client) ChatCompletion(ctx context.Context, payload interface{}, out interface{}) error {
	if c == nil {
		return fmt.Errorf("openai client is not initialized")
	}
	if c.config == nil {
		return fmt.Errorf("openai config is nil")
	}
	if strings.TrimSpace(c.config.APIKey) == "" {
		return fmt.Errorf("openai api key is empty")
	}

	baseURL := strings.TrimSuffix(c.config.BaseURL, "/")
	if baseURL == "" {
		baseURL = "https://api.openai.com/v1"
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal openai payload: %w", err)
	}

	c.logger.Debug("sending OpenAI chat completion request",
		zap.Int("payloadSizeKB", len(body)/1024))

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build openai request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.config.APIKey)
	req.Header.Set("User-Agent", "CyberStrikeAI/1.0")

	requestStart := time.Now()
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("call openai api: %w", err)
	}
	defer resp.Body.Close()

	bodyChan := make(chan []byte, 1)
	errChan := make(chan error, 1)
	go func() {
		responseBody, err := io.ReadAll(resp.Body)
		if err != nil {
			errChan <- err
			return
		}
		bodyChan <- responseBody
	}()

	hardTimeout := time.NewTimer(25 * time.Minute)
	defer hardTimeout.Stop()

	var respBody []byte
	select {
	case respBody = <-bodyChan:
	case err := <-errChan:
		return fmt.Errorf("read openai response: %w", err)
	case <-ctx.Done():
		// Close resp.Body to unblock the io.ReadAll goroutine
		resp.Body.Close()
		return fmt.Errorf("read openai response timeout: %w", ctx.Err())
	case <-hardTimeout.C:
		// Close resp.Body to unblock the io.ReadAll goroutine
		resp.Body.Close()
		return fmt.Errorf("read openai response timeout (25m)")
	}

	c.logger.Debug("received OpenAI response",
		zap.Int("status", resp.StatusCode),
		zap.Duration("duration", time.Since(requestStart)),
		zap.Int("responseSizeKB", len(respBody)/1024),
		zap.String("request_url", req.URL.String()),
	)

	if resp.StatusCode != http.StatusOK {
		c.logger.Warn("OpenAI chat completion returned non-200",
			zap.Int("status", resp.StatusCode),
			zap.String("request_url", req.URL.String()),
			zap.String("model", c.config.Model),
			zap.String("base_url", c.config.BaseURL),
			zap.String("body", string(respBody)),
		)
		return &APIError{
			StatusCode: resp.StatusCode,
			Body:       string(respBody),
		}
	}

	if out != nil {
		respBody = normalizeNonStandardToolCalls(respBody, c.logger)
		if err := json.Unmarshal(respBody, out); err != nil {
			c.logger.Error("failed to unmarshal OpenAI response",
				zap.Error(err),
				zap.String("body", string(respBody)),
			)
			return fmt.Errorf("unmarshal openai response: %w", err)
		}
	}

	return nil
}

// FetchFirstModel queries the /v1/models endpoint and returns the ID of the
// first available model.  This is used to auto-discover the served model name
// when the user hasn't explicitly configured one.
func FetchFirstModel(baseURL, apiKey string, httpClient *http.Client, logger *zap.Logger) (string, error) {
	models, err := FetchModels(baseURL, apiKey, httpClient)
	if err != nil {
		return "", err
	}
	if len(models) == 0 {
		return "", fmt.Errorf("no models available at %s", strings.TrimSuffix(strings.TrimSpace(baseURL), "/"))
	}
	modelID := models[0]
	if logger != nil {
		logger.Info("Auto-discovered model from endpoint",
			zap.String("base_url", strings.TrimSuffix(strings.TrimSpace(baseURL), "/")),
			zap.String("model", modelID),
			zap.Int("total_models", len(models)),
		)
	}
	return modelID, nil
}

// FetchModels queries the /v1/models endpoint and returns all available model IDs.
func FetchModels(baseURL, apiKey string, httpClient *http.Client) ([]string, error) {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 10 * time.Second}
	}
	base := strings.TrimSuffix(strings.TrimSpace(baseURL), "/")
	if base == "" {
		return nil, fmt.Errorf("base_url is empty")
	}

	req, err := http.NewRequest(http.MethodGet, base+"/models", nil)
	if err != nil {
		return nil, fmt.Errorf("build models request: %w", err)
	}
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch models: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("models endpoint returned %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("parse models response: %w", err)
	}
	if len(result.Data) == 0 {
		return nil, fmt.Errorf("no models available at %s", base)
	}

	models := make([]string, 0, len(result.Data))
	for _, m := range result.Data {
		id := strings.TrimSpace(m.ID)
		if id == "" {
			continue
		}
		models = append(models, id)
	}
	if len(models) == 0 {
		return nil, fmt.Errorf("no models available at %s", base)
	}
	return models, nil
}

var (
	jsonToolCallPattern     = regexp.MustCompile(`(?is)<tool_call>\s*(\{.*?\})\s*</tool_call>`)
	xmlToolCallPattern      = regexp.MustCompile(`(?is)<tool_call>\s*<function=([a-zA-Z0-9_\-:.]+)\s*(.*?)</function>\s*</tool_call>`)
	xmlToolParamPattern     = regexp.MustCompile(`(?is)<parameter=([a-zA-Z0-9_\-:.]+)>\s*(.*?)\s*</parameter>`)
	removeToolCallBlockExpr = regexp.MustCompile(`(?is)<tool_call>.*?</tool_call>`)
)

// normalizeNonStandardToolCalls converts text-embedded tool-call formats (often
// returned by some OpenAI-compatible backends) into standard message.tool_calls.
func normalizeNonStandardToolCalls(respBody []byte, logger *zap.Logger) []byte {
	var root map[string]interface{}
	if err := json.Unmarshal(respBody, &root); err != nil {
		return respBody
	}

	choices, ok := root["choices"].([]interface{})
	if !ok || len(choices) == 0 {
		return respBody
	}

	modified := false
	for _, rawChoice := range choices {
		choice, ok := rawChoice.(map[string]interface{})
		if !ok {
			continue
		}
		message, ok := choice["message"].(map[string]interface{})
		if !ok {
			continue
		}
		if existing, ok := message["tool_calls"].([]interface{}); ok && len(existing) > 0 {
			continue
		}
		content, _ := message["content"].(string)
		if strings.TrimSpace(content) == "" {
			continue
		}

		toolName, toolArgs, cleanContent, found := extractToolCallFromContent(content)
		if !found || strings.TrimSpace(toolName) == "" {
			continue
		}

		message["tool_calls"] = []interface{}{
			map[string]interface{}{
				"id":   fmt.Sprintf("compat-tool-%d", time.Now().UnixNano()),
				"type": "function",
				"function": map[string]interface{}{
					"name":      toolName,
					"arguments": toolArgs,
				},
			},
		}
		message["content"] = cleanContent
		choice["finish_reason"] = "tool_calls"
		modified = true
	}

	if !modified {
		return respBody
	}
	normalized, err := json.Marshal(root)
	if err != nil {
		return respBody
	}
	if logger != nil {
		logger.Info("Normalized non-standard tool call markup into message.tool_calls")
	}
	return normalized
}

func extractToolCallFromContent(content string) (name string, args map[string]interface{}, cleanContent string, ok bool) {
	cleanContent = strings.TrimSpace(removeToolCallBlockExpr.ReplaceAllString(content, ""))

	if m := jsonToolCallPattern.FindStringSubmatch(content); len(m) == 2 {
		var payload struct {
			Name      string                 `json:"name"`
			Arguments map[string]interface{} `json:"arguments"`
		}
		if err := json.Unmarshal([]byte(m[1]), &payload); err == nil && strings.TrimSpace(payload.Name) != "" {
			return strings.TrimSpace(payload.Name), payload.Arguments, cleanContent, true
		}
	}

	if m := xmlToolCallPattern.FindStringSubmatch(content); len(m) == 3 {
		name = strings.TrimSpace(m[1])
		args = make(map[string]interface{})
		for _, pm := range xmlToolParamPattern.FindAllStringSubmatch(m[2], -1) {
			if len(pm) != 3 {
				continue
			}
			key := strings.TrimSpace(pm[1])
			val := strings.TrimSpace(pm[2])
			if key != "" {
				args[key] = val
			}
		}
		if name != "" {
			return name, args, cleanContent, true
		}
	}
	return "", nil, content, false
}

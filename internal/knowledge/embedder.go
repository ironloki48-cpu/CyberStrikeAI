package knowledge

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"cyberstrike-ai/internal/config"
	"cyberstrike-ai/internal/openai"

	"go.uber.org/zap"
)

// Embedder is the text embedder
type Embedder struct {
	openAIClient *openai.Client
	config       *config.KnowledgeConfig
	openAIConfig *config.OpenAIConfig // used to retrieve the API Key
	logger       *zap.Logger
}

// NewEmbedder creates a new embedder
func NewEmbedder(cfg *config.KnowledgeConfig, openAIConfig *config.OpenAIConfig, openAIClient *openai.Client, logger *zap.Logger) *Embedder {
	return &Embedder{
		openAIClient: openAIClient,
		config:       cfg,
		openAIConfig: openAIConfig,
		logger:       logger,
	}
}

// EmbeddingRequest is the OpenAI embedding request
type EmbeddingRequest struct {
	Model string   `json:"model"`
	Input []string `json:"input"`
}

// EmbeddingResponse is the OpenAI embedding response
type EmbeddingResponse struct {
	Data []EmbeddingData `json:"data"`
	Error *EmbeddingError `json:"error,omitempty"`
}

// EmbeddingData contains embedding data
type EmbeddingData struct {
	Embedding []float64 `json:"embedding"`
	Index     int       `json:"index"`
}

// EmbeddingError contains an embedding error
type EmbeddingError struct {
	Message string `json:"message"`
	Type    string `json:"type"`
}

// EmbedText embeds the given text
func (e *Embedder) EmbedText(ctx context.Context, text string) ([]float32, error) {
	if e.openAIClient == nil {
		return nil, fmt.Errorf("OpenAI client not initialized")
	}

	// use the configured embedding model
	model := e.config.Embedding.Model
	if model == "" {
		model = "text-embedding-3-small"
	}

	req := EmbeddingRequest{
		Model: model,
		Input: []string{text},
	}

	// clean baseURL: trim whitespace and trailing slash
	baseURL := strings.TrimSpace(e.config.Embedding.BaseURL)
	baseURL = strings.TrimSuffix(baseURL, "/")
	if baseURL == "" {
		baseURL = "https://api.openai.com/v1"
	}

	// build request
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("failed to serialize request: %w", err)
	}

	requestURL := baseURL + "/embeddings"
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, requestURL, strings.NewReader(string(body)))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")

	// use configured API Key, fall back to OpenAI config if not set
	apiKey := strings.TrimSpace(e.config.Embedding.APIKey)
	if apiKey == "" && e.openAIConfig != nil {
		apiKey = e.openAIConfig.APIKey
	}
	if apiKey == "" {
		return nil, fmt.Errorf("API Key not configured")
	}
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)

	// send request
	httpClient := &http.Client{
		Timeout: 30 * time.Second,
	}
	resp, err := httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	// read response body for detailed error output
	bodyBytes := make([]byte, 0)
	buf := make([]byte, 4096)
	for {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			bodyBytes = append(bodyBytes, buf[:n]...)
		}
		if err != nil {
			break
		}
	}

	// log request and response information (for debugging)
	requestBodyPreview := string(body)
	if len(requestBodyPreview) > 200 {
		requestBodyPreview = requestBodyPreview[:200] + "..."
	}
	e.logger.Debug("embedding API request",
		zap.String("url", httpReq.URL.String()),
		zap.String("model", model),
		zap.String("requestBody", requestBodyPreview),
		zap.Int("status", resp.StatusCode),
		zap.Int("bodySize", len(bodyBytes)),
		zap.String("contentType", resp.Header.Get("Content-Type")),
	)

	var embeddingResp EmbeddingResponse
	if err := json.Unmarshal(bodyBytes, &embeddingResp); err != nil {
		// output detailed error information
		bodyPreview := string(bodyBytes)
		if len(bodyPreview) > 500 {
			bodyPreview = bodyPreview[:500] + "..."
		}
		return nil, fmt.Errorf("failed to parse response (URL: %s, status: %d, response length: %d bytes): %w\nrequest body: %s\nresponse content preview: %s",
			requestURL, resp.StatusCode, len(bodyBytes), err, requestBodyPreview, bodyPreview)
	}

	if embeddingResp.Error != nil {
		return nil, fmt.Errorf("OpenAI API error (status: %d): type=%s, message=%s",
			resp.StatusCode, embeddingResp.Error.Type, embeddingResp.Error.Message)
	}

	if resp.StatusCode != http.StatusOK {
		bodyPreview := string(bodyBytes)
		if len(bodyPreview) > 500 {
			bodyPreview = bodyPreview[:500] + "..."
		}
		return nil, fmt.Errorf("HTTP request failed (URL: %s, status: %d): response=%s", requestURL, resp.StatusCode, bodyPreview)
	}

	if len(embeddingResp.Data) == 0 {
		bodyPreview := string(bodyBytes)
		if len(bodyPreview) > 500 {
			bodyPreview = bodyPreview[:500] + "..."
		}
		return nil, fmt.Errorf("no embedding data received (status: %d, response length: %d bytes)\nresponse: %s",
			resp.StatusCode, len(bodyBytes), bodyPreview)
	}

	// convert to float32
	embedding := make([]float32, len(embeddingResp.Data[0].Embedding))
	for i, v := range embeddingResp.Data[0].Embedding {
		embedding[i] = float32(v)
	}

	return embedding, nil
}

// EmbedTexts embeds multiple texts in batch
func (e *Embedder) EmbedTexts(ctx context.Context, texts []string) ([][]float32, error) {
	if len(texts) == 0 {
		return nil, nil
	}

	// OpenAI API supports batching, but for simplicity we process individually
	// in practice, the batch API can be used for better efficiency
	embeddings := make([][]float32, len(texts))
	for i, text := range texts {
		embedding, err := e.EmbedText(ctx, text)
		if err != nil {
			return nil, fmt.Errorf("failed to embed text[%d]: %w", i, err)
		}
		embeddings[i] = embedding
	}

	return embeddings, nil
}

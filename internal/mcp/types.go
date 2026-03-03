package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

// ExternalMCPClient is the external MCP client interface (implemented in client_sdk.go based on the official SDK)
type ExternalMCPClient interface {
	Initialize(ctx context.Context) error
	ListTools(ctx context.Context) ([]Tool, error)
	CallTool(ctx context.Context, name string, args map[string]interface{}) (*ToolResult, error)
	Close() error
	IsConnected() bool
	GetStatus() string
}

// MCP message types
const (
	MessageTypeRequest  = "request"
	MessageTypeResponse = "response"
	MessageTypeError    = "error"
	MessageTypeNotify   = "notify"
)

// MCP protocol version
const ProtocolVersion = "2024-11-05"

// MessageID represents the id field in JSON-RPC 2.0, which can be a string, number, or null
type MessageID struct {
	value interface{}
}

// UnmarshalJSON custom deserialization, supports strings, numbers, and null
func (m *MessageID) UnmarshalJSON(data []byte) error {
	// try to parse as null
	if string(data) == "null" {
		m.value = nil
		return nil
	}

	// try to parse as string
	var str string
	if err := json.Unmarshal(data, &str); err == nil {
		m.value = str
		return nil
	}

	// try to parse as number
	var num json.Number
	if err := json.Unmarshal(data, &num); err == nil {
		m.value = num
		return nil
	}

	return fmt.Errorf("invalid id type")
}

// MarshalJSON custom serialization
func (m MessageID) MarshalJSON() ([]byte, error) {
	if m.value == nil {
		return []byte("null"), nil
	}
	return json.Marshal(m.value)
}

// String returns the string representation
func (m MessageID) String() string {
	if m.value == nil {
		return ""
	}
	return fmt.Sprintf("%v", m.value)
}

// Value returns the raw value
func (m MessageID) Value() interface{} {
	return m.value
}

// Message represents an MCP message (compliant with JSON-RPC 2.0 specification)
type Message struct {
	ID      MessageID       `json:"id,omitempty"`
	Type    string          `json:"-"` // internal use only, not serialized to JSON
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *Error          `json:"error,omitempty"`
	Version string          `json:"jsonrpc,omitempty"` // JSON-RPC 2.0 version identifier
}

// Error represents an MCP error
type Error struct {
	Code    int         `json:"code"`
	Message string      `json:"message"`
	Data    interface{} `json:"data,omitempty"`
}

// Tool represents an MCP tool definition
type Tool struct {
	Name             string                 `json:"name"`
	Description      string                 `json:"description"`                // detailed description
	ShortDescription string                 `json:"shortDescription,omitempty"` // short description (for tool lists, reduces token usage)
	InputSchema      map[string]interface{} `json:"inputSchema"`
}

// ToolCall represents a tool call
type ToolCall struct {
	Name      string                 `json:"name"`
	Arguments map[string]interface{} `json:"arguments"`
}

// ToolResult represents the result of a tool execution
type ToolResult struct {
	Content []Content `json:"content"`
	IsError bool      `json:"isError,omitempty"`
}

// Content represents content
type Content struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

// InitializeRequest is the initialization request
type InitializeRequest struct {
	ProtocolVersion string                 `json:"protocolVersion"`
	Capabilities    map[string]interface{} `json:"capabilities"`
	ClientInfo      ClientInfo             `json:"clientInfo"`
}

// ClientInfo contains client information
type ClientInfo struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

// InitializeResponse is the initialization response
type InitializeResponse struct {
	ProtocolVersion string             `json:"protocolVersion"`
	Capabilities    ServerCapabilities `json:"capabilities"`
	ServerInfo      ServerInfo         `json:"serverInfo"`
}

// ServerCapabilities represents server capabilities
type ServerCapabilities struct {
	Tools     map[string]interface{} `json:"tools,omitempty"`
	Prompts   map[string]interface{} `json:"prompts,omitempty"`
	Resources map[string]interface{} `json:"resources,omitempty"`
	Sampling  map[string]interface{} `json:"sampling,omitempty"`
}

// ServerInfo contains server information
type ServerInfo struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

// ListToolsRequest is the list tools request
type ListToolsRequest struct{}

// ListToolsResponse is the list tools response
type ListToolsResponse struct {
	Tools []Tool `json:"tools"`
}

// ListPromptsResponse is the list prompts response
type ListPromptsResponse struct {
	Prompts []Prompt `json:"prompts"`
}

// ListResourcesResponse is the list resources response
type ListResourcesResponse struct {
	Resources []Resource `json:"resources"`
}

// CallToolRequest is the call tool request
type CallToolRequest struct {
	Name      string                 `json:"name"`
	Arguments map[string]interface{} `json:"arguments"`
}

// CallToolResponse is the call tool response
type CallToolResponse struct {
	Content []Content `json:"content"`
	IsError bool      `json:"isError,omitempty"`
}

// ToolExecution is a tool execution record
type ToolExecution struct {
	ID        string                 `json:"id"`
	ToolName  string                 `json:"toolName"`
	Arguments map[string]interface{} `json:"arguments"`
	Status    string                 `json:"status"` // pending, running, completed, failed
	Result    *ToolResult            `json:"result,omitempty"`
	Error     string                 `json:"error,omitempty"`
	StartTime time.Time              `json:"startTime"`
	EndTime   *time.Time             `json:"endTime,omitempty"`
	Duration  time.Duration          `json:"duration,omitempty"`
}

// ToolStats contains tool statistics
type ToolStats struct {
	ToolName     string     `json:"toolName"`
	TotalCalls   int        `json:"totalCalls"`
	SuccessCalls int        `json:"successCalls"`
	FailedCalls  int        `json:"failedCalls"`
	LastCallTime *time.Time `json:"lastCallTime,omitempty"`
}

// Prompt is a prompt template
type Prompt struct {
	Name        string           `json:"name"`
	Description string           `json:"description,omitempty"`
	Arguments   []PromptArgument `json:"arguments,omitempty"`
}

// PromptArgument is a prompt argument
type PromptArgument struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Required    bool   `json:"required,omitempty"`
}

// GetPromptRequest is the get prompt request
type GetPromptRequest struct {
	Name      string                 `json:"name"`
	Arguments map[string]interface{} `json:"arguments,omitempty"`
}

// GetPromptResponse is the get prompt response
type GetPromptResponse struct {
	Messages []PromptMessage `json:"messages"`
}

// PromptMessage is a prompt message
type PromptMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// Resource represents a resource
type Resource struct {
	URI         string `json:"uri"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	MimeType    string `json:"mimeType,omitempty"`
}

// ReadResourceRequest is the read resource request
type ReadResourceRequest struct {
	URI string `json:"uri"`
}

// ReadResourceResponse is the read resource response
type ReadResourceResponse struct {
	Contents []ResourceContent `json:"contents"`
}

// ResourceContent is resource content
type ResourceContent struct {
	URI      string `json:"uri"`
	MimeType string `json:"mimeType,omitempty"`
	Text     string `json:"text,omitempty"`
	Blob     string `json:"blob,omitempty"`
}

// SamplingRequest is the sampling request
type SamplingRequest struct {
	Messages    []SamplingMessage `json:"messages"`
	Model       string            `json:"model,omitempty"`
	MaxTokens   int               `json:"maxTokens,omitempty"`
	Temperature float64           `json:"temperature,omitempty"`
	TopP        float64           `json:"topP,omitempty"`
}

// SamplingMessage is a sampling message
type SamplingMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// SamplingResponse is the sampling response
type SamplingResponse struct {
	Content    []SamplingContent `json:"content"`
	Model      string            `json:"model,omitempty"`
	StopReason string            `json:"stopReason,omitempty"`
}

// SamplingContent is sampling content
type SamplingContent struct {
	Type string `json:"type"`
	Text string `json:"text,omitempty"`
}

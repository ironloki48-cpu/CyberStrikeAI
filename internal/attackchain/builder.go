package attackchain

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"cyberstrike-ai/internal/agent"
	"cyberstrike-ai/internal/config"
	"cyberstrike-ai/internal/database"
	"cyberstrike-ai/internal/openai"

	"github.com/google/uuid"
	"go.uber.org/zap"
)

// Builder attack chain builder
type Builder struct {
	db           *database.DB
	logger       *zap.Logger
	openAIClient *openai.Client
	openAIConfig *config.OpenAIConfig
	tokenCounter agent.TokenCounter
	maxTokens    int // maximum token limit, default 100000
}

// Node attack chain node (using types from the database package)
type Node = database.AttackChainNode

// Edge attack chain edge (using types from the database package)
type Edge = database.AttackChainEdge

// Chain complete attack chain
type Chain struct {
	Nodes []Node `json:"nodes"`
	Edges []Edge `json:"edges"`
}

// NewBuilder creates a new attack chain builder
func NewBuilder(db *database.DB, openAIConfig *config.OpenAIConfig, logger *zap.Logger) *Builder {
	transport := &http.Transport{
		MaxIdleConns:        100,
		MaxIdleConnsPerHost: 10,
		IdleConnTimeout:     90 * time.Second,
	}
	httpClient := &http.Client{Timeout: 5 * time.Minute, Transport: transport}

	// Prefer the unified token limit from the config file (config.yaml -> openai.max_total_tokens)
	maxTokens := 0
	if openAIConfig != nil && openAIConfig.MaxTotalTokens > 0 {
		maxTokens = openAIConfig.MaxTotalTokens
	} else if openAIConfig != nil {
		// If max_total_tokens is not explicitly configured, set a reasonable default based on the model
		model := strings.ToLower(openAIConfig.Model)
		if strings.Contains(model, "gpt-4") {
			maxTokens = 128000 // gpt-4 typically supports 128k
		} else if strings.Contains(model, "gpt-3.5") {
			maxTokens = 16000 // gpt-3.5-turbo typically supports 16k
		} else if strings.Contains(model, "deepseek") {
			maxTokens = 131072 // deepseek-chat typically supports 131k
		} else {
			maxTokens = 100000 // fallback default
		}
	} else {
		// No OpenAI config, use fallback value to avoid 0
		maxTokens = 100000
	}

	return &Builder{
		db:           db,
		logger:       logger,
		openAIClient: openai.NewClient(openAIConfig, httpClient, logger),
		openAIConfig: openAIConfig,
		tokenCounter: agent.NewTikTokenCounter(),
		maxTokens:    maxTokens,
	}
}

// BuildChainFromConversation builds an attack chain from a conversation (simplified version: user input + last ReAct round input + model output)
func (b *Builder) BuildChainFromConversation(ctx context.Context, conversationID string) (*Chain, error) {
	b.logger.Info("Starting attack chain build (simplified version)", zap.String("conversationId", conversationID))

	// 0. First check if there are actual tool execution records
	messages, err := b.db.GetMessages(conversationID)
	if err != nil {
		return nil, fmt.Errorf("failed to get conversation messages: %w", err)
	}

	if len(messages) == 0 {
		b.logger.Info("No data in conversation", zap.String("conversationId", conversationID))
		return &Chain{Nodes: []Node{}, Edges: []Edge{}}, nil
	}

	// Check if there are actual tool executions (by checking assistant message mcp_execution_ids)
	hasToolExecutions := false
	for i := len(messages) - 1; i >= 0; i-- {
		if strings.EqualFold(messages[i].Role, "assistant") {
			if len(messages[i].MCPExecutionIDs) > 0 {
				hasToolExecutions = true
				break
			}
		}
	}

	// Check if the task was cancelled (by checking the last assistant message content or process_details)
	taskCancelled := false
	for i := len(messages) - 1; i >= 0; i-- {
		if strings.EqualFold(messages[i].Role, "assistant") {
			content := strings.ToLower(messages[i].Content)
			if strings.Contains(content, "cancel") || strings.Contains(content, "cancelled") {
				taskCancelled = true
			}
			break
		}
	}

	// If the task was cancelled and there are no actual tool executions, return an empty attack chain
	if taskCancelled && !hasToolExecutions {
		b.logger.Info("Task cancelled and no actual tool executions, returning empty attack chain",
			zap.String("conversationId", conversationID),
			zap.Bool("taskCancelled", taskCancelled),
			zap.Bool("hasToolExecutions", hasToolExecutions))
		return &Chain{Nodes: []Node{}, Edges: []Edge{}}, nil
	}

	// If there are no actual tool executions, also return an empty attack chain (to avoid AI fabrication)
	if !hasToolExecutions {
		b.logger.Info("No actual tool execution records, returning empty attack chain",
			zap.String("conversationId", conversationID))
		return &Chain{Nodes: []Node{}, Edges: []Edge{}}, nil
	}

	// 1. Preferably try to get the saved last ReAct round input and output from the database
	reactInputJSON, modelOutput, err := b.db.GetReActData(conversationID)
	if err != nil {
		b.logger.Warn("Failed to get saved ReAct data, will build from message history", zap.Error(err))
		// Continue using the original logic
		reactInputJSON = ""
		modelOutput = ""
	}

	// var userInput string
	var reactInputFinal string
	var dataSource string // record data source

	// If saved ReAct data was successfully retrieved, use it directly
	if reactInputJSON != "" && modelOutput != "" {
		// Compute hash of ReAct input for tracking
		hash := sha256.Sum256([]byte(reactInputJSON))
		reactInputHash := hex.EncodeToString(hash[:])[:16] // use first 16 characters as short identifier

		// Count number of messages
		var messageCount int
		var tempMessages []interface{}
		if json.Unmarshal([]byte(reactInputJSON), &tempMessages) == nil {
			messageCount = len(tempMessages)
		}

		dataSource = "database_last_react_input"
		b.logger.Info("Building attack chain using saved ReAct data",
			zap.String("conversationId", conversationID),
			zap.String("dataSource", dataSource),
			zap.Int("reactInputSize", len(reactInputJSON)),
			zap.Int("messageCount", messageCount),
			zap.String("reactInputHash", reactInputHash),
			zap.Int("modelOutputSize", len(modelOutput)))

		// Extract user input from saved ReAct input (JSON format)
		// userInput = b.extractUserInputFromReActInput(reactInputJSON)

		// Convert JSON-format messages to readable format
		reactInputFinal = b.formatReActInputFromJSON(reactInputJSON)
	} else {
		// 2. If no saved ReAct data, build from conversation messages
		dataSource = "messages_table"
		b.logger.Info("Building ReAct data from message history",
			zap.String("conversationId", conversationID),
			zap.String("dataSource", dataSource),
			zap.Int("messageCount", len(messages)))

		// Extract user input (last user message)
		for i := len(messages) - 1; i >= 0; i-- {
			if strings.EqualFold(messages[i].Role, "user") {
				// userInput = messages[i].Content
				break
			}
		}

		// Extract last ReAct round input (history messages + current user input)
		reactInputFinal = b.buildReActInput(messages)

		// Extract the model's last output (last assistant message)
		for i := len(messages) - 1; i >= 0; i-- {
			if strings.EqualFold(messages[i].Role, "assistant") {
				modelOutput = messages[i].Content
				break
			}
		}
	}

	// 3. Build a simplified prompt, pass it to the model all at once
	prompt := b.buildSimplePrompt(reactInputFinal, modelOutput)
	// fmt.Println(prompt)
	// 6. Call AI to generate attack chain (one shot, no additional processing)
	chainJSON, err := b.callAIForChainGeneration(ctx, prompt)
	if err != nil {
		return nil, fmt.Errorf("AI generation failed: %w", err)
	}

	// 7. Parse JSON and generate node/edge IDs (frontend needs valid IDs)
	chainData, err := b.parseChainJSON(chainJSON)
	if err != nil {
		// If parsing fails, return empty chain and let frontend handle the error
		b.logger.Warn("Failed to parse attack chain JSON", zap.Error(err), zap.String("raw_json", chainJSON))
		return &Chain{
			Nodes: []Node{},
			Edges: []Edge{},
		}, nil
	}

	b.logger.Info("Attack chain build completed",
		zap.String("conversationId", conversationID),
		zap.String("dataSource", dataSource),
		zap.Int("nodes", len(chainData.Nodes)),
		zap.Int("edges", len(chainData.Edges)))

	// Save to database (for subsequent loading)
	if err := b.saveChain(conversationID, chainData.Nodes, chainData.Edges); err != nil {
		b.logger.Warn("Failed to save attack chain to database", zap.Error(err))
		// Even if saving fails, return data to frontend
	}

	// Return directly without any processing or validation
	return chainData, nil
}

// buildReActInput builds the last ReAct round input (history messages + current user input)
func (b *Builder) buildReActInput(messages []database.Message) string {
	var builder strings.Builder
	for _, msg := range messages {
		builder.WriteString(fmt.Sprintf("[%s]: %s\n\n", msg.Role, msg.Content))
	}
	return builder.String()
}

// extractUserInputFromReActInput extracts the last user input from saved ReAct input (JSON-format messages array)
// func (b *Builder) extractUserInputFromReActInput(reactInputJSON string) string {
// 	// reactInputJSON is a JSON-format ChatMessage array, needs to be parsed
// 	var messages []map[string]interface{}
// 	if err := json.Unmarshal([]byte(reactInputJSON), &messages); err != nil {
// 		b.logger.Warn("Failed to parse ReAct input JSON", zap.Error(err))
// 		return ""
// 	}

// 	// Search backwards for the last user message
// 	for i := len(messages) - 1; i >= 0; i-- {
// 		if role, ok := messages[i]["role"].(string); ok && strings.EqualFold(role, "user") {
// 			if content, ok := messages[i]["content"].(string); ok {
// 				return content
// 			}
// 		}
// 	}

// 	return ""
// }

// formatReActInputFromJSON converts a JSON-format messages array to a readable string format
func (b *Builder) formatReActInputFromJSON(reactInputJSON string) string {
	var messages []map[string]interface{}
	if err := json.Unmarshal([]byte(reactInputJSON), &messages); err != nil {
		b.logger.Warn("Failed to parse ReAct input JSON", zap.Error(err))
		return reactInputJSON // if parsing fails, return original JSON
	}

	var builder strings.Builder
	for _, msg := range messages {
		role, _ := msg["role"].(string)
		content, _ := msg["content"].(string)

		// Handle assistant messages: extract tool_calls information
		if role == "assistant" {
			if toolCalls, ok := msg["tool_calls"].([]interface{}); ok && len(toolCalls) > 0 {
				// If there is text content, show it first
				if content != "" {
					builder.WriteString(fmt.Sprintf("[%s]: %s\n", role, content))
				}
				// Show each tool call in detail
				builder.WriteString(fmt.Sprintf("[%s] Tool calls (%d):\n", role, len(toolCalls)))
				for i, toolCall := range toolCalls {
					if tc, ok := toolCall.(map[string]interface{}); ok {
						toolCallID, _ := tc["id"].(string)
						if funcData, ok := tc["function"].(map[string]interface{}); ok {
							toolName, _ := funcData["name"].(string)
							arguments, _ := funcData["arguments"].(string)
							builder.WriteString(fmt.Sprintf("  [Tool call %d]\n", i+1))
							builder.WriteString(fmt.Sprintf("    ID: %s\n", toolCallID))
							builder.WriteString(fmt.Sprintf("    Tool name: %s\n", toolName))
							builder.WriteString(fmt.Sprintf("    Arguments: %s\n", arguments))
						}
					}
				}
				builder.WriteString("\n")
				continue
			}
		}

		// Handle tool messages: show tool_call_id and full content
		if role == "tool" {
			toolCallID, _ := msg["tool_call_id"].(string)
			if toolCallID != "" {
				builder.WriteString(fmt.Sprintf("[%s] (tool_call_id: %s):\n%s\n\n", role, toolCallID, content))
			} else {
				builder.WriteString(fmt.Sprintf("[%s]: %s\n\n", role, content))
			}
			continue
		}

		// Other message types (system, user, etc.) displayed normally
		builder.WriteString(fmt.Sprintf("[%s]: %s\n\n", role, content))
	}

	return builder.String()
}

// buildSimplePrompt builds a simplified prompt
func (b *Builder) buildSimplePrompt(reactInput, modelOutput string) string {
	return fmt.Sprintf(`You are a professional security testing analyst and attack chain construction expert. Your task is to build a logically clear and educational attack chain graph based on conversation records and tool execution results, fully demonstrating the thought process and execution path of penetration testing.

## Core Objectives

Build an attack chain that tells a complete attack story, enabling learners to:
1. Understand the complete process and logic of penetration testing (every step from target identification to vulnerability discovery)
2. Learn how to extract clues from failures and adjust strategies
3. Master the actual effects and limitations of tool usage
4. Understand the causal relationships between vulnerability discovery and exploitation

**Key principle**: Completeness first. Must include all meaningful tool executions and key steps; do not omit important information to control node count.

## Construction Process (Think in this order)

### Step 1: Understand the context
Carefully analyze the tool call sequence in the ReAct input and the model output, identifying:
- Test targets (IP, domain, URL, etc.)
- Actual tools executed and their parameters
- Key information returned by tools (successful results, error messages, timeouts, etc.)
- AI analysis and decision-making process

### Step 2: Extract key nodes
Extract meaningful nodes from tool execution records, **ensuring no key steps are omitted**:
- **target nodes**: Create one target node for each independent test target
- **action nodes**: Create one action node for each meaningful tool execution (including failures that provide clues, successful information gathering, vulnerability verification, etc.)
- **vulnerability nodes**: Create one vulnerability node for each genuinely confirmed vulnerability
- **Completeness check**: Cross-reference with the tool call sequence in the ReAct input, ensuring each meaningful tool execution is included in the attack chain

### Step 3: Build logical relationships (tree structure)
**Important: Must build a tree structure, not a simple linear chain.**
Connect nodes according to causal relationships, forming a tree graph (since it's single agent execution, it does not need to be in chronological order):
- **Branching structure**: One node can have multiple subsequent nodes (e.g., after port scan discovers multiple ports, multiple different tests can be conducted simultaneously)
- **Converging structure**: Multiple nodes can point to the same node (e.g., multiple different tests all discover the same vulnerability)
- Identify which actions are executed based on the results of previous actions
- Identify which vulnerabilities are discovered by which actions
- Identify how failed nodes provide clues for subsequent successes
- **Avoid linear chains**: Do not connect all nodes into one line; build a tree structure based on actual parallel testing and branch exploration

### Step 4: Optimize and simplify
- **Completeness check**: Ensure all meaningful tool executions are included; do not omit key steps
- **Merge rules**: Only merge truly similar or duplicate action nodes (e.g., multiple similar calls to the same tool)
- **Delete rules**: Only delete completely valueless failed nodes (no output at all, pure system errors, repeated identical failures)
- **Important reminder**: It is better to retain more nodes than to omit key steps. The attack chain must fully demonstrate the penetration testing process
- Ensure the attack chain is logically coherent and can tell a complete story

## Node Type Details

### target (target node)
- **Purpose**: Identifies test targets
- **Creation rule**: Create one target node for each independent target (different IPs/domains)
- **Multiple targets**: Nodes for different targets are not interconnected; each forms an independent subgraph
- **metadata.target**: Precisely record the target identifier (IP address, domain, URL, etc.)

### action (action node)
- **Purpose**: Records tool executions and AI analysis results
- **Label rules**:
  * 15-25 words, verb-object structure
  * Successful nodes: describe execution results (e.g., "Port scan found 80/443/8080", "Directory scan found /admin path")
  * Failed nodes: describe failure reason (e.g., "Attempted SQL injection (blocked by WAF)", "Port scan timed out (target unreachable)")
- **ai_analysis requirements**:
  * Successful nodes: summarize key findings of tool execution, explain the significance of these findings
  * Failed nodes: must state the failure reason, clues obtained, and how these clues guide subsequent actions
  * No more than 150 words, should be specific and informative
- **findings requirements**:
  * Extract key information points from tool return results
  * Each finding should be an independent, valuable piece of information
  * Successful nodes: list key findings (e.g., ["Port 80 open", "Port 443 open", "HTTP service is Apache 2.4"])
  * Failed nodes: list failure clues (e.g., ["WAF blocked", "Returned 403", "Cloudflare detected"])
- **status marking**:
  * Successful nodes: not set or set to "success"
  * Failed nodes providing clues: must be set to "failed_insight"
- **risk_score**: Always 0 (action nodes do not evaluate risk)

### vulnerability (vulnerability node)
- **Purpose**: Records genuinely confirmed security vulnerabilities
- **Creation rules**:
  * Must be a genuinely confirmed vulnerability, not every finding is a vulnerability
  * Requires clear vulnerability evidence (e.g., SQL injection returns database errors, XSS successfully executes, etc.)
- **risk_score rules**:
  * critical (90-100): Can lead to complete system compromise (RCE, SQL injection causing data leakage, etc.)
  * high (80-89): Can lead to sensitive information disclosure or privilege escalation
  * medium (60-79): Security risk exists but limited impact
  * low (40-59): Minor security issue
- **metadata requirements**:
  * vulnerability_type: Type of vulnerability (SQL injection, XSS, RCE, etc.)
  * description: Detailed description of vulnerability location, principle, and impact
  * severity: critical/high/medium/low
  * location: Precise vulnerability location (URL, parameter, file path, etc.)

## Node Filtering and Merging Rules

### Failed nodes that must be retained
The following failure situations must create nodes because they provide valuable clues:
- Tool returns clear error messages (permission error, connection refused, authentication failed, etc.)
- Timeout or connection failure (may indicate firewall, network isolation, etc.)
- WAF/firewall blocking (returning 403, 406, etc., indicating protective mechanisms exist)
- Tool not installed or configuration error (but a call was attempted)
- Target unreachable (DNS resolution failed, network unreachable, etc.)

### Failed nodes that should be deleted
The following situations should not create nodes:
- Tool calls with absolutely no output
- Pure system errors (unrelated to target, such as local environment issues)
- Repeated identical failures (keep only the first occurrence for multiple identical errors)

### Node merging rules
The following situations should merge nodes:
- Multiple similar calls to the same tool (e.g., multiple nmap scans of different port ranges, merge into one "port scan" node)
- Multiple similar probes on the same target (e.g., multiple directory scanning tools, merge into one "directory scan" node)

### Node count control
- **Completeness first**: Must include all meaningful tool executions and key steps; do not delete important nodes to control count
- **Suggested range**: Single target typically 8-15 nodes, but if actual execution steps are more, can appropriately increase (max 20 nodes)
- **Prioritize retaining**: Key successful steps, failures providing clues, discovered vulnerabilities, important information gathering steps
- **Can merge**: Multiple similar calls to the same tool (e.g., multiple nmap scans of different port ranges, merge into one "port scan" node)
- **Can delete**: Tool calls with no output at all, pure system errors, repeated identical failures (keep only the first for multiple identical errors)
- **Important principle**: It is better to have slightly more nodes than to omit key steps. The attack chain must fully demonstrate the complete penetration testing process

## Edge Types and Weights

### Edge types
- **leads_to**: Means "leads to" or "guides to", used for action→action, target→action
  * Example: port scan → directory scan (because port 80 was found, directory scan is performed)
- **discovers**: Means "discovers", **exclusively for action→vulnerability**
  * Example: SQL injection test → SQL injection vulnerability
  * **Important**: All action→vulnerability edges must use discovers type; even if multiple actions point to the same vulnerability, all should consistently use discovers
- **enables**: Means "enables" or "facilitates", **only for vulnerability→vulnerability, action→action (when subsequent action depends on previous result)**
  * Example: information disclosure vulnerability → privilege escalation vulnerability (information obtained from the disclosure facilitated the privilege escalation)
  * **Important**: enables cannot be used for action→vulnerability; action→vulnerability must use discovers

### Edge weights
- **Weight 1-2**: Weak association (e.g., initial probe to further probe)
- **Weight 3-4**: Moderate association (e.g., port discovery to service identification)
- **Weight 5-7**: Strong association (e.g., vulnerability found, key information disclosed)
- **Weight 8-10**: Very strong association (e.g., successful vulnerability exploitation, privilege escalation)

### DAG structure requirements (directed acyclic graph)
**Critical: Must ensure the generated structure is a true DAG (directed acyclic graph) with no cycles.**

- **Node numbering rules**: Node IDs start from "node_1" and increment (node_1, node_2, node_3...)
- **Edge direction rules**: All edges' source node ID must be strictly less than the target node ID (source < target); this is the key to ensuring no cycles
  * Example: node_1 → node_2 ✓ (correct)
  * Example: node_2 → node_1 ✗ (incorrect, would form a cycle)
  * Example: node_3 → node_5 ✓ (correct)
- **No-cycle verification**: Before outputting JSON, must check all edges to ensure no edge has source >= target
- **No isolated nodes**: Ensure each node has at least one edge connection (except possibly the root node)
- **DAG structure characteristics**:
  * One node can have multiple subsequent nodes (branching), e.g., node_2 (port scan) can simultaneously connect to node_3, node_4, node_5, etc.
  * Multiple nodes can converge to one node (converging), e.g., node_3, node_4, node_5 all point to node_6 (vulnerability node)
  * Avoid connecting all nodes into a line; build a DAG structure based on actual parallel testing and branch exploration
- **Topological sort verification**: If nodes are sorted by ID from smallest to largest, all edges should point from left to right (from top to bottom), which ensures no cycles

## Attack Chain Logical Coherence Requirements

The built attack chain should be able to answer the following questions:
1. **Starting point**: Where does the test begin? (target node)
2. **Exploration process**: How is information gradually collected? (action node sequence)
3. **Failure and adjustment**: How is strategy adjusted when encountering obstacles? (failed_insight nodes)
4. **Key discoveries**: What important information was found? (action findings)
5. **Vulnerability confirmation**: How is the existence of a vulnerability confirmed? (action→vulnerability)
6. **Attack path**: What is the complete attack path? (path from target to vulnerability)

## Last ReAct Round Input

%s

## Model Output

%s

## Output Format

Strictly output in the following JSON format, without adding any other text:

**Important: The example demonstrates a tree structure; note that node_2 (port scan) connects simultaneously to multiple subsequent nodes (node_3, node_4), forming a branching structure.**

{
   "nodes": [
     {
       "id": "node_1",
       "type": "target",
       "label": "Test target: example.com",
       "risk_score": 40,
       "metadata": {
         "target": "example.com"
       }
     },
     {
       "id": "node_2",
       "type": "action",
       "label": "Port scan found 80/443/8080",
       "risk_score": 0,
       "metadata": {
         "tool_name": "nmap",
         "tool_intent": "Port scan",
         "ai_analysis": "Used nmap to port scan the target, found ports 80, 443, 8080 open. Port 80 runs HTTP service, port 443 runs HTTPS service, port 8080 may be the admin backend. These open ports provide entry points for subsequent web application testing.",
         "findings": ["Port 80 open", "Port 443 open", "Port 8080 open", "HTTP service is Apache 2.4"]
       }
     },
     {
       "id": "node_3",
       "type": "action",
       "label": "Directory scan found /admin backend",
       "risk_score": 0,
       "metadata": {
         "tool_name": "dirsearch",
         "tool_intent": "Directory scan",
         "ai_analysis": "Used dirsearch to directory scan the target, found /admin directory exists and is accessible. This directory may be the admin backend and is an important test target.",
         "findings": ["/admin directory exists", "Returned 200 status code", "Suspected admin backend"]
       }
     },
     {
       "id": "node_4",
       "type": "action",
       "label": "Identified web service as Apache 2.4",
       "risk_score": 0,
       "metadata": {
         "tool_name": "whatweb",
         "tool_intent": "Web service identification",
         "ai_analysis": "Identified target running Apache 2.4 server, providing important information for subsequent vulnerability testing.",
         "findings": ["Apache 2.4", "PHP version information"]
       }
     },
     {
       "id": "node_5",
       "type": "action",
       "label": "Attempted SQL injection (blocked by WAF)",
       "risk_score": 0,
       "metadata": {
         "tool_name": "sqlmap",
         "tool_intent": "SQL injection detection",
         "ai_analysis": "SQL injection test on /login.php was blocked by WAF, returning 403 error. Error message shows Cloudflare protection detected. This indicates the target has deployed WAF and testing strategy needs to be adjusted.",
         "findings": ["WAF blocked", "Returned 403", "Cloudflare detected", "Target deployed WAF"],
         "status": "failed_insight"
       }
     },
     {
       "id": "node_6",
       "type": "vulnerability",
       "label": "SQL injection vulnerability",
       "risk_score": 85,
       "metadata": {
         "vulnerability_type": "SQL Injection",
         "description": "SQL injection vulnerability found in the username parameter of /admin/login.php. Can bypass login verification by injecting payload to directly obtain admin privileges. Vulnerability returns database error information, confirming the injection point exists.",
         "severity": "high",
         "location": "/admin/login.php?username="
       }
     }
   ],
   "edges": [
     {
       "source": "node_1",
       "target": "node_2",
       "type": "leads_to",
       "weight": 3
     },
     {
       "source": "node_2",
       "target": "node_3",
       "type": "leads_to",
       "weight": 4
     },
     {
       "source": "node_2",
       "target": "node_4",
       "type": "leads_to",
       "weight": 3
     },
     {
       "source": "node_3",
       "target": "node_5",
       "type": "leads_to",
       "weight": 4
     },
     {
       "source": "node_5",
       "target": "node_6",
       "type": "discovers",
       "weight": 7
     }
   ]
}

## Important Reminders

1. **No fabrication**: Only use tools actually executed and results actually returned in the ReAct input. If there is no actual data, return empty nodes and edges arrays.
2. **DAG structure required**: Must build a true DAG (directed acyclic graph) with no cycles. All edges' source node ID must be strictly less than the target node ID (source < target).
3. **Topological order**: Nodes should be numbered in logical order; target nodes are usually node_1, subsequent action nodes increment in execution order, vulnerability nodes come last.
4. **Completeness first**: Must include all meaningful tool executions and key steps; do not delete important nodes to control count. The attack chain must fully demonstrate the complete process from target identification to vulnerability discovery.
5. **Logical coherence**: Ensure the attack chain can tell a complete, coherent penetration testing story, including all key steps and decision points.
6. **Educational value**: Prioritize retaining nodes with educational significance to help learners understand penetration testing thinking and the complete process.
7. **Accuracy**: All node information must be based on actual data; do not speculate or assume.
8. **Completeness check**: Ensure each node has necessary metadata fields, each edge has correct source and target, no isolated nodes, no cycles.
9. **Do not over-simplify**: If actual execution steps are many, can appropriately increase node count (max 20), ensuring key steps are not omitted.
10. **Validate before output**: Before outputting JSON, must verify all edges satisfy source < target condition, ensuring DAG structure is correct.

Now begin analyzing and building the attack chain:`, reactInput, modelOutput)
}

// saveChain saves the attack chain to the database
func (b *Builder) saveChain(conversationID string, nodes []Node, edges []Edge) error {
	// First delete old attack chain data
	if err := b.db.DeleteAttackChain(conversationID); err != nil {
		b.logger.Warn("Failed to delete old attack chain", zap.Error(err))
	}

	for _, node := range nodes {
		metadataJSON, _ := json.Marshal(node.Metadata)
		if err := b.db.SaveAttackChainNode(conversationID, node.ID, node.Type, node.Label, "", string(metadataJSON), node.RiskScore); err != nil {
			b.logger.Warn("Failed to save attack chain node", zap.String("nodeId", node.ID), zap.Error(err))
		}
	}

	// Save edges
	for _, edge := range edges {
		if err := b.db.SaveAttackChainEdge(conversationID, edge.ID, edge.Source, edge.Target, edge.Type, edge.Weight); err != nil {
			b.logger.Warn("Failed to save attack chain edge", zap.String("edgeId", edge.ID), zap.Error(err))
		}
	}

	return nil
}

// LoadChainFromDatabase loads the attack chain from the database
func (b *Builder) LoadChainFromDatabase(conversationID string) (*Chain, error) {
	nodes, err := b.db.LoadAttackChainNodes(conversationID)
	if err != nil {
		return nil, fmt.Errorf("failed to load attack chain nodes: %w", err)
	}

	edges, err := b.db.LoadAttackChainEdges(conversationID)
	if err != nil {
		return nil, fmt.Errorf("failed to load attack chain edges: %w", err)
	}

	return &Chain{
		Nodes: nodes,
		Edges: edges,
	}, nil
}

// callAIForChainGeneration calls AI to generate the attack chain
func (b *Builder) callAIForChainGeneration(ctx context.Context, prompt string) (string, error) {
	requestBody := map[string]interface{}{
		"model": b.openAIConfig.Model,
		"messages": []map[string]interface{}{
			{
				"role":    "system",
				"content": "You are a professional security testing analyst, skilled at building attack chain graphs. Please strictly return attack chain data in JSON format.",
			},
			{
				"role":    "user",
				"content": prompt,
			},
		},
		"temperature": 0.3,
		"max_tokens":  8000,
	}

	var apiResponse struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}

	if b.openAIClient == nil {
		return "", fmt.Errorf("OpenAI client not initialized")
	}
	if err := b.openAIClient.ChatCompletion(ctx, requestBody, &apiResponse); err != nil {
		var apiErr *openai.APIError
		if errors.As(err, &apiErr) {
			bodyStr := strings.ToLower(apiErr.Body)
			if strings.Contains(bodyStr, "context") || strings.Contains(bodyStr, "length") || strings.Contains(bodyStr, "too long") {
				return "", fmt.Errorf("context length exceeded")
			}
		} else if strings.Contains(strings.ToLower(err.Error()), "context") || strings.Contains(strings.ToLower(err.Error()), "length") {
			return "", fmt.Errorf("context length exceeded")
		}
		return "", fmt.Errorf("request failed: %w", err)
	}

	if len(apiResponse.Choices) == 0 {
		return "", fmt.Errorf("API returned no valid response")
	}

	content := strings.TrimSpace(apiResponse.Choices[0].Message.Content)
	// Try to extract JSON (may contain markdown code blocks)
	content = strings.TrimPrefix(content, "```json")
	content = strings.TrimPrefix(content, "```")
	content = strings.TrimSuffix(content, "```")
	content = strings.TrimSpace(content)

	return content, nil
}

// ChainJSON attack chain JSON structure
type ChainJSON struct {
	Nodes []struct {
		ID        string                 `json:"id"`
		Type      string                 `json:"type"`
		Label     string                 `json:"label"`
		RiskScore int                    `json:"risk_score"`
		Metadata  map[string]interface{} `json:"metadata"`
	} `json:"nodes"`
	Edges []struct {
		Source string `json:"source"`
		Target string `json:"target"`
		Type   string `json:"type"`
		Weight int    `json:"weight"`
	} `json:"edges"`
}

// parseChainJSON parses the attack chain JSON
func (b *Builder) parseChainJSON(chainJSON string) (*Chain, error) {
	var chainData ChainJSON
	if err := json.Unmarshal([]byte(chainJSON), &chainData); err != nil {
		return nil, fmt.Errorf("failed to parse JSON: %w", err)
	}

	// Create node ID mapping (AI-returned ID -> new UUID)
	nodeIDMap := make(map[string]string)

	// Convert to Chain structure
	nodes := make([]Node, 0, len(chainData.Nodes))
	for _, n := range chainData.Nodes {
		// Generate new UUID node ID
		newNodeID := fmt.Sprintf("node_%s", uuid.New().String())
		nodeIDMap[n.ID] = newNodeID

		node := Node{
			ID:        newNodeID,
			Type:      n.Type,
			Label:     n.Label,
			RiskScore: n.RiskScore,
			Metadata:  n.Metadata,
		}
		if node.Metadata == nil {
			node.Metadata = make(map[string]interface{})
		}
		nodes = append(nodes, node)
	}

	// Convert edges
	edges := make([]Edge, 0, len(chainData.Edges))
	for _, e := range chainData.Edges {
		sourceID, ok := nodeIDMap[e.Source]
		if !ok {
			continue
		}
		targetID, ok := nodeIDMap[e.Target]
		if !ok {
			continue
		}

		// Generate edge ID (needed by frontend)
		edgeID := fmt.Sprintf("edge_%s", uuid.New().String())

		edges = append(edges, Edge{
			ID:     edgeID,
			Source: sourceID,
			Target: targetID,
			Type:   e.Type,
			Weight: e.Weight,
		})
	}

	return &Chain{
		Nodes: nodes,
		Edges: edges,
	}, nil
}

// All methods below are no longer in use and have been removed to simplify the code

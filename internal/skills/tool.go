package skills

import (
	"context"
	"fmt"
	"strings"
	"time"

	"cyberstrike-ai/internal/mcp"
	"cyberstrike-ai/internal/mcp/builtin"

	"go.uber.org/zap"
)

// RegisterSkillsTool registers Skills tools with the MCP server
func RegisterSkillsTool(
	mcpServer *mcp.Server,
	manager *Manager,
	logger *zap.Logger,
) {
	RegisterSkillsToolWithStorage(mcpServer, manager, nil, logger)
}

// RegisterSkillsToolWithStorage registers Skills tools with the MCP server (with storage support)
func RegisterSkillsToolWithStorage(
	mcpServer *mcp.Server,
	manager *Manager,
	storage SkillStatsStorage,
	logger *zap.Logger,
) {
	// register first tool: list all available skills
	listSkillsTool := mcp.Tool{
		Name:             builtin.ToolListSkills,
		Description:      "Get a list of all available skills. Skills are professional knowledge documents that can be read before executing tasks to obtain relevant expertise. Use this tool to view all available skills in the system, then use the read_skill tool to read the content of a specific skill.",
		ShortDescription: "Get a list of all available skills",
		InputSchema: map[string]interface{}{
			"type":       "object",
			"properties": map[string]interface{}{},
			"required":   []string{},
		},
	}

	listSkillsHandler := func(ctx context.Context, args map[string]interface{}) (*mcp.ToolResult, error) {
		skills, err := manager.ListSkills()
		if err != nil {
			logger.Error("failed to get skills list", zap.Error(err))
			return &mcp.ToolResult{
				Content: []mcp.Content{
					{
						Type: "text",
						Text: fmt.Sprintf("failed to get skills list: %v", err),
					},
				},
				IsError: true,
			}, nil
		}

		if len(skills) == 0 {
			return &mcp.ToolResult{
				Content: []mcp.Content{
					{
						Type: "text",
						Text: "No skills are currently available.\n\nSkills are professional knowledge documents that can be read before executing tasks to obtain relevant expertise. You can create new skills in the skills directory.",
					},
				},
				IsError: false,
			}, nil
		}

		var result strings.Builder
		result.WriteString(fmt.Sprintf("There are %d available skills:\n\n", len(skills)))
		for i, skill := range skills {
			result.WriteString(fmt.Sprintf("%d. %s\n", i+1, skill))
		}
		result.WriteString("\nUse the read_skill tool to read the detailed content of a specific skill.\n")
		result.WriteString("Example: read_skill(skill_name=\"sql-injection-testing\")")

		return &mcp.ToolResult{
			Content: []mcp.Content{
				{
					Type: "text",
					Text: result.String(),
				},
			},
			IsError: false,
		}, nil
	}

	mcpServer.RegisterTool(listSkillsTool, listSkillsHandler)
	logger.Info("registered skills list tool successfully")

	// register second tool: read the content of a specific skill
	readSkillTool := mcp.Tool{
		Name:             builtin.ToolReadSkill,
		Description:      "Read the detailed content of a specified skill. Skills are professional knowledge documents containing testing methods, tool usage, best practices, etc. Before executing related tasks, you can call this tool to read the relevant skill content to obtain professional knowledge and guidance.",
		ShortDescription: "Read the detailed content of a specified skill",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"skill_name": map[string]interface{}{
					"type":        "string",
					"description": "The name of the skill to read (required). You can use the list_skills tool to get all available skill names.",
				},
			},
			"required": []string{"skill_name"},
		},
	}

	readSkillHandler := func(ctx context.Context, args map[string]interface{}) (*mcp.ToolResult, error) {
		skillName, ok := args["skill_name"].(string)
		if !ok || skillName == "" {
			return &mcp.ToolResult{
				Content: []mcp.Content{
					{
						Type: "text",
						Text: "Error: skill_name parameter is required and cannot be empty. Please use the list_skills tool to get all available skill names.",
					},
				},
				IsError: true,
			}, nil
		}

		skill, err := manager.LoadSkill(skillName)
		failed := err != nil
		now := time.Now()

		// record call statistics
		if storage != nil {
			totalCalls := 1
			successCalls := 0
			failedCalls := 0
			if failed {
				failedCalls = 1
			} else {
				successCalls = 1
			}
			if err := storage.UpdateSkillStats(skillName, totalCalls, successCalls, failedCalls, &now); err != nil {
				logger.Warn("failed to save skills statistics", zap.String("skill", skillName), zap.Error(err))
			} else {
				logger.Info("skills statistics updated",
					zap.String("skill", skillName),
					zap.Int("totalCalls", totalCalls),
					zap.Int("successCalls", successCalls),
					zap.Int("failedCalls", failedCalls))
			}
		} else {
			logger.Warn("skills stats storage not configured, cannot record call statistics", zap.String("skill", skillName))
		}

		if err != nil {
			logger.Warn("failed to read skill", zap.String("skill", skillName), zap.Error(err))
			return &mcp.ToolResult{
				Content: []mcp.Content{
					{
						Type: "text",
						Text: fmt.Sprintf("failed to read skill: %v\n\nPlease use the list_skills tool to verify the skill name is correct.", err),
					},
				},
				IsError: true,
			}, nil
		}

		var result strings.Builder
		result.WriteString(fmt.Sprintf("## Skill: %s\n\n", skill.Name))
		if skill.Description != "" {
			result.WriteString(fmt.Sprintf("**Description**: %s\n\n", skill.Description))
		}
		result.WriteString("---\n\n")
		result.WriteString(skill.Content)
		result.WriteString("\n\n---\n\n")
		result.WriteString(fmt.Sprintf("*Skill path: %s*", skill.Path))

		return &mcp.ToolResult{
			Content: []mcp.Content{
				{
					Type: "text",
					Text: result.String(),
				},
			},
			IsError: false,
		}, nil
	}

	mcpServer.RegisterTool(readSkillTool, readSkillHandler)
	logger.Info("registered skill read tool successfully")
}

// SkillStatsStorage is the skills stats storage interface
type SkillStatsStorage interface {
	UpdateSkillStats(skillName string, totalCalls, successCalls, failedCalls int, lastCallTime *time.Time) error
	LoadSkillStats() (map[string]*SkillStats, error)
}

// SkillStats contains skills statistics information
type SkillStats struct {
	SkillName    string
	TotalCalls   int
	SuccessCalls int
	FailedCalls  int
	LastCallTime *time.Time
}

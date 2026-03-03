package builtin

// Built-in tool name constants.
// All code that references built-in tool names should use these constants rather than hardcoded strings.
const (
	// Vulnerability management tool
	ToolRecordVulnerability = "record_vulnerability"

	// Knowledge base tools
	ToolListKnowledgeRiskTypes = "list_knowledge_risk_types"
	ToolSearchKnowledgeBase    = "search_knowledge_base"

	// Skills tools
	ToolListSkills    = "list_skills"
	ToolReadSkill     = "read_skill"
)

// IsBuiltinTool reports whether the given tool name is a built-in tool.
func IsBuiltinTool(toolName string) bool {
	switch toolName {
	case ToolRecordVulnerability,
		ToolListKnowledgeRiskTypes,
		ToolSearchKnowledgeBase,
		ToolListSkills,
		ToolReadSkill:
		return true
	default:
		return false
	}
}

// GetAllBuiltinTools returns the list of all built-in tool names.
func GetAllBuiltinTools() []string {
	return []string{
		ToolRecordVulnerability,
		ToolListKnowledgeRiskTypes,
		ToolSearchKnowledgeBase,
		ToolListSkills,
		ToolReadSkill,
	}
}

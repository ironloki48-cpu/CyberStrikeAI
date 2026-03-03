/**
 * Built-in tool name constants
 * All places in frontend code that use built-in tool names should use these constants instead of hardcoded strings
 *
 * Note: These constants must remain consistent with the constants in the backend's internal/mcp/builtin/constants.go
 */

// Built-in tool name constants
const BuiltinTools = {
    // Vulnerability management tools
    RECORD_VULNERABILITY: 'record_vulnerability',

    // Knowledge base tools
    LIST_KNOWLEDGE_RISK_TYPES: 'list_knowledge_risk_types',
    SEARCH_KNOWLEDGE_BASE: 'search_knowledge_base'
};

// Check if a tool is a built-in tool
function isBuiltinTool(toolName) {
    return Object.values(BuiltinTools).includes(toolName);
}

// Get list of all built-in tool names
function getAllBuiltinTools() {
    return Object.values(BuiltinTools);
}


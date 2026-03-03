package handler

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"cyberstrike-ai/internal/config"

	"gopkg.in/yaml.v3"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// RoleHandler handles role CRUD operations
type RoleHandler struct {
	config        *config.Config
	configPath    string
	logger        *zap.Logger
	skillsManager SkillsManager // Skills manager interface (optional)
}

// SkillsManager is the Skills manager interface
type SkillsManager interface {
	ListSkills() ([]string, error)
}

// NewRoleHandler creates a new role handler
func NewRoleHandler(cfg *config.Config, configPath string, logger *zap.Logger) *RoleHandler {
	return &RoleHandler{
		config:     cfg,
		configPath: configPath,
		logger:     logger,
	}
}

// SetSkillsManager sets the Skills manager
func (h *RoleHandler) SetSkillsManager(manager SkillsManager) {
	h.skillsManager = manager
}

// GetSkills retrieves a list of all available skills
func (h *RoleHandler) GetSkills(c *gin.Context) {
	if h.skillsManager == nil {
		c.JSON(http.StatusOK, gin.H{
			"skills": []string{},
		})
		return
	}

	skills, err := h.skillsManager.ListSkills()
	if err != nil {
		h.logger.Warn("failed to get skills list", zap.Error(err))
		c.JSON(http.StatusOK, gin.H{
			"skills": []string{},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"skills": skills,
	})
}

// GetRoles retrieves all roles
func (h *RoleHandler) GetRoles(c *gin.Context) {
	if h.config.Roles == nil {
		h.config.Roles = make(map[string]config.RoleConfig)
	}

	roles := make([]config.RoleConfig, 0, len(h.config.Roles))
	for key, role := range h.config.Roles {
		// ensure role key matches name
		if role.Name == "" {
			role.Name = key
		}
		roles = append(roles, role)
	}

	c.JSON(http.StatusOK, gin.H{
		"roles": roles,
	})
}

// GetRole retrieves a single role
func (h *RoleHandler) GetRole(c *gin.Context) {
	roleName := c.Param("name")
	if roleName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "role name cannot be empty"})
		return
	}

	if h.config.Roles == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "role not found"})
		return
	}

	role, exists := h.config.Roles[roleName]
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "role not found"})
		return
	}

	// ensure role name matches key
	if role.Name == "" {
		role.Name = roleName
	}

	c.JSON(http.StatusOK, gin.H{
		"role": role,
	})
}

// UpdateRole updates a role
func (h *RoleHandler) UpdateRole(c *gin.Context) {
	roleName := c.Param("name")
	if roleName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "role name cannot be empty"})
		return
	}

	var req config.RoleConfig
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request parameters: " + err.Error()})
		return
	}

	// ensure role name matches the request name
	if req.Name == "" {
		req.Name = roleName
	}

	// initialize Roles map
	if h.config.Roles == nil {
		h.config.Roles = make(map[string]config.RoleConfig)
	}

	// delete all old roles with the same name but different key (to avoid duplicates)
	// use role name as key to ensure uniqueness
	finalKey := req.Name
	keysToDelete := make([]string, 0)
	for key := range h.config.Roles {
		// if key differs from the final key but name is the same, mark for deletion
		if key != finalKey {
			role := h.config.Roles[key]
			// ensure role name field is set correctly
			if role.Name == "" {
				role.Name = key
			}
			if role.Name == req.Name {
				keysToDelete = append(keysToDelete, key)
			}
		}
	}
	// delete old roles
	for _, key := range keysToDelete {
		delete(h.config.Roles, key)
		h.logger.Info("deleted duplicate role", zap.String("oldKey", key), zap.String("name", req.Name))
	}

	// if the current update key differs from the final key, delete the old one too
	if roleName != finalKey {
		delete(h.config.Roles, roleName)
	}

	// if role name changed, delete old file
	if roleName != finalKey {
		configDir := filepath.Dir(h.configPath)
		rolesDir := h.config.RolesDir
		if rolesDir == "" {
			rolesDir = "roles" // default directory
		}

		// if relative path, resolve relative to config file directory
		if !filepath.IsAbs(rolesDir) {
			rolesDir = filepath.Join(configDir, rolesDir)
		}

		// delete old role file
		oldSafeFileName := sanitizeFileName(roleName)
		oldRoleFileYaml := filepath.Join(rolesDir, oldSafeFileName+".yaml")
		oldRoleFileYml := filepath.Join(rolesDir, oldSafeFileName+".yml")

		if _, err := os.Stat(oldRoleFileYaml); err == nil {
			if err := os.Remove(oldRoleFileYaml); err != nil {
				h.logger.Warn("failed to delete old role config file", zap.String("file", oldRoleFileYaml), zap.Error(err))
			}
		}
		if _, err := os.Stat(oldRoleFileYml); err == nil {
			if err := os.Remove(oldRoleFileYml); err != nil {
				h.logger.Warn("failed to delete old role config file", zap.String("file", oldRoleFileYml), zap.Error(err))
			}
		}
	}

	// use role name as key to save (ensure uniqueness)
	h.config.Roles[finalKey] = req

	// save configuration to file
	if err := h.saveConfig(); err != nil {
		h.logger.Error("failed to save configuration", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save configuration: " + err.Error()})
		return
	}

	h.logger.Info("updated role", zap.String("oldKey", roleName), zap.String("newKey", finalKey), zap.String("name", req.Name))
	c.JSON(http.StatusOK, gin.H{
		"message": "role updated",
		"role":    req,
	})
}

// CreateRole creates a new role
func (h *RoleHandler) CreateRole(c *gin.Context) {
	var req config.RoleConfig
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request parameters: " + err.Error()})
		return
	}

	if req.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "role name cannot be empty"})
		return
	}

	// initialize Roles map
	if h.config.Roles == nil {
		h.config.Roles = make(map[string]config.RoleConfig)
	}

	// check if role already exists
	if _, exists := h.config.Roles[req.Name]; exists {
		c.JSON(http.StatusBadRequest, gin.H{"error": "role already exists"})
		return
	}

	// create role (enabled by default)
	if !req.Enabled {
		req.Enabled = true
	}

	h.config.Roles[req.Name] = req

	// save configuration to file
	if err := h.saveConfig(); err != nil {
		h.logger.Error("failed to save configuration", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save configuration: " + err.Error()})
		return
	}

	h.logger.Info("created role", zap.String("roleName", req.Name))
	c.JSON(http.StatusOK, gin.H{
		"message": "role created",
		"role":    req,
	})
}

// DeleteRole deletes a role
func (h *RoleHandler) DeleteRole(c *gin.Context) {
	roleName := c.Param("name")
	if roleName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "role name cannot be empty"})
		return
	}

	if h.config.Roles == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "role not found"})
		return
	}

	if _, exists := h.config.Roles[roleName]; !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "role not found"})
		return
	}

	// do not allow deleting the "default" role
	if roleName == "Default" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot delete the default role"})
		return
	}

	delete(h.config.Roles, roleName)

	// delete corresponding role file
	configDir := filepath.Dir(h.configPath)
	rolesDir := h.config.RolesDir
	if rolesDir == "" {
		rolesDir = "roles" // default directory
	}

	// if relative path, resolve relative to config file directory
	if !filepath.IsAbs(rolesDir) {
		rolesDir = filepath.Join(configDir, rolesDir)
	}

	// attempt to delete role files (.yaml and .yml)
	safeFileName := sanitizeFileName(roleName)
	roleFileYaml := filepath.Join(rolesDir, safeFileName+".yaml")
	roleFileYml := filepath.Join(rolesDir, safeFileName+".yml")

	// delete .yaml file (if exists)
	if _, err := os.Stat(roleFileYaml); err == nil {
		if err := os.Remove(roleFileYaml); err != nil {
			h.logger.Warn("failed to delete role config file", zap.String("file", roleFileYaml), zap.Error(err))
		} else {
			h.logger.Info("deleted role config file", zap.String("file", roleFileYaml))
		}
	}

	// delete .yml file (if exists)
	if _, err := os.Stat(roleFileYml); err == nil {
		if err := os.Remove(roleFileYml); err != nil {
			h.logger.Warn("failed to delete role config file", zap.String("file", roleFileYml), zap.Error(err))
		} else {
			h.logger.Info("deleted role config file", zap.String("file", roleFileYml))
		}
	}

	h.logger.Info("deleted role", zap.String("roleName", roleName))
	c.JSON(http.StatusOK, gin.H{
		"message": "role deleted",
	})
}

// saveConfig saves the configuration to files in the directory
func (h *RoleHandler) saveConfig() error {
	configDir := filepath.Dir(h.configPath)
	rolesDir := h.config.RolesDir
	if rolesDir == "" {
		rolesDir = "roles" // default directory
	}

	// if relative path, resolve relative to config file directory
	if !filepath.IsAbs(rolesDir) {
		rolesDir = filepath.Join(configDir, rolesDir)
	}

	// ensure directory exists
	if err := os.MkdirAll(rolesDir, 0755); err != nil {
		return fmt.Errorf("failed to create roles directory: %w", err)
	}

	// save each role to an individual file
	if h.config.Roles != nil {
		for roleName, role := range h.config.Roles {
			// ensure role name is set correctly
			if role.Name == "" {
				role.Name = roleName
			}

			// use role name as file name (sanitize to avoid special characters)
			safeFileName := sanitizeFileName(role.Name)
			roleFile := filepath.Join(rolesDir, safeFileName+".yaml")

			// serialize role configuration to YAML
			roleData, err := yaml.Marshal(&role)
			if err != nil {
				h.logger.Error("failed to serialize role configuration", zap.String("role", roleName), zap.Error(err))
				continue
			}

			// handle icon field: ensure icon values containing \U are quoted (YAML requires quotes for Unicode escapes)
			roleDataStr := string(roleData)
			if role.Icon != "" && strings.HasPrefix(role.Icon, "\\U") {
				// match icon: \UXXXXXXXX format (without quotes), excluding already-quoted cases
				// use negative lookahead to ensure no quotes follow, or directly match unquoted cases
				re := regexp.MustCompile(`(?m)^(icon:\s+)(\\U[0-9A-F]{8})(\s*)$`)
				roleDataStr = re.ReplaceAllString(roleDataStr, `${1}"${2}"${3}`)
				roleData = []byte(roleDataStr)
			}

			// write to file
			if err := os.WriteFile(roleFile, roleData, 0644); err != nil {
				h.logger.Error("failed to save role config file", zap.String("role", roleName), zap.String("file", roleFile), zap.Error(err))
				continue
			}

			h.logger.Info("role configuration saved to file", zap.String("role", roleName), zap.String("file", roleFile))
		}
	}

	return nil
}

// sanitizeFileName converts a role name to a safe file name
func sanitizeFileName(name string) string {
	// replace potentially unsafe characters
	replacer := map[rune]string{
		'/':  "_",
		'\\': "_",
		':':  "_",
		'*':  "_",
		'?':  "_",
		'"':  "_",
		'<':  "_",
		'>':  "_",
		'|':  "_",
		' ':  "_",
	}

	var result []rune
	for _, r := range name {
		if replacement, ok := replacer[r]; ok {
			result = append(result, []rune(replacement)...)
		} else {
			result = append(result, r)
		}
	}

	fileName := string(result)
	// if file name is empty, use default name
	if fileName == "" {
		fileName = "role"
	}

	return fileName
}

// updateRolesConfig updates the roles configuration
func updateRolesConfig(doc *yaml.Node, cfg config.RolesConfig) {
	root := doc.Content[0]
	rolesNode := ensureMap(root, "roles")

	// clear existing roles
	if rolesNode.Kind == yaml.MappingNode {
		rolesNode.Content = nil
	}

	// add new roles (use name as key to ensure uniqueness)
	if cfg.Roles != nil {
		// build a map keyed by name to deduplicate (keep the last one)
		rolesByName := make(map[string]config.RoleConfig)
		for roleKey, role := range cfg.Roles {
			// ensure role name field is set correctly
			if role.Name == "" {
				role.Name = roleKey
			}
			// use name as final key; if multiple keys map to the same name, keep the last one
			rolesByName[role.Name] = role
		}

		// write deduplicated roles to YAML
		for roleName, role := range rolesByName {
			roleNode := ensureMap(rolesNode, roleName)
			setStringInMap(roleNode, "name", role.Name)
			setStringInMap(roleNode, "description", role.Description)
			setStringInMap(roleNode, "user_prompt", role.UserPrompt)
			if role.Icon != "" {
				setStringInMap(roleNode, "icon", role.Icon)
			}
			setBoolInMap(roleNode, "enabled", role.Enabled)

			// add tool list (prefer tools field)
			if len(role.Tools) > 0 {
				toolsNode := ensureArray(roleNode, "tools")
				toolsNode.Content = nil
				for _, toolKey := range role.Tools {
					toolNode := &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: toolKey}
					toolsNode.Content = append(toolsNode.Content, toolNode)
				}
			} else if len(role.MCPs) > 0 {
				// backward compatibility: if no tools but mcps exist, save mcps
				mcpsNode := ensureArray(roleNode, "mcps")
				mcpsNode.Content = nil
				for _, mcpName := range role.MCPs {
					mcpNode := &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: mcpName}
					mcpsNode.Content = append(mcpsNode.Content, mcpNode)
				}
			}
		}
	}
}

// ensureArray ensures a sequence node exists for the specified key in the parent
func ensureArray(parent *yaml.Node, key string) *yaml.Node {
	_, valueNode := ensureKeyValue(parent, key)
	if valueNode.Kind != yaml.SequenceNode {
		valueNode.Kind = yaml.SequenceNode
		valueNode.Tag = "!!seq"
		valueNode.Content = nil
	}
	return valueNode
}

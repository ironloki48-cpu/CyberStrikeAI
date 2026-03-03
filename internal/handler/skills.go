package handler

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"cyberstrike-ai/internal/config"
	"cyberstrike-ai/internal/database"
	"cyberstrike-ai/internal/skills"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
	"gopkg.in/yaml.v3"
)

// SkillsHandler Skills handler
type SkillsHandler struct {
	manager    *skills.Manager
	config     *config.Config
	configPath string
	logger     *zap.Logger
	db         *database.DB // database connection (used to get call statistics)
}

// NewSkillsHandler creates a new Skills handler
func NewSkillsHandler(manager *skills.Manager, cfg *config.Config, configPath string, logger *zap.Logger) *SkillsHandler {
	return &SkillsHandler{
		manager:    manager,
		config:     cfg,
		configPath: configPath,
		logger:     logger,
	}
}

// SetDB sets the database connection (used to get call statistics)
func (h *SkillsHandler) SetDB(db *database.DB) {
	h.db = db
}

// GetSkills retrieves all skills list (supports pagination and search)
func (h *SkillsHandler) GetSkills(c *gin.Context) {
	skillList, err := h.manager.ListSkills()
	if err != nil {
		h.logger.Error("failed to get skills list", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// search parameter
	searchKeyword := strings.TrimSpace(c.Query("search"))

	// load detailed info for all skills first, for search filtering
	allSkillsInfo := make([]map[string]interface{}, 0, len(skillList))
	for _, skillName := range skillList {
		skill, err := h.manager.LoadSkill(skillName)
		if err != nil {
			h.logger.Warn("failed to load skill", zap.String("skill", skillName), zap.Error(err))
			continue
		}

		// get file info
		skillPath := skill.Path
		skillFile := filepath.Join(skillPath, "SKILL.md")
		// try other possible file names
		if _, err := os.Stat(skillFile); os.IsNotExist(err) {
			alternatives := []string{
				filepath.Join(skillPath, "skill.md"),
				filepath.Join(skillPath, "README.md"),
				filepath.Join(skillPath, "readme.md"),
			}
			for _, alt := range alternatives {
				if _, err := os.Stat(alt); err == nil {
					skillFile = alt
					break
				}
			}
		}

		fileInfo, _ := os.Stat(skillFile)
		var fileSize int64
		var modTime string
		if fileInfo != nil {
			fileSize = fileInfo.Size()
			modTime = fileInfo.ModTime().Format("2006-01-02 15:04:05")
		}

		skillInfo := map[string]interface{}{
			"name":        skill.Name,
			"description": skill.Description,
			"path":        skill.Path,
			"file_size":   fileSize,
			"mod_time":    modTime,
		}
		allSkillsInfo = append(allSkillsInfo, skillInfo)
	}

	// if a search keyword is provided, filter the results
	filteredSkillsInfo := allSkillsInfo
	if searchKeyword != "" {
		keywordLower := strings.ToLower(searchKeyword)
		filteredSkillsInfo = make([]map[string]interface{}, 0)
		for _, skillInfo := range allSkillsInfo {
			name := strings.ToLower(fmt.Sprintf("%v", skillInfo["name"]))
			description := strings.ToLower(fmt.Sprintf("%v", skillInfo["description"]))
			path := strings.ToLower(fmt.Sprintf("%v", skillInfo["path"]))

			if strings.Contains(name, keywordLower) ||
				strings.Contains(description, keywordLower) ||
				strings.Contains(path, keywordLower) {
				filteredSkillsInfo = append(filteredSkillsInfo, skillInfo)
			}
		}
	}

	// pagination parameters
	limit := 20 // default 20 per page
	offset := 0
	if limitStr := c.Query("limit"); limitStr != "" {
		if parsed, err := parseInt(limitStr); err == nil && parsed > 0 {
			// allow larger limits for search scenarios, but set a reasonable upper bound (10000)
			if parsed <= 10000 {
				limit = parsed
			} else {
				limit = 10000
			}
		}
	}
	if offsetStr := c.Query("offset"); offsetStr != "" {
		if parsed, err := parseInt(offsetStr); err == nil && parsed >= 0 {
			offset = parsed
		}
	}

	// calculate pagination range
	total := len(filteredSkillsInfo)
	start := offset
	end := offset + limit
	if start > total {
		start = total
	}
	if end > total {
		end = total
	}

	// get the skill list for the current page
	var paginatedSkillsInfo []map[string]interface{}
	if start < end {
		paginatedSkillsInfo = filteredSkillsInfo[start:end]
	} else {
		paginatedSkillsInfo = []map[string]interface{}{}
	}

	c.JSON(http.StatusOK, gin.H{
		"skills": paginatedSkillsInfo,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}

// GetSkill retrieves detailed info for a single skill
func (h *SkillsHandler) GetSkill(c *gin.Context) {
	skillName := c.Param("name")
	if skillName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "skill name cannot be empty"})
		return
	}

	skill, err := h.manager.LoadSkill(skillName)
	if err != nil {
		h.logger.Warn("failed to load skill", zap.String("skill", skillName), zap.Error(err))
		c.JSON(http.StatusNotFound, gin.H{"error": "skill does not exist: " + err.Error()})
		return
	}

	// get file info
	skillPath := skill.Path
	skillFile := filepath.Join(skillPath, "SKILL.md")
	if _, err := os.Stat(skillFile); os.IsNotExist(err) {
		alternatives := []string{
			filepath.Join(skillPath, "skill.md"),
			filepath.Join(skillPath, "README.md"),
			filepath.Join(skillPath, "readme.md"),
		}
		for _, alt := range alternatives {
			if _, err := os.Stat(alt); err == nil {
				skillFile = alt
				break
			}
		}
	}

	fileInfo, _ := os.Stat(skillFile)
	var fileSize int64
	var modTime string
	if fileInfo != nil {
		fileSize = fileInfo.Size()
		modTime = fileInfo.ModTime().Format("2006-01-02 15:04:05")
	}

	c.JSON(http.StatusOK, gin.H{
		"skill": map[string]interface{}{
			"name":        skill.Name,
			"description": skill.Description,
			"content":     skill.Content,
			"path":        skill.Path,
			"file_size":   fileSize,
			"mod_time":    modTime,
		},
	})
}

// GetSkillBoundRoles retrieves the list of roles bound to the specified skill
func (h *SkillsHandler) GetSkillBoundRoles(c *gin.Context) {
	skillName := c.Param("name")
	if skillName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "skill name cannot be empty"})
		return
	}

	boundRoles := h.getRolesBoundToSkill(skillName)
	c.JSON(http.StatusOK, gin.H{
		"skill":       skillName,
		"bound_roles": boundRoles,
		"bound_count": len(boundRoles),
	})
}

// getRolesBoundToSkill retrieves the list of roles bound to the specified skill (does not modify config)
func (h *SkillsHandler) getRolesBoundToSkill(skillName string) []string {
	if h.config.Roles == nil {
		return []string{}
	}

	boundRoles := make([]string, 0)
	for roleName, role := range h.config.Roles {
		// ensure role name is correctly set
		if role.Name == "" {
			role.Name = roleName
		}

		// check if the role's Skills list contains this skill
		if len(role.Skills) > 0 {
			for _, skill := range role.Skills {
				if skill == skillName {
					boundRoles = append(boundRoles, roleName)
					break
				}
			}
		}
	}

	return boundRoles
}

// CreateSkill creates a new skill
func (h *SkillsHandler) CreateSkill(c *gin.Context) {
	var req struct {
		Name        string `json:"name" binding:"required"`
		Description string `json:"description"`
		Content     string `json:"content" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request parameters: " + err.Error()})
		return
	}

	// validate skill name (only letters, numbers, hyphens, and underscores allowed)
	if !isValidSkillName(req.Name) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "skill name can only contain letters, numbers, hyphens, and underscores"})
		return
	}

	// get skills directory
	skillsDir := h.config.SkillsDir
	if skillsDir == "" {
		skillsDir = "skills"
	}
	configDir := filepath.Dir(h.configPath)
	if !filepath.IsAbs(skillsDir) {
		skillsDir = filepath.Join(configDir, skillsDir)
	}

	// create skill directory
	skillDir := filepath.Join(skillsDir, req.Name)
	if err := os.MkdirAll(skillDir, 0755); err != nil {
		h.logger.Error("failed to create skill directory", zap.String("skill", req.Name), zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create skill directory: " + err.Error()})
		return
	}

	// check if it already exists
	skillFile := filepath.Join(skillDir, "SKILL.md")
	if _, err := os.Stat(skillFile); err == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "skill already exists"})
		return
	}

	// build SKILL.md content
	var content strings.Builder
	content.WriteString("---\n")
	content.WriteString(fmt.Sprintf("name: %s\n", req.Name))
	if req.Description != "" {
		// if description contains special characters, add quotes
		desc := req.Description
		if strings.Contains(desc, ":") || strings.Contains(desc, "\n") {
			desc = fmt.Sprintf(`"%s"`, strings.ReplaceAll(desc, `"`, `\"`))
		}
		content.WriteString(fmt.Sprintf("description: %s\n", desc))
	}
	content.WriteString("version: 1.0.0\n")
	content.WriteString("---\n\n")
	content.WriteString(req.Content)

	// write file
	if err := os.WriteFile(skillFile, []byte(content.String()), 0644); err != nil {
		h.logger.Error("failed to create skill file", zap.String("skill", req.Name), zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create skill file: " + err.Error()})
		return
	}

	h.logger.Info("skill created successfully", zap.String("skill", req.Name))
	c.JSON(http.StatusOK, gin.H{
		"message": "skill created",
		"skill": map[string]interface{}{
			"name": req.Name,
			"path": skillDir,
		},
	})
}

// UpdateSkill updates a skill
func (h *SkillsHandler) UpdateSkill(c *gin.Context) {
	skillName := c.Param("name")
	if skillName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "skill name cannot be empty"})
		return
	}

	var req struct {
		Description string `json:"description"`
		Content     string `json:"content" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request parameters: " + err.Error()})
		return
	}

	// get skills directory
	skillsDir := h.config.SkillsDir
	if skillsDir == "" {
		skillsDir = "skills"
	}
	configDir := filepath.Dir(h.configPath)
	if !filepath.IsAbs(skillsDir) {
		skillsDir = filepath.Join(configDir, skillsDir)
	}

	// find skill file
	skillDir := filepath.Join(skillsDir, skillName)
	skillFile := filepath.Join(skillDir, "SKILL.md")
	if _, err := os.Stat(skillFile); os.IsNotExist(err) {
		alternatives := []string{
			filepath.Join(skillDir, "skill.md"),
			filepath.Join(skillDir, "README.md"),
			filepath.Join(skillDir, "readme.md"),
		}
		found := false
		for _, alt := range alternatives {
			if _, err := os.Stat(alt); err == nil {
				skillFile = alt
				found = true
				break
			}
		}
		if !found {
			c.JSON(http.StatusNotFound, gin.H{"error": "skill does not exist"})
			return
		}
	}

	// read existing file to preserve the name in front matter
	existingContent, err := os.ReadFile(skillFile)
	if err != nil {
		h.logger.Error("failed to read skill file", zap.String("skill", skillName), zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read skill file: " + err.Error()})
		return
	}

	// parse existing content to extract name
	existingName := skillName
	contentStr := string(existingContent)
	if strings.HasPrefix(contentStr, "---") {
		parts := strings.SplitN(contentStr, "---", 3)
		if len(parts) >= 2 {
			frontMatter := parts[1]
			lines := strings.Split(frontMatter, "\n")
			for _, line := range lines {
				line = strings.TrimSpace(line)
				if strings.HasPrefix(line, "name:") {
					name := strings.TrimSpace(strings.TrimPrefix(line, "name:"))
					name = strings.Trim(name, `"'`)
					if name != "" {
						existingName = name
					}
					break
				}
			}
		}
	}

	// build new SKILL.md content
	var newContent strings.Builder
	newContent.WriteString("---\n")
	newContent.WriteString(fmt.Sprintf("name: %s\n", existingName))
	if req.Description != "" {
		// if description contains special characters, add quotes
		desc := req.Description
		if strings.Contains(desc, ":") || strings.Contains(desc, "\n") {
			desc = fmt.Sprintf(`"%s"`, strings.ReplaceAll(desc, `"`, `\"`))
		}
		newContent.WriteString(fmt.Sprintf("description: %s\n", desc))
	}
	newContent.WriteString("version: 1.0.0\n")
	newContent.WriteString("---\n\n")
	newContent.WriteString(req.Content)

	// write file (standardize to SKILL.md)
	targetFile := filepath.Join(skillDir, "SKILL.md")
	if err := os.WriteFile(targetFile, []byte(newContent.String()), 0644); err != nil {
		h.logger.Error("failed to update skill file", zap.String("skill", skillName), zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update skill file: " + err.Error()})
		return
	}

	// if the original file was not SKILL.md, delete the old file
	if skillFile != targetFile {
		os.Remove(skillFile)
	}

	h.logger.Info("skill updated successfully", zap.String("skill", skillName))
	c.JSON(http.StatusOK, gin.H{
		"message": "skill updated",
	})
}

// DeleteSkill deletes a skill
func (h *SkillsHandler) DeleteSkill(c *gin.Context) {
	skillName := c.Param("name")
	if skillName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "skill name cannot be empty"})
		return
	}

	// check if any roles are bound to this skill; if so, automatically remove the binding
	affectedRoles := h.removeSkillFromRoles(skillName)
	if len(affectedRoles) > 0 {
		h.logger.Info("removing skill binding from roles",
			zap.String("skill", skillName),
			zap.Strings("roles", affectedRoles))
	}

	// get skills directory
	skillsDir := h.config.SkillsDir
	if skillsDir == "" {
		skillsDir = "skills"
	}
	configDir := filepath.Dir(h.configPath)
	if !filepath.IsAbs(skillsDir) {
		skillsDir = filepath.Join(configDir, skillsDir)
	}

	// delete skill directory
	skillDir := filepath.Join(skillsDir, skillName)
	if err := os.RemoveAll(skillDir); err != nil {
		h.logger.Error("failed to delete skill", zap.String("skill", skillName), zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete skill: " + err.Error()})
		return
	}

	responseMsg := "skill deleted"
	if len(affectedRoles) > 0 {
		responseMsg = fmt.Sprintf("skill deleted, automatically removed binding from %d role(s): %s",
			len(affectedRoles), strings.Join(affectedRoles, ", "))
	}

	h.logger.Info("skill deleted successfully", zap.String("skill", skillName))
	c.JSON(http.StatusOK, gin.H{
		"message":        responseMsg,
		"affected_roles": affectedRoles,
	})
}

// GetSkillStats retrieves skill call statistics
func (h *SkillsHandler) GetSkillStats(c *gin.Context) {
	skillList, err := h.manager.ListSkills()
	if err != nil {
		h.logger.Error("failed to get skills list", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// get skills directory
	skillsDir := h.config.SkillsDir
	if skillsDir == "" {
		skillsDir = "skills"
	}
	configDir := filepath.Dir(h.configPath)
	if !filepath.IsAbs(skillsDir) {
		skillsDir = filepath.Join(configDir, skillsDir)
	}

	// load call statistics from database
	var skillStatsMap map[string]*database.SkillStats
	if h.db != nil {
		dbStats, err := h.db.LoadSkillStats()
		if err != nil {
			h.logger.Warn("failed to load Skills statistics from database", zap.Error(err))
			skillStatsMap = make(map[string]*database.SkillStats)
		} else {
			skillStatsMap = dbStats
		}
	} else {
		skillStatsMap = make(map[string]*database.SkillStats)
	}

	// build statistics (includes all skills, even those with no call records)
	statsList := make([]map[string]interface{}, 0, len(skillList))
	totalCalls := 0
	totalSuccess := 0
	totalFailed := 0

	for _, skillName := range skillList {
		stat, exists := skillStatsMap[skillName]
		if !exists {
			stat = &database.SkillStats{
				SkillName:    skillName,
				TotalCalls:   0,
				SuccessCalls: 0,
				FailedCalls:  0,
			}
		}

		totalCalls += stat.TotalCalls
		totalSuccess += stat.SuccessCalls
		totalFailed += stat.FailedCalls

		lastCallTimeStr := ""
		if stat.LastCallTime != nil {
			lastCallTimeStr = stat.LastCallTime.Format("2006-01-02 15:04:05")
		}

		statsList = append(statsList, map[string]interface{}{
			"skill_name":     stat.SkillName,
			"total_calls":    stat.TotalCalls,
			"success_calls":  stat.SuccessCalls,
			"failed_calls":   stat.FailedCalls,
			"last_call_time": lastCallTimeStr,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"total_skills":  len(skillList),
		"total_calls":   totalCalls,
		"total_success": totalSuccess,
		"total_failed":  totalFailed,
		"skills_dir":    skillsDir,
		"stats":         statsList,
	})
}

// ClearSkillStats clears all Skills statistics
func (h *SkillsHandler) ClearSkillStats(c *gin.Context) {
	if h.db == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "database connection not configured"})
		return
	}

	if err := h.db.ClearSkillStats(); err != nil {
		h.logger.Error("failed to clear Skills statistics", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to clear statistics: " + err.Error()})
		return
	}

	h.logger.Info("all Skills statistics cleared")
	c.JSON(http.StatusOK, gin.H{
		"message": "all Skills statistics cleared",
	})
}

// ClearSkillStatsByName clears statistics for the specified skill
func (h *SkillsHandler) ClearSkillStatsByName(c *gin.Context) {
	skillName := c.Param("name")
	if skillName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "skill name cannot be empty"})
		return
	}

	if h.db == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "database connection not configured"})
		return
	}

	if err := h.db.ClearSkillStatsByName(skillName); err != nil {
		h.logger.Error("failed to clear statistics for specified skill", zap.String("skill", skillName), zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to clear statistics: " + err.Error()})
		return
	}

	h.logger.Info("statistics for specified skill cleared", zap.String("skill", skillName))
	c.JSON(http.StatusOK, gin.H{
		"message": fmt.Sprintf("statistics for skill '%s' cleared", skillName),
	})
}

// removeSkillFromRoles removes the specified skill binding from all roles
// returns the list of affected role names
func (h *SkillsHandler) removeSkillFromRoles(skillName string) []string {
	if h.config.Roles == nil {
		return []string{}
	}

	affectedRoles := make([]string, 0)
	rolesToUpdate := make(map[string]config.RoleConfig)

	// iterate over all roles to find and remove skill bindings
	for roleName, role := range h.config.Roles {
		// ensure role name is correctly set
		if role.Name == "" {
			role.Name = roleName
		}

		// check if the role's Skills list contains the skill to be deleted
		if len(role.Skills) > 0 {
			updated := false
			newSkills := make([]string, 0, len(role.Skills))
			for _, skill := range role.Skills {
				if skill != skillName {
					newSkills = append(newSkills, skill)
				} else {
					updated = true
				}
			}
			if updated {
				role.Skills = newSkills
				rolesToUpdate[roleName] = role
				affectedRoles = append(affectedRoles, roleName)
			}
		}
	}

	// if any roles need updating, save to file
	if len(rolesToUpdate) > 0 {
		// update config in memory
		for roleName, role := range rolesToUpdate {
			h.config.Roles[roleName] = role
		}
		// save updated role config to file
		if err := h.saveRolesConfig(); err != nil {
			h.logger.Error("failed to save role config", zap.Error(err))
		}
	}

	return affectedRoles
}

// saveRolesConfig saves role config to file (called from SkillsHandler)
func (h *SkillsHandler) saveRolesConfig() error {
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

	// save each role to a separate file
	if h.config.Roles != nil {
		for roleName, role := range h.config.Roles {
			// ensure role name is correctly set
			if role.Name == "" {
				role.Name = roleName
			}

			// use role name as filename (sanitize filename to avoid special characters)
			safeFileName := sanitizeRoleFileName(role.Name)
			roleFile := filepath.Join(rolesDir, safeFileName+".yaml")

			// serialize role config to YAML
			roleData, err := yaml.Marshal(&role)
			if err != nil {
				h.logger.Error("failed to serialize role config", zap.String("role", roleName), zap.Error(err))
				continue
			}

			// handle icon field: ensure icon values containing \U are quoted (YAML needs quotes to correctly parse Unicode escapes)
			roleDataStr := string(roleData)
			if role.Icon != "" && strings.HasPrefix(role.Icon, "\\U") {
				// match icon: \UXXXXXXXX format (without quotes), excluding already-quoted cases
				re := regexp.MustCompile(`(?m)^(icon:\s+)(\\U[0-9A-F]{8})(\s*)$`)
				roleDataStr = re.ReplaceAllString(roleDataStr, `${1}"${2}"${3}`)
				roleData = []byte(roleDataStr)
			}

			// write file
			if err := os.WriteFile(roleFile, roleData, 0644); err != nil {
				h.logger.Error("failed to save role config file", zap.String("role", roleName), zap.String("file", roleFile), zap.Error(err))
				continue
			}

			h.logger.Info("role config saved to file", zap.String("role", roleName), zap.String("file", roleFile))
		}
	}

	return nil
}

// sanitizeRoleFileName converts a role name to a safe filename
func sanitizeRoleFileName(name string) string {
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
	// if filename is empty, use default name
	if fileName == "" {
		fileName = "role"
	}

	return fileName
}

// isValidSkillName validates whether a skill name is valid
func isValidSkillName(name string) bool {
	if name == "" || len(name) > 100 {
		return false
	}
	// only letters, numbers, hyphens, and underscores are allowed
	for _, r := range name {
		if !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_') {
			return false
		}
	}
	return true
}

package skills

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"go.uber.org/zap"
)

// Manager is the Skills manager
type Manager struct {
	skillsDir string
	logger    *zap.Logger
	skills    map[string]*Skill // cache of loaded skills
	mu        sync.RWMutex      // protects concurrent access to skills map
}

// Skill defines a skill
type Skill struct {
	Name        string // skill name
	Description string // skill description
	Content     string // skill content (extracted from SKILL.md)
	Path        string // skill path
}

// NewManager creates a new Skills manager
func NewManager(skillsDir string, logger *zap.Logger) *Manager {
	return &Manager{
		skillsDir: skillsDir,
		logger:    logger,
		skills:    make(map[string]*Skill),
	}
}

// LoadSkill loads a single skill
func (m *Manager) LoadSkill(skillName string) (*Skill, error) {
	// try read lock to check cache first
	m.mu.RLock()
	if skill, exists := m.skills[skillName]; exists {
		m.mu.RUnlock()
		return skill, nil
	}
	m.mu.RUnlock()

	// build skill path
	skillPath := filepath.Join(m.skillsDir, skillName)

	// check if directory exists
	if _, err := os.Stat(skillPath); os.IsNotExist(err) {
		return nil, fmt.Errorf("skill %s not found", skillName)
	}

	// find SKILL.md file
	skillFile := filepath.Join(skillPath, "SKILL.md")
	if _, err := os.Stat(skillFile); os.IsNotExist(err) {
		// try other possible file names
		alternatives := []string{
			filepath.Join(skillPath, "skill.md"),
			filepath.Join(skillPath, "README.md"),
			filepath.Join(skillPath, "readme.md"),
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
			return nil, fmt.Errorf("skill file not found for %s", skillName)
		}
	}

	// read skill file
	content, err := os.ReadFile(skillFile)
	if err != nil {
		return nil, fmt.Errorf("failed to read skill file: %w", err)
	}

	// parse skill content
	skill := m.parseSkillContent(string(content), skillName, skillPath)

	// use write lock to cache skill (double-check to avoid duplicate loading)
	m.mu.Lock()
	// check again, another goroutine may have already loaded it
	if existing, exists := m.skills[skillName]; exists {
		m.mu.Unlock()
		return existing, nil
	}
	m.skills[skillName] = skill
	m.mu.Unlock()

	return skill, nil
}

// LoadSkills loads skills in batch
func (m *Manager) LoadSkills(skillNames []string) ([]*Skill, error) {
	var skills []*Skill
	var errors []string

	for _, name := range skillNames {
		skill, err := m.LoadSkill(name)
		if err != nil {
			errors = append(errors, fmt.Sprintf("failed to load skill %s: %v", name, err))
			m.logger.Warn("failed to load skill", zap.String("skill", name), zap.Error(err))
			continue
		}
		skills = append(skills, skill)
	}

	if len(errors) > 0 && len(skills) == 0 {
		return nil, fmt.Errorf("failed to load any skills: %s", strings.Join(errors, "; "))
	}

	return skills, nil
}

// ListSkills lists all available skills
func (m *Manager) ListSkills() ([]string, error) {
	if _, err := os.Stat(m.skillsDir); os.IsNotExist(err) {
		return []string{}, nil
	}

	entries, err := os.ReadDir(m.skillsDir)
	if err != nil {
		return nil, fmt.Errorf("failed to read skills directory: %w", err)
	}

	var skills []string
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		skillName := entry.Name()
		// check if SKILL.md file exists
		skillFile := filepath.Join(m.skillsDir, skillName, "SKILL.md")
		if _, err := os.Stat(skillFile); err == nil {
			skills = append(skills, skillName)
			continue
		}

		// try other possible file names
		alternatives := []string{
			filepath.Join(m.skillsDir, skillName, "skill.md"),
			filepath.Join(m.skillsDir, skillName, "README.md"),
			filepath.Join(m.skillsDir, skillName, "readme.md"),
		}
		for _, alt := range alternatives {
			if _, err := os.Stat(alt); err == nil {
				skills = append(skills, skillName)
				break
			}
		}
	}

	return skills, nil
}

// parseSkillContent parses skill content
// supports YAML front matter format, similar to goskills
func (m *Manager) parseSkillContent(content, skillName, skillPath string) *Skill {
	skill := &Skill{
		Name: skillName,
		Path: skillPath,
	}

	// check if there is YAML front matter
	if strings.HasPrefix(content, "---") {
		parts := strings.SplitN(content, "---", 3)
		if len(parts) >= 3 {
			// parse front matter (simple implementation, only extract name and description)
			frontMatter := parts[1]
			lines := strings.Split(frontMatter, "\n")
			for _, line := range lines {
				line = strings.TrimSpace(line)
				if strings.HasPrefix(line, "name:") {
					name := strings.TrimSpace(strings.TrimPrefix(line, "name:"))
					name = strings.Trim(name, `"'"`)
					if name != "" {
						skill.Name = name
					}
				} else if strings.HasPrefix(line, "description:") {
					desc := strings.TrimSpace(strings.TrimPrefix(line, "description:"))
					desc = strings.Trim(desc, `"'"`)
					skill.Description = desc
				}
			}
			// remaining part is the content
			if len(parts) == 3 {
				skill.Content = strings.TrimSpace(parts[2])
			}
		} else {
			// no front matter, entire content is the skill content
			skill.Content = content
		}
	} else {
		// no front matter, entire content is the skill content
		skill.Content = content
	}

	// if content is empty, use description as content
	if skill.Content == "" {
		skill.Content = skill.Description
	}

	return skill
}

// GetSkillContent gets the complete content of skills (used for injection into system prompts)
func (m *Manager) GetSkillContent(skillNames []string) (string, error) {
	skills, err := m.LoadSkills(skillNames)
	if err != nil {
		return "", err
	}

	if len(skills) == 0 {
		return "", nil
	}

	var builder strings.Builder
	builder.WriteString("## Available Skills\n\n")
	builder.WriteString("Before executing tasks, please carefully read the following skill content, which contains relevant professional knowledge and methods:\n\n")

	for _, skill := range skills {
		builder.WriteString(fmt.Sprintf("### Skill: %s\n", skill.Name))
		if skill.Description != "" {
			builder.WriteString(fmt.Sprintf("**Description**: %s\n\n", skill.Description))
		}
		builder.WriteString(skill.Content)
		builder.WriteString("\n\n---\n\n")
	}

	return builder.String(), nil
}

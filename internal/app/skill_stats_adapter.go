package app

import (
	"time"

	"cyberstrike-ai/internal/database"
	"cyberstrike-ai/internal/skills"
)

// skillStatsDBAdapter adapts database.DB to the skills.SkillStatsStorage interface
type skillStatsDBAdapter struct {
	db *database.DB
}

// UpdateSkillStats updates Skills statistics
func (a *skillStatsDBAdapter) UpdateSkillStats(skillName string, totalCalls, successCalls, failedCalls int, lastCallTime *time.Time) error {
	return a.db.UpdateSkillStats(skillName, totalCalls, successCalls, failedCalls, lastCallTime)
}

// LoadSkillStats loads all Skills statistics
func (a *skillStatsDBAdapter) LoadSkillStats() (map[string]*skills.SkillStats, error) {
	dbStats, err := a.db.LoadSkillStats()
	if err != nil {
		return nil, err
	}

	// convert to skills.SkillStats format
	result := make(map[string]*skills.SkillStats)
	for name, stat := range dbStats {
		result[name] = &skills.SkillStats{
			SkillName:    stat.SkillName,
			TotalCalls:   stat.TotalCalls,
			SuccessCalls: stat.SuccessCalls,
			FailedCalls:  stat.FailedCalls,
			LastCallTime: stat.LastCallTime,
		}
	}

	return result, nil
}

package storage

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"go.uber.org/zap"
)

// ResultStorage is the result storage interface.
type ResultStorage interface {
	// SaveResult saves the tool execution result.
	SaveResult(executionID string, toolName string, result string) error

	// GetResult retrieves the full result.
	GetResult(executionID string) (string, error)

	// GetResultPage retrieves results with pagination.
	GetResultPage(executionID string, page int, limit int) (*ResultPage, error)

	// SearchResult searches results.
	// useRegex: if true, keyword is treated as a regular expression; if false, simple substring matching is used.
	SearchResult(executionID string, keyword string, useRegex bool) ([]string, error)

	// FilterResult filters results.
	// useRegex: if true, filter is treated as a regular expression; if false, simple substring matching is used.
	FilterResult(executionID string, filter string, useRegex bool) ([]string, error)

	// GetResultMetadata retrieves result metadata.
	GetResultMetadata(executionID string) (*ResultMetadata, error)

	// GetResultPath returns the result file path.
	GetResultPath(executionID string) string

	// DeleteResult deletes a result.
	DeleteResult(executionID string) error
}

// ResultPage represents a paginated result.
type ResultPage struct {
	Lines      []string `json:"lines"`
	Page       int      `json:"page"`
	Limit      int      `json:"limit"`
	TotalLines int      `json:"total_lines"`
	TotalPages int      `json:"total_pages"`
}

// ResultMetadata holds result metadata.
type ResultMetadata struct {
	ExecutionID string    `json:"execution_id"`
	ToolName    string    `json:"tool_name"`
	TotalSize   int       `json:"total_size"`
	TotalLines  int       `json:"total_lines"`
	CreatedAt   time.Time `json:"created_at"`
}

// FileResultStorage is a file-based result storage implementation.
type FileResultStorage struct {
	baseDir string
	logger  *zap.Logger
	mu      sync.RWMutex
}

// NewFileResultStorage creates a new file-based result storage.
func NewFileResultStorage(baseDir string, logger *zap.Logger) (*FileResultStorage, error) {
	// Ensure directory exists
	if err := os.MkdirAll(baseDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create storage directory: %w", err)
	}

	return &FileResultStorage{
		baseDir: baseDir,
		logger:  logger,
	}, nil
}

// getResultPath returns the result file path.
func (s *FileResultStorage) getResultPath(executionID string) string {
	return filepath.Join(s.baseDir, executionID+".txt")
}

// getMetadataPath returns the metadata file path.
func (s *FileResultStorage) getMetadataPath(executionID string) string {
	return filepath.Join(s.baseDir, executionID+".meta.json")
}

// SaveResult saves the tool execution result.
func (s *FileResultStorage) SaveResult(executionID string, toolName string, result string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Save result file
	resultPath := s.getResultPath(executionID)
	if err := os.WriteFile(resultPath, []byte(result), 0644); err != nil {
		return fmt.Errorf("failed to save result file: %w", err)
	}

	// Calculate statistics
	lines := strings.Split(result, "\n")
	metadata := &ResultMetadata{
		ExecutionID: executionID,
		ToolName:    toolName,
		TotalSize:   len(result),
		TotalLines:  len(lines),
		CreatedAt:   time.Now(),
	}

	// Save metadata
	metadataPath := s.getMetadataPath(executionID)
	metadataJSON, err := json.Marshal(metadata)
	if err != nil {
		return fmt.Errorf("failed to serialize metadata: %w", err)
	}

	if err := os.WriteFile(metadataPath, metadataJSON, 0644); err != nil {
		return fmt.Errorf("failed to save metadata file: %w", err)
	}

	s.logger.Info("saved tool execution result",
		zap.String("executionID", executionID),
		zap.String("toolName", toolName),
		zap.Int("size", len(result)),
		zap.Int("lines", len(lines)),
	)

	return nil
}

// GetResult retrieves the full result.
func (s *FileResultStorage) GetResult(executionID string) (string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	resultPath := s.getResultPath(executionID)
	data, err := os.ReadFile(resultPath)
	if err != nil {
		if os.IsNotExist(err) {
			return "", fmt.Errorf("result does not exist: %s", executionID)
		}
		return "", fmt.Errorf("failed to read result file: %w", err)
	}

	return string(data), nil
}

// GetResultMetadata retrieves result metadata.
func (s *FileResultStorage) GetResultMetadata(executionID string) (*ResultMetadata, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	metadataPath := s.getMetadataPath(executionID)
	data, err := os.ReadFile(metadataPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("result does not exist: %s", executionID)
		}
		return nil, fmt.Errorf("failed to read metadata file: %w", err)
	}

	var metadata ResultMetadata
	if err := json.Unmarshal(data, &metadata); err != nil {
		return nil, fmt.Errorf("failed to parse metadata: %w", err)
	}

	return &metadata, nil
}

// GetResultPage retrieves results with pagination.
func (s *FileResultStorage) GetResultPage(executionID string, page int, limit int) (*ResultPage, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	// Get full result
	result, err := s.GetResult(executionID)
	if err != nil {
		return nil, err
	}

	// Split into lines
	lines := strings.Split(result, "\n")
	totalLines := len(lines)

	// Calculate pagination
	totalPages := (totalLines + limit - 1) / limit
	if page < 1 {
		page = 1
	}
	if page > totalPages && totalPages > 0 {
		page = totalPages
	}

	// Calculate start and end indices
	start := (page - 1) * limit
	end := start + limit
	if end > totalLines {
		end = totalLines
	}

	// Extract lines for the specified page
	var pageLines []string
	if start < totalLines {
		pageLines = lines[start:end]
	} else {
		pageLines = []string{}
	}

	return &ResultPage{
		Lines:      pageLines,
		Page:       page,
		Limit:      limit,
		TotalLines: totalLines,
		TotalPages: totalPages,
	}, nil
}

// SearchResult searches results.
func (s *FileResultStorage) SearchResult(executionID string, keyword string, useRegex bool) ([]string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	// Get full result
	result, err := s.GetResult(executionID)
	if err != nil {
		return nil, err
	}

	// If using regex, compile it first
	var regex *regexp.Regexp
	if useRegex {
		compiledRegex, err := regexp.Compile(keyword)
		if err != nil {
			return nil, fmt.Errorf("invalid regular expression: %w", err)
		}
		regex = compiledRegex
	}

	// Split into lines and search
	lines := strings.Split(result, "\n")
	var matchedLines []string

	for _, line := range lines {
		var matched bool
		if useRegex {
			matched = regex.MatchString(line)
		} else {
			matched = strings.Contains(line, keyword)
		}

		if matched {
			matchedLines = append(matchedLines, line)
		}
	}

	return matchedLines, nil
}

// FilterResult filters results.
func (s *FileResultStorage) FilterResult(executionID string, filter string, useRegex bool) ([]string, error) {
	// Filter and search logic is the same: find lines containing the keyword
	return s.SearchResult(executionID, filter, useRegex)
}

// GetResultPath returns the result file path.
func (s *FileResultStorage) GetResultPath(executionID string) string {
	return s.getResultPath(executionID)
}

// DeleteResult deletes a result.
func (s *FileResultStorage) DeleteResult(executionID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	resultPath := s.getResultPath(executionID)
	metadataPath := s.getMetadataPath(executionID)

	// Delete result file
	if err := os.Remove(resultPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to delete result file: %w", err)
	}

	// Delete metadata file
	if err := os.Remove(metadataPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to delete metadata file: %w", err)
	}

	s.logger.Info("deleted tool execution result",
		zap.String("executionID", executionID),
	)

	return nil
}

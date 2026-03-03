package knowledge

import (
	"encoding/json"
	"time"
)

// KnowledgeItem represents a knowledge base item
type KnowledgeItem struct {
	ID        string    `json:"id"`
	Category  string    `json:"category"` // risk type (folder name)
	Title     string    `json:"title"`    // title (file name)
	FilePath  string    `json:"filePath"` // file path
	Content   string    `json:"content"`  // file content
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// KnowledgeItemSummary is a knowledge base item summary (used for lists, does not include full content)
type KnowledgeItemSummary struct {
	ID        string    `json:"id"`
	Category  string    `json:"category"`
	Title     string    `json:"title"`
	FilePath  string    `json:"filePath"`
	Content   string    `json:"content,omitempty"` // optional: content preview (if provided, usually only the first 150 characters)
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// MarshalJSON custom JSON serialization to ensure correct time format
func (k *KnowledgeItemSummary) MarshalJSON() ([]byte, error) {
	type Alias KnowledgeItemSummary
	aux := &struct {
		*Alias
		CreatedAt string `json:"createdAt"`
		UpdatedAt string `json:"updatedAt"`
	}{
		Alias: (*Alias)(k),
	}

	// format created time
	if k.CreatedAt.IsZero() {
		aux.CreatedAt = ""
	} else {
		aux.CreatedAt = k.CreatedAt.Format(time.RFC3339)
	}

	// format updated time
	if k.UpdatedAt.IsZero() {
		aux.UpdatedAt = ""
	} else {
		aux.UpdatedAt = k.UpdatedAt.Format(time.RFC3339)
	}

	return json.Marshal(aux)
}

// MarshalJSON custom JSON serialization to ensure correct time format
func (k *KnowledgeItem) MarshalJSON() ([]byte, error) {
	type Alias KnowledgeItem
	aux := &struct {
		*Alias
		CreatedAt string `json:"createdAt"`
		UpdatedAt string `json:"updatedAt"`
	}{
		Alias: (*Alias)(k),
	}

	// format created time
	if k.CreatedAt.IsZero() {
		aux.CreatedAt = ""
	} else {
		aux.CreatedAt = k.CreatedAt.Format(time.RFC3339)
	}

	// format updated time
	if k.UpdatedAt.IsZero() {
		aux.UpdatedAt = ""
	} else {
		aux.UpdatedAt = k.UpdatedAt.Format(time.RFC3339)
	}

	return json.Marshal(aux)
}

// KnowledgeChunk is a knowledge chunk (used for vectorization)
type KnowledgeChunk struct {
	ID         string    `json:"id"`
	ItemID     string    `json:"itemId"`
	ChunkIndex int       `json:"chunkIndex"`
	ChunkText  string    `json:"chunkText"`
	Embedding  []float32 `json:"-"` // vector embedding, not serialized to JSON
	CreatedAt  time.Time `json:"createdAt"`
}

// RetrievalResult is a retrieval result
type RetrievalResult struct {
	Chunk      *KnowledgeChunk `json:"chunk"`
	Item       *KnowledgeItem  `json:"item"`
	Similarity float64         `json:"similarity"` // similarity score
	Score      float64         `json:"score"`      // composite score (hybrid retrieval)
}

// RetrievalLog is a retrieval log
type RetrievalLog struct {
	ID             string    `json:"id"`
	ConversationID string    `json:"conversationId,omitempty"`
	MessageID      string    `json:"messageId,omitempty"`
	Query          string    `json:"query"`
	RiskType       string    `json:"riskType,omitempty"`
	RetrievedItems []string  `json:"retrievedItems"` // list of retrieved knowledge item IDs
	CreatedAt      time.Time `json:"createdAt"`
}

// MarshalJSON custom JSON serialization to ensure correct time format
func (r *RetrievalLog) MarshalJSON() ([]byte, error) {
	type Alias RetrievalLog
	return json.Marshal(&struct {
		*Alias
		CreatedAt string `json:"createdAt"`
	}{
		Alias:     (*Alias)(r),
		CreatedAt: r.CreatedAt.Format(time.RFC3339),
	})
}

// CategoryWithItems represents a category and its knowledge items (used for category-based pagination)
type CategoryWithItems struct {
	Category  string                `json:"category"`  // category name
	ItemCount int                   `json:"itemCount"` // total knowledge items in this category
	Items     []*KnowledgeItemSummary `json:"items"`   // knowledge items in this category
}

// SearchRequest is the search request
type SearchRequest struct {
	Query     string  `json:"query"`
	RiskType  string  `json:"riskType,omitempty"`  // optional: specify risk type
	TopK      int     `json:"topK,omitempty"`      // return top-K results, default 5
	Threshold float64 `json:"threshold,omitempty"` // similarity threshold, default 0.7
}

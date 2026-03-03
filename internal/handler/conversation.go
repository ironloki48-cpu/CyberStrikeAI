package handler

import (
	"net/http"
	"strconv"

	"cyberstrike-ai/internal/database"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// ConversationHandler is the conversation handler
type ConversationHandler struct {
	db     *database.DB
	logger *zap.Logger
}

// NewConversationHandler creates a new conversation handler
func NewConversationHandler(db *database.DB, logger *zap.Logger) *ConversationHandler {
	return &ConversationHandler{
		db:     db,
		logger: logger,
	}
}

// CreateConversationRequest is the create conversation request
type CreateConversationRequest struct {
	Title string `json:"title"`
}

// CreateConversation creates a new conversation
func (h *ConversationHandler) CreateConversation(c *gin.Context) {
	var req CreateConversationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	title := req.Title
	if title == "" {
		title = "New Conversation"
	}

	conv, err := h.db.CreateConversation(title)
	if err != nil {
		h.logger.Error("failed to create conversation", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, conv)
}

// ListConversations lists conversations
func (h *ConversationHandler) ListConversations(c *gin.Context) {
	limitStr := c.DefaultQuery("limit", "50")
	offsetStr := c.DefaultQuery("offset", "0")
	search := c.Query("search") // get search parameter

	limit, _ := strconv.Atoi(limitStr)
	offset, _ := strconv.Atoi(offsetStr)

	if limit <= 0 || limit > 100 {
		limit = 50
	}

	conversations, err := h.db.ListConversations(limit, offset, search)
	if err != nil {
		h.logger.Error("failed to get conversation list", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, conversations)
}

// GetConversation gets a conversation
func (h *ConversationHandler) GetConversation(c *gin.Context) {
	id := c.Param("id")

	conv, err := h.db.GetConversation(id)
	if err != nil {
		h.logger.Error("failed to get conversation", zap.Error(err))
		c.JSON(http.StatusNotFound, gin.H{"error": "conversation not found"})
		return
	}

	c.JSON(http.StatusOK, conv)
}

// UpdateConversationRequest is the update conversation request
type UpdateConversationRequest struct {
	Title string `json:"title"`
}

// UpdateConversation updates a conversation
func (h *ConversationHandler) UpdateConversation(c *gin.Context) {
	id := c.Param("id")

	var req UpdateConversationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Title == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "title cannot be empty"})
		return
	}

	if err := h.db.UpdateConversationTitle(id, req.Title); err != nil {
		h.logger.Error("failed to update conversation", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// return the updated conversation
	conv, err := h.db.GetConversation(id)
	if err != nil {
		h.logger.Error("failed to get updated conversation", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, conv)
}

// DeleteConversation deletes a conversation
func (h *ConversationHandler) DeleteConversation(c *gin.Context) {
	id := c.Param("id")

	if err := h.db.DeleteConversation(id); err != nil {
		h.logger.Error("failed to delete conversation", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "deleted successfully"})
}

package handler

import (
	"net/http"
	"time"

	"cyberstrike-ai/internal/database"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// GroupHandler is the group handler
type GroupHandler struct {
	db     *database.DB
	logger *zap.Logger
}

// NewGroupHandler creates a new group handler
func NewGroupHandler(db *database.DB, logger *zap.Logger) *GroupHandler {
	return &GroupHandler{
		db:     db,
		logger: logger,
	}
}

// CreateGroupRequest is the create group request
type CreateGroupRequest struct {
	Name string `json:"name"`
	Icon string `json:"icon"`
}

// CreateGroup creates a group
func (h *GroupHandler) CreateGroup(c *gin.Context) {
	var req CreateGroupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "group name cannot be empty"})
		return
	}

	group, err := h.db.CreateGroup(req.Name, req.Icon)
	if err != nil {
		h.logger.Error("failed to create group", zap.Error(err))
		// if the name already exists, return 400
		if err.Error() == "group name already exists" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "group name already exists"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, group)
}

// ListGroups lists all groups
func (h *GroupHandler) ListGroups(c *gin.Context) {
	groups, err := h.db.ListGroups()
	if err != nil {
		h.logger.Error("failed to get group list", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, groups)
}

// GetGroup gets a group
func (h *GroupHandler) GetGroup(c *gin.Context) {
	id := c.Param("id")

	group, err := h.db.GetGroup(id)
	if err != nil {
		h.logger.Error("failed to get group", zap.Error(err))
		c.JSON(http.StatusNotFound, gin.H{"error": "group not found"})
		return
	}

	c.JSON(http.StatusOK, group)
}

// UpdateGroupRequest is the update group request
type UpdateGroupRequest struct {
	Name string `json:"name"`
	Icon string `json:"icon"`
}

// UpdateGroup updates a group
func (h *GroupHandler) UpdateGroup(c *gin.Context) {
	id := c.Param("id")

	var req UpdateGroupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "group name cannot be empty"})
		return
	}

	if err := h.db.UpdateGroup(id, req.Name, req.Icon); err != nil {
		h.logger.Error("failed to update group", zap.Error(err))
		// if the name already exists, return 400
		if err.Error() == "group name already exists" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "group name already exists"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	group, err := h.db.GetGroup(id)
	if err != nil {
		h.logger.Error("failed to get updated group", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, group)
}

// DeleteGroup deletes a group
func (h *GroupHandler) DeleteGroup(c *gin.Context) {
	id := c.Param("id")

	if err := h.db.DeleteGroup(id); err != nil {
		h.logger.Error("failed to delete group", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "deleted successfully"})
}

// AddConversationToGroupRequest is the request to add a conversation to a group
type AddConversationToGroupRequest struct {
	ConversationID string `json:"conversationId"`
	GroupID        string `json:"groupId"`
}

// AddConversationToGroup adds a conversation to a group
func (h *GroupHandler) AddConversationToGroup(c *gin.Context) {
	var req AddConversationToGroupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.db.AddConversationToGroup(req.ConversationID, req.GroupID); err != nil {
		h.logger.Error("failed to add conversation to group", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "added successfully"})
}

// RemoveConversationFromGroup removes a conversation from a group
func (h *GroupHandler) RemoveConversationFromGroup(c *gin.Context) {
	conversationID := c.Param("conversationId")
	groupID := c.Param("id")

	if err := h.db.RemoveConversationFromGroup(conversationID, groupID); err != nil {
		h.logger.Error("failed to remove conversation from group", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "removed successfully"})
}

// GroupConversation is the group conversation response structure
type GroupConversation struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	Pinned      bool      `json:"pinned"`
	GroupPinned bool      `json:"groupPinned"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// GetGroupConversations gets all conversations in a group
func (h *GroupHandler) GetGroupConversations(c *gin.Context) {
	groupID := c.Param("id")
	searchQuery := c.Query("search") // get search parameter

	var conversations []*database.Conversation
	var err error

	// if search keyword provided, use search method; otherwise use regular method
	if searchQuery != "" {
		conversations, err = h.db.SearchConversationsByGroup(groupID, searchQuery)
	} else {
		conversations, err = h.db.GetConversationsByGroup(groupID)
	}

	if err != nil {
		h.logger.Error("failed to get group conversations", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// get the pinned status of each conversation within the group
	groupConvs := make([]GroupConversation, 0, len(conversations))
	for _, conv := range conversations {
		// query pinned status within the group
		var groupPinned int
		err := h.db.QueryRow(
			"SELECT COALESCE(pinned, 0) FROM conversation_group_mappings WHERE conversation_id = ? AND group_id = ?",
			conv.ID, groupID,
		).Scan(&groupPinned)
		if err != nil {
			h.logger.Warn("failed to query group pinned status", zap.String("conversationId", conv.ID), zap.Error(err))
			groupPinned = 0
		}

		groupConvs = append(groupConvs, GroupConversation{
			ID:          conv.ID,
			Title:       conv.Title,
			Pinned:      conv.Pinned,
			GroupPinned: groupPinned != 0,
			CreatedAt:   conv.CreatedAt,
			UpdatedAt:   conv.UpdatedAt,
		})
	}

	c.JSON(http.StatusOK, groupConvs)
}

// UpdateConversationPinnedRequest is the update conversation pinned status request
type UpdateConversationPinnedRequest struct {
	Pinned bool `json:"pinned"`
}

// UpdateConversationPinned updates the pinned status of a conversation
func (h *GroupHandler) UpdateConversationPinned(c *gin.Context) {
	conversationID := c.Param("id")

	var req UpdateConversationPinnedRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.db.UpdateConversationPinned(conversationID, req.Pinned); err != nil {
		h.logger.Error("failed to update conversation pinned status", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "updated successfully"})
}

// UpdateGroupPinnedRequest is the update group pinned status request
type UpdateGroupPinnedRequest struct {
	Pinned bool `json:"pinned"`
}

// UpdateGroupPinned updates the pinned status of a group
func (h *GroupHandler) UpdateGroupPinned(c *gin.Context) {
	groupID := c.Param("id")

	var req UpdateGroupPinnedRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.db.UpdateGroupPinned(groupID, req.Pinned); err != nil {
		h.logger.Error("failed to update group pinned status", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "updated successfully"})
}

// UpdateConversationPinnedInGroupRequest is the update conversation pinned status in group request
type UpdateConversationPinnedInGroupRequest struct {
	Pinned bool `json:"pinned"`
}

// UpdateConversationPinnedInGroup updates the pinned status of a conversation within a group
func (h *GroupHandler) UpdateConversationPinnedInGroup(c *gin.Context) {
	groupID := c.Param("id")
	conversationID := c.Param("conversationId")

	var req UpdateConversationPinnedInGroupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.db.UpdateConversationPinnedInGroup(conversationID, groupID, req.Pinned); err != nil {
		h.logger.Error("failed to update group conversation pinned status", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "updated successfully"})
}

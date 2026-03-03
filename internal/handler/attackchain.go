package handler

import (
	"context"
	"net/http"
	"sync"
	"time"

	"cyberstrike-ai/internal/attackchain"
	"cyberstrike-ai/internal/config"
	"cyberstrike-ai/internal/database"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// AttackChainHandler is the attack chain handler
type AttackChainHandler struct {
	db           *database.DB
	logger       *zap.Logger
	openAIConfig *config.OpenAIConfig
	mu           sync.RWMutex // protects concurrent access to openAIConfig
	// prevents concurrent generation for the same conversation
	generatingLocks sync.Map // map[string]*sync.Mutex
}

// NewAttackChainHandler creates a new attack chain handler
func NewAttackChainHandler(db *database.DB, openAIConfig *config.OpenAIConfig, logger *zap.Logger) *AttackChainHandler {
	return &AttackChainHandler{
		db:           db,
		logger:       logger,
		openAIConfig: openAIConfig,
	}
}

// UpdateConfig updates the OpenAI configuration
func (h *AttackChainHandler) UpdateConfig(cfg *config.OpenAIConfig) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.openAIConfig = cfg
	h.logger.Info("AttackChainHandler configuration updated",
		zap.String("base_url", cfg.BaseURL),
		zap.String("model", cfg.Model),
	)
}

// getOpenAIConfig gets the OpenAI configuration (thread-safe)
func (h *AttackChainHandler) getOpenAIConfig() *config.OpenAIConfig {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.openAIConfig
}

// GetAttackChain gets the attack chain (generates on demand)
// GET /api/attack-chain/:conversationId
func (h *AttackChainHandler) GetAttackChain(c *gin.Context) {
	conversationID := c.Param("conversationId")
	if conversationID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "conversationId is required"})
		return
	}

	// check if conversation exists
	_, err := h.db.GetConversation(conversationID)
	if err != nil {
		h.logger.Warn("conversation not found", zap.String("conversationId", conversationID), zap.Error(err))
		c.JSON(http.StatusNotFound, gin.H{"error": "conversation not found"})
		return
	}

	// try loading from database first (if already generated)
	openAIConfig := h.getOpenAIConfig()
	builder := attackchain.NewBuilder(h.db, openAIConfig, h.logger)
	chain, err := builder.LoadChainFromDatabase(conversationID)
	if err == nil && len(chain.Nodes) > 0 {
		// if already exists, return directly
		h.logger.Info("returning existing attack chain", zap.String("conversationId", conversationID))
		c.JSON(http.StatusOK, chain)
		return
	}

	// if not exists, generate a new attack chain (on demand)
	// use lock to prevent concurrent generation for the same conversation
	lockInterface, _ := h.generatingLocks.LoadOrStore(conversationID, &sync.Mutex{})
	lock := lockInterface.(*sync.Mutex)

	// try to acquire lock; if already generating, return error
	acquired := lock.TryLock()
	if !acquired {
		h.logger.Info("attack chain is being generated, please try again later", zap.String("conversationId", conversationID))
		c.JSON(http.StatusConflict, gin.H{"error": "attack chain is being generated, please try again later"})
		return
	}
	defer lock.Unlock()

	// check again if already generated (may have completed while waiting for lock)
	chain, err = builder.LoadChainFromDatabase(conversationID)
	if err == nil && len(chain.Nodes) > 0 {
		h.logger.Info("returning existing attack chain (generated while waiting for lock)", zap.String("conversationId", conversationID))
		c.JSON(http.StatusOK, chain)
		return
	}

	h.logger.Info("starting attack chain generation", zap.String("conversationId", conversationID))

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	chain, err = builder.BuildChainFromConversation(ctx, conversationID)
	if err != nil {
		h.logger.Error("failed to generate attack chain", zap.String("conversationId", conversationID), zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate attack chain: " + err.Error()})
		return
	}

	// after generation, optionally remove from lock map (can also keep to prevent repeated generation in short time)
	// h.generatingLocks.Delete(conversationID)

	c.JSON(http.StatusOK, chain)
}

// RegenerateAttackChain regenerates the attack chain
// POST /api/attack-chain/:conversationId/regenerate
func (h *AttackChainHandler) RegenerateAttackChain(c *gin.Context) {
	conversationID := c.Param("conversationId")
	if conversationID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "conversationId is required"})
		return
	}

	// check if conversation exists
	_, err := h.db.GetConversation(conversationID)
	if err != nil {
		h.logger.Warn("conversation not found", zap.String("conversationId", conversationID), zap.Error(err))
		c.JSON(http.StatusNotFound, gin.H{"error": "conversation not found"})
		return
	}

	// delete old attack chain
	if err := h.db.DeleteAttackChain(conversationID); err != nil {
		h.logger.Warn("failed to delete old attack chain", zap.Error(err))
	}

	// use lock to prevent concurrent generation
	lockInterface, _ := h.generatingLocks.LoadOrStore(conversationID, &sync.Mutex{})
	lock := lockInterface.(*sync.Mutex)

	acquired := lock.TryLock()
	if !acquired {
		h.logger.Info("attack chain is being generated, please try again later", zap.String("conversationId", conversationID))
		c.JSON(http.StatusConflict, gin.H{"error": "attack chain is being generated, please try again later"})
		return
	}
	defer lock.Unlock()

	// generate new attack chain
	h.logger.Info("regenerating attack chain", zap.String("conversationId", conversationID))

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	openAIConfig := h.getOpenAIConfig()
	builder := attackchain.NewBuilder(h.db, openAIConfig, h.logger)
	chain, err := builder.BuildChainFromConversation(ctx, conversationID)
	if err != nil {
		h.logger.Error("failed to generate attack chain", zap.String("conversationId", conversationID), zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate attack chain: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, chain)
}

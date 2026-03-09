package handler

import (
	"encoding/base64"
	"net/http"
	"strconv"
	"strings"

	"cyberstrike-ai/internal/filemanager"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// FileManagerHandler provides HTTP handlers for the file management API.
type FileManagerHandler struct {
	mgr    *filemanager.Manager
	logger *zap.Logger
}

// NewFileManagerHandler creates a FileManagerHandler.
func NewFileManagerHandler(mgr *filemanager.Manager, logger *zap.Logger) *FileManagerHandler {
	return &FileManagerHandler{mgr: mgr, logger: logger}
}

// ListFiles handles GET /api/files
func (h *FileManagerHandler) ListFiles(c *gin.Context) {
	fileType := filemanager.FileType(c.Query("file_type"))
	status := filemanager.FileStatus(c.Query("status"))
	search := c.Query("search")
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))

	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}

	files, total, err := h.mgr.List(fileType, status, search, limit, offset)
	if err != nil {
		h.logger.Error("list files", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if files == nil {
		files = []*filemanager.ManagedFile{}
	}

	c.JSON(http.StatusOK, gin.H{
		"files":    files,
		"total":    total,
		"limit":    limit,
		"offset":   offset,
		"has_more": offset+limit < total,
	})
}

// GetFile handles GET /api/files/:id
func (h *FileManagerHandler) GetFile(c *gin.Context) {
	id := c.Param("id")
	f, err := h.mgr.Get(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"file": f})
}

// GetFileStats handles GET /api/files/stats
func (h *FileManagerHandler) GetFileStats(c *gin.Context) {
	stats, err := h.mgr.Stats()
	if err != nil {
		h.logger.Error("file stats", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, stats)
}

// UploadFile handles POST /api/files/upload
func (h *FileManagerHandler) UploadFile(c *gin.Context) {
	var req struct {
		FileName       string `json:"file_name" binding:"required"`
		Content        string `json:"content" binding:"required"`
		MimeType       string `json:"mime_type"`
		FileType       string `json:"file_type"`
		ConversationID string `json:"conversation_id"`
		IsBase64       bool   `json:"is_base64"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var content []byte
	if req.IsBase64 {
		decoded, err := base64.StdEncoding.DecodeString(req.Content)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid base64 content"})
			return
		}
		content = decoded
	} else {
		content = []byte(req.Content)
	}

	ft := filemanager.FileType(req.FileType)
	if ft == "" {
		ft = filemanager.FileTypeOther
	}

	f, err := h.mgr.Upload(req.FileName, content, ft, req.ConversationID, req.MimeType)
	if err != nil {
		h.logger.Error("upload file", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"file": f})
}

// RegisterFile handles POST /api/files/register (register existing file on disk)
func (h *FileManagerHandler) RegisterFile(c *gin.Context) {
	var req struct {
		FileName       string `json:"file_name" binding:"required"`
		FilePath       string `json:"file_path" binding:"required"`
		FileSize       int64  `json:"file_size"`
		MimeType       string `json:"mime_type"`
		FileType       string `json:"file_type"`
		ConversationID string `json:"conversation_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ft := filemanager.FileType(req.FileType)
	if ft == "" {
		ft = filemanager.FileTypeOther
	}

	f, err := h.mgr.Register(req.FileName, req.FilePath, req.FileSize, req.MimeType, ft, req.ConversationID)
	if err != nil {
		h.logger.Error("register file", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"file": f})
}

// UpdateFile handles PUT /api/files/:id
func (h *FileManagerHandler) UpdateFile(c *gin.Context) {
	id := c.Param("id")

	var req map[string]interface{}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	f, err := h.mgr.Update(id, req)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		h.logger.Error("update file", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"file": f})
}

// AppendLog handles POST /api/files/:id/log
func (h *FileManagerHandler) AppendLog(c *gin.Context) {
	id := c.Param("id")
	var req struct {
		Entry string `json:"entry" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.mgr.AppendLog(id, req.Entry); err != nil {
		h.logger.Error("append file log", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// AppendFindings handles POST /api/files/:id/findings
func (h *FileManagerHandler) AppendFindings(c *gin.Context) {
	id := c.Param("id")
	var req struct {
		Finding string `json:"finding" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.mgr.AppendFindings(id, req.Finding); err != nil {
		h.logger.Error("append file finding", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// ReadFileContent handles GET /api/files/:id/content
func (h *FileManagerHandler) ReadFileContent(c *gin.Context) {
	id := c.Param("id")
	maxBytes, _ := strconv.ParseInt(c.DefaultQuery("max_bytes", "102400"), 10, 64)

	content, err := h.mgr.ReadFileContent(id, maxBytes)
	if err != nil {
		if strings.Contains(err.Error(), "not found") || strings.Contains(err.Error(), "no such file") {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		h.logger.Error("read file content", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"content": content})
}

// DeleteFile handles DELETE /api/files/:id
func (h *FileManagerHandler) DeleteFile(c *gin.Context) {
	id := c.Param("id")
	deleteDisk := c.Query("delete_from_disk") == "true"

	if err := h.mgr.Delete(id, deleteDisk); err != nil {
		h.logger.Error("delete file", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

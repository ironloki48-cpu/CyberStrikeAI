package security

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

const (
	ContextAuthTokenKey  = "authToken"
	ContextSessionExpiry = "authSessionExpiry"
)

// AuthMiddleware enforces authentication on protected routes.
func AuthMiddleware(manager *AuthManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := extractTokenFromRequest(c)
		session, ok := manager.ValidateToken(token)
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "unauthorized access, please log in first",
			})
			return
		}

		c.Set(ContextAuthTokenKey, session.Token)
		c.Set(ContextSessionExpiry, session.ExpiresAt)
		c.Next()
	}
}

func extractTokenFromRequest(c *gin.Context) string {
	authHeader := c.GetHeader("Authorization")
	if authHeader != "" {
		if len(authHeader) > 7 && strings.EqualFold(authHeader[0:7], "Bearer ") {
			return strings.TrimSpace(authHeader[7:])
		}
		return strings.TrimSpace(authHeader)
	}

	if cookie, err := c.Cookie("auth_token"); err == nil {
		return strings.TrimSpace(cookie)
	}

	return ""
}

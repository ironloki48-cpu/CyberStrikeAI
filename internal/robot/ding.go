package robot

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"cyberstrike-ai/internal/config"

	"github.com/open-dingtalk/dingtalk-stream-sdk-go/chatbot"
	"github.com/open-dingtalk/dingtalk-stream-sdk-go/client"
	dingutils "github.com/open-dingtalk/dingtalk-stream-sdk-go/utils"
	"go.uber.org/zap"
)

const (
	dingReconnectInitial = 5 * time.Second  // initial reconnect interval
	dingReconnectMax     = 60 * time.Second // maximum reconnect interval
)

// StartDing starts the DingTalk Stream long connection (no public IP required), calls handler on message receipt and replies via SessionWebhook.
// Automatically reconnects on disconnection (e.g. laptop sleep, network interruption); exits when ctx is cancelled for configuration reload.
func StartDing(ctx context.Context, cfg config.RobotDingtalkConfig, h MessageHandler, logger *zap.Logger) {
	if !cfg.Enabled || cfg.ClientID == "" || cfg.ClientSecret == "" {
		return
	}
	go runDingLoop(ctx, cfg, h, logger)
}

// runDingLoop maintains the DingTalk long connection in a loop: reconnects with backoff interval when disconnected and ctx is not cancelled.
func runDingLoop(ctx context.Context, cfg config.RobotDingtalkConfig, h MessageHandler, logger *zap.Logger) {
	backoff := dingReconnectInitial
	for {
		streamClient := client.NewStreamClient(
			client.WithAppCredential(client.NewAppCredentialConfig(cfg.ClientID, cfg.ClientSecret)),
			client.WithSubscription(dingutils.SubscriptionTypeKCallback, "/v1.0/im/bot/messages/get",
				chatbot.NewDefaultChatBotFrameHandler(func(ctx context.Context, msg *chatbot.BotCallbackDataModel) ([]byte, error) {
					go handleDingMessage(ctx, msg, h, logger)
					return nil, nil
				}).OnEventReceived),
		)
		logger.Info("DingTalk Stream connecting...", zap.String("client_id", cfg.ClientID))
		err := streamClient.Start(ctx)
		if ctx.Err() != nil {
			logger.Info("DingTalk Stream closed per configuration reload")
			return
		}
		if err != nil {
			logger.Warn("DingTalk Stream long connection disconnected (e.g. sleep/network), will auto-reconnect", zap.Error(err), zap.Duration("retry_after", backoff))
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
			// increment reconnect interval up to 60 seconds to avoid frequent retries
			if backoff < dingReconnectMax {
				backoff *= 2
				if backoff > dingReconnectMax {
					backoff = dingReconnectMax
				}
			}
		}
	}
}

func handleDingMessage(ctx context.Context, msg *chatbot.BotCallbackDataModel, h MessageHandler, logger *zap.Logger) {
	if msg == nil || msg.SessionWebhook == "" {
		return
	}
	content := ""
	if msg.Text.Content != "" {
		content = strings.TrimSpace(msg.Text.Content)
	}
	if content == "" && msg.Msgtype == "richText" {
		if cMap, ok := msg.Content.(map[string]interface{}); ok {
			if rich, ok := cMap["richText"].([]interface{}); ok {
				for _, c := range rich {
					if m, ok := c.(map[string]interface{}); ok {
						if txt, ok := m["text"].(string); ok {
							content = strings.TrimSpace(txt)
							break
						}
					}
				}
			}
		}
	}
	if content == "" {
		logger.Debug("DingTalk message content is empty, ignored", zap.String("msgtype", msg.Msgtype))
		return
	}
	logger.Info("DingTalk received message", zap.String("sender", msg.SenderId), zap.String("content", content))
	userID := msg.SenderId
	if userID == "" {
		userID = msg.ConversationId
	}
	reply := h.HandleMessage("dingtalk", userID, content)
	// use markdown type to properly render headings, lists, code blocks, etc.
	title := reply
	if idx := strings.IndexAny(reply, "\n"); idx > 0 {
		title = strings.TrimSpace(reply[:idx])
	}
	if len(title) > 50 {
		title = title[:50] + "..."
	}
	if title == "" {
		title = "Reply"
	}
	body := map[string]interface{}{
		"msgtype": "markdown",
		"markdown": map[string]string{
			"title": title,
			"text":  reply,
		},
	}
	bodyBytes, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, msg.SessionWebhook, bytes.NewReader(bodyBytes))
	if err != nil {
		logger.Warn("DingTalk failed to construct reply request", zap.Error(err))
		return
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		logger.Warn("DingTalk reply request failed", zap.Error(err))
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		logger.Warn("DingTalk reply returned non-200", zap.Int("status", resp.StatusCode))
		return
	}
	logger.Debug("DingTalk reply succeeded", zap.String("content_preview", reply))
}

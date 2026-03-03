package robot

// MessageHandler is the message handling interface called by the Lark/DingTalk long connections (implemented by handler.RobotHandler)
type MessageHandler interface {
	HandleMessage(platform, userID, text string) string
}

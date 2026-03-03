# CyberStrikeAI Bot / Chatbot Guide

[Chinese](robot.md) | [English](robot_en.md)

This document explains how to chat with CyberStrikeAI via **DingTalk** and **Lark (Feishu)** using persistent long-lived connections, so you can use it from your phone without opening a browser. Follow these steps to avoid common pitfalls.

---

## 1. Where to Configure in CyberStrikeAI

1. Log in to the CyberStrikeAI Web UI.
2. Navigate to **System Settings** in the left sidebar.
3. Click **Bot Settings** in the left settings panel (located between "Basic Settings" and "Security Settings").
4. Enable and fill in the relevant platform fields (DingTalk: Client ID / Client Secret; Lark: App ID / App Secret).
5. Click **Apply Configuration** to save.
6. **Restart the CyberStrikeAI application** (saving without restarting will not establish the bot connection).

Configuration is written to the `robots` section of `config.yaml` and can also be edited directly in the config file. **After changing DingTalk/Lark configuration, a restart is required for the long-lived connection to take effect.**

---

## 2. Supported Platforms (Long-Lived Connection)

| Platform | Description |
|----------|-------------|
| DingTalk | Uses Stream long-lived connection; the program actively connects to DingTalk to receive messages |
| Lark (Feishu) | Uses long-lived connection; the program actively connects to Lark to receive messages |

Section 3 below explains per-platform: what to do on the open platform, which fields to copy, and where to fill them in CyberStrikeAI.

---

## 3. Per-Platform Configuration and Setup Steps

### 3.1 DingTalk

**First, understand the two types of DingTalk bots:**

| Type | Where to create | Supports "user sends message → bot replies" | Supported by this app |
|------|-----------------|--------------------------------------------|-----------------------|
| **Custom bot** | DingTalk group → Group Settings → Add Bot → Custom (Webhook) | ❌ No — you can only push messages to the group | ❌ Not supported |
| **Internal enterprise app bot** | [DingTalk Open Platform](https://open.dingtalk.com) — create an app and enable the bot | ✅ Yes | ✅ Supported |

If you have a "Custom Bot" Webhook URL (`oapi.dingtalk.com/robot/send?access_token=xxx`) and signing secret (`SEC...`), **you cannot use it directly with this app**. You must follow the steps below to create an "Internal Enterprise App" on the open platform and obtain the **Client ID** and **Client Secret**.

---

**DingTalk full configuration steps (in order):**

1. **Open the DingTalk Open Platform**
   Visit [https://open.dingtalk.com](https://open.dingtalk.com) in your browser and log in with an **enterprise admin** account.

2. **Go to App Development**
   In the left menu, select **App Development → Internal Enterprise Development** → click **Create App** (or select an existing app). Fill in the app name and basic info, then create.

3. **Get the Client ID and Client Secret**
   - Click **Credentials & Basic Info** (under "Basic Info") in the left menu.
   - The page shows **Client ID (formerly AppKey)** and **Client Secret (formerly AppSecret)**.
   - Copy them — do **not** type them manually. Watch out for confusable characters: digit **0** vs letter **o**, digit **1** vs letter **l** (for example, `ding9gf9tiozuc504aer` has **504**, not 5o4).

4. **Enable the Bot and select Stream mode**
   - In the left menu, go to **App Capabilities → Bot**.
   - Turn on "Bot Configuration".
   - Fill in the bot name, description, etc. (fill in required fields as prompted).
   - **Key**: the message receiving method must be set to **"Stream Mode"** (streaming access). If only "HTTP Callback" is shown or Stream is not selected, the app will not receive messages.
   - Save.

5. **Permissions and Publishing**
   - In the left menu, go to **Permission Management**: search for "bot" and "message", enable **Receive Messages**, **Send Messages**, and other bot-related permissions, and confirm authorization.
   - In the left menu, go to **Version Management & Publishing**: if there are unpublished changes, click **Publish New Version** / **Go Live**; otherwise changes will not take effect.

6. **Fill in CyberStrikeAI**
   - Return to CyberStrikeAI → System Settings → Bot Settings → DingTalk.
   - Check "Enable DingTalk Bot".
   - Paste the Client ID copied in step 3 into **Client ID (AppKey)**.
   - Paste the Client Secret copied in step 3 into **Client Secret**.
   - Click **Apply Configuration**, then **restart CyberStrikeAI**.

---

**CyberStrikeAI DingTalk field reference:**

| Field in CyberStrikeAI | Source on DingTalk Open Platform |
|------------------------|----------------------------------|
| Enable DingTalk Bot | Check to enable |
| Client ID (AppKey) | Credentials & Basic Info → **Client ID (formerly AppKey)** |
| Client Secret | Credentials & Basic Info → **Client Secret (formerly AppSecret)** |

---

### 3.2 Lark (Feishu)

| Field | Description |
|-------|-------------|
| Enable Lark Bot | Check to start Lark long-lived connection |
| App ID | App ID from the Lark Open Platform app credentials |
| App Secret | App Secret from the Lark Open Platform app credentials |
| Verify Token | Used for event subscription verification (optional) |

**Lark quick setup**: Log in to [Lark Open Platform](https://open.feishu.cn) → Create an internal enterprise app → Get **App ID** and **App Secret** from "Credentials & Basic Info" → Enable **Bot** under "App Capabilities" and grant the required permissions → Publish the app → Enter App ID and App Secret in CyberStrikeAI Bot Settings → Save and **restart the application**.

---

## 4. Bot Commands

Send the following **text commands** to the bot in DingTalk/Lark (text only):

| Command | Description |
|---------|-------------|
| **help** | Display command help and descriptions |
| **list** or **conversations** | List all conversation titles and IDs |
| **switch \<conversation-id\>** or **continue \<conversation-id\>** | Switch to the specified conversation; subsequent messages continue in that conversation |
| **new** | Start a new conversation; subsequent messages go into the new conversation |
| **clear** | Clear the current conversation context (equivalent to "new") |
| **current** | Show the current conversation ID and title |
| **stop** | Interrupt the currently running task |
| **roles** or **role list** | List all available roles (Penetration Testing, CTF, Web Application Scanning, etc.) |
| **role \<role-name\>** or **switch role \<role-name\>** | Switch to the specified role |
| **delete \<conversation-id\>** | Delete the specified conversation |
| **version** | Display the current CyberStrikeAI version number |

Any input **other than the above commands** is sent as a user message to the AI, following the same logic as the Web UI (penetration testing, security analysis, etc.).

---

## 5. How to Use (Do You Need to @ the Bot?)

- **Direct message (recommended)**: In DingTalk/Lark, **search for and open the bot**, enter the private chat with the bot, and type "help" or any text directly — **no @ required**.
- **Group chat**: If the bot is added to a group, only messages sent **@bot** in the group will be received and replied to; messages without @ will not trigger the bot.

Summary: In a **direct/private chat**, just send your message directly; in a **group chat**, you need to **@bot** before your message.

---

## 6. Recommended Workflow (Avoid Missing Steps)

1. **On the open platform**: Complete DingTalk or Lark app creation, copy credentials, enable the bot (DingTalk: must select **Stream Mode**), set permissions, and publish — as described in Section 3.
2. **In CyberStrikeAI**: System Settings → Bot Settings → check the relevant platform, paste Client ID/App ID and Client Secret/App Secret → click **Apply Configuration**.
3. **Restart the CyberStrikeAI process** (otherwise the long-lived connection will not be established).
4. **On your phone (DingTalk/Lark)**: Find the bot (direct chat: just send a message; group chat: @bot first), then send "help" or any content to test.

If messages get no response, check **Section 9 Troubleshooting** and **Section 10 Common Pitfalls** first.

---

## 7. Configuration File Example

Relevant `config.yaml` snippet for bot configuration:

```yaml
robots:
  dingtalk:
    enabled: true
    client_id: "your_dingtalk_app_key"
    client_secret: "your_dingtalk_app_secret"
  lark:
    enabled: true
    app_id: "your_lark_app_id"
    app_secret: "your_lark_app_secret"
    verify_token: ""
```

After modifying, **restart the application** — the long-lived connection is established when the application starts.

---

## 8. How to Verify Without a DingTalk/Lark Client

If DingTalk or Lark is not installed, use the **test endpoint** to verify bot logic:

1. Log in to the CyberStrikeAI Web UI first (to obtain a valid session).
2. Call the test endpoint with curl (requires the login Cookie):

```bash
# Replace YOUR_COOKIE with the Cookie obtained after login
# (browser F12 → Network → any request → Request Headers → Cookie)
curl -X POST "http://localhost:8080/api/robot/test" \
  -H "Content-Type: application/json" \
  -H "Cookie: YOUR_COOKIE" \
  -d '{"platform":"dingtalk","user_id":"test_user","text":"help"}'
```

If the JSON response contains `"reply":"[CyberStrikeAI Bot Commands]..."`, the command handling is working. You can also try `"text":"list"`, `"text":"current"`, etc.

Endpoint: `POST /api/robot/test` (requires login). Request body: `{"platform":"optional","user_id":"optional","text":"required"}`. Response: `{"reply":"reply content"}`.

---

## 9. Troubleshooting: DingTalk Messages Get No Response

Check in order:

0. **After laptop lid-close / sleep / network disconnect**
   Both DingTalk and Lark use long-lived connections to receive messages; connections drop on sleep or network loss. The program **auto-reconnects** (retries within ~5–60 seconds). Wait a moment after waking or restoring connectivity before sending a message; if still no response, restart the CyberStrikeAI process.

1. **Client ID / Client Secret exactly match the open platform**
   **Copy-paste** from "Credentials & Basic Info" — do not type manually. Watch for digit **0** vs letter **o**, digit **1** vs letter **l**.

2. **Did you restart the application after saving the configuration?**
   The bot long-lived connection is established at **application startup**. Clicking "Apply Configuration" in the Web UI only writes to the config file — you **must restart the CyberStrikeAI process** for the DingTalk connection to take effect.

3. **Check program logs**
   - After startup you should see: `DingTalk Stream connecting…`, `DingTalk Stream started (no public IP required), waiting for messages`.
   - If you see `DingTalk Stream long-lived connection exited` with an error, the most common cause is an **incorrect Client ID / Client Secret** or **Stream mode not enabled on the open platform**.
   - After sending a message from DingTalk, if it was received, you should see `DingTalk message received` in the logs; if not, DingTalk is not pushing messages to the app (go back and check whether the bot capability is enabled and **Stream Mode** is selected on the open platform).

4. **On the open platform side**
   The app must be **published**; the **Bot** capability must have **Stream access** enabled to receive messages (HTTP Callback alone is not sufficient); the permission management section must have bot receive/send message permissions.

---

## 10. Common Pitfalls

- **Wrong bot type**: The "Custom Bot" added inside a DingTalk **group** (Webhook + signing secret) **cannot** be used for two-way conversation. This app only supports bots in **"Internal Enterprise Apps"** on the open platform.
- **Saved but not restarted**: After changing bot configuration in CyberStrikeAI, you **must restart the application** — otherwise the long-lived connection will not be established.
- **Mistyped Client ID**: If the open platform shows `504`, enter `504` — not `5o4`. Always use copy-paste.
- **DingTalk: HTTP Callback only, Stream not enabled**: This app receives messages via **Stream long-lived connection**. The bot message receiving method on the open platform **must be set to Stream Mode**.
- **App not published**: After modifying bot settings or permissions on the open platform, you must **publish a new version** under "Version Management & Publishing" — otherwise changes will not take effect.

---

## 11. Notes

- Both DingTalk and Lark **process text messages only**; other types (images, voice, etc.) will either display a "not supported" notice or be ignored.
- Conversations are shared with the Web UI: conversations created via the bot appear in the Web UI's "Conversations" list, and vice versa.
- The bot's execution logic is identical to **`/api/agent-loop/stream`** (including progress callbacks and step details written to the database); the only difference is that SSE is not pushed to the client — instead the complete reply is sent back to DingTalk/Lark in one message at the end.

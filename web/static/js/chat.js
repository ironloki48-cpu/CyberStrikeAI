let currentConversationId = null;
let activeChatStreamController = null;

// @ mention related state
let mentionTools = [];
let mentionToolsLoaded = false;
let mentionToolsLoadingPromise = null;
let mentionSuggestionsEl = null;
let mentionFilteredTools = [];
let externalMcpNames = []; // External MCP name list
const mentionState = {
    active: false,
    startIndex: -1,
    query: '',
    selectedIndex: 0,
};

// IME input method state tracking
let isComposing = false;

// Input box draft saving related
const DRAFT_STORAGE_KEY = 'cyberstrike-chat-draft';
let draftSaveTimer = null;
const DRAFT_SAVE_DELAY = 500; // 500ms debounce delay

// Conversation file upload related (backend will concatenate path and content for the model; frontend no longer re-sends the file list)
const MAX_CHAT_FILES = 10;
const CHAT_FILE_DEFAULT_PROMPT = 'Please analyze the uploaded file content.';
/** @type {{ fileName: string, content: string, mimeType: string }[]} */
let chatAttachments = [];

// Save input box draft to localStorage (debounced version)
function saveChatDraftDebounced(content) {
    // Clear previous timer
    if (draftSaveTimer) {
        clearTimeout(draftSaveTimer);
    }
    
    // Set new timer
    draftSaveTimer = setTimeout(() => {
        saveChatDraft(content);
    }, DRAFT_SAVE_DELAY);
}

// Save input box draft to localStorage
function saveChatDraft(content) {
    try {
        if (content && content.trim().length > 0) {
            localStorage.setItem(DRAFT_STORAGE_KEY, content);
        } else {
            // If content is empty, clear the saved draft
            localStorage.removeItem(DRAFT_STORAGE_KEY);
        }
    } catch (error) {
        // localStorage may be full or unavailable; fail silently
        console.warn('Failed to save draft:', error);
    }
}

// Restore input box draft from localStorage
function restoreChatDraft() {
    try {
        const chatInput = document.getElementById('chat-input');
        if (!chatInput) {
            return;
        }
        
        // If the input box already has content, do not restore the draft (avoid overwriting user input)
        if (chatInput.value && chatInput.value.trim().length > 0) {
            return;
        }
        
        const draft = localStorage.getItem(DRAFT_STORAGE_KEY);
        if (draft && draft.trim().length > 0) {
            chatInput.value = draft;
            // Adjust input box height to fit content
            adjustTextareaHeight(chatInput);
        }
    } catch (error) {
        console.warn('Failed to restore draft:', error);
    }
}

// Clear saved draft
function clearChatDraft() {
    try {
        // Synchronous clear, ensure immediate effect
        localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch (error) {
        console.warn('Failed to clear draft:', error);
    }
}

// Adjust textarea height to fit content
function adjustTextareaHeight(textarea) {
    if (!textarea) return;
    
    // First reset height to auto, then immediately set to a fixed value to accurately get scrollHeight
    textarea.style.height = 'auto';
    // Force browser to recalculate layout
    void textarea.offsetHeight;
    
    // Calculate new height (min 40px, max 300px)
    const scrollHeight = textarea.scrollHeight;
    const newHeight = Math.min(Math.max(scrollHeight, 40), 300);
    textarea.style.height = newHeight + 'px';
    
    // If content is empty or very short, immediately reset to minimum height
    if (!textarea.value || textarea.value.trim().length === 0) {
        textarea.style.height = '40px';
    }
}

// Send message
async function sendMessage() {
    if (activeChatStreamController) {
        addMessage('system', 'A task is already running in this session. Please wait for it to finish or stop it from Active Tasks.');
        return;
    }

    const input = document.getElementById('chat-input');
    let message = input.value.trim();
    const hasAttachments = chatAttachments && chatAttachments.length > 0;

    if (!message && !hasAttachments) {
        return;
    }
    // If there are attachments and no user input, send a short default prompt (backend will concatenate path and file content for the model)
    if (hasAttachments && !message) {
        message = CHAT_FILE_DEFAULT_PROMPT;
    }

    // Display user message (including attachment names for user confirmation)
    const displayMessage = hasAttachments
        ? message + '\n' + chatAttachments.map(a => '📎 ' + a.fileName).join('\n')
        : message;
    addMessage('user', displayMessage);
    
    // Clear debounce timer to prevent re-saving draft after clearing input box
    if (draftSaveTimer) {
        clearTimeout(draftSaveTimer);
        draftSaveTimer = null;
    }
    
    // Immediately clear draft to prevent restoring on page refresh
    clearChatDraft();
    // Use synchronous method to ensure draft is cleared
    try {
        localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch (e) {
        // Ignore error
    }
    
    // Immediately clear input box and draft (before sending the request)
    input.value = '';
    // Force reset input box height to initial height (40px)
    input.style.height = '40px';

    // Build request body (with attachments)
    const body = {
        message: message,
        conversationId: currentConversationId,
        role: typeof getCurrentRole === 'function' ? getCurrentRole() : ''
    };
    if (hasAttachments) {
        body.attachments = chatAttachments.map(a => ({
            fileName: a.fileName,
            content: a.content,
            mimeType: a.mimeType || ''
        }));
    }
    // Clear attachment list after sending
    chatAttachments = [];
    renderChatFileChips();

    // Create progress message container (with detailed progress display)
    const progressId = addProgressMessage();
    const progressElement = document.getElementById(progressId);
    registerProgressTask(progressId, currentConversationId);
    loadActiveTasks();
    let assistantMessageId = null;
    let mcpExecutionIds = [];
    
    setChatInputSendingState(true);
    const streamController = new AbortController();
    activeChatStreamController = streamController;

    try {
        const response = await apiFetch('/api/agent-loop/stream', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
            signal: streamController.signal,
        });
        
        if (!response.ok) {
            throw new Error('Request failed: ' + response.status);
        }
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            buffer = processSSEBuffer(
                buffer,
                progressElement,
                progressId,
                () => assistantMessageId,
                (id) => { assistantMessageId = id; },
                () => mcpExecutionIds,
                (ids) => { mcpExecutionIds = ids; }
            );
        }
        
        // Handle remaining buffer
        if (buffer.trim()) {
            processSSEBuffer(
                buffer + '\n',
                progressElement,
                progressId,
                () => assistantMessageId,
                (id) => { assistantMessageId = id; },
                () => mcpExecutionIds,
                (ids) => { mcpExecutionIds = ids; }
            );
        }
        
        // After successful message send, ensure draft is cleared again
        clearChatDraft();
        try {
            localStorage.removeItem(DRAFT_STORAGE_KEY);
        } catch (e) {
            // Ignore error
        }
        
    } catch (error) {
        removeMessage(progressId);
        addMessage('system', 'Error: ' + error.message);
        // On send failure, do not restore draft, as the message is already shown in the chat
    } finally {
        activeChatStreamController = null;
        setChatInputSendingState(false);
    }
}

function setChatInputSendingState(isSending) {
    const sendButton = document.querySelector('#chat-input-container .send-btn');
    if (sendButton) {
        sendButton.disabled = isSending;
        sendButton.classList.toggle('disabled', isSending);
        sendButton.title = isSending ? 'Task is running...' : '';
    }
}

function processSSEBuffer(buffer, progressElement, progressId, getAssistantId, setAssistantId, getMcpIds, setMcpIds) {
    const lines = buffer.split(/\r?\n/);
    const remainder = lines.pop();

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) {
            continue;
        }

        const payload = line.slice(5).trim();
        if (!payload) {
            continue;
        }

        try {
            const eventData = JSON.parse(payload);
            handleStreamEvent(eventData, progressElement, progressId, getAssistantId, setAssistantId, getMcpIds, setMcpIds);
        } catch (e) {
            console.error('Failed to parse event data:', e, line);
        }
    }

    return remainder || '';
}

// ---------- Conversation file upload ----------
function renderChatFileChips() {
    const list = document.getElementById('chat-file-list');
    if (!list) return;
    list.innerHTML = '';
    if (!chatAttachments.length) return;
    chatAttachments.forEach((a, i) => {
        const chip = document.createElement('div');
        chip.className = 'chat-file-chip';
        chip.setAttribute('role', 'listitem');
        const name = document.createElement('span');
        name.className = 'chat-file-chip-name';
        name.title = a.fileName;
        name.textContent = a.fileName;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'chat-file-chip-remove';
        remove.title = 'Remove';
        remove.innerHTML = '×';
        remove.setAttribute('aria-label', 'Remove ' + a.fileName);
        remove.addEventListener('click', () => removeChatAttachment(i));
        chip.appendChild(name);
        chip.appendChild(remove);
        list.appendChild(chip);
    });
}

function removeChatAttachment(index) {
    chatAttachments.splice(index, 1);
    renderChatFileChips();
}

// If there are attachments and the input box is empty, fill in a default prompt (editable); backend will concatenate path and content for the model
function appendChatFilePrompt() {
    const input = document.getElementById('chat-input');
    if (!input || !chatAttachments.length) return;
    if (!input.value.trim()) {
        input.value = CHAT_FILE_DEFAULT_PROMPT;
        adjustTextareaHeight(input);
    }
}

function readFileAsAttachment(file) {
    return new Promise((resolve, reject) => {
        const mimeType = file.type || '';
        const isTextLike = /^text\//i.test(mimeType) || /^(application\/(json|xml|javascript)|image\/svg\+xml)/i.test(mimeType);
        const reader = new FileReader();
        reader.onload = () => {
            let content = reader.result;
            if (typeof content === 'string' && content.startsWith('data:')) {
                content = content.replace(/^data:[^;]+;base64,/, '');
            }
            resolve({ fileName: file.name, content: content, mimeType: mimeType });
        };
        reader.onerror = () => reject(reader.error);
        if (isTextLike) {
            reader.readAsText(file, 'UTF-8');
        } else {
            reader.readAsDataURL(file);
        }
    });
}

function addFilesToChat(files) {
    if (!files || !files.length) return;
    const next = Array.from(files);
    if (chatAttachments.length + next.length > MAX_CHAT_FILES) {
        alert('You can upload at most ' + MAX_CHAT_FILES + ' files at once. Currently selected: ' + chatAttachments.length + '.');
        return;
    }
    const addOne = (file) => {
        return readFileAsAttachment(file).then((a) => {
            chatAttachments.push(a);
            renderChatFileChips();
            appendChatFilePrompt();
        }).catch(() => {
            alert('Failed to read file: ' + file.name);
        });
    };
    let p = Promise.resolve();
    next.forEach((file) => { p = p.then(() => addOne(file)); });
    p.then(() => {});
}

function setupChatFileUpload() {
    const inputEl = document.getElementById('chat-file-input');
    const container = document.getElementById('chat-input-container') || document.querySelector('.chat-input-container');
    if (!inputEl || !container) return;

    inputEl.addEventListener('change', function () {
        const files = this.files;
        if (files && files.length) {
            addFilesToChat(files);
        }
        this.value = '';
    });

    container.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.stopPropagation();
        this.classList.add('drag-over');
    });
    container.addEventListener('dragleave', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (!this.contains(e.relatedTarget)) {
            this.classList.remove('drag-over');
        }
    });
    container.addEventListener('drop', function (e) {
        e.preventDefault();
        e.stopPropagation();
        this.classList.remove('drag-over');
        const files = e.dataTransfer && e.dataTransfer.files;
        if (files && files.length) addFilesToChat(files);
    });
}

// Ensure chat-input-container has an id (in case template did not set it)
function ensureChatInputContainerId() {
    const c = document.querySelector('.chat-input-container');
    if (c && !c.id) c.id = 'chat-input-container';
}

function setupMentionSupport() {
    mentionSuggestionsEl = document.getElementById('mention-suggestions');
    if (mentionSuggestionsEl) {
        mentionSuggestionsEl.style.display = 'none';
        mentionSuggestionsEl.addEventListener('mousedown', (event) => {
            // Prevent input box from losing focus when clicking a suggestion
            event.preventDefault();
        });
    }
    ensureMentionToolsLoaded().catch(() => {
        // Ignore load error; can retry later
    });
}

// Refresh tool list (reset loaded state, force reload)
function refreshMentionTools() {
    mentionToolsLoaded = false;
    mentionTools = [];
    externalMcpNames = [];
    mentionToolsLoadingPromise = null;
    // If @ mention is currently active, immediately trigger reload
    if (mentionState.active) {
        ensureMentionToolsLoaded().catch(() => {
            // Ignore load error
        });
    }
}

// Expose refresh function to window object for other modules to call
if (typeof window !== 'undefined') {
    window.refreshMentionTools = refreshMentionTools;
}

function ensureMentionToolsLoaded() {
    // Check if role has changed; if so, force reload
    if (typeof window !== 'undefined' && window._mentionToolsRoleChanged) {
        mentionToolsLoaded = false;
        mentionTools = [];
        delete window._mentionToolsRoleChanged;
    }
    
    if (mentionToolsLoaded) {
        return Promise.resolve(mentionTools);
    }
    if (mentionToolsLoadingPromise) {
        return mentionToolsLoadingPromise;
    }
    mentionToolsLoadingPromise = fetchMentionTools().finally(() => {
        mentionToolsLoadingPromise = null;
    });
    return mentionToolsLoadingPromise;
}

// Generate unique tool identifier to distinguish tools with same name but different sources
function getToolKeyForMention(tool) {
    // If it is an external tool, use external_mcp::tool.name as unique identifier
    // If it is an internal tool, use tool.name as identifier
    if (tool.is_external && tool.external_mcp) {
        return `${tool.external_mcp}::${tool.name}`;
    }
    return tool.name;
}

async function fetchMentionTools() {
    const pageSize = 100;
    let page = 1;
    let totalPages = 1;
    const seen = new Set();
    const collected = [];

    try {
        // Get currently selected role (from roles.js function)
        const roleName = typeof getCurrentRole === 'function' ? getCurrentRole() : '';

        // Also get external MCP list
        try {
            const mcpResponse = await apiFetch('/api/external-mcp');
            if (mcpResponse.ok) {
                const mcpData = await mcpResponse.json();
                externalMcpNames = Object.keys(mcpData.servers || {}).filter(name => {
                    const server = mcpData.servers[name];
                    // Only include connected and enabled MCPs
                    return server.status === 'connected' && 
                           (server.config.external_mcp_enable || (server.config.enabled && !server.config.disabled));
                });
            }
        } catch (mcpError) {
            console.warn('Failed to load external MCP list:', mcpError);
            externalMcpNames = [];
        }

        while (page <= totalPages && page <= 20) {
            // Build API URL; if role is specified, add role query parameter
            let url = `/api/config/tools?page=${page}&page_size=${pageSize}`;
            if (roleName && roleName !== 'Default') {
                url += `&role=${encodeURIComponent(roleName)}`;
            }

            const response = await apiFetch(url);
            if (!response.ok) {
                break;
            }
            const result = await response.json();
            const tools = Array.isArray(result.tools) ? result.tools : [];
            tools.forEach(tool => {
                if (!tool || !tool.name) {
                    return;
                }
                // Use unique identifier for deduplication, not just the tool name
                const toolKey = getToolKeyForMention(tool);
                if (seen.has(toolKey)) {
                    return;
                }
                seen.add(toolKey);

                // Determine the enabled state of the tool in the current role
                // If role_enabled field exists, use it (indicates a role was specified)
                // Otherwise use the enabled field (indicates no role specified or using all tools)
                let roleEnabled = tool.enabled !== false;
                if (tool.role_enabled !== undefined && tool.role_enabled !== null) {
                    roleEnabled = tool.role_enabled;
                }

                collected.push({
                    name: tool.name,
                    description: tool.description || '',
                    enabled: tool.enabled !== false, // Tool's own enabled state
                    roleEnabled: roleEnabled, // Enabled state in current role
                    isExternal: !!tool.is_external,
                    externalMcp: tool.external_mcp || '',
                    toolKey: toolKey, // Save unique identifier
                });
            });
            totalPages = result.total_pages || 1;
            page += 1;
            if (page > totalPages) {
                break;
            }
        }
        mentionTools = collected;
        mentionToolsLoaded = true;
    } catch (error) {
        console.warn('Failed to load tool list; @ mention feature may be unavailable:', error);
    }
    return mentionTools;
}

function handleChatInputInput(event) {
    const textarea = event.target;
    updateMentionStateFromInput(textarea);
    // Auto-adjust input box height
    // Use requestAnimationFrame to adjust immediately after DOM update, especially when deleting content
    requestAnimationFrame(() => {
        adjustTextareaHeight(textarea);
    });
    // Save input content to localStorage (debounced)
    saveChatDraftDebounced(textarea.value);
}

function handleChatInputClick(event) {
    updateMentionStateFromInput(event.target);
}

function handleChatInputKeydown(event) {
    // If using an input method (IME), Enter should confirm the candidate word, not send the message
    // Use event.isComposing or isComposing flag to determine this
    if (event.isComposing || isComposing) {
        return;
    }

    if (mentionState.active && mentionSuggestionsEl && mentionSuggestionsEl.style.display !== 'none') {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            moveMentionSelection(1);
            return;
        }
        if (event.key === 'ArrowUp') {
            event.preventDefault();
            moveMentionSelection(-1);
            return;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault();
            applyMentionSelection();
            return;
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            deactivateMentionState();
            return;
        }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
}

function updateMentionStateFromInput(textarea) {
    if (!textarea) {
        deactivateMentionState();
        return;
    }
    const caret = textarea.selectionStart || 0;
    const textBefore = textarea.value.slice(0, caret);
    const atIndex = textBefore.lastIndexOf('@');

    if (atIndex === -1) {
        deactivateMentionState();
        return;
    }

    // The character before the trigger must be whitespace or start of string
    if (atIndex > 0) {
        const boundaryChar = textBefore[atIndex - 1];
        if (boundaryChar && !/\s/.test(boundaryChar) && !'([{，。,.;:!?'.includes(boundaryChar)) {
            deactivateMentionState();
            return;
        }
    }

    const querySegment = textBefore.slice(atIndex + 1);

    if (querySegment.includes(' ') || querySegment.includes('\n') || querySegment.includes('\t') || querySegment.includes('@')) {
        deactivateMentionState();
        return;
    }

    if (querySegment.length > 60) {
        deactivateMentionState();
        return;
    }

    mentionState.active = true;
    mentionState.startIndex = atIndex;
    mentionState.query = querySegment.toLowerCase();
    mentionState.selectedIndex = 0;

    if (!mentionToolsLoaded) {
        renderMentionSuggestions({ showLoading: true });
    } else {
        updateMentionCandidates();
        renderMentionSuggestions();
    }

    ensureMentionToolsLoaded().then(() => {
        if (mentionState.active) {
            updateMentionCandidates();
            renderMentionSuggestions();
        }
    });
}

function updateMentionCandidates() {
    if (!mentionState.active) {
        mentionFilteredTools = [];
        return;
    }
    const normalizedQuery = (mentionState.query || '').trim().toLowerCase();
    let filtered = mentionTools;

    if (normalizedQuery) {
        // Check if it exactly matches an external MCP name
        const exactMatchedMcp = externalMcpNames.find(mcpName => 
            mcpName.toLowerCase() === normalizedQuery
        );

        if (exactMatchedMcp) {
            // If exactly matching an MCP name, show only tools under that MCP
            filtered = mentionTools.filter(tool => {
                return tool.externalMcp && tool.externalMcp.toLowerCase() === exactMatchedMcp.toLowerCase();
            });
        } else {
            // Check if it partially matches an MCP name
            const partialMatchedMcps = externalMcpNames.filter(mcpName => 
                mcpName.toLowerCase().includes(normalizedQuery)
            );
            
            // Normal match: filter by tool name and description, also match MCP name
            filtered = mentionTools.filter(tool => {
                const nameMatch = tool.name.toLowerCase().includes(normalizedQuery);
                const descMatch = tool.description && tool.description.toLowerCase().includes(normalizedQuery);
                const mcpMatch = tool.externalMcp && tool.externalMcp.toLowerCase().includes(normalizedQuery);
                
                // If partially matching an MCP name, also include all tools under that MCP
                const mcpPartialMatch = partialMatchedMcps.some(mcpName => 
                    tool.externalMcp && tool.externalMcp.toLowerCase() === mcpName.toLowerCase()
                );
                
                return nameMatch || descMatch || mcpMatch || mcpPartialMatch;
            });
        }
    }

    filtered = filtered.slice().sort((a, b) => {
        // If a role is specified, prioritize tools enabled in the current role
        if (a.roleEnabled !== undefined || b.roleEnabled !== undefined) {
            const aRoleEnabled = a.roleEnabled !== undefined ? a.roleEnabled : a.enabled;
            const bRoleEnabled = b.roleEnabled !== undefined ? b.roleEnabled : b.enabled;
            if (aRoleEnabled !== bRoleEnabled) {
                return aRoleEnabled ? -1 : 1; // Enabled tools come first
            }
        }

        if (normalizedQuery) {
            // Tools that exactly match the MCP name are shown first
            const aMcpExact = a.externalMcp && a.externalMcp.toLowerCase() === normalizedQuery;
            const bMcpExact = b.externalMcp && b.externalMcp.toLowerCase() === normalizedQuery;
            if (aMcpExact !== bMcpExact) {
                return aMcpExact ? -1 : 1;
            }
            
            const aStarts = a.name.toLowerCase().startsWith(normalizedQuery);
            const bStarts = b.name.toLowerCase().startsWith(normalizedQuery);
            if (aStarts !== bStarts) {
                return aStarts ? -1 : 1;
            }
        }
        // If a role is specified, use roleEnabled; otherwise use enabled
        const aEnabled = a.roleEnabled !== undefined ? a.roleEnabled : a.enabled;
        const bEnabled = b.roleEnabled !== undefined ? b.roleEnabled : b.enabled;
        if (aEnabled !== bEnabled) {
            return aEnabled ? -1 : 1;
        }
        return a.name.localeCompare(b.name, 'en-US');
    });

    mentionFilteredTools = filtered;
    if (mentionFilteredTools.length === 0) {
        mentionState.selectedIndex = 0;
    } else if (mentionState.selectedIndex >= mentionFilteredTools.length) {
        mentionState.selectedIndex = 0;
    }
}

function renderMentionSuggestions({ showLoading = false } = {}) {
    if (!mentionSuggestionsEl || !mentionState.active) {
        hideMentionSuggestions();
        return;
    }

    const currentQuery = mentionState.query || '';
    const existingList = mentionSuggestionsEl.querySelector('.mention-suggestions-list');
    const canPreserveScroll = !showLoading &&
        existingList &&
        mentionSuggestionsEl.dataset.lastMentionQuery === currentQuery;
    const previousScrollTop = canPreserveScroll ? existingList.scrollTop : 0;

    if (showLoading) {
        mentionSuggestionsEl.innerHTML = '<div class="mention-empty">Loading tools...</div>';
        mentionSuggestionsEl.style.display = 'block';
        delete mentionSuggestionsEl.dataset.lastMentionQuery;
        return;
    }

    if (!mentionFilteredTools.length) {
        mentionSuggestionsEl.innerHTML = '<div class="mention-empty">No matching tools</div>';
        mentionSuggestionsEl.style.display = 'block';
        mentionSuggestionsEl.dataset.lastMentionQuery = currentQuery;
        return;
    }

    const itemsHtml = mentionFilteredTools.map((tool, index) => {
        const activeClass = index === mentionState.selectedIndex ? 'active' : '';
        // If the tool has roleEnabled field (role specified), use it; otherwise use enabled
        const toolEnabled = tool.roleEnabled !== undefined ? tool.roleEnabled : tool.enabled;
        const disabledClass = toolEnabled ? '' : 'disabled';
        const badge = tool.isExternal ? '<span class="mention-item-badge">External</span>' : '<span class="mention-item-badge internal">Built-in</span>';
        const nameHtml = escapeHtml(tool.name);
        const description = tool.description && tool.description.length > 0 ? escapeHtml(tool.description) : 'No description';
        const descHtml = `<div class="mention-item-desc">${description}</div>`;
        // Show status label based on tool enabled state in the current role
        const statusLabel = toolEnabled ? 'Available' : (tool.roleEnabled !== undefined ? 'Disabled (current role)' : 'Disabled');
        const statusClass = toolEnabled ? 'enabled' : 'disabled';
        const originLabel = tool.isExternal
            ? (tool.externalMcp ? `Source: ${escapeHtml(tool.externalMcp)}` : 'Source: External MCP')
            : 'Source: Built-in tool';

        return `
            <button type="button" class="mention-item ${activeClass} ${disabledClass}" data-index="${index}">
                <div class="mention-item-name">
                    <span class="mention-item-icon">🔧</span>
                    <span class="mention-item-text">@${nameHtml}</span>
                    ${badge}
                </div>
                ${descHtml}
                <div class="mention-item-meta">
                    <span class="mention-status ${statusClass}">${statusLabel}</span>
                    <span class="mention-origin">${originLabel}</span>
                </div>
            </button>
        `;
    }).join('');

    const listWrapper = document.createElement('div');
    listWrapper.className = 'mention-suggestions-list';
    listWrapper.innerHTML = itemsHtml;

    mentionSuggestionsEl.innerHTML = '';
    mentionSuggestionsEl.appendChild(listWrapper);
    mentionSuggestionsEl.style.display = 'block';
    mentionSuggestionsEl.dataset.lastMentionQuery = currentQuery;

    if (canPreserveScroll) {
        listWrapper.scrollTop = previousScrollTop;
    }

    listWrapper.querySelectorAll('.mention-item').forEach(item => {
        item.addEventListener('mousedown', (event) => {
            event.preventDefault();
            const idx = parseInt(item.dataset.index, 10);
            if (!Number.isNaN(idx)) {
                mentionState.selectedIndex = idx;
            }
            applyMentionSelection();
        });
    });

    scrollMentionSelectionIntoView();
}

function hideMentionSuggestions() {
    if (mentionSuggestionsEl) {
        mentionSuggestionsEl.style.display = 'none';
        mentionSuggestionsEl.innerHTML = '';
        delete mentionSuggestionsEl.dataset.lastMentionQuery;
    }
}

function deactivateMentionState() {
    mentionState.active = false;
    mentionState.startIndex = -1;
    mentionState.query = '';
    mentionState.selectedIndex = 0;
    mentionFilteredTools = [];
    hideMentionSuggestions();
}

function moveMentionSelection(direction) {
    if (!mentionFilteredTools.length) {
        return;
    }
    const max = mentionFilteredTools.length - 1;
    let nextIndex = mentionState.selectedIndex + direction;
    if (nextIndex < 0) {
        nextIndex = max;
    } else if (nextIndex > max) {
        nextIndex = 0;
    }
    mentionState.selectedIndex = nextIndex;
    updateMentionActiveHighlight();
}

function updateMentionActiveHighlight() {
    if (!mentionSuggestionsEl) {
        return;
    }
    const items = mentionSuggestionsEl.querySelectorAll('.mention-item');
    if (!items.length) {
        return;
    }
    items.forEach(item => item.classList.remove('active'));

    let targetIndex = mentionState.selectedIndex;
    if (targetIndex < 0) {
        targetIndex = 0;
    }
    if (targetIndex >= items.length) {
        targetIndex = items.length - 1;
        mentionState.selectedIndex = targetIndex;
    }

    const activeItem = items[targetIndex];
    if (activeItem) {
        activeItem.classList.add('active');
        scrollMentionSelectionIntoView(activeItem);
    }
}

function scrollMentionSelectionIntoView(targetItem = null) {
    if (!mentionSuggestionsEl) {
        return;
    }
    const activeItem = targetItem || mentionSuggestionsEl.querySelector('.mention-item.active');
    if (activeItem && typeof activeItem.scrollIntoView === 'function') {
        activeItem.scrollIntoView({
            block: 'nearest',
            inline: 'nearest',
            behavior: 'auto'
        });
    }
}

function applyMentionSelection() {
    const textarea = document.getElementById('chat-input');
    if (!textarea || mentionState.startIndex === -1 || !mentionFilteredTools.length) {
        deactivateMentionState();
        return;
    }

    const selectedTool = mentionFilteredTools[mentionState.selectedIndex] || mentionFilteredTools[0];
    if (!selectedTool) {
        deactivateMentionState();
        return;
    }

    const caret = textarea.selectionStart || 0;
    const before = textarea.value.slice(0, mentionState.startIndex);
    const after = textarea.value.slice(caret);
    const mentionText = `@${selectedTool.name}`;
    const needsSpace = after.length === 0 || !/^\s/.test(after);
    const insertText = mentionText + (needsSpace ? ' ' : '');

    textarea.value = before + insertText + after;
    const newCaret = before.length + insertText.length;
    textarea.focus();
    textarea.setSelectionRange(newCaret, newCaret);
    
    // Adjust input box height and save draft
    adjustTextareaHeight(textarea);
    saveChatDraftDebounced(textarea.value);

    deactivateMentionState();
}

function initializeChatUI() {
    const chatInputEl = document.getElementById('chat-input');
    if (chatInputEl) {
        // Set correct height during initialization
        adjustTextareaHeight(chatInputEl);
        // Restore saved draft (only when input box is empty, to avoid overwriting user input)
        if (!chatInputEl.value || chatInputEl.value.trim() === '') {
            // Check if there are recent messages (within 30 seconds); if so, it may be a just-sent message, do not restore draft
            const messagesDiv = document.getElementById('chat-messages');
            let shouldRestoreDraft = true;
            if (messagesDiv && messagesDiv.children.length > 0) {
                // Check the time of the last message
                const lastMessage = messagesDiv.lastElementChild;
                if (lastMessage) {
                    const timeDiv = lastMessage.querySelector('.message-time');
                    if (timeDiv && timeDiv.textContent) {
                        // If the last message is a user message and recent, do not restore draft
                        const isUserMessage = lastMessage.classList.contains('user');
                        if (isUserMessage) {
                            // Check message time; if within the last 30 seconds, do not restore draft
                            const now = new Date();
                            const messageTimeText = timeDiv.textContent;
                            // Simple check: if message time shows current time (format: HH:MM) and it is a user message, do not restore draft
                            // More precise method: check message creation time, but requires extracting from the message element
                            // Simple strategy: if the last message is a user message and input box is empty, it may have just been sent, do not restore draft
                            shouldRestoreDraft = false;
                        }
                    }
                }
            }
            if (shouldRestoreDraft) {
                restoreChatDraft();
            } else {
                // Even if not restoring draft, clear the draft from localStorage to avoid false restore next time
                clearChatDraft();
            }
        }
    }

    const messagesDiv = document.getElementById('chat-messages');
    if (messagesDiv && messagesDiv.childElementCount === 0) {
        addMessage('assistant', 'System ready. Please enter your testing requirements; the system will automatically execute the corresponding security tests.');
    }

    addAttackChainButton(currentConversationId);
    loadActiveTasks(true);
    if (activeTaskInterval) {
        clearInterval(activeTaskInterval);
    }
    activeTaskInterval = setInterval(() => loadActiveTasks(), ACTIVE_TASK_REFRESH_INTERVAL);
    setupMentionSupport();
    ensureChatInputContainerId();
    setupChatFileUpload();
}

// Message counter to ensure unique IDs
let messageCounter = 0;

// Add independent scroll container for tables in message bubbles
function wrapTablesInBubble(bubble) {
    const tables = bubble.querySelectorAll('table');
    tables.forEach(table => {
        // Check if the table already has a wrapper container
        if (table.parentElement && table.parentElement.classList.contains('table-wrapper')) {
            return;
        }
        
        // Create table wrapper container
        const wrapper = document.createElement('div');
        wrapper.className = 'table-wrapper';
        
        // Move table into wrapper container
        table.parentNode.insertBefore(wrapper, table);
        wrapper.appendChild(table);
    });
}

// Add message
function addMessage(role, content, mcpExecutionIds = null, progressId = null, createdAt = null) {
    const messagesDiv = document.getElementById('chat-messages');
    const messageDiv = document.createElement('div');
    messageCounter++;
    const id = 'msg-' + Date.now() + '-' + messageCounter + '-' + Math.random().toString(36).substr(2, 9);
    messageDiv.id = id;
    messageDiv.className = 'message ' + role;
    
    // Create avatar
    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    if (role === 'user') {
        avatar.textContent = 'U';
    } else if (role === 'assistant') {
        avatar.textContent = 'A';
    } else {
        avatar.textContent = 'S';
    }
    messageDiv.appendChild(avatar);
    
    // Create message content container
    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'message-content';
    
    // Create message bubble
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    
    // Parse Markdown or HTML format
    let formattedContent;
    const defaultSanitizeConfig = {
        ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 's', 'code', 'pre', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr'],
        ALLOWED_ATTR: ['href', 'title', 'alt', 'src', 'class'],
        ALLOW_DATA_ATTR: false,
    };
    
    // HTML entity encoding function
    const escapeHtml = (text) => {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    };
    
    // Note: code block content does not need escaping, because:
    // 1. After Markdown parsing, code blocks are wrapped in <code> or <pre> tags
    // 2. Browsers do not execute HTML inside <code> and <pre> tags (they are text nodes)
    // 3. DOMPurify preserves text content inside these tags
    // This prevents XSS while correctly displaying code
    
    const parseMarkdown = (raw) => {
        if (typeof marked === 'undefined') {
            return null;
        }
        try {
            marked.setOptions({
                breaks: true,
                gfm: true,
            });
            return marked.parse(raw);
        } catch (e) {
            console.error('Markdown parsing failed:', e);
            return null;
        }
    };
    
    // For user messages, directly escape HTML without Markdown parsing to preserve all special characters
    if (role === 'user') {
        formattedContent = escapeHtml(content).replace(/\n/g, '<br>');
    } else if (typeof DOMPurify !== 'undefined') {
        // Directly parse Markdown (code blocks will be wrapped in <code>/<pre>; DOMPurify preserves text content)
        let parsedContent = parseMarkdown(content);
        if (!parsedContent) {
            parsedContent = content;
        }
        
        // Use DOMPurify for sanitization, only add necessary URL validation hooks (DOMPurify handles event handlers etc. by default)
        if (DOMPurify.addHook) {
            // Remove previously existing hooks
            try {
                DOMPurify.removeHook('uponSanitizeAttribute');
            } catch (e) {
                // Hook does not exist, ignore
            }
            
            // Only validate URL attributes to block dangerous protocols (DOMPurify handles event handlers, style, etc. by default)
            DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
                const attrName = data.attrName.toLowerCase();
                
                // Only validate URL attributes (src, href)
                if ((attrName === 'src' || attrName === 'href') && data.attrValue) {
                    const value = data.attrValue.trim().toLowerCase();
                    // Block dangerous protocols
                    if (value.startsWith('javascript:') || 
                        value.startsWith('vbscript:') ||
                        value.startsWith('data:text/html') ||
                        value.startsWith('data:text/javascript')) {
                        data.keepAttr = false;
                        return;
                    }
                    // For img src, block suspicious short URLs (prevent 404 and XSS)
                    if (attrName === 'src' && node.tagName && node.tagName.toLowerCase() === 'img') {
                        if (value.length <= 2 || /^[a-z]$/i.test(value)) {
                            data.keepAttr = false;
                            return;
                        }
                    }
                }
            });
        }
        
        formattedContent = DOMPurify.sanitize(parsedContent, defaultSanitizeConfig);
    } else if (typeof marked !== 'undefined') {
        const parsedContent = parseMarkdown(content);
        if (parsedContent) {
            formattedContent = parsedContent;
        } else {
            formattedContent = escapeHtml(content).replace(/\n/g, '<br>');
        }
    } else {
        formattedContent = escapeHtml(content).replace(/\n/g, '<br>');
    }
    
    bubble.innerHTML = formattedContent;
    
    // Final security check: only handle obviously suspicious images (prevent 404 and XSS)
    // DOMPurify already handles most XSS vectors; this is just a necessary supplement
    const images = bubble.querySelectorAll('img');
    images.forEach(img => {
        const src = img.getAttribute('src');
        if (src) {
            const trimmedSrc = src.trim();
            // Only check obviously suspicious URLs (short strings, single characters)
            if (trimmedSrc.length <= 2 || /^[a-z]$/i.test(trimmedSrc)) {
                img.remove();
            }
        } else {
            img.remove();
        }
    });
    
    // Add independent scroll container for each table
    wrapTablesInBubble(bubble);
    
    contentWrapper.appendChild(bubble);
    
    // Save original content to message element for copy functionality
    if (role === 'assistant') {
        messageDiv.dataset.originalContent = content;
    }
    
    // Add copy button to assistant messages (copies entire reply) - placed at bottom-right of message bubble
    if (role === 'assistant') {
        const copyBtn = document.createElement('button');
        copyBtn.className = 'message-copy-btn';
        copyBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg><span>Copy</span>';
        copyBtn.title = 'Copy message content';
        copyBtn.onclick = function(e) {
            e.stopPropagation();
            copyMessageToClipboard(messageDiv, this);
        };
        bubble.appendChild(copyBtn);
    }
    
    // Add timestamp
    const timeDiv = document.createElement('div');
    timeDiv.className = 'message-time';
    // If creation time is provided, use it; otherwise use current time
    let messageTime;
    if (createdAt) {
        // Handle string or Date object
        if (typeof createdAt === 'string') {
            messageTime = new Date(createdAt);
        } else if (createdAt instanceof Date) {
            messageTime = createdAt;
        } else {
            messageTime = new Date(createdAt);
        }
        // If parsing fails, use current time
        if (isNaN(messageTime.getTime())) {
            messageTime = new Date();
        }
    } else {
        messageTime = new Date();
    }
    timeDiv.textContent = messageTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    contentWrapper.appendChild(timeDiv);
    
    // If there are MCP execution IDs or a progress ID, add a details view area (unified "Penetration Test Details" style)
    if (role === 'assistant' && ((mcpExecutionIds && Array.isArray(mcpExecutionIds) && mcpExecutionIds.length > 0) || progressId)) {
        const mcpSection = document.createElement('div');
        mcpSection.className = 'mcp-call-section';
        
        const mcpLabel = document.createElement('div');
        mcpLabel.className = 'mcp-call-label';
        mcpLabel.textContent = '📋 Penetration Test Details';
        mcpSection.appendChild(mcpLabel);
        
        const buttonsContainer = document.createElement('div');
        buttonsContainer.className = 'mcp-call-buttons';
        
        // If there are MCP execution IDs, add MCP call detail buttons
        if (mcpExecutionIds && Array.isArray(mcpExecutionIds) && mcpExecutionIds.length > 0) {
            mcpExecutionIds.forEach((execId, index) => {
                const detailBtn = document.createElement('button');
                detailBtn.className = 'mcp-detail-btn';
                detailBtn.innerHTML = `<span>Call #${index + 1}</span>`;
                detailBtn.onclick = () => showMCPDetail(execId);
                buttonsContainer.appendChild(detailBtn);
                // Asynchronously get tool name and update button text
                updateButtonWithToolName(detailBtn, execId, index + 1);
            });
        }
        
        // If there is a progress ID, add an expand details button (unified "Expand Details" text)
        if (progressId) {
            const progressDetailBtn = document.createElement('button');
            progressDetailBtn.className = 'mcp-detail-btn process-detail-btn';
            progressDetailBtn.innerHTML = '<span>Expand Details</span>';
            progressDetailBtn.onclick = () => toggleProcessDetails(progressId, messageDiv.id);
            buttonsContainer.appendChild(progressDetailBtn);
            // Store progress ID in message element
            messageDiv.dataset.progressId = progressId;
        }
        
        mcpSection.appendChild(buttonsContainer);
        contentWrapper.appendChild(mcpSection);
    }
    
    messageDiv.appendChild(contentWrapper);
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    return id;
}

// Copy message content to clipboard (using original Markdown format)
function copyMessageToClipboard(messageDiv, button) {
    try {
        // Get saved original Markdown content
        const originalContent = messageDiv.dataset.originalContent;
        
        if (!originalContent) {
            // If no original content was saved, try extracting from rendered HTML (fallback)
            const bubble = messageDiv.querySelector('.message-bubble');
            if (bubble) {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = bubble.innerHTML;
                
                // Remove the copy button itself (avoid copying button text)
                const copyBtnInTemp = tempDiv.querySelector('.message-copy-btn');
                if (copyBtnInTemp) {
                    copyBtnInTemp.remove();
                }
                
                // Extract plain text content
                let textContent = tempDiv.textContent || tempDiv.innerText || '';
                textContent = textContent.replace(/\n{3,}/g, '\n\n').trim();
                
                navigator.clipboard.writeText(textContent).then(() => {
                    showCopySuccess(button);
                }).catch(err => {
                    console.error('Copy failed:', err);
                    alert('Copy failed. Please manually select and copy the content.');
                });
            }
            return;
        }
        
        // Use original Markdown content
        navigator.clipboard.writeText(originalContent).then(() => {
            showCopySuccess(button);
        }).catch(err => {
            console.error('Copy failed:', err);
            alert('Copy failed. Please manually select and copy the content.');
        });
    } catch (error) {
        console.error('Error copying message:', error);
        alert('Copy failed. Please manually select and copy the content.');
    }
}

// Show copy success indicator
function showCopySuccess(button) {
    if (button) {
        const originalText = button.innerHTML;
        button.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg><span>Copied</span>';
        button.style.color = '#10b981';
        button.style.background = 'rgba(16, 185, 129, 0.1)';
        button.style.borderColor = 'rgba(16, 185, 129, 0.3)';
        setTimeout(() => {
            button.innerHTML = originalText;
            button.style.color = '';
            button.style.background = '';
            button.style.borderColor = '';
        }, 2000);
    }
}

// Render process details
function renderProcessDetails(messageId, processDetails) {
    const messageElement = document.getElementById(messageId);
    if (!messageElement) {
        return;
    }
    
    // Find or create MCP call area
    let mcpSection = messageElement.querySelector('.mcp-call-section');
    if (!mcpSection) {
        mcpSection = document.createElement('div');
        mcpSection.className = 'mcp-call-section';
        
        const contentWrapper = messageElement.querySelector('.message-content');
        if (contentWrapper) {
            contentWrapper.appendChild(mcpSection);
        } else {
            return;
        }
    }
    
    // Ensure label and button container exist (unified structure)
    let mcpLabel = mcpSection.querySelector('.mcp-call-label');
    let buttonsContainer = mcpSection.querySelector('.mcp-call-buttons');
    
    // If no label, create one (when there are no tool calls)
    if (!mcpLabel && !buttonsContainer) {
        mcpLabel = document.createElement('div');
        mcpLabel.className = 'mcp-call-label';
        mcpLabel.textContent = '📋 Penetration Test Details';
        mcpSection.appendChild(mcpLabel);
    } else if (mcpLabel && mcpLabel.textContent !== '📋 Penetration Test Details') {
        // If label exists but not in unified format, update it
        mcpLabel.textContent = '📋 Penetration Test Details';
    }
    
    // If no button container, create one
    if (!buttonsContainer) {
        buttonsContainer = document.createElement('div');
        buttonsContainer.className = 'mcp-call-buttons';
        mcpSection.appendChild(buttonsContainer);
    }
    
    // Add process detail button (if not already present)
    let processDetailBtn = buttonsContainer.querySelector('.process-detail-btn');
    if (!processDetailBtn) {
        processDetailBtn = document.createElement('button');
        processDetailBtn.className = 'mcp-detail-btn process-detail-btn';
        processDetailBtn.innerHTML = '<span>Expand Details</span>';
        processDetailBtn.onclick = () => toggleProcessDetails(null, messageId);
        buttonsContainer.appendChild(processDetailBtn);
    }
    
    // Create process detail container (placed after button container)
    const detailsId = 'process-details-' + messageId;
    let detailsContainer = document.getElementById(detailsId);
    
    if (!detailsContainer) {
        detailsContainer = document.createElement('div');
        detailsContainer.id = detailsId;
        detailsContainer.className = 'process-details-container';
        // Ensure container is after button container
        if (buttonsContainer.nextSibling) {
            mcpSection.insertBefore(detailsContainer, buttonsContainer.nextSibling);
        } else {
            mcpSection.appendChild(detailsContainer);
        }
    }
    
    // Create timeline (create even without processDetails, so the expand details button works)
    const timelineId = detailsId + '-timeline';
    let timeline = document.getElementById(timelineId);
    
    if (!timeline) {
        const contentDiv = document.createElement('div');
        contentDiv.className = 'process-details-content';
        
        timeline = document.createElement('div');
        timeline.id = timelineId;
        timeline.className = 'progress-timeline';
        
        contentDiv.appendChild(timeline);
        detailsContainer.appendChild(contentDiv);
    }
    
    // If no processDetails or empty, show empty state
    if (!processDetails || processDetails.length === 0) {
        // Show empty state hint
        timeline.innerHTML = '<div class="progress-timeline-empty">No process details available (may have executed too fast or no detail events triggered)</div>';
        // Default collapsed
        timeline.classList.remove('expanded');
        return;
    }
    
    // Clear timeline and re-render
    timeline.innerHTML = '';
    
    
    // Render each process detail event
    processDetails.forEach(detail => {
        const eventType = detail.eventType || '';
        const title = detail.message || '';
        const data = detail.data || {};
        
        // Render different content based on event type
        let itemTitle = title;
        if (eventType === 'iteration') {
            itemTitle = `Round ${data.iteration || 1}`;
        } else if (eventType === 'thinking') {
            itemTitle = '🤔 AI Thinking';
        } else if (eventType === 'tool_calls_detected') {
            itemTitle = `🔧 Detected ${data.count || 0} tool call(s)`;
        } else if (eventType === 'tool_call') {
            const toolName = data.toolName || 'Unknown tool';
            const index = data.index || 0;
            const total = data.total || 0;
            itemTitle = `🔧 Calling tool: ${escapeHtml(toolName)} (${index}/${total})`;
        } else if (eventType === 'tool_result') {
            const toolName = data.toolName || 'Unknown tool';
            const success = data.success !== false;
            const statusIcon = success ? '✅' : '❌';
            itemTitle = `${statusIcon} Tool ${escapeHtml(toolName)} execution ${success ? 'completed' : 'failed'}`;
            
            // If it is a knowledge retrieval tool, add special marker
            if (toolName === BuiltinTools.SEARCH_KNOWLEDGE_BASE && success) {
                itemTitle = `📚 ${itemTitle} - Knowledge Retrieval`;
            }
        } else if (eventType === 'knowledge_retrieval') {
            itemTitle = '📚 Knowledge Retrieval';
        } else if (eventType === 'error') {
            itemTitle = '❌ Error';
        } else if (eventType === 'cancelled') {
            itemTitle = '⛔ Task Cancelled';
        }
        
        addTimelineItem(timeline, eventType, {
            title: itemTitle,
            message: detail.message || '',
            data: data,
            createdAt: detail.createdAt // Pass actual event creation time
        });
    });
    
    // Check if there are error or cancelled events; if so, ensure details are collapsed by default
    const hasErrorOrCancelled = processDetails.some(d => 
        d.eventType === 'error' || d.eventType === 'cancelled'
    );
    if (hasErrorOrCancelled) {
        // Ensure timeline is collapsed
        timeline.classList.remove('expanded');
        // Update button text to "Expand Details"
        const processDetailBtn = messageElement.querySelector('.process-detail-btn');
        if (processDetailBtn) {
            processDetailBtn.innerHTML = '<span>Expand Details</span>';
        }
    }
}

// Remove message
function removeMessage(id) {
    const messageDiv = document.getElementById(id);
    if (messageDiv) {
        messageDiv.remove();
    }
}

// Input box event binding (Enter to send / @ mention)
const chatInput = document.getElementById('chat-input');
if (chatInput) {
    chatInput.addEventListener('keydown', handleChatInputKeydown);
    chatInput.addEventListener('input', handleChatInputInput);
    chatInput.addEventListener('click', handleChatInputClick);
    chatInput.addEventListener('focus', handleChatInputClick);
    // IME input method event listeners for tracking IME state
    chatInput.addEventListener('compositionstart', () => {
        isComposing = true;
    });
    chatInput.addEventListener('compositionend', () => {
        isComposing = false;
    });
    chatInput.addEventListener('blur', () => {
        setTimeout(() => {
            if (!chatInput.matches(':focus')) {
                deactivateMentionState();
            }
        }, 120);
        // Save draft immediately on blur (without debounce)
        if (chatInput.value) {
            saveChatDraft(chatInput.value);
        }
    });
}

// Save draft immediately on page unload
window.addEventListener('beforeunload', () => {
    const chatInput = document.getElementById('chat-input');
    if (chatInput && chatInput.value) {
        // Save immediately without debounce
        saveChatDraft(chatInput.value);
    }
});

// Asynchronously get tool name and update button text
async function updateButtonWithToolName(button, executionId, index) {
    try {
        const response = await apiFetch(`/api/monitor/execution/${executionId}`);
        if (response.ok) {
            const exec = await response.json();
            const toolName = exec.toolName || 'Unknown tool';
            // Format tool name (if in name::toolName format, show only the toolName part)
            const displayToolName = toolName.includes('::') ? toolName.split('::')[1] : toolName;
            button.querySelector('span').textContent = `${displayToolName} #${index}`;
        }
    } catch (error) {
        // If fetch fails, keep original text
        console.error('Failed to get tool name:', error);
    }
}

let mcpDetailPollTimer = null;
let mcpDetailCurrentExecutionId = null;
const MCP_RUNNING_STATUSES = new Set(['pending', 'running']);
const MCP_DETAIL_REFRESH_INTERVAL_MS = 1000;

function stopMCPDetailPolling() {
    if (mcpDetailPollTimer) {
        clearInterval(mcpDetailPollTimer);
        mcpDetailPollTimer = null;
    }
}

function formatMCPDetailTime(startTime, endTime) {
    if (!startTime) {
        return '—';
    }

    const start = new Date(startTime);
    if (Number.isNaN(start.getTime())) {
        return '—';
    }

    const finish = endTime ? new Date(endTime) : new Date();
    const elapsedMs = Math.max(0, finish.getTime() - start.getTime());
    const elapsedSec = Math.floor(elapsedMs / 1000);
    const elapsedMin = Math.floor(elapsedSec / 60);
    const remainSec = elapsedSec % 60;

    const elapsedText = elapsedMin > 0 ? `${elapsedMin}m ${remainSec}s` : `${remainSec}s`;
    return `${start.toLocaleString('en-US')} (elapsed ${elapsedText})`;
}

function getToolResultText(content) {
    if (typeof content === 'string') {
        return content;
    }
    if (Array.isArray(content)) {
        const texts = content
            .map(item => (item && typeof item === 'object' && typeof item.text === 'string') ? item.text : '')
            .filter(Boolean);
        if (texts.length > 0) {
            return texts.join('\n\n');
        }
    }
    if (content && typeof content === 'object' && typeof content.text === 'string') {
        return content.text;
    }
    return '';
}

function renderMCPDetail(exec) {
    document.getElementById('detail-tool-name').textContent = exec.toolName || 'Unknown';
    document.getElementById('detail-execution-id').textContent = exec.id || 'N/A';

    const statusEl = document.getElementById('detail-status');
    const normalizedStatus = (exec.status || 'unknown').toLowerCase();
    statusEl.textContent = getStatusText(exec.status);
    statusEl.className = `status-chip status-${normalizedStatus}`;

    document.getElementById('detail-time').textContent = formatMCPDetailTime(exec.startTime, exec.endTime);

    const requestData = {
        tool: exec.toolName,
        arguments: exec.arguments
    };
    document.getElementById('detail-request').textContent = JSON.stringify(requestData, null, 2);

    const responseElement = document.getElementById('detail-response');
    const successSection = document.getElementById('detail-success-section');
    const successElement = document.getElementById('detail-success');
    const errorSection = document.getElementById('detail-error-section');
    const errorElement = document.getElementById('detail-error');

    responseElement.className = 'code-block';
    responseElement.textContent = '';
    if (successSection && successElement) {
        successSection.style.display = 'none';
        successElement.textContent = '';
    }
    if (errorSection && errorElement) {
        errorSection.style.display = 'none';
        errorElement.textContent = '';
    }

    const hasResult = !!exec.result;
    const isRunning = MCP_RUNNING_STATUSES.has(normalizedStatus);

    if (hasResult) {
        const responseData = {
            content: exec.result.content,
            isError: exec.result.isError
        };
        responseElement.textContent = JSON.stringify(responseData, null, 2);

        if (exec.result.isError) {
            responseElement.className = 'code-block error';
            if (exec.error && errorSection && errorElement) {
                errorSection.style.display = 'block';
                errorElement.textContent = exec.error;
            }
        } else if (successSection && successElement) {
            successSection.style.display = 'block';
            const successText = getToolResultText(exec.result.content) || 'Execution succeeded; no displayable text content returned.';
            successElement.textContent = successText;
        }
    } else if (isRunning) {
        responseElement.textContent = 'Tool is running. Waiting for realtime output...';
    } else {
        responseElement.textContent = 'No response data available';
    }
}

async function fetchAndRenderMCPDetail(executionId) {
    const response = await apiFetch(`/api/monitor/execution/${executionId}`);
    const exec = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(exec.error || 'Unknown error');
    }

    renderMCPDetail(exec);
    return exec;
}

function startMCPDetailPolling(executionId) {
    stopMCPDetailPolling();
    mcpDetailCurrentExecutionId = executionId;

    mcpDetailPollTimer = setInterval(async () => {
        const modal = document.getElementById('mcp-detail-modal');
        if (!modal || modal.style.display !== 'block' || !mcpDetailCurrentExecutionId) {
            stopMCPDetailPolling();
            return;
        }

        try {
            const exec = await fetchAndRenderMCPDetail(mcpDetailCurrentExecutionId);
            const status = (exec.status || '').toLowerCase();
            if (!MCP_RUNNING_STATUSES.has(status)) {
                stopMCPDetailPolling();
            }
        } catch (error) {
            console.error('Failed to refresh MCP details:', error);
            stopMCPDetailPolling();
        }
    }, MCP_DETAIL_REFRESH_INTERVAL_MS);
}

// Show MCP call details
async function showMCPDetail(executionId) {
    stopMCPDetailPolling();
    mcpDetailCurrentExecutionId = executionId;

    try {
        const exec = await fetchAndRenderMCPDetail(executionId);
        document.getElementById('mcp-detail-modal').style.display = 'block';

        const status = (exec.status || '').toLowerCase();
        if (MCP_RUNNING_STATUSES.has(status)) {
            startMCPDetailPolling(executionId);
        }
    } catch (error) {
        stopMCPDetailPolling();
        alert('Failed to get details: ' + error.message);
    }
}

// Close MCP detail modal
function closeMCPDetail() {
    stopMCPDetailPolling();
    mcpDetailCurrentExecutionId = null;
    document.getElementById('mcp-detail-modal').style.display = 'none';
}

// Copy content from detail panel
function copyDetailBlock(elementId, triggerBtn = null) {
    const target = document.getElementById(elementId);
    if (!target) {
        return;
    }
    const text = target.textContent || '';
    if (!text.trim()) {
        return;
    }

    const originalLabel = triggerBtn ? (triggerBtn.dataset.originalLabel || triggerBtn.textContent.trim()) : '';
    if (triggerBtn && !triggerBtn.dataset.originalLabel) {
        triggerBtn.dataset.originalLabel = originalLabel;
    }

    const showCopiedState = () => {
        if (!triggerBtn) {
            return;
        }
        triggerBtn.textContent = 'Copied';
        triggerBtn.disabled = true;
        setTimeout(() => {
            triggerBtn.disabled = false;
            triggerBtn.textContent = triggerBtn.dataset.originalLabel || originalLabel || 'Copy';
        }, 1200);
    };

    const fallbackCopy = (value) => {
        return new Promise((resolve, reject) => {
            const textarea = document.createElement('textarea');
            textarea.value = value;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            try {
                const successful = document.execCommand('copy');
                document.body.removeChild(textarea);
                if (successful) {
                    resolve();
                } else {
                    reject(new Error('execCommand failed'));
                }
            } catch (err) {
                document.body.removeChild(textarea);
                reject(err);
            }
        });
    };

    const copyPromise = (navigator.clipboard && typeof navigator.clipboard.writeText === 'function')
        ? navigator.clipboard.writeText(text)
        : fallbackCopy(text);

    copyPromise
        .then(() => {
            showCopiedState();
        })
        .catch(() => {
            if (triggerBtn) {
                triggerBtn.disabled = false;
                triggerBtn.textContent = triggerBtn.dataset.originalLabel || originalLabel || 'Copy';
            }
            alert('Copy failed. Please manually select and copy the text.');
        });
}


// Start new conversation
async function startNewConversation() {
    // If currently on group detail page, exit group detail first
    if (currentGroupId) {
        const groupDetailPage = document.getElementById('group-detail-page');
        const chatContainer = document.querySelector('.chat-container');
        if (groupDetailPage) groupDetailPage.style.display = 'none';
        if (chatContainer) chatContainer.style.display = 'flex';
        currentGroupId = null;
        // Refresh conversation list
        loadConversationsWithGroups();
    }
    
    currentConversationId = null;
    currentConversationGroupId = null; // New conversation does not belong to any group
    document.getElementById('chat-messages').innerHTML = '';
    addMessage('assistant', 'System ready. Please enter your testing requirements; the system will automatically execute the corresponding security tests.');
    addAttackChainButton(null);
    updateActiveConversation();
    // Refresh group list, clear group highlight
    await loadGroups();
    // Refresh conversation list to ensure latest history is shown
    loadConversationsWithGroups();
    // Clear debounce timer to prevent triggering save during draft restore
    if (draftSaveTimer) {
        clearTimeout(draftSaveTimer);
        draftSaveTimer = null;
    }
    // Clear draft; a new conversation should not restore the previous draft
    clearChatDraft();
    // Clear input box
    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
        chatInput.value = '';
        adjustTextareaHeight(chatInput);
    }
}

// Load conversation list (grouped by time)
async function loadConversations(searchQuery = '') {
    try {
        let url = '/api/conversations?limit=50';
        if (searchQuery && searchQuery.trim()) {
            url += '&search=' + encodeURIComponent(searchQuery.trim());
        }
        const response = await apiFetch(url);

        const listContainer = document.getElementById('conversations-list');
        if (!listContainer) {
            return;
        }

        // Save scroll position
        const sidebarContent = listContainer.closest('.sidebar-content');
        const savedScrollTop = sidebarContent ? sidebarContent.scrollTop : 0;

        const emptyStateHtml = '<div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 0.875rem;">No conversation history</div>';
        listContainer.innerHTML = '';

        // If the response is not 200, show empty state (handle gracefully, do not show error)
        if (!response.ok) {
            listContainer.innerHTML = emptyStateHtml;
            return;
        }

        const conversations = await response.json();

        if (!Array.isArray(conversations) || conversations.length === 0) {
            listContainer.innerHTML = emptyStateHtml;
            return;
        }

        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const weekday = todayStart.getDay() === 0 ? 7 : todayStart.getDay();
        const startOfWeek = new Date(todayStart);
        startOfWeek.setDate(todayStart.getDate() - (weekday - 1));
        const yesterdayStart = new Date(todayStart);
        yesterdayStart.setDate(todayStart.getDate() - 1);

        const groups = {
            today: [],
            yesterday: [],
            thisWeek: [],
            earlier: [],
        };

        conversations.forEach(conv => {
            const dateObj = conv.updatedAt ? new Date(conv.updatedAt) : new Date();
            const validDate = isNaN(dateObj.getTime()) ? new Date() : dateObj;
            const groupKey = getConversationGroup(validDate, todayStart, startOfWeek, yesterdayStart);
            groups[groupKey].push({
                ...conv,
                _time: validDate,
                _timeText: formatConversationTimestamp(validDate, todayStart, yesterdayStart),
            });
        });

        const groupOrder = [
            { key: 'today', label: 'Today' },
            { key: 'yesterday', label: 'Yesterday' },
            { key: 'thisWeek', label: 'This week' },
            { key: 'earlier', label: 'Earlier' },
        ];

        const fragment = document.createDocumentFragment();
        let rendered = false;

        groupOrder.forEach(({ key, label }) => {
            const items = groups[key];
            if (!items || items.length === 0) {
                return;
            }
            rendered = true;

            const section = document.createElement('div');
            section.className = 'conversation-group';

            const title = document.createElement('div');
            title.className = 'conversation-group-title';
            title.textContent = label;
            section.appendChild(title);

            items.forEach(itemData => {
                // Determine if pinned
                const isPinned = itemData.pinned || false;
                section.appendChild(createConversationListItemWithMenu(itemData, isPinned));
            });

            fragment.appendChild(section);
        });

        if (!rendered) {
            listContainer.innerHTML = emptyStateHtml;
            return;
        }

        listContainer.appendChild(fragment);
        updateActiveConversation();
        
        // Restore scroll position
        if (sidebarContent) {
            // Use requestAnimationFrame to ensure DOM has been updated
            requestAnimationFrame(() => {
                sidebarContent.scrollTop = savedScrollTop;
            });
        }
    } catch (error) {
        console.error('Failed to load conversation list:', error);
        // On error, show empty state rather than error prompt (better user experience)
        const listContainer = document.getElementById('conversations-list');
        if (listContainer) {
            const emptyStateHtml = '<div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 0.875rem;">No conversation history</div>';
            listContainer.innerHTML = emptyStateHtml;
        }
    }
}

function createConversationListItem(conversation) {
    const item = document.createElement('div');
    item.className = 'conversation-item';
    item.dataset.conversationId = conversation.id;
    if (conversation.id === currentConversationId) {
        item.classList.add('active');
    }

    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'conversation-content';

    const title = document.createElement('div');
    title.className = 'conversation-title';
    const titleText = conversation.title || 'Unnamed conversation';
    title.textContent = safeTruncateText(titleText, 60);
    title.title = titleText; // Set full title for hover view
    contentWrapper.appendChild(title);

    const time = document.createElement('div');
    time.className = 'conversation-time';
    time.textContent = conversation._timeText || formatConversationTimestamp(conversation._time || new Date());
    contentWrapper.appendChild(time);

    item.appendChild(contentWrapper);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'conversation-delete-btn';
    deleteBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14zM10 11v6M14 11v6" 
                  stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
    `;
    deleteBtn.title = 'Delete conversation';
    deleteBtn.onclick = (e) => {
        e.stopPropagation();
        deleteConversation(conversation.id);
    };
    item.appendChild(deleteBtn);

    item.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        loadConversation(conversation.id);
    };
    return item;
}

// Handle history search
let conversationSearchTimer = null;
function handleConversationSearch(query) {
    // Debounce to avoid frequent requests
    if (conversationSearchTimer) {
        clearTimeout(conversationSearchTimer);
    }
    
    const searchInput = document.getElementById('conversation-search-input');
    const clearBtn = document.getElementById('conversation-search-clear');
    
    if (clearBtn) {
        if (query && query.trim()) {
            clearBtn.style.display = 'block';
        } else {
            clearBtn.style.display = 'none';
        }
    }
    
    conversationSearchTimer = setTimeout(() => {
        loadConversations(query);
    }, 300); // 300ms debounce delay
}

// Clear search
function clearConversationSearch() {
    const searchInput = document.getElementById('conversation-search-input');
    const clearBtn = document.getElementById('conversation-search-clear');
    
    if (searchInput) {
        searchInput.value = '';
    }
    if (clearBtn) {
        clearBtn.style.display = 'none';
    }
    
    loadConversations('');
}

function formatConversationTimestamp(dateObj, todayStart, yesterdayStart) {
    if (!(dateObj instanceof Date) || isNaN(dateObj.getTime())) {
        return '';
    }
    // If todayStart is not provided, use current date as reference
    const now = new Date();
    const referenceToday = todayStart || new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const referenceYesterday = yesterdayStart || new Date(referenceToday.getTime() - 24 * 60 * 60 * 1000);
    const messageDate = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());

    if (messageDate.getTime() === referenceToday.getTime()) {
        return dateObj.toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit'
        });
    }
    if (messageDate.getTime() === referenceYesterday.getTime()) {
        return 'Yesterday ' + dateObj.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit'
        });
    }
    if (dateObj.getFullYear() === referenceToday.getFullYear()) {
        return dateObj.toLocaleString('zh-CN', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }
    return dateObj.toLocaleString('zh-CN', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getConversationGroup(dateObj, todayStart, startOfWeek, yesterdayStart) {
    if (!(dateObj instanceof Date) || isNaN(dateObj.getTime())) {
        return 'earlier';
    }
    const today = new Date(todayStart.getFullYear(), todayStart.getMonth(), todayStart.getDate());
    const yesterday = new Date(yesterdayStart.getFullYear(), yesterdayStart.getMonth(), yesterdayStart.getDate());
    const messageDay = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());

    if (messageDay.getTime() === today.getTime() || messageDay > today) {
        return 'today';
    }
    if (messageDay.getTime() === yesterday.getTime()) {
        return 'yesterday';
    }
    if (messageDay >= startOfWeek && messageDay < today) {
        return 'thisWeek';
    }
    return 'earlier';
}

// Load conversation
async function loadConversation(conversationId) {
    try {
        const response = await apiFetch(`/api/conversations/${conversationId}`);
        const conversation = await response.json();
        
        if (!response.ok) {
            alert('Failed to load conversation: ' + (conversation.error || 'Unknown error'));
            return;
        }
        
        // If currently on group detail page, switch to conversation view
        // Exit group detail mode, show all recent conversations for better UX
        if (currentGroupId) {
            const sidebar = document.querySelector('.conversation-sidebar');
            const groupDetailPage = document.getElementById('group-detail-page');
            const chatContainer = document.querySelector('.chat-container');
            
            // Ensure sidebar is always visible
            if (sidebar) sidebar.style.display = 'flex';
            // Hide group detail page, show conversation view
            if (groupDetailPage) groupDetailPage.style.display = 'none';
            if (chatContainer) chatContainer.style.display = 'flex';
            
            // Exit group detail mode so recent conversation list shows all conversations
            // User can see all conversations in sidebar for easy switching
            const previousGroupId = currentGroupId;
            currentGroupId = null;
            
            // Refresh recent conversation list to show all conversations (including grouped ones)
            loadConversationsWithGroups();
        }
        
        // Get the group ID the current conversation belongs to (for highlight display)
        // Ensure group mapping is loaded
        if (Object.keys(conversationGroupMappingCache).length === 0) {
            await loadConversationGroupMapping();
        }
        currentConversationGroupId = conversationGroupMappingCache[conversationId] || null;
        
        // Regardless of group detail page, refresh group list to ensure highlight state is correct
        // This clears previous group highlight state, ensuring UI state consistency
        await loadGroups();
        
        // Update current conversation ID
        currentConversationId = conversationId;
        updateActiveConversation();
        
        // If attack chain modal is open and showing a different conversation, close it
        const attackChainModal = document.getElementById('attack-chain-modal');
        if (attackChainModal && attackChainModal.style.display === 'block') {
            if (currentAttackChainConversationId !== conversationId) {
                closeAttackChainModal();
            }
        }
        
        // Clear message area
        const messagesDiv = document.getElementById('chat-messages');
        messagesDiv.innerHTML = '';
        
        // Check if there are recent messages in the conversation; if so, clear draft (avoid restoring already sent messages)
        let hasRecentUserMessage = false;
        if (conversation.messages && conversation.messages.length > 0) {
            const lastMessage = conversation.messages[conversation.messages.length - 1];
            if (lastMessage && lastMessage.role === 'user') {
                // Check message time; if within the last 30 seconds, clear draft
                const messageTime = new Date(lastMessage.createdAt);
                const now = new Date();
                const timeDiff = now.getTime() - messageTime.getTime();
                if (timeDiff < 30000) { // Within 30 seconds
                    hasRecentUserMessage = true;
                }
            }
        }
        if (hasRecentUserMessage) {
            // If there are recently sent user messages, clear draft
            clearChatDraft();
            const chatInput = document.getElementById('chat-input');
            if (chatInput) {
                chatInput.value = '';
                adjustTextareaHeight(chatInput);
            }
        }
        
        // Load messages
        if (conversation.messages && conversation.messages.length > 0) {
            conversation.messages.forEach(msg => {
                // Check if message content is "Processing..."; if so, check processDetails for error or cancel events
                let displayContent = msg.content;
                if (msg.role === 'assistant' && msg.content === 'Processing...' && msg.processDetails && msg.processDetails.length > 0) {
                    // Find the last error or cancelled event
                    for (let i = msg.processDetails.length - 1; i >= 0; i--) {
                        const detail = msg.processDetails[i];
                        if (detail.eventType === 'error' || detail.eventType === 'cancelled') {
                            displayContent = detail.message || msg.content;
                            break;
                        }
                    }
                }
                
                // Pass message creation time
                const messageId = addMessage(msg.role, displayContent, msg.mcpExecutionIds || [], null, msg.createdAt);
                // For assistant messages, always render process details (show expand details button even without processDetails)
                if (msg.role === 'assistant') {
                    // Slight delay to ensure message has rendered
                    setTimeout(() => {
                        renderProcessDetails(messageId, msg.processDetails || []);
                        // If there are process details, check for error or cancel events; if found, ensure details are collapsed by default
                        if (msg.processDetails && msg.processDetails.length > 0) {
                            const hasErrorOrCancelled = msg.processDetails.some(d => 
                                d.eventType === 'error' || d.eventType === 'cancelled'
                            );
                            if (hasErrorOrCancelled) {
                                collapseAllProgressDetails(messageId, null);
                            }
                        }
                    }, 100);
                }
            });
        } else {
            addMessage('assistant', 'System ready. Please enter your testing requirements; the system will automatically execute the corresponding security tests.');
        }
        
        // Scroll to bottom
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
        
        // Add attack chain button
        addAttackChainButton(conversationId);
        
        // Refresh conversation list
        loadConversations();
    } catch (error) {
        console.error('Failed to load conversation:', error);
        alert('Failed to load conversation: ' + error.message);
    }
}

// Delete conversation
async function deleteConversation(conversationId, skipConfirm = false) {
    // Confirm deletion (if caller has not skipped confirmation)
    if (!skipConfirm) {
        if (!confirm('Are you sure you want to delete this conversation? This action cannot be undone.')) {
            return;
        }
    }
    
    try {
        const response = await apiFetch(`/api/conversations/${conversationId}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Delete failed');
        }
        
        // If the deleted conversation is the current one, clear the conversation view
        if (conversationId === currentConversationId) {
            currentConversationId = null;
            document.getElementById('chat-messages').innerHTML = '';
            addMessage('assistant', 'System ready. Please enter your testing requirements; the system will automatically execute the corresponding security tests.');
            addAttackChainButton(null);
        }
        
        // Update cache - delete immediately to ensure correct identification on subsequent loads
        delete conversationGroupMappingCache[conversationId];
        // Also remove from pending-preserve mapping
        delete pendingGroupMappings[conversationId];
        
        // If currently on group detail page, reload group conversations
        if (currentGroupId) {
            await loadGroupConversations(currentGroupId);
        }
        
        // Refresh conversation list
        loadConversations();
    } catch (error) {
        console.error('Failed to delete conversation:', error);
        alert('Failed to delete conversation: ' + error.message);
    }
}

// Update active conversation style
function updateActiveConversation() {
    document.querySelectorAll('.conversation-item').forEach(item => {
        item.classList.remove('active');
        if (currentConversationId && item.dataset.conversationId === currentConversationId) {
            item.classList.add('active');
        }
    });
}

// ==================== Attack chain visualization functionality ====================

let attackChainCytoscape = null;
let currentAttackChainConversationId = null;
// Manage loading state by conversation ID for decoupling between conversations
const attackChainLoadingMap = new Map(); // Map<conversationId, boolean>

// Check if a specified conversation is loading
function isAttackChainLoading(conversationId) {
    return attackChainLoadingMap.get(conversationId) === true;
}

// Set the loading state of a specified conversation
function setAttackChainLoading(conversationId, loading) {
    if (loading) {
        attackChainLoadingMap.set(conversationId, true);
    } else {
        attackChainLoadingMap.delete(conversationId);
    }
}

// Add attack chain button (moved to menu; this function is retained for compatibility but no longer shows a top button)
function addAttackChainButton(conversationId) {
    // Attack chain button moved to three-dot menu; no longer need to show top button
    // This function is retained for code compatibility but no longer does anything
    const conversationHeader = document.getElementById('conversation-header');
    if (conversationHeader) {
        conversationHeader.style.display = 'none';
    }
}

function updateAttackChainAvailability() {
    addAttackChainButton(currentConversationId);
}

// Show attack chain modal
async function showAttackChain(conversationId) {
    // If the displayed conversation ID is different or not loading, allow opening
    // If loading the same conversation, also allow opening (show loading state)
    if (isAttackChainLoading(conversationId) && currentAttackChainConversationId === conversationId) {
        // If modal is already open showing the same conversation, do not open again
        const modal = document.getElementById('attack-chain-modal');
        if (modal && modal.style.display === 'block') {
            console.log('Attack chain loading in progress, modal already open');
            return;
        }
    }
    
    currentAttackChainConversationId = conversationId;
    const modal = document.getElementById('attack-chain-modal');
    if (!modal) {
        console.error('Attack chain modal not found');
        return;
    }
    
    modal.style.display = 'block';
    
    // Clear container
    const container = document.getElementById('attack-chain-container');
    if (container) {
        container.innerHTML = '<div class="loading-spinner">Loading...</div>';
    }
    
    // Hide detail panel
    const detailsPanel = document.getElementById('attack-chain-details');
    if (detailsPanel) {
        detailsPanel.style.display = 'none';
    }
    
    // Disable regenerate button
    const regenerateBtn = document.querySelector('button[onclick="regenerateAttackChain()"]');
    if (regenerateBtn) {
        regenerateBtn.disabled = true;
        regenerateBtn.style.opacity = '0.5';
        regenerateBtn.style.cursor = 'not-allowed';
    }
    
    // Load attack chain data
    await loadAttackChain(conversationId);
}

// Load attack chain data
async function loadAttackChain(conversationId) {
    if (isAttackChainLoading(conversationId)) {
        return; // Prevent duplicate calls
    }
    
    setAttackChainLoading(conversationId, true);
    
    try {
        const response = await apiFetch(`/api/attack-chain/${conversationId}`);
        
        if (!response.ok) {
            // Handle 409 Conflict (generation in progress)
            if (response.status === 409) {
                const error = await response.json();
                const container = document.getElementById('attack-chain-container');
                if (container) {
                    container.innerHTML = `
                        <div style="text-align: center; padding: 28px 24px; color: var(--text-secondary);">
                            <div style="display: inline-flex; align-items: center; gap: 8px; font-size: 0.95rem; color: var(--text-primary);">
                                <span role="presentation" aria-hidden="true">⏳</span>
                                <span>Attack chain generating, please wait</span>
                            </div>
                            <button class="btn-secondary" onclick="refreshAttackChain()" style="margin-top: 12px; font-size: 0.78rem; padding: 4px 12px;">
                                Refresh
                            </button>
                        </div>
                    `;
                }
                // Auto-refresh after 5 seconds (allow refresh but maintain loading state to prevent duplicate clicks)
                // Use closure to save conversationId to prevent cross-contamination
                setTimeout(() => {
                    // Check if currently displayed conversation ID matches
                    if (currentAttackChainConversationId === conversationId) {
                        refreshAttackChain();
                    }
                }, 5000);
                // In 409 case, maintain loading state to prevent duplicate clicks
                // But allow refreshAttackChain to call loadAttackChain to check status
                // Note: do not reset loading state; maintain loading state
                // Restore button state (although loading state is maintained, allow user to manually refresh)
                const regenerateBtn = document.querySelector('button[onclick="regenerateAttackChain()"]');
                if (regenerateBtn) {
                    regenerateBtn.disabled = false;
                    regenerateBtn.style.opacity = '1';
                    regenerateBtn.style.cursor = 'pointer';
                }
                return; // Early return, do not execute setAttackChainLoading(conversationId, false) in finally block
            }
            
            const error = await response.json();
            throw new Error(error.error || 'Failed to load attack chain');
        }
        
        const chainData = await response.json();
        
        // Check if currently displayed conversation ID matches to prevent cross-contamination
        if (currentAttackChainConversationId !== conversationId) {
            console.log('Attack chain data returned, but displayed conversation has switched; ignoring this render', {
                returned: conversationId,
                current: currentAttackChainConversationId
            });
            setAttackChainLoading(conversationId, false);
            return;
        }
        
        // Render attack chain
        renderAttackChain(chainData);
        
        // Update statistics
        updateAttackChainStats(chainData);
        
        // After successful load, reset loading state
        setAttackChainLoading(conversationId, false);
        
    } catch (error) {
        console.error('Failed to load attack chain:', error);
        const container = document.getElementById('attack-chain-container');
        if (container) {
            container.innerHTML = `<div class="error-message">Load failed: ${error.message}</div>`;
        }
        // Also reset loading state on error
        setAttackChainLoading(conversationId, false);
    } finally {
        // Restore regenerate button
        const regenerateBtn = document.querySelector('button[onclick="regenerateAttackChain()"]');
        if (regenerateBtn) {
            regenerateBtn.disabled = false;
            regenerateBtn.style.opacity = '1';
            regenerateBtn.style.cursor = 'pointer';
        }
    }
}

// Render attack chain
function renderAttackChain(chainData) {
    const container = document.getElementById('attack-chain-container');
    if (!container) {
        return;
    }
    
    // Clear container
    container.innerHTML = '';
    
    if (!chainData.nodes || chainData.nodes.length === 0) {
        container.innerHTML = '<div class="empty-message">No attack chain data available</div>';
        return;
    }
    
    // Calculate graph complexity (for dynamically adjusting layout and style)
    const nodeCount = chainData.nodes.length;
    const edgeCount = chainData.edges.length;
    const isComplexGraph = nodeCount > 15 || edgeCount > 25;
    
    // Optimize node labels: smart truncation and wrapping
    chainData.nodes.forEach(node => {
        if (node.label) {
            // Smart truncation: prefer truncating at punctuation marks or spaces
            const maxLength = isComplexGraph ? 18 : 22;
            if (node.label.length > maxLength) {
                let truncated = node.label.substring(0, maxLength);
                // Try to truncate at the last punctuation mark or space
                const lastPunct = Math.max(
                    truncated.lastIndexOf('，'),
                    truncated.lastIndexOf('。'),
                    truncated.lastIndexOf('、'),
                    truncated.lastIndexOf(' '),
                    truncated.lastIndexOf('/')
                );
                if (lastPunct > maxLength * 0.6) { // If punctuation position is reasonable
                    truncated = truncated.substring(0, lastPunct + 1);
                }
                node.label = truncated + '...';
            }
        }
    });
    
    // Prepare Cytoscape data
    const elements = [];
    
    // Add nodes, pre-calculate text color and border color, and prepare type label data
    chainData.nodes.forEach(node => {
        const riskScore = node.risk_score || 0;
        const nodeType = node.type || '';
        
        // Set type label text and identifier based on node type (using more modern design)
        let typeLabel = '';
        let typeBadge = '';
        let typeColor = '';
        if (nodeType === 'target') {
            typeLabel = 'Target';
            typeBadge = '○';  // Use hollow circle, more modern
            typeColor = '#1976d2';  // Blue
        } else if (nodeType === 'action') {
            typeLabel = 'Action';
            typeBadge = '▷';  // Use simpler triangle
            typeColor = '#f57c00';  // Orange
        } else if (nodeType === 'vulnerability') {
            typeLabel = 'Vulnerability';
            typeBadge = '◇';  // Use hollow diamond, more refined
            typeColor = '#d32f2f';  // Red
        } else {
            typeLabel = nodeType;
            typeBadge = '•';
            typeColor = '#666';
        }
        
        // Calculate text color and border color based on risk score
        let textColor, borderColor, textOutlineWidth, textOutlineColor;
        if (riskScore >= 80) {
            // Red background: white text, white border
            textColor = '#fff';
            borderColor = '#fff';
            textOutlineWidth = 1;
            textOutlineColor = '#333';
        } else if (riskScore >= 60) {
            // Orange background: white text, white border
            textColor = '#fff';
            borderColor = '#fff';
            textOutlineWidth = 1;
            textOutlineColor = '#333';
        } else if (riskScore >= 40) {
            // Yellow background: dark text, dark border
            textColor = '#333';
            borderColor = '#cc9900';
            textOutlineWidth = 2;
            textOutlineColor = '#fff';
        } else {
            // Green background: dark green text, dark border
            textColor = '#1a5a1a';
            borderColor = '#5a8a5a';
            textOutlineWidth = 2;
            textOutlineColor = '#fff';
        }
        
        // Save node data, using original label (type label will be added in style)
        elements.push({
            data: {
                id: node.id,
                label: node.label,  // Original label
                originalLabel: node.label,  // Save original label for search
                type: nodeType,
                typeLabel: typeLabel,  // Save type label text
                typeBadge: typeBadge,  // Save type identifier
                typeColor: typeColor,  // Save type color
                riskScore: riskScore,
                toolExecutionId: node.tool_execution_id || '',
                metadata: node.metadata || {},
                textColor: textColor,
                borderColor: borderColor,
                textOutlineWidth: textOutlineWidth,
                textOutlineColor: textOutlineColor
            }
        });
    });
    
    // Add edges (only add edges where both source and target nodes exist)
    const nodeIds = new Set(chainData.nodes.map(node => node.id));
    
    // Save valid edges for ELK layout
    const validEdges = [];
    chainData.edges.forEach(edge => {
        // Validate that source and target nodes exist
        if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
            validEdges.push(edge);
            elements.push({
                data: {
                    id: edge.id,
                    source: edge.source,
                    target: edge.target,
                    type: edge.type || 'leads_to',
                    weight: edge.weight || 1
                }
            });
        } else {
            console.warn('Skipping invalid edge: source or target node does not exist', {
                edgeId: edge.id,
                source: edge.source,
                target: edge.target,
                sourceExists: nodeIds.has(edge.source),
                targetExists: nodeIds.has(edge.target)
            });
        }
    });
    
    // Initialize Cytoscape
    attackChainCytoscape = cytoscape({
        container: container,
        elements: elements,
        style: [
            {
                selector: 'node',
                style: {
                    // Modern card design with clear visual hierarchy
                    'label': function(ele) {
                        const typeLabel = ele.data('typeLabel') || '';
                        const label = ele.data('label') || '';
                        // Clean two-line display: type label + content
                        return typeLabel + '\n' + label;
                    },
                    // Reasonable node dimensions
                    'width': function(ele) {
                        const type = ele.data('type');
                        if (type === 'target') return isComplexGraph ? 280 : 320;
                        if (type === 'vulnerability') return isComplexGraph ? 260 : 300;
                        return isComplexGraph ? 240 : 280;
                    },
                    'height': function(ele) {
                        const type = ele.data('type');
                        if (type === 'target') return isComplexGraph ? 100 : 120;
                        if (type === 'vulnerability') return isComplexGraph ? 90 : 110;
                        return isComplexGraph ? 80 : 100;
                    },
                    'shape': 'round-rectangle',
                    // Modern background: white card with left colored bar
                    'background-color': '#FFFFFF',
                    'background-opacity': 1,
                    // Left colored bar effect (implemented via border)
                    'border-width': function(ele) {
                        const type = ele.data('type');
                        return 0;  // No border, use background color block
                    },
                    'border-color': 'transparent',
                    // Text style: clear and readable
                    'color': '#2C3E50',  // Dark blue-grey, professional look
                    'font-size': function(ele) {
                        const type = ele.data('type');
                        if (type === 'target') return isComplexGraph ? '14px' : '16px';
                        if (type === 'vulnerability') return isComplexGraph ? '13px' : '15px';
                        return isComplexGraph ? '13px' : '15px';
                    },
                    'font-weight': '600',  // Medium bold
                    'font-family': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Microsoft YaHei", sans-serif',
                    'text-valign': 'center',
                    'text-halign': 'center',
                    'text-wrap': 'wrap',
                    'text-max-width': function(ele) {
                        const type = ele.data('type');
                        if (type === 'target') return isComplexGraph ? '240px' : '280px';
                        if (type === 'vulnerability') return isComplexGraph ? '220px' : '260px';
                        return isComplexGraph ? '200px' : '240px';
                    },
                    'text-overflow-wrap': 'anywhere',
                    'text-margin-y': 4,
                    'padding': '12px 16px',  // Reasonable inner padding
                    'line-height': 1.5,
                    'text-outline-width': 0
                }
            },
            {
                // Target node: blue theme
                selector: 'node[type = "target"]',
                style: {
                    'background-color': '#E3F2FD',
                    'color': '#1565C0',
                    'border-width': 3,
                    'border-color': '#2196F3',
                    'border-style': 'solid'
                }
            },
            {
                // Action node: show different colors based on status
                selector: 'node[type = "action"]',
                style: {
                    'background-color': function(ele) {
                        const metadata = ele.data('metadata') || {};
                        const findings = metadata.findings || [];
                        const status = metadata.status || '';
                        const hasFindings = Array.isArray(findings) && findings.length > 0;
                        const isFailedInsight = status === 'failed_insight';
                        
                        if (hasFindings && !isFailedInsight) {
                            return '#E8F5E9';  // Light green background
                        } else {
                            return '#F5F5F5';  // Light grey background
                        }
                    },
                    'color': '#424242',
                    'border-width': 2,
                    'border-color': function(ele) {
                        const metadata = ele.data('metadata') || {};
                        const findings = metadata.findings || [];
                        const status = metadata.status || '';
                        const hasFindings = Array.isArray(findings) && findings.length > 0;
                        const isFailedInsight = status === 'failed_insight';
                        
                        if (hasFindings && !isFailedInsight) {
                            return '#4CAF50';  // Green border
                        } else {
                            return '#9E9E9E';  // Grey border
                        }
                    },
                    'border-style': 'solid'
                }
            },
            {
                // Vulnerability node: show colors based on risk level
                selector: 'node[type = "vulnerability"]',
                style: {
                    'background-color': function(ele) {
                        const riskScore = ele.data('riskScore') || 0;
                        if (riskScore >= 80) return '#FFEBEE';
                        if (riskScore >= 60) return '#FFF3E0';
                        if (riskScore >= 40) return '#FFFDE7';
                        return '#E8F5E9';
                    },
                    'color': function(ele) {
                        const riskScore = ele.data('riskScore') || 0;
                        if (riskScore >= 80) return '#C62828';
                        if (riskScore >= 60) return '#E65100';
                        if (riskScore >= 40) return '#F57C00';
                        return '#2E7D32';
                    },
                    'border-width': 3,
                    'border-color': function(ele) {
                        const riskScore = ele.data('riskScore') || 0;
                        if (riskScore >= 80) return '#F44336';
                        if (riskScore >= 60) return '#FF9800';
                        if (riskScore >= 40) return '#FFC107';
                        return '#4CAF50';
                    },
                    'border-style': 'solid'
                }
            },
            {
                selector: 'edge',
                style: {
                    // Clean and clear connection lines
                    'width': function(ele) {
                        const type = ele.data('type');
                        if (type === 'discovers') return 2.5;  // Slightly thicker for discovering vulnerabilities
                        if (type === 'enables') return 2.5;  // Slightly thicker for enable relationships
                        return 2;  // Normal edge
                    },
                    'line-color': function(ele) {
                        const type = ele.data('type');
                        if (type === 'discovers') return '#42A5F5';  // Blue
                        if (type === 'targets') return '#42A5F5';  // Blue
                        if (type === 'enables') return '#EF5350';  // Red
                        if (type === 'leads_to') return '#90A4AE';  // Blue-grey
                        return '#B0BEC5';
                    },
                    'target-arrow-color': function(ele) {
                        const type = ele.data('type');
                        if (type === 'discovers') return '#42A5F5';
                        if (type === 'targets') return '#42A5F5';
                        if (type === 'enables') return '#EF5350';
                        if (type === 'leads_to') return '#90A4AE';
                        return '#B0BEC5';
                    },
                    'target-arrow-shape': 'triangle',
                    'arrow-scale': 1.2,  // Moderate arrow size
                    'curve-style': 'straight',
                    'opacity': 0.7,  // Moderate opacity
                    'line-style': function(ele) {
                        const type = ele.data('type');
                        if (type === 'targets') return 'dashed';
                        return 'solid';
                    },
                    'line-dash-pattern': function(ele) {
                        const type = ele.data('type');
                        if (type === 'targets') return [8, 4];
                        return [];
                    }
                }
            },
            {
                selector: 'node:selected',
                style: {
                    'border-width': 5,
                    'border-color': '#0066ff',
                    'z-index': 999,
                    'opacity': 1,
                    'overlay-opacity': 0.1,
                    'overlay-color': '#0066ff'
                }
            }
        ],
        userPanningEnabled: true,
        userZoomingEnabled: true,
        boxSelectionEnabled: true
    });
    
    // Use ELK layout (high-quality DAG layout, reduces edge crossings)
    let layoutOptions = {
        name: 'breadthfirst',
        directed: true,
        spacingFactor: isComplexGraph ? 3.0 : 2.5,
        padding: 40
    };
    
    // Use ELK.js for layout calculation
    // elk.bundled.js exposes the ELK object; can use new ELK() directly
    let elkInstance = null;
    if (typeof ELK !== 'undefined') {
        try {
            elkInstance = new ELK();
        } catch (e) {
            console.warn('ELK initialization failed:', e);
        }
    }
    
    if (elkInstance) {
        try {
            
            // Build ELK graph structure
            const elkGraph = {
                id: 'root',
                layoutOptions: {
                    'elk.algorithm': 'layered',
                    'elk.direction': 'DOWN',
                    'elk.spacing.nodeNode': String(isComplexGraph ? 100 : 120),  // Reasonable node spacing
                    'elk.spacing.edgeNode': '50',  // Reasonable edge-to-node spacing
                    'elk.spacing.edgeEdge': '25',  // Reasonable edge spacing
                    'elk.layered.spacing.nodeNodeBetweenLayers': String(isComplexGraph ? 150 : 180),  // Reasonable layer spacing
                    'elk.layered.nodePlacement.strategy': 'SIMPLE',  // Use simple strategy for more spread-out layout
                    'elk.layered.crossingMinimization.strategy': 'INTERACTIVE',  // Interactive crossing minimization
                    'elk.layered.thoroughness': '10',  // Maximum optimization level
                    'elk.layered.spacing.edgeNodeBetweenLayers': '50',
                    'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
                    'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
                    'elk.layered.crossingMinimization.forceNodeModelOrder': 'true',
                    'elk.layered.cycleBreaking.strategy': 'GREEDY',
                    'elk.layered.thoroughness': '7',
                    'elk.padding': '[top=60,left=100,bottom=60,right=100]',  // Larger left/right padding for more spread-out graph
                    'elk.spacing.componentComponent': String(isComplexGraph ? 100 : 120)  // Component spacing
                },
                children: chainData.nodes.map(node => {
                    const type = node.type || '';
                    return {
                        id: node.id,
                        width: type === 'target' ? (isComplexGraph ? 280 : 320) : 
                               type === 'vulnerability' ? (isComplexGraph ? 260 : 300) : 
                               (isComplexGraph ? 240 : 280),
                        height: type === 'target' ? (isComplexGraph ? 100 : 120) : 
                                type === 'vulnerability' ? (isComplexGraph ? 90 : 110) : 
                                (isComplexGraph ? 80 : 100)
                    };
                }),
                edges: validEdges.map(edge => ({
                    id: edge.id,
                    sources: [edge.source],
                    targets: [edge.target]
                }))
            };
            
            // Use ELK to calculate layout
            elkInstance.layout(elkGraph).then(laidOutGraph => {
                // Apply ELK-calculated layout to Cytoscape nodes
                if (laidOutGraph && laidOutGraph.children) {
                    laidOutGraph.children.forEach(elkNode => {
                        const cyNode = attackChainCytoscape.getElementById(elkNode.id);
                        if (cyNode && elkNode.x !== undefined && elkNode.y !== undefined) {
                            cyNode.position({
                                x: elkNode.x + (elkNode.width || 0) / 2,
                                y: elkNode.y + (elkNode.height || 0) / 2
                            });
                        }
                    });
                    
                    // After layout completes, center the graph
                    setTimeout(() => {
                        centerAttackChain();
                    }, 150);
                } else {
                    throw new Error('ELK layout returned invalid result');
                }
            }).catch(err => {
                console.warn('ELK layout calculation failed, using default layout:', err);
                // Fall back to default layout
                const layout = attackChainCytoscape.layout(layoutOptions);
                layout.one('layoutstop', () => {
                    setTimeout(() => {
                        centerAttackChain();
                    }, 100);
                });
                layout.run();
            });
        } catch (e) {
            console.warn('ELK layout initialization failed, using default layout:', e);
            // Fall back to default layout
            const layout = attackChainCytoscape.layout(layoutOptions);
            layout.one('layoutstop', () => {
                setTimeout(() => {
                    centerAttackChain();
                }, 100);
            });
            layout.run();
        }
    } else {
        console.warn('ELK.js not loaded, using default layout. Please check if elkjs library is correctly loaded.');
        // Use default layout
        const layout = attackChainCytoscape.layout(layoutOptions);
        layout.one('layoutstop', () => {
            setTimeout(() => {
                centerAttackChain();
            }, 100);
        });
        layout.run();
    }
    
    // Function to center the attack chain
    function centerAttackChain() {
        try {
            if (!attackChainCytoscape) {
                return;
            }
            
            const container = attackChainCytoscape.container();
            if (!container) {
                return;
            }
            
            const containerWidth = container.offsetWidth;
            const containerHeight = container.offsetHeight;
            
            if (containerWidth === 0 || containerHeight === 0) {
                // If container size is 0, retry with delay
                setTimeout(centerAttackChain, 100);
                return;
            }
            
            // Center the graph while maintaining reasonable zoom
            const padding = 80;  // Margin
            attackChainCytoscape.fit(undefined, padding);
            
            // Wait for fit to complete before adjusting
            setTimeout(() => {
                const extent = attackChainCytoscape.extent();
                if (!extent || typeof extent.x1 === 'undefined' || typeof extent.x2 === 'undefined' || 
                    typeof extent.y1 === 'undefined' || typeof extent.y2 === 'undefined') {
                    return;
                }
                
                const graphWidth = extent.x2 - extent.x1;
                const graphHeight = extent.y2 - extent.y1;
                const currentZoom = attackChainCytoscape.zoom();
                
                // If graph is too small, zoom in appropriately
                const availableWidth = containerWidth - padding * 2;
                const availableHeight = containerHeight - padding * 2;
                const widthScale = graphWidth > 0 ? availableWidth / (graphWidth * currentZoom) : 1;
                const heightScale = graphHeight > 0 ? availableHeight / (graphHeight * currentZoom) : 1;
                const scale = Math.min(widthScale, heightScale);
                
                // Only adjust zoom within reasonable range (0.8x-1.3x)
                if (scale > 1 && scale < 1.3) {
                    attackChainCytoscape.zoom(currentZoom * scale);
                } else if (scale < 0.8) {
                    attackChainCytoscape.zoom(currentZoom * 0.8);
                }
                
                // Ensure graph is centered
                const graphCenterX = (extent.x1 + extent.x2) / 2;
                const graphCenterY = (extent.y1 + extent.y2) / 2;
                const zoom = attackChainCytoscape.zoom();
                const pan = attackChainCytoscape.pan();
                
                const graphCenterViewX = graphCenterX * zoom + pan.x;
                const graphCenterViewY = graphCenterY * zoom + pan.y;
                
                const desiredViewX = containerWidth / 2;
                const desiredViewY = containerHeight / 2;
                
                const deltaX = desiredViewX - graphCenterViewX;
                const deltaY = desiredViewY - graphCenterViewY;
                
                attackChainCytoscape.pan({
                    x: pan.x + deltaX,
                    y: pan.y + deltaY
                });
            }, 100);
        } catch (error) {
            console.warn('Error centering chart:', error);
        }
    }
    
    // Add click events
    attackChainCytoscape.on('tap', 'node', function(evt) {
        const node = evt.target;
        showNodeDetails(node.data());
    });
    
    // Add hover effects (using event listeners instead of CSS selectors)
    attackChainCytoscape.on('mouseover', 'node', function(evt) {
        const node = evt.target;
        node.style('border-width', 5);
        node.style('z-index', 998);
        node.style('overlay-opacity', 0.05);
        node.style('overlay-color', '#333333');
    });
    
    attackChainCytoscape.on('mouseout', 'node', function(evt) {
        const node = evt.target;
        const type = node.data('type');
        // Restore default border width
        const defaultBorderWidth = type === 'target' ? 5 : 4;
        node.style('border-width', defaultBorderWidth);
        node.style('z-index', 'auto');
        node.style('overlay-opacity', 0);
    });
    
    // Save original data for filtering
    window.attackChainOriginalData = chainData;
}

// Safely get source and target nodes of an edge
function getEdgeNodes(edge) {
    try {
        const source = edge.source();
        const target = edge.target();
        
        // Check if source and target nodes exist
        if (!source || !target || source.length === 0 || target.length === 0) {
            return { source: null, target: null, valid: false };
        }
        
        return { source: source, target: target, valid: true };
    } catch (error) {
        console.warn('Error getting edge nodes:', error, edge.id());
        return { source: null, target: null, valid: false };
    }
}

// Filter attack chain nodes (by search keyword)
function filterAttackChainNodes(searchText) {
    if (!attackChainCytoscape || !window.attackChainOriginalData) {
        return;
    }
    
    const searchLower = searchText.toLowerCase().trim();
    if (searchLower === '') {
        // Reset visibility of all nodes
        attackChainCytoscape.nodes().style('display', 'element');
        attackChainCytoscape.edges().style('display', 'element');
        // Restore default border
        attackChainCytoscape.nodes().style('border-width', 2);
        return;
    }
    
    // Filter nodes
    attackChainCytoscape.nodes().forEach(node => {
        // Use original label for search, excluding type label
        const originalLabel = node.data('originalLabel') || node.data('label') || '';
        const label = originalLabel.toLowerCase();
        const type = (node.data('type') || '').toLowerCase();
        const matches = label.includes(searchLower) || type.includes(searchLower);
        
        if (matches) {
            node.style('display', 'element');
            // Highlight matching nodes
            node.style('border-width', 4);
            node.style('border-color', '#0066ff');
        } else {
            node.style('display', 'none');
        }
    });
    
    // Hide edges without visible source or target nodes
    attackChainCytoscape.edges().forEach(edge => {
        const { source, target, valid } = getEdgeNodes(edge);
        if (!valid) {
            edge.style('display', 'none');
            return;
        }
        
        const sourceVisible = source.style('display') !== 'none';
        const targetVisible = target.style('display') !== 'none';
        if (sourceVisible && targetVisible) {
            edge.style('display', 'element');
        } else {
            edge.style('display', 'none');
        }
    });
    
    // Re-adjust view
    attackChainCytoscape.fit(undefined, 60);
}

// Filter attack chain nodes by type
function filterAttackChainByType(type) {
    if (!attackChainCytoscape || !window.attackChainOriginalData) {
        return;
    }
    
    if (type === 'all') {
        attackChainCytoscape.nodes().style('display', 'element');
        attackChainCytoscape.edges().style('display', 'element');
        attackChainCytoscape.nodes().style('border-width', 2);
        attackChainCytoscape.fit(undefined, 60);
        return;
    }
    
    // Filter nodes
    attackChainCytoscape.nodes().forEach(node => {
        const nodeType = node.data('type') || '';
        if (nodeType === type) {
            node.style('display', 'element');
        } else {
            node.style('display', 'none');
        }
    });
    
    // Hide edges without visible source or target nodes
    attackChainCytoscape.edges().forEach(edge => {
        const { source, target, valid } = getEdgeNodes(edge);
        if (!valid) {
            edge.style('display', 'none');
            return;
        }
        
        const sourceVisible = source.style('display') !== 'none';
        const targetVisible = target.style('display') !== 'none';
        if (sourceVisible && targetVisible) {
            edge.style('display', 'element');
        } else {
            edge.style('display', 'none');
        }
    });
    
    // Readjust view
    attackChainCytoscape.fit(undefined, 60);
}

// Filter attack chain nodes by risk level
function filterAttackChainByRisk(riskLevel) {
    if (!attackChainCytoscape || !window.attackChainOriginalData) {
        return;
    }
    
    if (riskLevel === 'all') {
        attackChainCytoscape.nodes().style('display', 'element');
        attackChainCytoscape.edges().style('display', 'element');
        attackChainCytoscape.nodes().style('border-width', 2);
        attackChainCytoscape.fit(undefined, 60);
        return;
    }
    
    // Define risk range
    const riskRanges = {
        'high': [80, 100],
        'medium-high': [60, 79],
        'medium': [40, 59],
        'low': [0, 39]
    };
    
    const [minRisk, maxRisk] = riskRanges[riskLevel] || [0, 100];
    
    // Filter nodes
    attackChainCytoscape.nodes().forEach(node => {
        const riskScore = node.data('riskScore') || 0;
        if (riskScore >= minRisk && riskScore <= maxRisk) {
            node.style('display', 'element');
        } else {
            node.style('display', 'none');
        }
    });
    
    // Hide edges with no visible source or target nodes
    attackChainCytoscape.edges().forEach(edge => {
        const { source, target, valid } = getEdgeNodes(edge);
        if (!valid) {
            edge.style('display', 'none');
            return;
        }
        
        const sourceVisible = source.style('display') !== 'none';
        const targetVisible = target.style('display') !== 'none';
        if (sourceVisible && targetVisible) {
            edge.style('display', 'element');
        } else {
            edge.style('display', 'none');
        }
    });
    
    // Readjust view
    attackChainCytoscape.fit(undefined, 60);
}

// Reset attack chain filters
function resetAttackChainFilters() {
    // Reset search box
    const searchInput = document.getElementById('attack-chain-search');
    if (searchInput) {
        searchInput.value = '';
    }
    
    // Reset type filter
    const typeFilter = document.getElementById('attack-chain-type-filter');
    if (typeFilter) {
        typeFilter.value = 'all';
    }
    
    // Reset risk filter
    const riskFilter = document.getElementById('attack-chain-risk-filter');
    if (riskFilter) {
        riskFilter.value = 'all';
    }
    
    // Reset visibility of all nodes
    if (attackChainCytoscape) {
        attackChainCytoscape.nodes().forEach(node => {
            node.style('display', 'element');
            node.style('border-width', 2); // Restore default border
        });
        attackChainCytoscape.edges().style('display', 'element');
        attackChainCytoscape.fit(undefined, 60);
    }
}

// Show node details
function showNodeDetails(nodeData) {
    const detailsPanel = document.getElementById('attack-chain-details');
    const detailsContent = document.getElementById('attack-chain-details-content');
    
    if (!detailsPanel || !detailsContent) {
        return;
    }
    
    // Use requestAnimationFrame to optimize display animation
    requestAnimationFrame(() => {
        detailsPanel.style.display = 'flex';
        // Set opacity in next frame to ensure smooth display animation
        requestAnimationFrame(() => {
            detailsPanel.style.opacity = '1';
        });
    });
    
    let html = `
        <div class="node-detail-item">
            <strong>Node ID:</strong> <code>${nodeData.id}</code>
        </div>
        <div class="node-detail-item">
            <strong>Type:</strong> ${getNodeTypeLabel(nodeData.type)}
        </div>
        <div class="node-detail-item">
            <strong>Label:</strong> ${escapeHtml(nodeData.originalLabel || nodeData.label)}
        </div>
        <div class="node-detail-item">
            <strong>Risk Score:</strong> ${nodeData.riskScore}/100
        </div>
    `;
    
    // Show action node information (tool execution + AI analysis)
    if (nodeData.type === 'action' && nodeData.metadata) {
        if (nodeData.metadata.tool_name) {
            html += `
                <div class="node-detail-item">
                    <strong>Tool Name:</strong> <code>${escapeHtml(nodeData.metadata.tool_name)}</code>
                </div>
            `;
        }
        if (nodeData.metadata.tool_intent) {
            html += `
                <div class="node-detail-item">
                    <strong>Tool Intent:</strong> <span style="color: #0066ff; font-weight: bold;">${escapeHtml(nodeData.metadata.tool_intent)}</span>
                </div>
            `;
        }
        if (nodeData.metadata.status === 'failed_insight') {
            html += `
                <div class="node-detail-item">
                    <strong>Execution Status:</strong> <span style="color: #ff9800; font-weight: bold;">Failed but has clues</span>
                </div>
            `;
        }
        if (nodeData.metadata.ai_analysis) {
            html += `
                <div class="node-detail-item">
                    <strong>AI Analysis:</strong> <div style="margin-top: 5px; padding: 8px; background: #f5f5f5; border-radius: 4px;">${escapeHtml(nodeData.metadata.ai_analysis)}</div>
                </div>
            `;
        }
        if (nodeData.metadata.findings && Array.isArray(nodeData.metadata.findings) && nodeData.metadata.findings.length > 0) {
            html += `
                <div class="node-detail-item">
                    <strong>Key Findings:</strong>
                    <ul style="margin: 5px 0; padding-left: 20px;">
                        ${nodeData.metadata.findings.map(f => `<li>${escapeHtml(f)}</li>`).join('')}
                    </ul>
                </div>
            `;
        }
    }
    
    // Show target information (if it is a target node)
    if (nodeData.type === 'target' && nodeData.metadata && nodeData.metadata.target) {
        html += `
            <div class="node-detail-item">
                <strong>Test Target:</strong> <code>${escapeHtml(nodeData.metadata.target)}</code>
            </div>
        `;
    }
    
    // Show vulnerability information (if it is a vulnerability node)
    if (nodeData.type === 'vulnerability' && nodeData.metadata) {
        if (nodeData.metadata.vulnerability_type) {
            html += `
                <div class="node-detail-item">
                    <strong>Vulnerability Type:</strong> ${escapeHtml(nodeData.metadata.vulnerability_type)}
                </div>
            `;
        }
        if (nodeData.metadata.description) {
            html += `
                <div class="node-detail-item">
                    <strong>Description:</strong> ${escapeHtml(nodeData.metadata.description)}
                </div>
            `;
        }
        if (nodeData.metadata.severity) {
            html += `
                <div class="node-detail-item">
                    <strong>Severity:</strong> <span style="color: ${getSeverityColor(nodeData.metadata.severity)}; font-weight: bold;">${escapeHtml(nodeData.metadata.severity)}</span>
                </div>
            `;
        }
        if (nodeData.metadata.location) {
            html += `
                <div class="node-detail-item">
                    <strong>Location:</strong> <code>${escapeHtml(nodeData.metadata.location)}</code>
                </div>
            `;
        }
    }
    
    if (nodeData.toolExecutionId) {
        html += `
            <div class="node-detail-item">
                <strong>Tool Execution ID:</strong> <code>${nodeData.toolExecutionId}</code>
            </div>
        `;
    }
    
    // First reset scroll position to avoid scroll calculation during content update
    if (detailsContent) {
        detailsContent.scrollTop = 0;
    }
    
    // Use requestAnimationFrame to optimize DOM update and scrolling
    requestAnimationFrame(() => {
        // Update content
        detailsContent.innerHTML = html;
        
        // Execute scrolling in the next frame to avoid conflict with DOM update
        requestAnimationFrame(() => {
            // Reset scroll position of detail content area
            if (detailsContent) {
                detailsContent.scrollTop = 0;
            }
            
            // Reset sidebar scroll position to ensure detail area is visible
            const sidebar = document.querySelector('.attack-chain-sidebar-content');
            if (sidebar) {
                // Find the position of the detail panel
                const detailsPanel = document.getElementById('attack-chain-details');
                if (detailsPanel && detailsPanel.offsetParent !== null) {
                    // Use getBoundingClientRect to get position, better performance
                    const detailsRect = detailsPanel.getBoundingClientRect();
                    const sidebarRect = sidebar.getBoundingClientRect();
                    const scrollTop = sidebar.scrollTop;
                    const relativeTop = detailsRect.top - sidebarRect.top + scrollTop;
                    sidebar.scrollTop = relativeTop - 20; // Leave a small margin
                }
            }
        });
    });
}

// Get severity color
function getSeverityColor(severity) {
    const colors = {
        'critical': '#ff0000',
        'high': '#ff4444',
        'medium': '#ff8800',
        'low': '#ffbb00'
    };
    return colors[severity.toLowerCase()] || '#666';
}

// Get node type label
function getNodeTypeLabel(type) {
    const labels = {
        'action': 'Action',
        'vulnerability': 'Vulnerability',
        'target': 'Target'
    };
    return labels[type] || type;
}

// Update statistics
function updateAttackChainStats(chainData) {
    const statsElement = document.getElementById('attack-chain-stats');
    if (statsElement) {
        const nodeCount = chainData.nodes ? chainData.nodes.length : 0;
        const edgeCount = chainData.edges ? chainData.edges.length : 0;
        statsElement.textContent = `Nodes: ${nodeCount} | Edges: ${edgeCount}`;
    }
}

// Close node details
function closeNodeDetails() {
    const detailsPanel = document.getElementById('attack-chain-details');
    if (detailsPanel) {
        // Add fade-out animation
        detailsPanel.style.opacity = '0';
        detailsPanel.style.maxHeight = detailsPanel.scrollHeight + 'px';
        
        setTimeout(() => {
            detailsPanel.style.display = 'none';
            detailsPanel.style.maxHeight = '';
            detailsPanel.style.opacity = '';
        }, 300);
    }
    
    // Deselect node
    if (attackChainCytoscape) {
        attackChainCytoscape.elements().unselect();
    }
}

// Close attack chain modal
function closeAttackChainModal() {
    const modal = document.getElementById('attack-chain-modal');
    if (modal) {
        modal.style.display = 'none';
    }
    
    // Close node details
    closeNodeDetails();
    
    // Clean up Cytoscape instance
    if (attackChainCytoscape) {
        attackChainCytoscape.destroy();
        attackChainCytoscape = null;
    }
    
    currentAttackChainConversationId = null;
}

// Refresh attack chain (reload)
// Note: this function can be called during loading to check generation status
function refreshAttackChain() {
    if (currentAttackChainConversationId) {
        // Temporarily allow refresh even while loading (to check generation status)
        const wasLoading = isAttackChainLoading(currentAttackChainConversationId);
        setAttackChainLoading(currentAttackChainConversationId, false); // Temporarily reset to allow refresh
        loadAttackChain(currentAttackChainConversationId).finally(() => {
            // If previously loading (409 case), restore loading state
            // Otherwise keep false (normal completion)
            if (wasLoading) {
                // Check if loading state still needs to be maintained (if still 409, it will be handled in loadAttackChain)
                // Here we assume if loaded successfully, reset the state
                // If still 409, loadAttackChain will maintain loading state
            }
        });
    }
}

// Regenerate attack chain
async function regenerateAttackChain() {
    if (!currentAttackChainConversationId) {
        return;
    }
    
    // Prevent duplicate clicks (only check loading state of current conversation)
    if (isAttackChainLoading(currentAttackChainConversationId)) {
        console.log('Attack chain is generating, please wait...');
        return;
    }
    
    // Save conversation ID at time of request to prevent cross-contamination
    const savedConversationId = currentAttackChainConversationId;
    setAttackChainLoading(savedConversationId, true);
    
    const container = document.getElementById('attack-chain-container');
    if (container) {
        container.innerHTML = '<div class="loading-spinner">Regenerating...</div>';
    }
    
    // Disable regenerate button
    const regenerateBtn = document.querySelector('button[onclick="regenerateAttackChain()"]');
    if (regenerateBtn) {
        regenerateBtn.disabled = true;
        regenerateBtn.style.opacity = '0.5';
        regenerateBtn.style.cursor = 'not-allowed';
    }
    
    try {
        // Call regenerate API
        const response = await apiFetch(`/api/attack-chain/${savedConversationId}/regenerate`, {
            method: 'POST'
        });
        
        if (!response.ok) {
            // Handle 409 Conflict (generation in progress)
            if (response.status === 409) {
                const error = await response.json();
                if (container) {
                    container.innerHTML = `
                        <div class="loading-spinner" style="text-align: center; padding: 40px;">
                            <div style="margin-bottom: 16px;">⏳ Attack chain generating...</div>
                            <div style="color: var(--text-secondary); font-size: 0.875rem;">
                                Please wait; will display automatically when generation is complete
                            </div>
                            <button class="btn-secondary" onclick="refreshAttackChain()" style="margin-top: 16px;">
                                Refresh to view progress
                            </button>
                        </div>
                    `;
                }
                // Auto-refresh after 5 seconds
                // savedConversationId was defined at the start of the function
                setTimeout(() => {
                    // Check if currently displayed conversation ID matches and is still loading
                    if (currentAttackChainConversationId === savedConversationId && 
                        isAttackChainLoading(savedConversationId)) {
                        refreshAttackChain();
                    }
                }, 5000);
                return;
            }
            
            const error = await response.json();
            throw new Error(error.error || 'Regeneration of attack chain failed');
        }
        
        const chainData = await response.json();
        
        // Check if currently displayed conversation ID matches to prevent cross-contamination
        if (currentAttackChainConversationId !== savedConversationId) {
            console.log('Attack chain data returned, but displayed conversation has switched; ignoring this render', {
                returned: savedConversationId,
                current: currentAttackChainConversationId
            });
            setAttackChainLoading(savedConversationId, false);
            return;
        }
        
        // Render attack chain
        renderAttackChain(chainData);
        
        // Update statistics
        updateAttackChainStats(chainData);
        
    } catch (error) {
        console.error('Regeneration of attack chain failed:', error);
        if (container) {
            container.innerHTML = `<div class="error-message">Regeneration failed: ${error.message}</div>`;
        }
    } finally {
        setAttackChainLoading(savedConversationId, false);
        
        // Restore regenerate button
        if (regenerateBtn) {
            regenerateBtn.disabled = false;
            regenerateBtn.style.opacity = '1';
            regenerateBtn.style.cursor = 'pointer';
        }
    }
}

// Export attack chain
function exportAttackChain(format) {
    if (!attackChainCytoscape) {
        alert('Please load the attack chain first');
        return;
    }
    
    // Ensure graph has finished rendering (using small delay)
    setTimeout(() => {
        try {
            if (format === 'png') {
                try {
                    const pngPromise = attackChainCytoscape.png({
                        output: 'blob',
                        bg: 'white',
                        full: true,
                        scale: 1
                    });
                    
                    // Handle Promise
                    if (pngPromise && typeof pngPromise.then === 'function') {
                        pngPromise.then(blob => {
                            if (!blob) {
                                throw new Error('PNG export returned empty data');
                            }
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `attack-chain-${currentAttackChainConversationId || 'export'}-${Date.now()}.png`;
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            setTimeout(() => URL.revokeObjectURL(url), 100);
                        }).catch(err => {
                            console.error('PNG export failed:', err);
                            alert('PNG export failed: ' + (err.message || 'Unknown error'));
                        });
                    } else {
                        // If not a Promise, use directly
                        const url = URL.createObjectURL(pngPromise);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `attack-chain-${currentAttackChainConversationId || 'export'}-${Date.now()}.png`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        setTimeout(() => URL.revokeObjectURL(url), 100);
                    }
                } catch (err) {
                    console.error('PNG export error:', err);
                    alert('PNG export failed: ' + (err.message || 'Unknown error'));
                }
            } else if (format === 'svg') {
                try {
                    // Cytoscape.js 3.x does not directly support .svg() method
                    // Use alternative: manually build SVG from Cytoscape data
                    const container = attackChainCytoscape.container();
                    if (!container) {
                        throw new Error('Cannot get container element');
                    }
                    
                    // Get all nodes and edges
                    const nodes = attackChainCytoscape.nodes();
                    const edges = attackChainCytoscape.edges();
                    
                    if (nodes.length === 0) {
                        throw new Error('No nodes to export');
                    }
                    
                    // Calculate actual bounds of all nodes (including node size)
                    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                    nodes.forEach(node => {
                        const pos = node.position();
                        const nodeWidth = node.width();
                        const nodeHeight = node.height();
                        const size = Math.max(nodeWidth, nodeHeight) / 2;
                        
                        minX = Math.min(minX, pos.x - size);
                        minY = Math.min(minY, pos.y - size);
                        maxX = Math.max(maxX, pos.x + size);
                        maxY = Math.max(maxY, pos.y + size);
                    });
                    
                    // Also consider edge bounds
                    edges.forEach(edge => {
                        const { source, target, valid } = getEdgeNodes(edge);
                        if (valid) {
                            const sourcePos = source.position();
                            const targetPos = target.position();
                            minX = Math.min(minX, sourcePos.x, targetPos.x);
                            minY = Math.min(minY, sourcePos.y, targetPos.y);
                            maxX = Math.max(maxX, sourcePos.x, targetPos.x);
                            maxY = Math.max(maxY, sourcePos.y, targetPos.y);
                        }
                    });
                    
                    // Add margin
                    const padding = 50;
                    minX -= padding;
                    minY -= padding;
                    maxX += padding;
                    maxY += padding;
                    
                    const width = maxX - minX;
                    const height = maxY - minY;
                    
                    // Create SVG element
                    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                    svg.setAttribute('width', width.toString());
                    svg.setAttribute('height', height.toString());
                    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
                    svg.setAttribute('viewBox', `${minX} ${minY} ${width} ${height}`);
                    
                    // Add white background rectangle
                    const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                    bgRect.setAttribute('x', minX.toString());
                    bgRect.setAttribute('y', minY.toString());
                    bgRect.setAttribute('width', width.toString());
                    bgRect.setAttribute('height', height.toString());
                    bgRect.setAttribute('fill', 'white');
                    svg.appendChild(bgRect);
                    
                    // Create defs for arrow markers
                    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
                    
                    // Add arrow markers for edges (create different arrows for different edge types)
                    const edgeTypes = ['discovers', 'targets', 'enables', 'leads_to'];
                    edgeTypes.forEach((type, index) => {
                        let color = '#999';
                        if (type === 'discovers') color = '#3498db';
                        else if (type === 'targets') color = '#0066ff';
                        else if (type === 'enables') color = '#e74c3c';
                        else if (type === 'leads_to') color = '#666';
                        
                        const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
                        marker.setAttribute('id', `arrowhead-${type}`);
                        marker.setAttribute('markerWidth', '10');
                        marker.setAttribute('markerHeight', '10');
                        marker.setAttribute('refX', '9');
                        marker.setAttribute('refY', '3');
                        marker.setAttribute('orient', 'auto');
                        const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                        polygon.setAttribute('points', '0 0, 10 3, 0 6');
                        polygon.setAttribute('fill', color);
                        marker.appendChild(polygon);
                        defs.appendChild(marker);
                    });
                    svg.appendChild(defs);
                    
                    // Add edges (draw first so nodes appear on top)
                    edges.forEach(edge => {
                        const { source, target, valid } = getEdgeNodes(edge);
                        if (!valid) {
                            return; // Skip invalid edges
                        }
                        
                        const sourcePos = source.position();
                        const targetPos = target.position();
                        const edgeData = edge.data();
                        const edgeType = edgeData.type || 'leads_to';
                        
                        // Get edge style
                        let lineColor = '#999';
                        if (edgeType === 'discovers') lineColor = '#3498db';
                        else if (edgeType === 'targets') lineColor = '#0066ff';
                        else if (edgeType === 'enables') lineColor = '#e74c3c';
                        else if (edgeType === 'leads_to') lineColor = '#666';
                        
                        // Create path (supports curves)
                        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                        // Simple straight line path (can be improved to curve)
                        const midX = (sourcePos.x + targetPos.x) / 2;
                        const midY = (sourcePos.y + targetPos.y) / 2;
                        const dx = targetPos.x - sourcePos.x;
                        const dy = targetPos.y - sourcePos.y;
                        const offset = Math.min(30, Math.sqrt(dx * dx + dy * dy) * 0.3);
                        
                        // Use quadratic Bezier curve
                        const controlX = midX + (dy > 0 ? -offset : offset);
                        const controlY = midY + (dx > 0 ? offset : -offset);
                        path.setAttribute('d', `M ${sourcePos.x} ${sourcePos.y} Q ${controlX} ${controlY} ${targetPos.x} ${targetPos.y}`);
                        path.setAttribute('stroke', lineColor);
                        path.setAttribute('stroke-width', '2');
                        path.setAttribute('fill', 'none');
                        path.setAttribute('marker-end', `url(#arrowhead-${edgeType})`);
                        svg.appendChild(path);
                    });
                    
                    // Add nodes
                    nodes.forEach(node => {
                        const pos = node.position();
                        const nodeData = node.data();
                        const riskScore = nodeData.riskScore || 0;
                        const nodeWidth = node.width();
                        const nodeHeight = node.height();
                        const size = Math.max(nodeWidth, nodeHeight) / 2;
                        
                        // Determine node color
                        let bgColor = '#88cc00';
                        let textColor = '#1a5a1a';
                        let borderColor = '#5a8a5a';
                        if (riskScore >= 80) {
                            bgColor = '#ff4444';
                            textColor = '#fff';
                            borderColor = '#fff';
                        } else if (riskScore >= 60) {
                            bgColor = '#ff8800';
                            textColor = '#fff';
                            borderColor = '#fff';
                        } else if (riskScore >= 40) {
                            bgColor = '#ffbb00';
                            textColor = '#333';
                            borderColor = '#cc9900';
                        }
                        
                        // Determine node shape
                        const nodeType = nodeData.type;
                        let shapeElement;
                        if (nodeType === 'vulnerability') {
                            // Diamond
                            shapeElement = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                            const points = [
                                `${pos.x},${pos.y - size}`,
                                `${pos.x + size},${pos.y}`,
                                `${pos.x},${pos.y + size}`,
                                `${pos.x - size},${pos.y}`
                            ].join(' ');
                            shapeElement.setAttribute('points', points);
                        } else if (nodeType === 'target') {
                            // Star (five-pointed)
                            shapeElement = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                            const points = [];
                            for (let i = 0; i < 5; i++) {
                                const angle = (i * 4 * Math.PI / 5) - Math.PI / 2;
                                const x = pos.x + size * Math.cos(angle);
                                const y = pos.y + size * Math.sin(angle);
                                points.push(`${x},${y}`);
                            }
                            shapeElement.setAttribute('points', points.join(' '));
                        } else {
                            // Rounded rectangle
                            shapeElement = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                            shapeElement.setAttribute('x', (pos.x - size).toString());
                            shapeElement.setAttribute('y', (pos.y - size).toString());
                            shapeElement.setAttribute('width', (size * 2).toString());
                            shapeElement.setAttribute('height', (size * 2).toString());
                            shapeElement.setAttribute('rx', '5');
                            shapeElement.setAttribute('ry', '5');
                        }
                        
                        shapeElement.setAttribute('fill', bgColor);
                        shapeElement.setAttribute('stroke', borderColor);
                        shapeElement.setAttribute('stroke-width', '2');
                        svg.appendChild(shapeElement);
                        
                        // Add text label (use text stroke to improve readability)
                        // Use original label, not including type label prefix
                        const label = (nodeData.originalLabel || nodeData.label || nodeData.id || '').toString();
                        const maxLength = 15;
                        
                        // Create text group, containing stroke and fill
                        const textGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                        textGroup.setAttribute('text-anchor', 'middle');
                        textGroup.setAttribute('dominant-baseline', 'middle');
                        
                        // Handle long text (simple wrapping)
                        let lines = [];
                        if (label.length > maxLength) {
                            const words = label.split(' ');
                            let currentLine = '';
                            words.forEach(word => {
                                if ((currentLine + word).length <= maxLength) {
                                    currentLine += (currentLine ? ' ' : '') + word;
                                } else {
                                    if (currentLine) lines.push(currentLine);
                                    currentLine = word;
                                }
                            });
                            if (currentLine) lines.push(currentLine);
                            lines = lines.slice(0, 2); // Maximum two lines
                        } else {
                            lines = [label];
                        }
                        
                        // Determine text stroke color (consistent with original rendering)
                        let textOutlineColor = '#fff';
                        let textOutlineWidth = 2;
                        if (riskScore >= 80 || riskScore >= 60) {
                            // Red/orange background: white text, white stroke, dark outline
                            textOutlineColor = '#333';
                            textOutlineWidth = 1;
                        } else if (riskScore >= 40) {
                            // Yellow background: dark text, white stroke
                            textOutlineColor = '#fff';
                            textOutlineWidth = 2;
                        } else {
                            // Green background: dark green text, white stroke
                            textOutlineColor = '#fff';
                            textOutlineWidth = 2;
                        }
                        
                        // Create stroke and fill for each line of text
                        lines.forEach((line, i) => {
                            const textY = pos.y + (i - (lines.length - 1) / 2) * 16;
                            
                            // Stroke text (to improve contrast, simulating text-outline effect)
                            const strokeText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                            strokeText.setAttribute('x', pos.x.toString());
                            strokeText.setAttribute('y', textY.toString());
                            strokeText.setAttribute('fill', 'none');
                            strokeText.setAttribute('stroke', textOutlineColor);
                            strokeText.setAttribute('stroke-width', textOutlineWidth.toString());
                            strokeText.setAttribute('stroke-linejoin', 'round');
                            strokeText.setAttribute('stroke-linecap', 'round');
                            strokeText.setAttribute('font-size', '14px');
                            strokeText.setAttribute('font-weight', 'bold');
                            strokeText.setAttribute('font-family', 'Arial, sans-serif');
                            strokeText.setAttribute('text-anchor', 'middle');
                            strokeText.setAttribute('dominant-baseline', 'middle');
                            strokeText.textContent = line;
                            textGroup.appendChild(strokeText);
                            
                            // Fill text (actually visible text)
                            const fillText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                            fillText.setAttribute('x', pos.x.toString());
                            fillText.setAttribute('y', textY.toString());
                            fillText.setAttribute('fill', textColor);
                            fillText.setAttribute('font-size', '14px');
                            fillText.setAttribute('font-weight', 'bold');
                            fillText.setAttribute('font-family', 'Arial, sans-serif');
                            fillText.setAttribute('text-anchor', 'middle');
                            fillText.setAttribute('dominant-baseline', 'middle');
                            fillText.textContent = line;
                            textGroup.appendChild(fillText);
                        });
                        
                        svg.appendChild(textGroup);
                    });
                    
                    // Convert SVG to string
                    const serializer = new XMLSerializer();
                    let svgString = serializer.serializeToString(svg);
                    
                    // Ensure XML declaration exists
                    if (!svgString.startsWith('<?xml')) {
                        svgString = '<?xml version="1.0" encoding="UTF-8"?>\n' + svgString;
                    }
                    
                    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `attack-chain-${currentAttackChainConversationId || 'export'}-${Date.now()}.svg`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    setTimeout(() => URL.revokeObjectURL(url), 100);
                } catch (err) {
                    console.error('SVG export error:', err);
                    alert('SVG export failed: ' + (err.message || 'Unknown error'));
                }
            } else {
                alert('Unsupported export format: ' + format);
            }
        } catch (error) {
            console.error('Export failed:', error);
            alert('Export failed: ' + (error.message || 'Unknown error'));
        }
    }, 100); // Small delay to ensure graph has rendered
}

// ============================================
// Conversation grouping and bulk management functionality
// ============================================

// Group data management (using API)
let currentGroupId = null; // Currently viewing group detail page
let currentConversationGroupId = null; // Group ID the current conversation belongs to (for highlight display)
let contextMenuConversationId = null;
let contextMenuGroupId = null;
let groupsCache = [];
let conversationGroupMappingCache = {};
let pendingGroupMappings = {}; // Pending group mappings (for handling backend API delay)

// Load group list
async function loadGroups() {
    try {
        const response = await apiFetch('/api/groups');
        if (!response.ok) {
            groupsCache = [];
            return;
        }
        const data = await response.json();
        // Ensure groupsCache is a valid array
        if (Array.isArray(data)) {
            groupsCache = data;
        } else {
            // If return is not an array, use empty array (no warning, as backend may return error format but we handle gracefully)
            groupsCache = [];
        }

        const groupsList = document.getElementById('conversation-groups-list');
        if (!groupsList) return;

        groupsList.innerHTML = '';

        if (!Array.isArray(groupsCache) || groupsCache.length === 0) {
            return;
        }

        // Sort groups: pinned groups first (backend already sorted; just display in order)
        const sortedGroups = [...groupsCache];

            sortedGroups.forEach(group => {
            const groupItem = document.createElement('div');
            groupItem.className = 'group-item';
            // Highlight logic:
            // 1. If currently on group detail page, only highlight current group (currentGroupId)
            // 2. If not on group detail page, highlight the group the current conversation belongs to (currentConversationGroupId)
            const shouldHighlight = currentGroupId 
                ? (currentGroupId === group.id)
                : (currentConversationGroupId === group.id);
            if (shouldHighlight) {
                groupItem.classList.add('active');
            }
            const isPinned = group.pinned || false;
            if (isPinned) {
                groupItem.classList.add('pinned');
            }
            groupItem.dataset.groupId = group.id;

            const content = document.createElement('div');
            content.className = 'group-item-content';

            const icon = document.createElement('span');
            icon.className = 'group-item-icon';
            icon.textContent = group.icon || '📁';

            const name = document.createElement('span');
            name.className = 'group-item-name';
            name.textContent = group.name;

            content.appendChild(icon);
            content.appendChild(name);

            // If it is a pinned group, add pin icon
            if (isPinned) {
                const pinIcon = document.createElement('span');
                pinIcon.className = 'group-item-pinned';
                pinIcon.innerHTML = '📌';
                pinIcon.title = 'Pinned';
                name.appendChild(pinIcon);
            }
            groupItem.appendChild(content);

            const menuBtn = document.createElement('button');
            menuBtn.className = 'group-item-menu';
            menuBtn.innerHTML = '⋯';
            menuBtn.onclick = (e) => {
                e.stopPropagation();
                showGroupContextMenu(e, group.id);
            };
            groupItem.appendChild(menuBtn);

            groupItem.onclick = () => {
                enterGroupDetail(group.id);
            };

            groupsList.appendChild(groupItem);
        });
    } catch (error) {
        console.error('Failed to load group list:', error);
    }
}

// Load conversation list (modified to support grouping and pinning)
async function loadConversationsWithGroups(searchQuery = '') {
    try {
        // Always reload group list and group mapping to ensure cache is up to date
        // This correctly handles the case where a group has been deleted
        await loadGroups();
        await loadConversationGroupMapping();

        // If there is a search keyword, use larger limit to get all matching results
        const limit = (searchQuery && searchQuery.trim()) ? 1000 : 100;
        let url = `/api/conversations?limit=${limit}`;
        if (searchQuery && searchQuery.trim()) {
            url += '&search=' + encodeURIComponent(searchQuery.trim());
        }
        const response = await apiFetch(url);

        const listContainer = document.getElementById('conversations-list');
        if (!listContainer) {
            return;
        }

        // Save scroll position
        const sidebarContent = listContainer.closest('.sidebar-content');
        const savedScrollTop = sidebarContent ? sidebarContent.scrollTop : 0;

        const emptyStateHtml = '<div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 0.875rem;">No conversation history</div>';
        listContainer.innerHTML = '';

        // If the response is not 200, show empty state (handle gracefully, do not show error)
        if (!response.ok) {
            listContainer.innerHTML = emptyStateHtml;
            return;
        }

        const conversations = await response.json();

        if (!Array.isArray(conversations) || conversations.length === 0) {
            listContainer.innerHTML = emptyStateHtml;
            return;
        }
        
        // Separate pinned and normal conversations
        const pinnedConvs = [];
        const normalConvs = [];
        const hasSearchQuery = searchQuery && searchQuery.trim();

        conversations.forEach(conv => {
            // If there is a search keyword, show all matching conversations (global search, including grouped ones)
            if (hasSearchQuery) {
                // During search, show all matching conversations regardless of group
                if (conv.pinned) {
                    pinnedConvs.push(conv);
                } else {
                    normalConvs.push(conv);
                }
                return;
            }

            // If no search keyword, use original logic
            // "Recent conversations" list should only show conversations not in any group
            // Regardless of group detail page, grouped conversations should not appear in "Recent conversations"
            if (conversationGroupMappingCache[conv.id]) {
                // Conversation is in a group, should not be shown in "Recent conversations" list
                return;
            }

            if (conv.pinned) {
                pinnedConvs.push(conv);
            } else {
                normalConvs.push(conv);
            }
        });

        // Sort by time
        const sortByTime = (a, b) => {
            const timeA = a.updatedAt ? new Date(a.updatedAt) : new Date(0);
            const timeB = b.updatedAt ? new Date(b.updatedAt) : new Date(0);
            return timeB - timeA;
        };

        pinnedConvs.sort(sortByTime);
        normalConvs.sort(sortByTime);

        const fragment = document.createDocumentFragment();

        // Add pinned conversations
        if (pinnedConvs.length > 0) {
            pinnedConvs.forEach(conv => {
                fragment.appendChild(createConversationListItemWithMenu(conv, true));
            });
        }

        // Add normal conversations
        normalConvs.forEach(conv => {
            fragment.appendChild(createConversationListItemWithMenu(conv, false));
        });

        if (fragment.children.length === 0) {
            listContainer.innerHTML = emptyStateHtml;
            return;
        }

        listContainer.appendChild(fragment);
        updateActiveConversation();
        
        // Restore scroll position
        if (sidebarContent) {
            // Use requestAnimationFrame to ensure DOM has been updated
            requestAnimationFrame(() => {
                sidebarContent.scrollTop = savedScrollTop;
            });
        }
    } catch (error) {
        console.error('Failed to load conversation list:', error);
        // On error, show empty state rather than error prompt (better UX)
        const listContainer = document.getElementById('conversations-list');
        if (listContainer) {
            const emptyStateHtml = '<div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 0.875rem;">No conversation history</div>';
            listContainer.innerHTML = emptyStateHtml;
        }
    }
}

// Create conversation item with menu
function createConversationListItemWithMenu(conversation, isPinned) {
    const item = document.createElement('div');
    item.className = 'conversation-item';
    item.dataset.conversationId = conversation.id;
    if (conversation.id === currentConversationId) {
        item.classList.add('active');
    }

    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'conversation-content';

    const titleWrapper = document.createElement('div');
    titleWrapper.style.display = 'flex';
    titleWrapper.style.alignItems = 'center';
    titleWrapper.style.gap = '4px';

    const title = document.createElement('div');
    title.className = 'conversation-title';
    const titleText = conversation.title || 'Unnamed conversation';
    title.textContent = safeTruncateText(titleText, 60);
    title.title = titleText; // Set full title for hover view
    titleWrapper.appendChild(title);

    if (isPinned) {
        const pinIcon = document.createElement('span');
        pinIcon.className = 'conversation-item-pinned';
        pinIcon.innerHTML = '📌';
        pinIcon.title = 'Pinned';
        titleWrapper.appendChild(pinIcon);
    }

    contentWrapper.appendChild(titleWrapper);

    const time = document.createElement('div');
    time.className = 'conversation-time';
    const dateObj = conversation.updatedAt ? new Date(conversation.updatedAt) : new Date();
    time.textContent = formatConversationTimestamp(dateObj);
    contentWrapper.appendChild(time);

    // If conversation belongs to a group, show group tag
    const groupId = conversationGroupMappingCache[conversation.id];
    if (groupId) {
        const group = groupsCache.find(g => g.id === groupId);
        if (group) {
            const groupTag = document.createElement('div');
            groupTag.className = 'conversation-group-tag';
            groupTag.innerHTML = `<span class="group-tag-icon">${group.icon || '📁'}</span><span class="group-tag-name">${group.name}</span>`;
            groupTag.title = `Group: ${group.name}`;
            contentWrapper.appendChild(groupTag);
        }
    }

    item.appendChild(contentWrapper);

    const menuBtn = document.createElement('button');
    menuBtn.className = 'conversation-item-menu';
    menuBtn.innerHTML = '⋯';
    menuBtn.onclick = (e) => {
        e.stopPropagation();
        contextMenuConversationId = conversation.id;
        showConversationContextMenu(e);
    };
    item.appendChild(menuBtn);

    item.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (currentGroupId) {
            exitGroupDetail();
        }
        loadConversation(conversation.id);
    };

    return item;
}

// Show conversation context menu
async function showConversationContextMenu(event) {
    const menu = document.getElementById('conversation-context-menu');
    if (!menu) return;

    // First hide submenu to ensure it is closed every time the menu is opened
    const submenu = document.getElementById('move-to-group-submenu');
    if (submenu) {
        submenu.style.display = 'none';
        submenuVisible = false;
    }
    // Clear all timers
    clearSubmenuHideTimeout();
    clearSubmenuShowTimeout();
    submenuLoading = false;

    const convId = contextMenuConversationId;
    
    // Update enabled state of attack chain menu item
    const attackChainMenuItem = document.getElementById('attack-chain-menu-item');
    if (attackChainMenuItem) {
        if (convId) {
            const isRunning = typeof isConversationTaskRunning === 'function'
                ? isConversationTaskRunning(convId)
                : false;
            if (isRunning) {
                attackChainMenuItem.style.opacity = '0.5';
                attackChainMenuItem.style.cursor = 'not-allowed';
                attackChainMenuItem.onclick = null;
                attackChainMenuItem.title = 'Current conversation is executing; please generate attack chain later';
            } else {
                attackChainMenuItem.style.opacity = '1';
                attackChainMenuItem.style.cursor = 'pointer';
                attackChainMenuItem.onclick = showAttackChainFromContext;
                attackChainMenuItem.title = 'View attack chain for current conversation';
            }
        } else {
            attackChainMenuItem.style.opacity = '0.5';
            attackChainMenuItem.style.cursor = 'not-allowed';
            attackChainMenuItem.onclick = null;
            attackChainMenuItem.title = 'Please select a conversation to view the attack chain';
        }
    }
    
    // First get conversation pin state and update menu text (before showing menu)
    if (convId) {
        try {
            let isPinned = false;
            // Check if conversation is actually in the current group
            const conversationGroupId = conversationGroupMappingCache[convId];
            const isInCurrentGroup = currentGroupId && conversationGroupId === currentGroupId;
            
            if (isInCurrentGroup) {
                // Conversation is in current group, get group-internal pin state
                const response = await apiFetch(`/api/groups/${currentGroupId}/conversations`);
                if (response.ok) {
                    const groupConvs = await response.json();
                    const conv = groupConvs.find(c => c.id === convId);
                    if (conv) {
                        isPinned = conv.groupPinned || false;
                    }
                }
            } else {
                // Not on group detail page, or conversation not in current group, get global pin state
                const response = await apiFetch(`/api/conversations/${convId}`);
                if (response.ok) {
                    const conv = await response.json();
                    isPinned = conv.pinned || false;
                }
            }
            
            // Update menu text
            const pinMenuText = document.getElementById('pin-conversation-menu-text');
            if (pinMenuText) {
                pinMenuText.textContent = isPinned ? 'Unpin' : 'Pin this conversation';
            }
        } catch (error) {
            console.error('Failed to get conversation pin state:', error);
            // If fetch fails, use default text
            const pinMenuText = document.getElementById('pin-conversation-menu-text');
            if (pinMenuText) {
                pinMenuText.textContent = 'Pin this conversation';
            }
        }
    } else {
        // If no conversation ID, use default text
        const pinMenuText = document.getElementById('pin-conversation-menu-text');
        if (pinMenuText) {
            pinMenuText.textContent = 'Pin this conversation';
        }
    }

    // Show menu after state retrieval is complete
    menu.style.display = 'block';
    menu.style.visibility = 'visible';
    menu.style.opacity = '1';
    
    // Force reflow to get correct dimensions
    void menu.offsetHeight;
    
    // Calculate menu position to ensure it does not overflow the screen
    const menuRect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // Get submenu width (if exists, reuse previously obtained submenu variable)
    const submenuWidth = submenu ? 180 : 0; // Submenu width + spacing
    
    let left = event.clientX;
    let top = event.clientY;
    
    // If menu would overflow right boundary, adjust to left side
    // Consider submenu width
    if (left + menuRect.width + submenuWidth > viewportWidth) {
        left = event.clientX - menuRect.width;
        // If still overflows after adjustment, place on left side of button
        if (left < 0) {
            left = Math.max(8, event.clientX - menuRect.width - submenuWidth);
        }
    }
    
    // If menu would overflow bottom boundary, adjust upward
    if (top + menuRect.height > viewportHeight) {
        top = Math.max(8, event.clientY - menuRect.height);
    }
    
    // Ensure does not overflow left boundary
    if (left < 0) {
        left = 8;
    }
    
    // Ensure does not overflow top boundary
    if (top < 0) {
        top = 8;
    }
    
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    
    // If menu is on right side, submenu should display on left side
    if (submenu && left < event.clientX) {
        submenu.style.left = 'auto';
        submenu.style.right = '100%';
        submenu.style.marginLeft = '0';
        submenu.style.marginRight = '4px';
    } else if (submenu) {
        submenu.style.left = '100%';
        submenu.style.right = 'auto';
        submenu.style.marginLeft = '4px';
        submenu.style.marginRight = '0';
    }

    // Click outside to close menu
    const closeMenu = (e) => {
        // Check if click is inside main menu or submenu
        const moveToGroupSubmenuEl = document.getElementById('move-to-group-submenu');
        const clickedInMenu = menu.contains(e.target);
        const clickedInSubmenu = moveToGroupSubmenuEl && moveToGroupSubmenuEl.contains(e.target);
        
        if (!clickedInMenu && !clickedInSubmenu) {
            // Use closeContextMenu to ensure both main menu and submenu are closed
            closeContextMenu();
            document.removeEventListener('click', closeMenu);
        }
    };
    setTimeout(() => {
        document.addEventListener('click', closeMenu);
    }, 0);
}

// Show group context menu
async function showGroupContextMenu(event, groupId) {
    const menu = document.getElementById('group-context-menu');
    if (!menu) return;

    contextMenuGroupId = groupId;

    // First get group pin state and update menu text (before showing menu)
    try {
        // First look up from cache
        let group = groupsCache.find(g => g.id === groupId);
        let isPinned = false;
        
        if (group) {
            isPinned = group.pinned || false;
        } else {
            // If not in cache, fetch from API
            const response = await apiFetch(`/api/groups/${groupId}`);
            if (response.ok) {
                group = await response.json();
                isPinned = group.pinned || false;
            }
        }
        
        // Update menu text
        const pinMenuText = document.getElementById('pin-group-menu-text');
        if (pinMenuText) {
            pinMenuText.textContent = isPinned ? 'Unpin' : 'Pin this group';
        }
    } catch (error) {
        console.error('Failed to get group pin state:', error);
        // If fetch fails, use default text
        const pinMenuText = document.getElementById('pin-group-menu-text');
        if (pinMenuText) {
            pinMenuText.textContent = 'Pin this group';
        }
    }

    // Show menu after state retrieval is complete
    menu.style.display = 'block';
    menu.style.visibility = 'visible';
    menu.style.opacity = '1';
    
    // Force reflow to get correct dimensions
    void menu.offsetHeight;
    
    // Calculate menu position to ensure it does not overflow the screen
    const menuRect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    let left = event.clientX;
    let top = event.clientY;
    
    // If menu would overflow right boundary, adjust to left side
    if (left + menuRect.width > viewportWidth) {
        left = event.clientX - menuRect.width;
    }
    
    // If menu would overflow bottom boundary, adjust upward
    if (top + menuRect.height > viewportHeight) {
        top = event.clientY - menuRect.height;
    }
    
    // Ensure does not overflow left boundary
    if (left < 0) {
        left = 8;
    }
    
    // Ensure does not overflow top boundary
    if (top < 0) {
        top = 8;
    }
    
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';

    // Click outside to close menu
    const closeMenu = (e) => {
        if (!menu.contains(e.target)) {
            menu.style.display = 'none';
            document.removeEventListener('click', closeMenu);
        }
    };
    setTimeout(() => {
        document.addEventListener('click', closeMenu);
    }, 0);
}

// Rename conversation
async function renameConversation() {
    const convId = contextMenuConversationId;
    if (!convId) return;

    const newTitle = prompt('Please enter new title:', '');
    if (newTitle === null || !newTitle.trim()) {
        closeContextMenu();
        return;
    }

    try {
        const response = await apiFetch(`/api/conversations/${convId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ title: newTitle.trim() }),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Update failed');
        }

        // Update frontend display
        const item = document.querySelector(`[data-conversation-id="${convId}"]`);
        if (item) {
            const titleEl = item.querySelector('.conversation-title');
            if (titleEl) {
                titleEl.textContent = newTitle.trim();
            }
        }

        // If on group detail page, also needs update
        const groupItem = document.querySelector(`.group-conversation-item[data-conversation-id="${convId}"]`);
        if (groupItem) {
            const groupTitleEl = groupItem.querySelector('.group-conversation-title');
            if (groupTitleEl) {
                groupTitleEl.textContent = newTitle.trim();
            }
        }

        // Reload conversation list
        loadConversationsWithGroups();
    } catch (error) {
        console.error('Failed to rename conversation:', error);
        alert('Rename failed: ' + (error.message || 'Unknown error'));
    }

    closeContextMenu();
}

// Pin conversation
async function pinConversation() {
    const convId = contextMenuConversationId;
    if (!convId) return;

    try {
        // Check if conversation is actually in the current group
        // If conversation has been moved out of group, conversationGroupMappingCache will not have its mapping
        // Or the mapped group ID does not equal the current group ID
        const conversationGroupId = conversationGroupMappingCache[convId];
        const isInCurrentGroup = currentGroupId && conversationGroupId === currentGroupId;
        
        // If currently on group detail page and conversation is in the current group, use group-internal pin
        if (isInCurrentGroup) {
            // Get pin state of current conversation in the group
            const response = await apiFetch(`/api/groups/${currentGroupId}/conversations`);
            const groupConvs = await response.json();
            const conv = groupConvs.find(c => c.id === convId);
            
            // If conversation not found, there may be an issue; use default value
            const currentPinned = conv && conv.groupPinned !== undefined ? conv.groupPinned : false;
            const newPinned = !currentPinned;

            // Update group-internal pin state
            await apiFetch(`/api/groups/${currentGroupId}/conversations/${convId}/pinned`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ pinned: newPinned }),
            });

            // Reload group conversations
            loadGroupConversations(currentGroupId);
        } else {
            // Not on group detail page, or conversation not in current group; use global pin
            const response = await apiFetch(`/api/conversations/${convId}`);
            const conv = await response.json();
            const newPinned = !conv.pinned;

            // Update global pin state
            await apiFetch(`/api/conversations/${convId}/pinned`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ pinned: newPinned }),
            });

            loadConversationsWithGroups();
        }
    } catch (error) {
        console.error('Failed to pin conversation:', error);
        alert('Pin failed: ' + (error.message || 'Unknown error'));
    }

    closeContextMenu();
}

// Show move-to-group submenu
async function showMoveToGroupSubmenu() {
    const submenu = document.getElementById('move-to-group-submenu');
    if (!submenu) return;

    // If submenu is already shown, no need to re-render
    if (submenuVisible && submenu.style.display === 'block') {
        return;
    }

    // If loading, avoid duplicate calls
    if (submenuLoading) {
        return;
    }

    // Clear hide timer
    clearSubmenuHideTimeout();
    
    // Mark as loading
    submenuLoading = true;
    submenu.innerHTML = '';

    // Ensure group list is loaded - force reload to ensure data is up to date
    try {
        // If cache is empty, force load
        if (!Array.isArray(groupsCache) || groupsCache.length === 0) {
            await loadGroups();
        } else {
            // Even if cache is not empty, try to refresh once to ensure data is up to date
            // But use silent mode, do not show errors
            try {
                const response = await apiFetch('/api/groups');
                if (response.ok) {
                    const freshGroups = await response.json();
                    if (Array.isArray(freshGroups)) {
                        groupsCache = freshGroups;
                    }
                }
            } catch (err) {
                // If refresh fails, use cached data
                console.warn('Failed to refresh group list, using cached data:', err);
            }
        }
        
        // Validate cache again
        if (!Array.isArray(groupsCache)) {
            console.warn('groupsCache is not a valid array, resetting to empty array');
            groupsCache = [];
            // If still invalid, try to reload
            if (groupsCache.length === 0) {
                await loadGroups();
            }
        }
    } catch (error) {
        console.error('Failed to load group list:', error);
        // Even if load fails, continue to show menu using existing cache
    }

    // If currently on group detail page, show "Remove from group" option
    if (currentGroupId && contextMenuConversationId) {
        // Check if conversation is in the current group
        const convInGroup = conversationGroupMappingCache[contextMenuConversationId] === currentGroupId;
        if (convInGroup) {
            const removeItem = document.createElement('div');
            removeItem.className = 'context-submenu-item';
            removeItem.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M9 12l6 6M15 12l-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                <span>Remove from group</span>
            `;
            removeItem.onclick = () => {
                removeConversationFromGroup(contextMenuConversationId, currentGroupId);
            };
            submenu.appendChild(removeItem);
            
            // Add divider
            const divider = document.createElement('div');
            divider.className = 'context-menu-divider';
            submenu.appendChild(divider);
        }
    }

    // Validate if groupsCache is a valid array
    if (!Array.isArray(groupsCache)) {
        console.warn('groupsCache is not a valid array, resetting to empty array');
        groupsCache = [];
    }

    // If there are groups, show all groups (excluding the one the conversation is already in)
    if (groupsCache.length > 0) {
        // Check the group ID the conversation currently belongs to
        const conversationCurrentGroupId = contextMenuConversationId 
            ? conversationGroupMappingCache[contextMenuConversationId] 
            : null;
        
        groupsCache.forEach(group => {
            // Validate if group object is valid
            if (!group || !group.id || !group.name) {
                console.warn('Invalid group object:', group);
                return;
            }
            
            // If conversation is already in this group, do not show it (already there)
            if (conversationCurrentGroupId && group.id === conversationCurrentGroupId) {
                return;
            }
            
            const item = document.createElement('div');
            item.className = 'context-submenu-item';
            item.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                <span>${group.name}</span>
            `;
            item.onclick = () => {
                moveConversationToGroup(contextMenuConversationId, group.id);
            };
            submenu.appendChild(item);
        });
    } else {
        // If still no groups, log for debugging
        console.warn('showMoveToGroupSubmenu: groupsCache is empty, cannot show group list');
    }

    // Always show "Create group" option
    const addItem = document.createElement('div');
    addItem.className = 'context-submenu-item add-group-item';
    addItem.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>+ New Group</span>
    `;
    addItem.onclick = () => {
        showCreateGroupModal(true);
    };
    submenu.appendChild(addItem);

    submenu.style.display = 'block';
    submenuVisible = true;
    submenuLoading = false;
    
    // Calculate submenu position to prevent overflow
    setTimeout(() => {
        const submenuRect = submenu.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        
        // If submenu overflows right boundary, adjust to left side
        if (submenuRect.right > viewportWidth) {
            submenu.style.left = 'auto';
            submenu.style.right = '100%';
            submenu.style.marginLeft = '0';
            submenu.style.marginRight = '4px';
        }
        
        // If submenu overflows bottom boundary, adjust position
        if (submenuRect.bottom > viewportHeight) {
            const overflow = submenuRect.bottom - viewportHeight;
            const currentTop = parseInt(submenu.style.top) || 0;
            submenu.style.top = (currentTop - overflow - 8) + 'px';
        }
    }, 0);
}

// Timer for hiding move-to-group submenu
let submenuHideTimeout = null;
// Debounce timer for showing submenu
let submenuShowTimeout = null;
// Whether submenu is loading
let submenuLoading = false;
// Whether submenu is shown
let submenuVisible = false;

// Hide move-to-group submenu
function hideMoveToGroupSubmenu() {
    const submenu = document.getElementById('move-to-group-submenu');
    if (submenu) {
        submenu.style.display = 'none';
        submenuVisible = false;
    }
}

// Clear timer for hiding submenu
function clearSubmenuHideTimeout() {
    if (submenuHideTimeout) {
        clearTimeout(submenuHideTimeout);
        submenuHideTimeout = null;
    }
}

// Clear timer for showing submenu
function clearSubmenuShowTimeout() {
    if (submenuShowTimeout) {
        clearTimeout(submenuShowTimeout);
        submenuShowTimeout = null;
    }
}

// Handle mouse enter "Move to group" menu item (with debounce)
function handleMoveToGroupSubmenuEnter() {
    // Clear hide timer
    clearSubmenuHideTimeout();
    
    // If submenu is already shown, no need to call again
    const submenu = document.getElementById('move-to-group-submenu');
    if (submenu && submenuVisible && submenu.style.display === 'block') {
        return;
    }
    
    // Clear previous show timer
    clearSubmenuShowTimeout();
    
    // Use debounce delay for showing to avoid frequent triggers
    submenuShowTimeout = setTimeout(() => {
        showMoveToGroupSubmenu();
        submenuShowTimeout = null;
    }, 100);
}

// Handle mouse leave "Move to group" menu item
function handleMoveToGroupSubmenuLeave(event) {
    const submenu = document.getElementById('move-to-group-submenu');
    if (!submenu) return;
    
    // Clear show timer
    clearSubmenuShowTimeout();
    
    // Check if mouse moved to submenu
    const relatedTarget = event.relatedTarget;
    if (relatedTarget && submenu.contains(relatedTarget)) {
        // Mouse moved to submenu, do not clear
        return;
    }
    
    // Clear previous hide timer
    clearSubmenuHideTimeout();
    
    // Delay hiding to give user time to move to submenu
    submenuHideTimeout = setTimeout(() => {
        hideMoveToGroupSubmenu();
        submenuHideTimeout = null;
    }, 200);
}

// Move conversation to group
async function moveConversationToGroup(convId, groupId) {
    try {
        await apiFetch('/api/groups/conversations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                conversationId: convId,
                groupId: groupId,
            }),
        });

        // Update cache
        const oldGroupId = conversationGroupMappingCache[convId];
        conversationGroupMappingCache[convId] = groupId;
        
        // Add newly moved conversation to pending-preserve mapping to prevent mapping loss due to backend API delay
        pendingGroupMappings[convId] = groupId;
        
        // If the moved conversation is the current one, update currentConversationGroupId
        if (currentConversationId === convId) {
            currentConversationGroupId = groupId;
        }
        
        // If currently on group detail page, reload group conversations
        if (currentGroupId) {
            // If moved out of or into current group, both require reload
            if (currentGroupId === oldGroupId || currentGroupId === groupId) {
                await loadGroupConversations(currentGroupId);
            }
        }
        
        // Regardless of group detail page, need to refresh recent conversation list
        // Because recent conversation list filters based on group mapping cache; needs immediate update
        // loadConversationsWithGroups internally calls loadConversationGroupMapping,
        // loadConversationGroupMapping retains mappings in pendingGroupMappings
        await loadConversationsWithGroups();
        
        // Note: mappings in pendingGroupMappings will be cleaned up next time loadConversationGroupMapping 
        // successfully loads from backend (handled in loadConversationGroupMapping)
        
        // Refresh group list to update highlight state
        await loadGroups();
    } catch (error) {
        console.error('Failed to move conversation to group:', error);
        alert('Move failed: ' + (error.message || 'Unknown error'));
    }

    closeContextMenu();
}

// Remove conversation from group
async function removeConversationFromGroup(convId, groupId) {
    try {
        await apiFetch(`/api/groups/${groupId}/conversations/${convId}`, {
            method: 'DELETE',
        });

        // Update cache - delete immediately to ensure correct identification on subsequent loads
        delete conversationGroupMappingCache[convId];
        // Also remove from pending-preserve mapping
        delete pendingGroupMappings[convId];
        
        // If the removed conversation is the current one, clear currentConversationGroupId
        if (currentConversationId === convId) {
            currentConversationGroupId = null;
        }
        
        // If currently on group detail page, reload group conversations
        if (currentGroupId === groupId) {
            await loadGroupConversations(groupId);
        }
        
        // Reload group mapping to ensure cache is up to date
        await loadConversationGroupMapping();
        
        // Refresh group list to update highlight state
        await loadGroups();
        
        // Refresh recent conversation list to immediately show the removed conversation
        // Use temporary variable to save currentGroupId, then temporarily set to null, to show all conversations not in groups
        const savedGroupId = currentGroupId;
        currentGroupId = null;
        await loadConversationsWithGroups();
        currentGroupId = savedGroupId;
    } catch (error) {
        console.error('Failed to remove conversation from group:', error);
        alert('Remove failed: ' + (error.message || 'Unknown error'));
    }

    closeContextMenu();
}

// Load conversation group mapping
async function loadConversationGroupMapping() {
    try {
        // Get all groups, then get conversations for each group
        let groups;
        if (Array.isArray(groupsCache) && groupsCache.length > 0) {
            groups = groupsCache;
        } else {
            const response = await apiFetch('/api/groups');
            if (!response.ok) {
                // If API request fails, use empty array and do not print warning (normal error handling)
                groups = [];
            } else {
                groups = await response.json();
                // Ensure groups is a valid array; only print warning on truly exceptional cases
                if (!Array.isArray(groups)) {
                    // Only print warning when return is not array and not null/undefined (backend may have returned error format)
                    if (groups !== null && groups !== undefined) {
                        console.warn('loadConversationGroupMapping: groups is not a valid array, using empty array', groups);
                    }
                    groups = [];
                }
            }
        }
        
        // Save pending-preserve mappings
        const preservedMappings = { ...pendingGroupMappings };
        
        conversationGroupMappingCache = {};

        for (const group of groups) {
            const response = await apiFetch(`/api/groups/${group.id}/conversations`);
            const conversations = await response.json();
            // Ensure conversations is a valid array
            if (Array.isArray(conversations)) {
                conversations.forEach(conv => {
                    conversationGroupMappingCache[conv.id] = group.id;
                    // If this conversation is in pending-preserve mapping, remove it (since it has been loaded from backend)
                    if (preservedMappings[conv.id] === group.id) {
                        delete pendingGroupMappings[conv.id];
                    }
                });
            }
        }
        
        // Restore pending-preserve mappings (these are mappings not yet synced by backend API)
        Object.assign(conversationGroupMappingCache, preservedMappings);
    } catch (error) {
        console.error('Failed to load conversation group mapping:', error);
    }
}

// View attack chain from context menu
function showAttackChainFromContext() {
    const convId = contextMenuConversationId;
    if (!convId) return;
    
    closeContextMenu();
    showAttackChain(convId);
}

// Delete conversation from context menu
function deleteConversationFromContext() {
    const convId = contextMenuConversationId;
    if (!convId) return;

    if (confirm('Are you sure you want to delete this conversation?')) {
        deleteConversation(convId, true); // Skip internal confirmation since already confirmed here
    }
    closeContextMenu();
}

// Close context menu
function closeContextMenu() {
    const menu = document.getElementById('conversation-context-menu');
    if (menu) {
        menu.style.display = 'none';
    }
    const submenu = document.getElementById('move-to-group-submenu');
    if (submenu) {
        submenu.style.display = 'none';
        submenuVisible = false;
    }
    // Clear all timers
    clearSubmenuHideTimeout();
    clearSubmenuShowTimeout();
    submenuLoading = false;
    contextMenuConversationId = null;
}

// Show bulk management modal
let allConversationsForBatch = [];

async function showBatchManageModal() {
    try {
        const response = await apiFetch('/api/conversations?limit=1000');
        
        // If response is not 200, use empty array (handle gracefully, do not show error)
        if (!response.ok) {
            allConversationsForBatch = [];
        } else {
            const data = await response.json();
            allConversationsForBatch = Array.isArray(data) ? data : [];
        }

        const modal = document.getElementById('batch-manage-modal');
        const countEl = document.getElementById('batch-manage-count');
        if (countEl) {
            countEl.textContent = allConversationsForBatch.length;
        }

        renderBatchConversations();
        if (modal) {
            modal.style.display = 'flex';
        }
    } catch (error) {
        console.error('Failed to load conversation list:', error);
        // On error, use empty array and do not show error prompt (better UX)
        allConversationsForBatch = [];
        const modal = document.getElementById('batch-manage-modal');
        const countEl = document.getElementById('batch-manage-count');
        if (countEl) {
            countEl.textContent = 0;
        }
        if (modal) {
            renderBatchConversations();
            modal.style.display = 'flex';
        }
    }
}

// Safely truncate strings to avoid truncating in the middle of a character
function safeTruncateText(text, maxLength = 50) {
    if (!text || typeof text !== 'string') {
        return text || '';
    }
    
    // Use Array.from to convert string to character array (correctly handles Unicode surrogate pairs)
    const chars = Array.from(text);
    
    // If text length does not exceed the limit, return directly
    if (chars.length <= maxLength) {
        return text;
    }
    
    // Truncate to max length (based on character count, not code units)
    let truncatedChars = chars.slice(0, maxLength);
    
    // Try to truncate at punctuation marks or spaces for more natural truncation
    // Search backward from truncation point for a suitable break (no more than 20% of length)
    const searchRange = Math.floor(maxLength * 0.2);
    const breakChars = ['，', '。', '、', ' ', ',', '.', ';', ':', '!', '?', '！', '？', '/', '\\', '-', '_'];
    let bestBreakPos = truncatedChars.length;
    
    for (let i = truncatedChars.length - 1; i >= truncatedChars.length - searchRange && i >= 0; i--) {
        if (breakChars.includes(truncatedChars[i])) {
            bestBreakPos = i + 1; // Break after punctuation mark
            break;
        }
    }
    
    // If a suitable break is found, use it; otherwise use the original truncation position
    if (bestBreakPos < truncatedChars.length) {
        truncatedChars = truncatedChars.slice(0, bestBreakPos);
    }
    
    // Convert character array back to string and add ellipsis
    return truncatedChars.join('') + '...';
}

// Render bulk management conversation list
function renderBatchConversations(filtered = null) {
    const list = document.getElementById('batch-conversations-list');
    if (!list) return;

    const conversations = filtered || allConversationsForBatch;
    list.innerHTML = '';

    conversations.forEach(conv => {
        const row = document.createElement('div');
        row.className = 'batch-conversation-row';
        row.dataset.conversationId = conv.id;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'batch-conversation-checkbox';
        checkbox.dataset.conversationId = conv.id;

        const name = document.createElement('div');
        name.className = 'batch-table-col-name';
        const originalTitle = conv.title || 'Unnamed conversation';
        // Use safe truncation function, max length 45 characters (to leave space for ellipsis)
        const truncatedTitle = safeTruncateText(originalTitle, 45);
        name.textContent = truncatedTitle;
        // Set title attribute to show full text (on mouse hover)
        name.title = originalTitle;

        const time = document.createElement('div');
        time.className = 'batch-table-col-time';
        const dateObj = conv.updatedAt ? new Date(conv.updatedAt) : new Date();
        time.textContent = dateObj.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });

        const action = document.createElement('div');
        action.className = 'batch-table-col-action';
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'batch-delete-btn';
        deleteBtn.innerHTML = '🗑️';
        deleteBtn.onclick = () => deleteConversation(conv.id);
        action.appendChild(deleteBtn);

        row.appendChild(checkbox);
        row.appendChild(name);
        row.appendChild(time);
        row.appendChild(action);

        list.appendChild(row);
    });
}

// Filter bulk management conversations
function filterBatchConversations(query) {
    if (!query || !query.trim()) {
        renderBatchConversations();
        return;
    }

    const filtered = allConversationsForBatch.filter(conv => {
        const title = (conv.title || '').toLowerCase();
        return title.includes(query.toLowerCase());
    });

    renderBatchConversations(filtered);
}

// Select all / deselect all
function toggleSelectAllBatch() {
    const selectAll = document.getElementById('batch-select-all');
    const checkboxes = document.querySelectorAll('.batch-conversation-checkbox');
    
    checkboxes.forEach(cb => {
        cb.checked = selectAll.checked;
    });
}

// Delete selected conversations
async function deleteSelectedConversations() {
    const checkboxes = document.querySelectorAll('.batch-conversation-checkbox:checked');
    if (checkboxes.length === 0) {
        alert('Please select conversations to delete first');
        return;
    }

    if (!confirm(`Are you sure you want to delete the selected ${checkboxes.length} conversation(s)?`)) {
        return;
    }

    const ids = Array.from(checkboxes).map(cb => cb.dataset.conversationId);
    
    try {
        for (const id of ids) {
            await deleteConversation(id, true); // Skip internal confirmation since already confirmed for bulk delete
        }
        closeBatchManageModal();
        loadConversationsWithGroups();
    } catch (error) {
        console.error('Delete failed:', error);
        alert('Delete failed: ' + (error.message || 'Unknown error'));
    }
}

// Close bulk management modal
function closeBatchManageModal() {
    const modal = document.getElementById('batch-manage-modal');
    if (modal) {
        modal.style.display = 'none';
    }
    const selectAll = document.getElementById('batch-select-all');
    if (selectAll) {
        selectAll.checked = false;
    }
    allConversationsForBatch = [];
}

// Show create group modal
function showCreateGroupModal(andMoveConversation = false) {
    const modal = document.getElementById('create-group-modal');
    const input = document.getElementById('create-group-name-input');
    const iconBtn = document.getElementById('create-group-icon-btn');
    const iconPicker = document.getElementById('group-icon-picker');
    const customInput = document.getElementById('custom-icon-input');
    
    if (input) {
        input.value = '';
    }
    // Reset icon to default value
    if (iconBtn) {
        iconBtn.textContent = '📁';
    }
    // Clear custom icon input box
    if (customInput) {
        customInput.value = '';
    }
    // Close icon selector
    if (iconPicker) {
        iconPicker.style.display = 'none';
    }
    if (modal) {
        modal.style.display = 'flex';
        modal.dataset.moveConversation = andMoveConversation ? 'true' : 'false';
        if (input) {
            setTimeout(() => input.focus(), 100);
        }
    }
}

// Close create group modal
function closeCreateGroupModal() {
    const modal = document.getElementById('create-group-modal');
    if (modal) {
        modal.style.display = 'none';
    }
    const input = document.getElementById('create-group-name-input');
    if (input) {
        input.value = '';
    }
    // Reset icon to default value
    const iconBtn = document.getElementById('create-group-icon-btn');
    if (iconBtn) {
        iconBtn.textContent = '📁';
    }
    // Clear custom icon input box
    const customInput = document.getElementById('custom-icon-input');
    if (customInput) {
        customInput.value = '';
    }
    // Close icon selector
    const iconPicker = document.getElementById('group-icon-picker');
    if (iconPicker) {
        iconPicker.style.display = 'none';
    }
}

// Select suggested tag
function selectSuggestion(name) {
    const input = document.getElementById('create-group-name-input');
    if (input) {
        input.value = name;
        input.focus();
    }
}

// Toggle icon selector display state
function toggleGroupIconPicker() {
    const picker = document.getElementById('group-icon-picker');
    if (picker) {
        const isVisible = picker.style.display !== 'none';
        picker.style.display = isVisible ? 'none' : 'block';
    }
}

// Select group icon
function selectGroupIcon(icon) {
    const iconBtn = document.getElementById('create-group-icon-btn');
    if (iconBtn) {
        iconBtn.textContent = icon;
    }
    // Clear custom input box
    const customInput = document.getElementById('custom-icon-input');
    if (customInput) {
        customInput.value = '';
    }
    // Close selector
    const picker = document.getElementById('group-icon-picker');
    if (picker) {
        picker.style.display = 'none';
    }
}

// Apply custom icon
function applyCustomIcon() {
    const customInput = document.getElementById('custom-icon-input');
    if (!customInput) return;
    
    const customIcon = customInput.value.trim();
    if (!customIcon) {
        return;
    }
    
    const iconBtn = document.getElementById('create-group-icon-btn');
    if (iconBtn) {
        iconBtn.textContent = customIcon;
    }
    
    // Clear input box and close selector
    customInput.value = '';
    const picker = document.getElementById('group-icon-picker');
    if (picker) {
        picker.style.display = 'none';
    }
}

// Handle Enter key in custom icon input box
document.addEventListener('DOMContentLoaded', function() {
    const customInput = document.getElementById('custom-icon-input');
    if (customInput) {
        customInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                applyCustomIcon();
            }
        });
    }
});

// Click outside to close icon selector
document.addEventListener('click', function(event) {
    const picker = document.getElementById('group-icon-picker');
    const iconBtn = document.getElementById('create-group-icon-btn');
    if (picker && iconBtn) {
        // If click is not on icon button or selector itself, close selector
        if (!picker.contains(event.target) && !iconBtn.contains(event.target)) {
            picker.style.display = 'none';
        }
    }
});

// Create group
async function createGroup(event) {
    // Prevent event bubbling
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    const input = document.getElementById('create-group-name-input');
    if (!input) {
        console.error('Input box not found');
        return;
    }

    const name = input.value.trim();
    if (!name) {
        alert('Please enter a group name');
        return;
    }

    // Frontend validation: check if name already exists
    try {
        let groups;
        if (Array.isArray(groupsCache) && groupsCache.length > 0) {
            groups = groupsCache;
        } else {
            const response = await apiFetch('/api/groups');
            groups = await response.json();
        }
        
        // Ensure groups is a valid array
        if (!Array.isArray(groups)) {
            groups = [];
        }
        
        const nameExists = groups.some(g => g.name === name);
        if (nameExists) {
            alert('Group name already exists. Please choose a different name.');
            return;
        }
    } catch (error) {
        console.error('Failed to check group name:', error);
    }

    // Get selected icon
    const iconBtn = document.getElementById('create-group-icon-btn');
    const selectedIcon = iconBtn ? iconBtn.textContent.trim() : '📁';

    try {
        const response = await apiFetch('/api/groups', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                name: name,
                icon: selectedIcon,
            }),
        });

        if (!response.ok) {
            const error = await response.json();
            if (error.error && error.error.includes('already exists')) {
                alert('Group name already exists. Please choose a different name.');
                return;
            }
            throw new Error(error.error || 'Create failed');
        }

        const newGroup = await response.json();
        
        // Check if "Move to group" submenu is open
        const submenu = document.getElementById('move-to-group-submenu');
        const isSubmenuOpen = submenu && submenu.style.display !== 'none';

        await loadGroups();

        const modal = document.getElementById('create-group-modal');
        const shouldMove = modal && modal.dataset.moveConversation === 'true';
        
        closeCreateGroupModal();

        if (shouldMove && contextMenuConversationId) {
            moveConversationToGroup(contextMenuConversationId, newGroup.id);
        }

        // If submenu is open, refresh it to immediately show newly created group
        if (isSubmenuOpen) {
            await showMoveToGroupSubmenu();
        }
    } catch (error) {
        console.error('Failed to create group:', error);
        alert('Create failed: ' + (error.message || 'Unknown error'));
    }
}

// Enter group detail
async function enterGroupDetail(groupId) {
    currentGroupId = groupId;
    // When entering group detail page, clear current conversation group ID to avoid highlight conflict
    // Because at this point the user is viewing group details, not a conversation within the group
    currentConversationGroupId = null;
    
    try {
        const response = await apiFetch(`/api/groups/${groupId}`);
        const group = await response.json();
        
        if (!group) {
            currentGroupId = null;
            return;
        }

        // Show group detail page, hide conversation view, but keep sidebar visible
        const sidebar = document.querySelector('.conversation-sidebar');
        const groupDetailPage = document.getElementById('group-detail-page');
        const chatContainer = document.querySelector('.chat-container');
        const titleEl = document.getElementById('group-detail-title');

        // Keep sidebar visible
        if (sidebar) sidebar.style.display = 'flex';
        // Hide conversation view, show group detail page
        if (chatContainer) chatContainer.style.display = 'none';
        if (groupDetailPage) groupDetailPage.style.display = 'flex';
        if (titleEl) titleEl.textContent = group.name;

        // Refresh group list to ensure current group is highlighted
        await loadGroups();

        // Load group conversations (use search query if there is one)
        loadGroupConversations(groupId, currentGroupSearchQuery);
    } catch (error) {
        console.error('Failed to load group:', error);
        currentGroupId = null;
    }
}

// Exit group detail
function exitGroupDetail() {
    currentGroupId = null;
    currentGroupSearchQuery = ''; // Clear search state
    
    // Hide search box and clear search content
    const searchContainer = document.getElementById('group-search-container');
    const searchInput = document.getElementById('group-search-input');
    if (searchContainer) searchContainer.style.display = 'none';
    if (searchInput) searchInput.value = '';
    
    const sidebar = document.querySelector('.conversation-sidebar');
    const groupDetailPage = document.getElementById('group-detail-page');
    const chatContainer = document.querySelector('.chat-container');

    // Keep sidebar visible
    if (sidebar) sidebar.style.display = 'flex';
    // Hide group detail page, show conversation view
    if (groupDetailPage) groupDetailPage.style.display = 'none';
    if (chatContainer) chatContainer.style.display = 'flex';

    loadConversationsWithGroups();
}

// Load conversations in group
async function loadGroupConversations(groupId, searchQuery = '') {
    try {
        if (!groupId) {
            console.error('loadGroupConversations: groupId is null or undefined');
            return;
        }
        
        // Ensure group mapping is loaded
        if (Object.keys(conversationGroupMappingCache).length === 0) {
            await loadConversationGroupMapping();
        }
        
        // First clear list to avoid showing stale data
        const list = document.getElementById('group-conversations-list');
        if (!list) {
            console.error('group-conversations-list element not found');
            return;
        }
        
        // Show loading state
        if (searchQuery) {
            list.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text-muted);">Searching...</div>';
        } else {
            list.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text-muted);">Loading...</div>';
        }

        // Build URL; if search keyword exists, add search parameter
        let url = `/api/groups/${groupId}/conversations`;
        if (searchQuery && searchQuery.trim()) {
            url += '?search=' + encodeURIComponent(searchQuery.trim());
        }
        
        const response = await apiFetch(url);
        if (!response.ok) {
            console.error(`Failed to load conversations for group ${groupId}:`, response.statusText);
            list.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text-muted);">Load failed, please retry</div>';
            return;
        }
        
        let groupConvs = await response.json();
        
        // Handle null or undefined cases, treat as empty array
        if (!groupConvs) {
            groupConvs = [];
        }
        
        // Validate returned data type
        if (!Array.isArray(groupConvs)) {
            console.error(`Invalid response for group ${groupId}:`, groupConvs);
            list.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text-muted);">Data format error</div>';
            return;
        }
        
        // Update group mapping cache (only update conversations in current group)
        // First clean up previous mappings for this group (if any conversations were moved out)
        Object.keys(conversationGroupMappingCache).forEach(convId => {
            if (conversationGroupMappingCache[convId] === groupId) {
                // If this conversation is not in the new list, it has been moved out
                if (!groupConvs.find(c => c.id === convId)) {
                    delete conversationGroupMappingCache[convId];
                }
            }
        });
        
        // Update conversation mapping for the current group
        groupConvs.forEach(conv => {
            conversationGroupMappingCache[conv.id] = groupId;
        });

        // Clear list again (clear "Loading" prompt)
        list.innerHTML = '';

        if (groupConvs.length === 0) {
            if (searchQuery && searchQuery.trim()) {
                list.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text-muted);">No matching conversations found</div>';
            } else {
                list.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text-muted);">This group has no conversations</div>';
            }
            return;
        }

        // Load detailed information for each conversation to get messages
        for (const conv of groupConvs) {
            try {
                // Validate conversation ID exists
                if (!conv.id) {
                    console.warn('Conversation missing id:', conv);
                    continue;
                }
                
                const convResponse = await apiFetch(`/api/conversations/${conv.id}`);
                if (!convResponse.ok) {
                    console.error(`Failed to load conversation ${conv.id}:`, convResponse.statusText);
                    continue;
                }
                
                const fullConv = await convResponse.json();
                
                const item = document.createElement('div');
                item.className = 'group-conversation-item';
                item.dataset.conversationId = conv.id;
                // Only show active state when on group detail page and conversation ID matches
                // If not on group detail page, should not show active state
                if (currentGroupId && conv.id === currentConversationId) {
                    item.classList.add('active');
                } else {
                    item.classList.remove('active');
                }

                // Create content wrapper
                const contentWrapper = document.createElement('div');
                contentWrapper.className = 'group-conversation-content-wrapper';

                const titleWrapper = document.createElement('div');
                titleWrapper.style.display = 'flex';
                titleWrapper.style.alignItems = 'center';
                titleWrapper.style.gap = '4px';

                const title = document.createElement('div');
                title.className = 'group-conversation-title';
                const titleText = fullConv.title || conv.title || 'Unnamed conversation';
                title.textContent = safeTruncateText(titleText, 60);
                title.title = titleText; // Set full title for hover view
                titleWrapper.appendChild(title);

                // If conversation is pinned in the group, show pin icon
                if (conv.groupPinned) {
                    const pinIcon = document.createElement('span');
                    pinIcon.className = 'conversation-item-pinned';
                    pinIcon.innerHTML = '📌';
                    pinIcon.title = 'Pinned in group';
                    titleWrapper.appendChild(pinIcon);
                }

                contentWrapper.appendChild(titleWrapper);

                const timeWrapper = document.createElement('div');
                timeWrapper.className = 'group-conversation-time';
                const dateObj = fullConv.updatedAt ? new Date(fullConv.updatedAt) : new Date();
                timeWrapper.textContent = dateObj.toLocaleString('zh-CN', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });

                contentWrapper.appendChild(timeWrapper);

                // If there is a first message, show content preview
                if (fullConv.messages && fullConv.messages.length > 0) {
                    const firstMsg = fullConv.messages.find(m => m.role === 'user' && m.content);
                    if (firstMsg && firstMsg.content) {
                        const content = document.createElement('div');
                        content.className = 'group-conversation-content';
                        let preview = firstMsg.content.substring(0, 200);
                        if (firstMsg.content.length > 200) {
                            preview += '...';
                        }
                        content.textContent = preview;
                        contentWrapper.appendChild(content);
                    }
                }

                item.appendChild(contentWrapper);

                // Add three-dot menu button
                const menuBtn = document.createElement('button');
                menuBtn.className = 'conversation-item-menu';
                menuBtn.innerHTML = '⋯';
                menuBtn.onclick = (e) => {
                    e.stopPropagation();
                    contextMenuConversationId = conv.id;
                    showConversationContextMenu(e);
                };
                item.appendChild(menuBtn);

                item.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    // Switch to conversation view but keep group detail state
                    const groupDetailPage = document.getElementById('group-detail-page');
                    const chatContainer = document.querySelector('.chat-container');
                    if (groupDetailPage) groupDetailPage.style.display = 'none';
                    if (chatContainer) chatContainer.style.display = 'flex';
                    loadConversation(conv.id);
                };

                list.appendChild(item);
            } catch (err) {
                console.error(`Failed to load conversation ${conv.id}:`, err);
            }
        }
    } catch (error) {
        console.error('Failed to load group conversations:', error);
    }
}

// Edit group
async function editGroup() {
    if (!currentGroupId) return;

    try {
        const response = await apiFetch(`/api/groups/${currentGroupId}`);
        const group = await response.json();
        if (!group) return;

        const newName = prompt('Please enter new name:', group.name);
        if (newName === null || !newName.trim()) return;

        const trimmedName = newName.trim();
        
        // Frontend validation: check if name already exists (excluding current group)
        let groups;
        if (Array.isArray(groupsCache) && groupsCache.length > 0) {
            groups = groupsCache;
        } else {
            const response = await apiFetch('/api/groups');
            groups = await response.json();
        }
        
        // Ensure groups is a valid array
        if (!Array.isArray(groups)) {
            groups = [];
        }
        
        const nameExists = groups.some(g => g.name === trimmedName && g.id !== currentGroupId);
        if (nameExists) {
            alert('Group name already exists. Please choose a different name.');
            return;
        }

        const updateResponse = await apiFetch(`/api/groups/${currentGroupId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                name: trimmedName,
                icon: group.icon || '📁',
            }),
        });

        if (!updateResponse.ok) {
            const error = await updateResponse.json();
            if (error.error && error.error.includes('already exists')) {
                alert('Group name already exists. Please choose a different name.');
                return;
            }
            throw new Error(error.error || 'Update failed');
        }

        loadGroups();
        
        const titleEl = document.getElementById('group-detail-title');
        if (titleEl) {
            titleEl.textContent = trimmedName;
        }
    } catch (error) {
        console.error('Failed to edit group:', error);
        alert('Edit failed: ' + (error.message || 'Unknown error'));
    }
}

// Delete group
async function deleteGroup() {
    if (!currentGroupId) return;

    if (!confirm('Are you sure you want to delete this group? Conversations in the group will not be deleted but will be removed from the group.')) {
        return;
    }

    try {
        await apiFetch(`/api/groups/${currentGroupId}`, {
            method: 'DELETE',
        });

        // Update cache
        groupsCache = groupsCache.filter(g => g.id !== currentGroupId);
        Object.keys(conversationGroupMappingCache).forEach(convId => {
            if (conversationGroupMappingCache[convId] === currentGroupId) {
                delete conversationGroupMappingCache[convId];
            }
        });

        // If "Move to group" submenu is open, refresh it
        const submenu = document.getElementById('move-to-group-submenu');
        if (submenu && submenu.style.display !== 'none') {
            // Submenu is open; reload group list and refresh submenu
            await loadGroups();
            await showMoveToGroupSubmenu();
        } else {
            exitGroupDetail();
            await loadGroups();
        }
        
        // Refresh conversation list to ensure previously grouped conversations appear immediately
        await loadConversationsWithGroups();
    } catch (error) {
        console.error('Failed to delete group:', error);
        alert('Delete failed: ' + (error.message || 'Unknown error'));
    }
}

// Rename group from context menu
async function renameGroupFromContext() {
    const groupId = contextMenuGroupId;
    if (!groupId) return;

    try {
        const response = await apiFetch(`/api/groups/${groupId}`);
        const group = await response.json();
        if (!group) return;

        const newName = prompt('Please enter new name:', group.name);
        if (newName === null || !newName.trim()) {
            closeGroupContextMenu();
            return;
        }

        const trimmedName = newName.trim();
        
        // Frontend validation: check if name already exists (excluding current group)
        let groups;
        if (Array.isArray(groupsCache) && groupsCache.length > 0) {
            groups = groupsCache;
        } else {
            const response = await apiFetch('/api/groups');
            groups = await response.json();
        }
        
        // Ensure groups is a valid array
        if (!Array.isArray(groups)) {
            groups = [];
        }
        
        const nameExists = groups.some(g => g.name === trimmedName && g.id !== groupId);
        if (nameExists) {
            alert('Group name already exists. Please choose a different name.');
            return;
        }

        const updateResponse = await apiFetch(`/api/groups/${groupId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                name: trimmedName,
                icon: group.icon || '📁',
            }),
        });

        if (!updateResponse.ok) {
            const error = await updateResponse.json();
            if (error.error && error.error.includes('already exists')) {
                alert('Group name already exists. Please choose a different name.');
                return;
            }
            throw new Error(error.error || 'Update failed');
        }

        loadGroups();
        
        // If currently on group detail page, update title
        if (currentGroupId === groupId) {
            const titleEl = document.getElementById('group-detail-title');
            if (titleEl) {
                titleEl.textContent = trimmedName;
            }
        }
    } catch (error) {
        console.error('Failed to rename group:', error);
        alert('Rename failed: ' + (error.message || 'Unknown error'));
    }

    closeGroupContextMenu();
}

// Pin group from context menu
async function pinGroupFromContext() {
    const groupId = contextMenuGroupId;
    if (!groupId) return;

    try {
        // Get current group information
        const response = await apiFetch(`/api/groups/${groupId}`);
        const group = await response.json();
        if (!group) return;

        const newPinnedState = !group.pinned;

        // Call API to update pin state
        const updateResponse = await apiFetch(`/api/groups/${groupId}/pinned`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                pinned: newPinnedState,
            }),
        });

        if (!updateResponse.ok) {
            const error = await updateResponse.json();
            throw new Error(error.error || 'Update failed');
        }

        // Reload group list to update display order
        loadGroups();
    } catch (error) {
        console.error('Failed to pin group:', error);
        alert('Pin failed: ' + (error.message || 'Unknown error'));
    }

    closeGroupContextMenu();
}

// Delete group from context menu
async function deleteGroupFromContext() {
    const groupId = contextMenuGroupId;
    if (!groupId) return;

    if (!confirm('Are you sure you want to delete this group? Conversations in the group will not be deleted but will be removed from the group.')) {
        closeGroupContextMenu();
        return;
    }

    try {
        await apiFetch(`/api/groups/${groupId}`, {
            method: 'DELETE',
        });

        // Update cache
        groupsCache = groupsCache.filter(g => g.id !== groupId);
        Object.keys(conversationGroupMappingCache).forEach(convId => {
            if (conversationGroupMappingCache[convId] === groupId) {
                delete conversationGroupMappingCache[convId];
            }
        });

        // If "Move to group" submenu is open, refresh it
        const submenu = document.getElementById('move-to-group-submenu');
        if (submenu && submenu.style.display !== 'none') {
            // Submenu is open; reload group list and refresh submenu
            await loadGroups();
            await showMoveToGroupSubmenu();
        } else {
            // If currently on group detail page, exit detail page
            if (currentGroupId === groupId) {
                exitGroupDetail();
            }
            await loadGroups();
        }
        
        // Refresh conversation list to ensure previously grouped conversations appear immediately
        await loadConversationsWithGroups();
    } catch (error) {
        console.error('Failed to delete group:', error);
        alert('Delete failed: ' + (error.message || 'Unknown error'));
    }

    closeGroupContextMenu();
}

// Close group context menu
function closeGroupContextMenu() {
    const menu = document.getElementById('group-context-menu');
    if (menu) {
        menu.style.display = 'none';
    }
    contextMenuGroupId = null;
}


// Group search related variables
let groupSearchTimer = null;
let currentGroupSearchQuery = '';

// Toggle group search box show/hide
function toggleGroupSearch() {
    const searchContainer = document.getElementById('group-search-container');
    const searchInput = document.getElementById('group-search-input');
    
    if (!searchContainer || !searchInput) return;
    
    if (searchContainer.style.display === 'none') {
        searchContainer.style.display = 'block';
        searchInput.focus();
    } else {
        searchContainer.style.display = 'none';
        clearGroupSearch();
    }
}

// Handle group search input
function handleGroupSearchInput(event) {
    // Support Enter key for search
    if (event.key === 'Enter') {
        event.preventDefault();
        performGroupSearch();
        return;
    }
    
    // Support ESC key to close search
    if (event.key === 'Escape') {
        clearGroupSearch();
        toggleGroupSearch();
        return;
    }
    
    const searchInput = document.getElementById('group-search-input');
    const clearBtn = document.getElementById('group-search-clear-btn');
    
    if (!searchInput) return;
    
    const query = searchInput.value.trim();
    
    // Show/hide clear button
    if (clearBtn) {
        clearBtn.style.display = query ? 'block' : 'none';
    }
    
    // Debounce search
    if (groupSearchTimer) {
        clearTimeout(groupSearchTimer);
    }
    
    groupSearchTimer = setTimeout(() => {
        performGroupSearch();
    }, 300); // 300ms debounce
}

// Execute group search
async function performGroupSearch() {
    const searchInput = document.getElementById('group-search-input');
    if (!searchInput || !currentGroupId) return;
    
    const query = searchInput.value.trim();
    currentGroupSearchQuery = query;
    
    // Load search results
    await loadGroupConversations(currentGroupId, query);
}

// Clear group search
function clearGroupSearch() {
    const searchInput = document.getElementById('group-search-input');
    const clearBtn = document.getElementById('group-search-clear-btn');
    
    if (searchInput) {
        searchInput.value = '';
    }
    if (clearBtn) {
        clearBtn.style.display = 'none';
    }
    
    currentGroupSearchQuery = '';
    
    // Reload group conversations (without search)
    if (currentGroupId) {
        loadGroupConversations(currentGroupId, '');
    }
}

// Load groups on initialization
document.addEventListener('DOMContentLoaded', async () => {
    await loadGroups();
    // Replace original loadConversations call
    if (typeof loadConversations === 'function') {
        // Retain original function but use new one
        const originalLoad = loadConversations;
        loadConversations = function(...args) {
            loadConversationsWithGroups(...args);
        };
    }
    await loadConversationsWithGroups();
    
    // Add auto-refresh conversation list on page focus
    // So when a conversation is created via OpenAPI, switching back to the page shows the new conversation
    let lastFocusTime = Date.now();
    const CONVERSATION_REFRESH_INTERVAL = 30000; // Refresh at most once per 30 seconds to avoid excessive frequency
    
    window.addEventListener('focus', () => {
        const now = Date.now();
        // Only refresh conversation list if more than 30 seconds have passed since last refresh
        if (now - lastFocusTime > CONVERSATION_REFRESH_INTERVAL) {
            lastFocusTime = now;
            if (typeof loadConversationsWithGroups === 'function') {
                loadConversationsWithGroups();
            }
        }
    });
    
    // Listen for page visibility changes (when user switches back to the tab)
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            // When page becomes visible, check if refresh is needed
            const now = Date.now();
            if (now - lastFocusTime > CONVERSATION_REFRESH_INTERVAL) {
                lastFocusTime = now;
                if (typeof loadConversationsWithGroups === 'function') {
                    loadConversationsWithGroups();
                }
            }
        }
    });
});

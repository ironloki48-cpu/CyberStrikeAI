// Task management page functionality

// HTML escape function (if not defined)
if (typeof escapeHtml === 'undefined') {
    function escapeHtml(text) {
        if (text == null) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Task management state
const tasksState = {
    allTasks: [],
    filteredTasks: [],
    selectedTasks: new Set(),
    autoRefresh: true,
    refreshInterval: null,
    durationUpdateInterval: null,
    completedTasksHistory: [], // Save the most recently completed task history
    showHistory: true // Whether to show history
};

// Load completed task history from localStorage
function loadCompletedTasksHistory() {
    try {
        const saved = localStorage.getItem('tasks-completed-history');
        if (saved) {
            const history = JSON.parse(saved);
            // Only keep tasks completed within the last 24 hours
            const now = Date.now();
            const oneDayAgo = now - 24 * 60 * 60 * 1000;
            tasksState.completedTasksHistory = history.filter(task => {
                const completedTime = task.completedAt || task.startedAt;
                return completedTime && new Date(completedTime).getTime() > oneDayAgo;
            });
            // Save the cleaned-up history
            saveCompletedTasksHistory();
        }
    } catch (error) {
        console.error('Failed to load completed task history:', error);
        tasksState.completedTasksHistory = [];
    }
}

// Save completed task history to localStorage
function saveCompletedTasksHistory() {
    try {
        localStorage.setItem('tasks-completed-history', JSON.stringify(tasksState.completedTasksHistory));
    } catch (error) {
        console.error('Failed to save completed task history:', error);
    }
}

// Update completed task history
function updateCompletedTasksHistory(currentTasks) {
    // Save snapshot of all current tasks (for comparison next time)
    const currentTaskIds = new Set(currentTasks.map(t => t.conversationId));
    
    // If this is the first load, just save the current task snapshot
    if (tasksState.allTasks.length === 0) {
        return;
    }
    
    const previousTaskIds = new Set(tasksState.allTasks.map(t => t.conversationId));
    
    // Find tasks that just completed (previously existed but no longer present)
    // Any task that disappears from the list is considered completed
    const justCompleted = tasksState.allTasks.filter(task => {
        return previousTaskIds.has(task.conversationId) && !currentTaskIds.has(task.conversationId);
    });
    
    // Add newly completed tasks to history
    justCompleted.forEach(task => {
        // Check if already exists (to avoid duplicate entries)
        const exists = tasksState.completedTasksHistory.some(t => t.conversationId === task.conversationId);
        if (!exists) {
            // If task status is not a final status, mark as completed
            const finalStatus = ['completed', 'failed', 'timeout', 'cancelled'].includes(task.status) 
                ? task.status 
                : 'completed';
            
            tasksState.completedTasksHistory.push({
                conversationId: task.conversationId,
                message: task.message || 'Unnamed Task',
                startedAt: task.startedAt,
                status: finalStatus,
                completedAt: new Date().toISOString()
            });
        }
    });
    
    // Limit history size (keep at most 50 entries)
    if (tasksState.completedTasksHistory.length > 50) {
        tasksState.completedTasksHistory = tasksState.completedTasksHistory
            .sort((a, b) => new Date(b.completedAt || b.startedAt) - new Date(a.completedAt || a.startedAt))
            .slice(0, 50);
    }
    
    saveCompletedTasksHistory();
}

// Load task list
async function loadTasks() {
    const listContainer = document.getElementById('tasks-list');
    if (!listContainer) return;
    
    listContainer.innerHTML = '<div class="loading-spinner">Loading...</div>';

    try {
        // Load running tasks and completed task history in parallel
        const [activeResponse, completedResponse] = await Promise.allSettled([
            apiFetch('/api/agent-loop/tasks'),
            apiFetch('/api/agent-loop/tasks/completed').catch(() => null) // If API does not exist, return null
        ]);

        // Handle running tasks
        if (activeResponse.status === 'rejected' || !activeResponse.value || !activeResponse.value.ok) {
            throw new Error('Failed to get task list');
        }

        const activeResult = await activeResponse.value.json();
        const activeTasks = activeResult.tasks || [];
        
        // Load completed task history (if API is available)
        let completedTasks = [];
        if (completedResponse.status === 'fulfilled' && completedResponse.value && completedResponse.value.ok) {
            try {
                const completedResult = await completedResponse.value.json();
                completedTasks = completedResult.tasks || [];
            } catch (e) {
                console.warn('Failed to parse completed task history:', e);
            }
        }
        
        // Save all tasks
        tasksState.allTasks = activeTasks;
        
        // Update completed task history (from backend API)
        if (completedTasks.length > 0) {
            // Merge backend and local history records (deduplicate)
            const backendTaskIds = new Set(completedTasks.map(t => t.conversationId));
            const localHistory = tasksState.completedTasksHistory.filter(t => 
                !backendTaskIds.has(t.conversationId)
            );
            
            // Backend history takes priority, then add local-only entries
            tasksState.completedTasksHistory = [
                ...completedTasks.map(t => ({
                    conversationId: t.conversationId,
                    message: t.message || 'Unnamed Task',
                    startedAt: t.startedAt,
                    status: t.status || 'completed',
                    completedAt: t.completedAt || new Date().toISOString()
                })),
                ...localHistory
            ];
            
            // Limit history size
            if (tasksState.completedTasksHistory.length > 50) {
                tasksState.completedTasksHistory = tasksState.completedTasksHistory
                    .sort((a, b) => new Date(b.completedAt || b.startedAt) - new Date(a.completedAt || a.startedAt))
                    .slice(0, 50);
            }
            
            saveCompletedTasksHistory();
        } else {
            // If backend API is not available, still use frontend logic to update history
            updateCompletedTasksHistory(activeTasks);
        }
        
        updateTaskStats(activeTasks);
        filterAndSortTasks();
        startDurationUpdates();
    } catch (error) {
        console.error('Failed to load tasks:', error);
        listContainer.innerHTML = `
            <div class="tasks-empty">
                <p>Failed to load: ${escapeHtml(error.message)}</p>
                <button class="btn-secondary" onclick="loadTasks()">Retry</button>
            </div>
        `;
    }
}

// Update task statistics
function updateTaskStats(tasks) {
    const stats = {
        running: 0,
        cancelling: 0,
        completed: 0,
        failed: 0,
        timeout: 0,
        cancelled: 0,
        total: tasks.length
    };

    tasks.forEach(task => {
        if (task.status === 'running') {
            stats.running++;
        } else if (task.status === 'cancelling') {
            stats.cancelling++;
        } else if (task.status === 'completed') {
            stats.completed++;
        } else if (task.status === 'failed') {
            stats.failed++;
        } else if (task.status === 'timeout') {
            stats.timeout++;
        } else if (task.status === 'cancelled') {
            stats.cancelled++;
        }
    });

    const statRunning = document.getElementById('stat-running');
    const statCancelling = document.getElementById('stat-cancelling');
    const statCompleted = document.getElementById('stat-completed');
    const statTotal = document.getElementById('stat-total');

    if (statRunning) statRunning.textContent = stats.running;
    if (statCancelling) statCancelling.textContent = stats.cancelling;
    if (statCompleted) statCompleted.textContent = stats.completed;
    if (statTotal) statTotal.textContent = stats.total;
}

// Filter tasks
function filterTasks() {
    filterAndSortTasks();
}

// Sort tasks
function sortTasks() {
    filterAndSortTasks();
}

// Filter and sort tasks
function filterAndSortTasks() {
    const statusFilter = document.getElementById('tasks-status-filter')?.value || 'all';
    const sortBy = document.getElementById('tasks-sort-by')?.value || 'time-desc';
    
    // Merge current tasks and history tasks
    let allTasks = [...tasksState.allTasks];
    
    // If showing history, add historical tasks
    if (tasksState.showHistory) {
        const historyTasks = tasksState.completedTasksHistory
            .filter(ht => !tasksState.allTasks.some(t => t.conversationId === ht.conversationId))
            .map(ht => ({ ...ht, isHistory: true }));
        allTasks = [...allTasks, ...historyTasks];
    }
    
    // Filter
    let filtered = allTasks;
    if (statusFilter === 'active') {
        // Only running tasks (exclude history)
        filtered = tasksState.allTasks.filter(task => 
            task.status === 'running' || task.status === 'cancelling'
        );
    } else if (statusFilter === 'history') {
        // History only
        filtered = allTasks.filter(task => task.isHistory);
    } else if (statusFilter !== 'all') {
        filtered = allTasks.filter(task => task.status === statusFilter);
    }
    
    // Sort
    filtered.sort((a, b) => {
        const aTime = new Date(a.completedAt || a.startedAt);
        const bTime = new Date(b.completedAt || b.startedAt);
        
        switch (sortBy) {
            case 'time-asc':
                return aTime - bTime;
            case 'time-desc':
                return bTime - aTime;
            case 'status':
                return (a.status || '').localeCompare(b.status || '');
            case 'message':
                return (a.message || '').localeCompare(b.message || '');
            default:
                return 0;
        }
    });
    
    tasksState.filteredTasks = filtered;
    renderTasks(filtered);
    updateBatchActions();
}

// Toggle show history
function toggleShowHistory(show) {
    tasksState.showHistory = show;
    localStorage.setItem('tasks-show-history', show ? 'true' : 'false');
    filterAndSortTasks();
}

// Calculate execution duration
function calculateDuration(startedAt) {
    if (!startedAt) return 'Unknown';
    const start = new Date(startedAt);
    const now = new Date();
    const diff = Math.floor((now - start) / 1000); // seconds
    
    if (diff < 60) {
        return `${diff}s`;
    } else if (diff < 3600) {
        const minutes = Math.floor(diff / 60);
        const seconds = diff % 60;
        return `${minutes}m ${seconds}s`;
    } else {
        const hours = Math.floor(diff / 3600);
        const minutes = Math.floor((diff % 3600) / 60);
        return `${hours}h ${minutes}m`;
    }
}

// Start duration updates
function startDurationUpdates() {
    // Clear old timer
    if (tasksState.durationUpdateInterval) {
        clearInterval(tasksState.durationUpdateInterval);
    }
    
    // Update execution duration every second
    tasksState.durationUpdateInterval = setInterval(() => {
        updateTaskDurations();
    }, 1000);
}

// Update task execution duration display
function updateTaskDurations() {
    const taskItems = document.querySelectorAll('.task-item[data-task-id]');
    taskItems.forEach(item => {
        const startedAt = item.dataset.startedAt;
        const status = item.dataset.status;
        const durationEl = item.querySelector('.task-duration');
        
        if (durationEl && startedAt && (status === 'running' || status === 'cancelling')) {
            durationEl.textContent = calculateDuration(startedAt);
        }
    });
}

// Render task list
function renderTasks(tasks) {
    const listContainer = document.getElementById('tasks-list');
    if (!listContainer) return;

    if (tasks.length === 0) {
        listContainer.innerHTML = `
            <div class="tasks-empty">
                <p>No tasks match the current criteria</p>
                ${tasksState.allTasks.length === 0 && tasksState.completedTasksHistory.length > 0 ? 
                    '<p style="margin-top: 8px; color: var(--text-muted); font-size: 0.875rem;">Tip: There are completed task history entries, check "Show History" to view</p>' : ''}
            </div>
        `;
        return;
    }

    // Status map
    const statusMap = {
        'running': { text: 'Running', class: 'task-status-running' },
        'cancelling': { text: 'Cancelling', class: 'task-status-cancelling' },
        'failed': { text: 'Failed', class: 'task-status-failed' },
        'timeout': { text: 'Timed Out', class: 'task-status-timeout' },
        'cancelled': { text: 'Cancelled', class: 'task-status-cancelled' },
        'completed': { text: 'Completed', class: 'task-status-completed' }
    };

    // Separate current tasks from historical tasks
    const activeTasks = tasks.filter(t => !t.isHistory);
    const historyTasks = tasks.filter(t => t.isHistory);

    let html = '';
    
    // Render current tasks
    if (activeTasks.length > 0) {
        html += activeTasks.map(task => renderTaskItem(task, statusMap)).join('');
    }
    
    // Render historical tasks
    if (historyTasks.length > 0) {
        html += `<div class="tasks-history-section">
            <div class="tasks-history-header">
                <span class="tasks-history-title">📜 Recently Completed Tasks (Last 24 Hours)</span>
                <button class="btn-secondary btn-small" onclick="clearTasksHistory()">Clear History</button>
            </div>
            ${historyTasks.map(task => renderTaskItem(task, statusMap, true)).join('')}
        </div>`;
    }
    
    listContainer.innerHTML = html;
}

// Render a single task item
function renderTaskItem(task, statusMap, isHistory = false) {
    const startedTime = task.startedAt ? new Date(task.startedAt) : null;
    const completedTime = task.completedAt ? new Date(task.completedAt) : null;
    
    const timeText = startedTime && !isNaN(startedTime.getTime())
        ? startedTime.toLocaleString('zh-CN', { 
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        })
        : 'UnknownTime';
    
    const completedText = completedTime && !isNaN(completedTime.getTime())
        ? completedTime.toLocaleString('zh-CN', { 
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        })
        : '';

    const status = statusMap[task.status] || { text: task.status, class: 'task-status-unknown' };
    const isFinalStatus = ['failed', 'timeout', 'cancelled', 'completed'].includes(task.status);
    const canCancel = !isFinalStatus && task.status !== 'cancelling' && !isHistory;
    const isSelected = tasksState.selectedTasks.has(task.conversationId);
    const duration = (task.status === 'running' || task.status === 'cancelling') 
        ? calculateDuration(task.startedAt) 
        : '';

    return `
        <div class="task-item ${isHistory ? 'task-item-history' : ''}" data-task-id="${task.conversationId}" data-started-at="${task.startedAt}" data-status="${task.status}">
            <div class="task-header">
                <div class="task-info">
                    ${canCancel ? `
                        <label class="task-checkbox">
                            <input type="checkbox" ${isSelected ? 'checked' : ''} 
                                   onchange="toggleTaskSelection('${task.conversationId}', this.checked)">
                        </label>
                    ` : '<div class="task-checkbox-placeholder"></div>'}
                    <span class="task-status ${status.class}">${status.text}</span>
                    ${isHistory ? '<span class="task-history-badge" title="History">📜</span>' : ''}
                    <span class="task-message" title="${escapeHtml(task.message || 'Unnamed Task')}">${escapeHtml(task.message || 'Unnamed Task')}</span>
                </div>
                <div class="task-actions">
                    ${duration ? `<span class="task-duration" title="Execution Duration">⏱ ${duration}</span>` : ''}
                    <span class="task-time" title="${isHistory && completedText ? 'Completed Time' : 'Start Time'}">
                        ${isHistory && completedText ? completedText : timeText}
                    </span>
                    ${canCancel ? `<button class="btn-secondary btn-small" onclick="cancelTask('${task.conversationId}', this)">Cancel Task</button>` : ''}
                    ${task.conversationId ? `<button class="btn-secondary btn-small" onclick="viewConversation('${task.conversationId}')">View Conversation</button>` : ''}
                </div>
            </div>
            ${task.conversationId ? `
                <div class="task-details">
                    <span class="task-id-label">Conversation ID:</span>
                    <span class="task-id-value" title="Click to copy" onclick="copyTaskId('${task.conversationId}')">${escapeHtml(task.conversationId)}</span>
                </div>
            ` : ''}
        </div>
    `;
}

// Clear task history
function clearTasksHistory() {
    if (!confirm('Are you sure you want to clear all task history?')) {
        return;
    }
    tasksState.completedTasksHistory = [];
    saveCompletedTasksHistory();
    filterAndSortTasks();
}

// Toggle task selection
function toggleTaskSelection(conversationId, selected) {
    if (selected) {
        tasksState.selectedTasks.add(conversationId);
    } else {
        tasksState.selectedTasks.delete(conversationId);
    }
    updateBatchActions();
}

// Update batch actions UI
function updateBatchActions() {
    const batchActions = document.getElementById('tasks-batch-actions');
    const selectedCount = document.getElementById('tasks-selected-count');
    
    if (!batchActions || !selectedCount) return;
    
    const count = tasksState.selectedTasks.size;
    if (count > 0) {
        batchActions.style.display = 'flex';
        selectedCount.textContent = `${count} item(s) selected`;
    } else {
        batchActions.style.display = 'none';
    }
}

// Clear task selection
function clearTaskSelection() {
    tasksState.selectedTasks.clear();
    updateBatchActions();
    // Re-render to update checkbox status
    filterAndSortTasks();
}

// Batch cancel tasks
async function batchCancelTasks() {
    const selected = Array.from(tasksState.selectedTasks);
    if (selected.length === 0) return;
    
    if (!confirm(`Are you sure you want to cancel ${selected.length} task(s)?`)) {
        return;
    }
    
    let successCount = 0;
    let failCount = 0;
    
    for (const conversationId of selected) {
        try {
            const response = await apiFetch('/api/agent-loop/cancel', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ conversationId }),
            });
            
            if (response.ok) {
                successCount++;
            } else {
                failCount++;
            }
        } catch (error) {
            console.error('Failed to cancel task:', conversationId, error);
            failCount++;
        }
    }
    
    // Clear selection
    clearTaskSelection();
    
    // Refresh task list
    await loadTasks();
    
    // Show result
    if (failCount > 0) {
        alert(`Batch cancel completed: ${successCount} succeeded, ${failCount} failed`);
    } else {
        alert(`Successfully cancelled ${successCount} task(s)`);
    }
}

// Copy task ID
function copyTaskId(conversationId) {
    navigator.clipboard.writeText(conversationId).then(() => {
        // Show copy success tooltip
        const tooltip = document.createElement('div');
        tooltip.textContent = 'Copied!';
        tooltip.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(0,0,0,0.8); color: white; padding: 8px 16px; border-radius: 4px; z-index: 10000;';
        document.body.appendChild(tooltip);
        setTimeout(() => tooltip.remove(), 1000);
    }).catch(err => {
        console.error('Copy failed:', err);
    });
}

// Cancel task
async function cancelTask(conversationId, button) {
    if (!conversationId) return;
    
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Cancelling...';

    try {
        const response = await apiFetch('/api/agent-loop/cancel', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ conversationId }),
        });

        if (!response.ok) {
            const result = await response.json().catch(() => ({}));
            throw new Error(result.error || 'Failed to cancel task');
        }

        // Remove from selection
        tasksState.selectedTasks.delete(conversationId);
        updateBatchActions();
        
        // Reload task list
        await loadTasks();
    } catch (error) {
        console.error('Failed to cancel task:', error);
        alert('Failed to cancel task: ' + error.message);
        button.disabled = false;
        button.textContent = originalText;
    }
}

// View conversation
function viewConversation(conversationId) {
    if (!conversationId) return;
    
    // Switch to conversation page
    if (typeof switchPage === 'function') {
        switchPage('chat');
        // Load and select the conversation - using global function
        setTimeout(() => {
            // Try multiple methods to load conversation
            if (typeof loadConversation === 'function') {
                loadConversation(conversationId);
            } else if (typeof window.loadConversation === 'function') {
                window.loadConversation(conversationId);
            } else {
                // If function does not exist, try URL navigation
                window.location.hash = `chat?conversation=${conversationId}`;
                console.log('Switched to conversation page, conversation ID:', conversationId);
            }
        }, 500);
    }
}

// Refresh task list
async function refreshTasks() {
    await loadTasks();
}

// Toggle auto-refresh
function toggleTasksAutoRefresh(enabled) {
    tasksState.autoRefresh = enabled;
    
    // Save to localStorage
    localStorage.setItem('tasks-auto-refresh', enabled ? 'true' : 'false');
    
    if (enabled) {
        // Start auto-refresh
        if (!tasksState.refreshInterval) {
            tasksState.refreshInterval = setInterval(() => {
                loadBatchQueues();
            }, 5000);
        }
    } else {
        // Stop auto-refresh
        if (tasksState.refreshInterval) {
            clearInterval(tasksState.refreshInterval);
            tasksState.refreshInterval = null;
        }
    }
}

// Initialize task management page
function initTasksPage() {
    // Restore auto-refresh settings
    const autoRefreshCheckbox = document.getElementById('tasks-auto-refresh');
    if (autoRefreshCheckbox) {
        const saved = localStorage.getItem('tasks-auto-refresh');
        const enabled = saved !== null ? saved === 'true' : true;
        autoRefreshCheckbox.checked = enabled;
        toggleTasksAutoRefresh(enabled);
    } else {
        toggleTasksAutoRefresh(true);
    }
    
    // Only load batch task queues
    loadBatchQueues();
}

// Clean up timers (called when switching pages)
function cleanupTasksPage() {
    if (tasksState.refreshInterval) {
        clearInterval(tasksState.refreshInterval);
        tasksState.refreshInterval = null;
    }
    if (tasksState.durationUpdateInterval) {
        clearInterval(tasksState.durationUpdateInterval);
        tasksState.durationUpdateInterval = null;
    }
    tasksState.selectedTasks.clear();
    stopBatchQueueRefresh();
}

// Export functions for global use
window.loadTasks = loadTasks;
window.cancelTask = cancelTask;
window.viewConversation = viewConversation;
window.refreshTasks = refreshTasks;
window.initTasksPage = initTasksPage;
window.cleanupTasksPage = cleanupTasksPage;
window.filterTasks = filterTasks;
window.sortTasks = sortTasks;
window.toggleTaskSelection = toggleTaskSelection;
window.clearTaskSelection = clearTaskSelection;
window.batchCancelTasks = batchCancelTasks;
window.copyTaskId = copyTaskId;
window.toggleTasksAutoRefresh = toggleTasksAutoRefresh;
window.toggleShowHistory = toggleShowHistory;
window.clearTasksHistory = clearTasksHistory;

// ==================== Batch Task Features ====================

// Batch task state
const batchQueuesState = {
    queues: [],
    currentQueueId: null,
    refreshInterval: null,
    // Filter and pagination state
    filterStatus: 'all', // 'all', 'pending', 'running', 'paused', 'completed', 'cancelled'
    searchKeyword: '',
    currentPage: 1,
    pageSize: 10,
    total: 0,
    totalPages: 1
};

// Show new task modal
async function showBatchImportModal() {
    const modal = document.getElementById('batch-import-modal');
    const input = document.getElementById('batch-tasks-input');
    const titleInput = document.getElementById('batch-queue-title');
    const roleSelect = document.getElementById('batch-queue-role');
    if (modal && input) {
        input.value = '';
        if (titleInput) {
            titleInput.value = '';
        }
        // Reset role selection to default
        if (roleSelect) {
            roleSelect.value = '';
        }
        updateBatchImportStats('');
        
        // Load and populate role list
        if (roleSelect && typeof loadRoles === 'function') {
            try {
                const loadedRoles = await loadRoles();
                // Clear existing options (except the default option)
                roleSelect.innerHTML = '<option value="">Default</option>';
                
                // Add enabled roles
                const sortedRoles = loadedRoles.sort((a, b) => {
                    if (a.name === 'Default') return -1;
                    if (b.name === 'Default') return 1;
                    return (a.name || '').localeCompare(b.name || '', 'zh-CN');
                });
                
                sortedRoles.forEach(role => {
                    if (role.name !== 'Default' && role.enabled !== false) {
                        const option = document.createElement('option');
                        option.value = role.name;
                        option.textContent = role.name;
                        roleSelect.appendChild(option);
                    }
                });
            } catch (error) {
                console.error('Failed to load role list:', error);
            }
        }
        
        modal.style.display = 'block';
        input.focus();
    }
}

// Close new task modal
function closeBatchImportModal() {
    const modal = document.getElementById('batch-import-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Update new task statistics
function updateBatchImportStats(text) {
    const statsEl = document.getElementById('batch-import-stats');
    if (!statsEl) return;
    
    const lines = text.split('\n').filter(line => line.trim() !== '');
    const count = lines.length;
    
    if (count > 0) {
        statsEl.innerHTML = `<div class="batch-import-stat">Total: ${count} task(s)</div>`;
        statsEl.style.display = 'block';
    } else {
        statsEl.style.display = 'none';
    }
}

// Listen for batch task input
document.addEventListener('DOMContentLoaded', function() {
    const input = document.getElementById('batch-tasks-input');
    if (input) {
        input.addEventListener('input', function() {
            updateBatchImportStats(this.value);
        });
    }
});

// Create batch task queue
async function createBatchQueue() {
    const input = document.getElementById('batch-tasks-input');
    const titleInput = document.getElementById('batch-queue-title');
    const roleSelect = document.getElementById('batch-queue-role');
    if (!input) return;
    
    const text = input.value.trim();
    if (!text) {
        alert('Please enter at least one task');
        return;
    }
    
    // Split tasks by line
    const tasks = text.split('\n').map(line => line.trim()).filter(line => line !== '');
    if (tasks.length === 0) {
        alert('No valid tasks found');
        return;
    }
    
    // Get title (optional)
    const title = titleInput ? titleInput.value.trim() : '';
    
    // Get role (optional, empty string means default role)
    const role = roleSelect ? roleSelect.value || '' : '';
    
    try {
        const response = await apiFetch('/api/batch-tasks', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ title, tasks, role }),
        });
        
        if (!response.ok) {
            const result = await response.json().catch(() => ({}));
            throw new Error(result.error || 'Failed to create batch task queue');
        }
        
        const result = await response.json();
        closeBatchImportModal();
        
        // Show queue details
        showBatchQueueDetail(result.queueId);
        
        // Refresh batch queue list
        refreshBatchQueues();
    } catch (error) {
        console.error('Failed to create batch task queue:', error);
        alert('Failed to create batch task queue: ' + error.message);
    }
}

// Get role icon (helper function)
function getRoleIconForDisplay(roleName, rolesList) {
    if (!roleName || roleName === '') {
        return '🔵'; // Default role icon
    }
    
    if (Array.isArray(rolesList) && rolesList.length > 0) {
        const role = rolesList.find(r => r.name === roleName);
        if (role && role.icon) {
            let icon = role.icon;
            // Check if it is Unicode escape format (may contain quotes)
            const unicodeMatch = icon.match(/^"?\\U([0-9A-F]{8})"?$/i);
            if (unicodeMatch) {
                try {
                    const codePoint = parseInt(unicodeMatch[1], 16);
                    icon = String.fromCodePoint(codePoint);
                } catch (e) {
                    // Conversion failed, use default icon
                    console.warn('Failed to convert icon Unicode escape:', icon, e);
                    return '👤';
                }
            }
            return icon;
        }
    }
    return '👤'; // Default icon
}

// Load batch task queue list
async function loadBatchQueues(page) {
    const section = document.getElementById('batch-queues-section');
    if (!section) return;
    
    // If page is specified, use it; otherwise use current page
    if (page !== undefined) {
        batchQueuesState.currentPage = page;
    }
    
    // Load role list (for displaying correct role icons)
    let loadedRoles = [];
    if (typeof loadRoles === 'function') {
        try {
            loadedRoles = await loadRoles();
        } catch (error) {
            console.warn('Failed to load role list, will use default icon:', error);
        }
    }
    batchQueuesState.loadedRoles = loadedRoles; // Save to state for use during rendering
    
    // Build query parameters
    const params = new URLSearchParams();
    params.append('page', batchQueuesState.currentPage.toString());
    params.append('limit', batchQueuesState.pageSize.toString());
    if (batchQueuesState.filterStatus && batchQueuesState.filterStatus !== 'all') {
        params.append('status', batchQueuesState.filterStatus);
    }
    if (batchQueuesState.searchKeyword) {
        params.append('keyword', batchQueuesState.searchKeyword);
    }
    
    try {
        const response = await apiFetch(`/api/batch-tasks?${params.toString()}`);
        if (!response.ok) {
            throw new Error('Failed to get batch task queues');
        }
        
        const result = await response.json();
        batchQueuesState.queues = result.queues || [];
        batchQueuesState.total = result.total || 0;
        batchQueuesState.totalPages = result.total_pages || 1;
        renderBatchQueues();
    } catch (error) {
        console.error('Failed to load batch task queues:', error);
        section.style.display = 'block';
        const list = document.getElementById('batch-queues-list');
        if (list) {
            list.innerHTML = '<div class="tasks-empty"><p>Failed to load: ' + escapeHtml(error.message) + '</p><button class="btn-secondary" onclick="refreshBatchQueues()">Retry</button></div>';
        }
    }
}

// Filter batch task queues
function filterBatchQueues() {
    const statusFilter = document.getElementById('batch-queues-status-filter');
    const searchInput = document.getElementById('batch-queues-search');
    
    if (statusFilter) {
        batchQueuesState.filterStatus = statusFilter.value;
    }
    if (searchInput) {
        batchQueuesState.searchKeyword = searchInput.value.trim();
    }
    
    // Reset to first page and reload
    batchQueuesState.currentPage = 1;
    loadBatchQueues(1);
}

// Render batch task queue list
function renderBatchQueues() {
    const section = document.getElementById('batch-queues-section');
    const list = document.getElementById('batch-queues-list');
    const pagination = document.getElementById('batch-queues-pagination');
    
    if (!section || !list) return;
    
    section.style.display = 'block';
    
    const queues = batchQueuesState.queues;
    
    if (queues.length === 0) {
        list.innerHTML = '<div class="tasks-empty"><p>No batch task queues found</p></div>';
        if (pagination) pagination.style.display = 'none';
        return;
    }
    
    // Ensure pagination controls are visible (reset previously set display: none)
    if (pagination) {
        pagination.style.display = '';
    }
    
    list.innerHTML = queues.map(queue => {
        const statusMap = {
            'pending': { text: 'Pending', class: 'batch-queue-status-pending' },
            'running': { text: 'Running', class: 'batch-queue-status-running' },
            'paused': { text: 'Paused', class: 'batch-queue-status-paused' },
            'completed': { text: 'Completed', class: 'batch-queue-status-completed' },
            'cancelled': { text: 'Cancelled', class: 'batch-queue-status-cancelled' }
        };
        
        const status = statusMap[queue.status] || { text: queue.status, class: 'batch-queue-status-unknown' };
        
        // Tally task statuses
        const stats = {
            total: queue.tasks.length,
            pending: 0,
            running: 0,
            completed: 0,
            failed: 0,
            cancelled: 0
        };
        
        queue.tasks.forEach(task => {
            if (task.status === 'pending') stats.pending++;
            else if (task.status === 'running') stats.running++;
            else if (task.status === 'completed') stats.completed++;
            else if (task.status === 'failed') stats.failed++;
            else if (task.status === 'cancelled') stats.cancelled++;
        });
        
        const progress = stats.total > 0 ? Math.round((stats.completed + stats.failed + stats.cancelled) / stats.total * 100) : 0;
        // Allow deleting queues in pending, completed or cancelled status
        const canDelete = queue.status === 'pending' || queue.status === 'completed' || queue.status === 'cancelled';
        
        const titleDisplay = queue.title ? `<span class="batch-queue-title" style="font-weight: 600; color: var(--text-primary); margin-right: 8px;">${escapeHtml(queue.title)}</span>` : '';
        
        // Show role info (using the correct role icon)
        const loadedRoles = batchQueuesState.loadedRoles || [];
        const roleIcon = getRoleIconForDisplay(queue.role, loadedRoles);
        const roleName = queue.role && queue.role !== '' ? queue.role : 'Default';
        const roleDisplay = `<span class="batch-queue-role" style="margin-right: 8px;" title="Role: ${escapeHtml(roleName)}">${roleIcon} ${escapeHtml(roleName)}</span>`;
        
        return `
            <div class="batch-queue-item" data-queue-id="${queue.id}" onclick="showBatchQueueDetail('${queue.id}')">
                <div class="batch-queue-header">
                    <div class="batch-queue-info" style="flex: 1;">
                        ${titleDisplay}
                        ${roleDisplay}
                        <span class="batch-queue-status ${status.class}">${status.text}</span>
                        <span class="batch-queue-id">Queue ID: ${escapeHtml(queue.id)}</span>
                        <span class="batch-queue-time">Created: ${new Date(queue.createdAt).toLocaleString('en-US')}</span>
                    </div>
                    <div class="batch-queue-progress">
                        <div class="batch-queue-progress-bar">
                            <div class="batch-queue-progress-fill" style="width: ${progress}%"></div>
                        </div>
                        <span class="batch-queue-progress-text">${progress}% (${stats.completed + stats.failed + stats.cancelled}/${stats.total})</span>
                    </div>
                    <div class="batch-queue-actions" style="display: flex; align-items: center; gap: 8px; margin-left: 12px;" onclick="event.stopPropagation();">
                        ${canDelete ? `<button class="btn-secondary btn-small btn-danger" onclick="deleteBatchQueueFromList('${queue.id}')" title="Delete queue">Delete</button>` : ''}
                    </div>
                </div>
                <div class="batch-queue-stats">
                    <span>Total: ${stats.total}</span>
                    <span>Pending: ${stats.pending}</span>
                    <span>Running: ${stats.running}</span>
                    <span style="color: var(--success-color);">Completed: ${stats.completed}</span>
                    <span style="color: var(--error-color);">Failed: ${stats.failed}</span>
                    ${stats.cancelled > 0 ? `<span style="color: var(--text-secondary);">Cancelled: ${stats.cancelled}</span>` : ''}
                </div>
            </div>
        `;
    }).join('');
    
    // Render pagination controls
    renderBatchQueuesPagination();
}

// Render batch task queue pagination controls (following the Skills management page style)
function renderBatchQueuesPagination() {
    const paginationContainer = document.getElementById('batch-queues-pagination');
    if (!paginationContainer) return;
    
    const { currentPage, pageSize, total, totalPages } = batchQueuesState;
    
    // Show pagination info even when there is only one page (following Skills style)
    if (total === 0) {
        paginationContainer.innerHTML = '';
        return;
    }
    
    // Calculate display range
    const start = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
    const end = total === 0 ? 0 : Math.min(currentPage * pageSize, total);
    
    let paginationHTML = '<div class="pagination">';
    
    // Left side: display range info and per-page size selector (following Skills style)
    paginationHTML += `
        <div class="pagination-info">
            <span>Showing ${start}-${end} of ${total}</span>
            <label class="pagination-page-size">
                Per page:
                <select id="batch-queues-page-size-pagination" onchange="changeBatchQueuesPageSize()">
                    <option value="10" ${pageSize === 10 ? 'selected' : ''}>10</option>
                    <option value="20" ${pageSize === 20 ? 'selected' : ''}>20</option>
                    <option value="50" ${pageSize === 50 ? 'selected' : ''}>50</option>
                    <option value="100" ${pageSize === 100 ? 'selected' : ''}>100</option>
                </select>
            </label>
        </div>
    `;
    
    // Right side: pagination buttons (following Skills style: first, prev, page X/Y, next, last)
    paginationHTML += `
        <div class="pagination-controls">
            <button class="btn-secondary" onclick="goBatchQueuesPage(1)" ${currentPage === 1 || total === 0 ? 'disabled' : ''}>First</button>
            <button class="btn-secondary" onclick="goBatchQueuesPage(${currentPage - 1})" ${currentPage === 1 || total === 0 ? 'disabled' : ''}>Prev</button>
            <span class="pagination-page">Page ${currentPage} / ${totalPages || 1}</span>
            <button class="btn-secondary" onclick="goBatchQueuesPage(${currentPage + 1})" ${currentPage >= totalPages || total === 0 ? 'disabled' : ''}>Next</button>
            <button class="btn-secondary" onclick="goBatchQueuesPage(${totalPages || 1})" ${currentPage >= totalPages || total === 0 ? 'disabled' : ''}>Last</button>
        </div>
    `;
    
    paginationHTML += '</div>';
    
    paginationContainer.innerHTML = paginationHTML;
    
    // Ensure pagination component aligns with list content area (excluding scrollbar)
    function alignPaginationWidth() {
        const batchQueuesList = document.getElementById('batch-queues-list');
        if (batchQueuesList && paginationContainer) {
            // Get the actual content width of the list (excluding scrollbar)
            const listClientWidth = batchQueuesList.clientWidth; // Visible area width (excluding scrollbar)
            const listScrollHeight = batchQueuesList.scrollHeight; // Total content height
            const listClientHeight = batchQueuesList.clientHeight; // Visible area height
            const hasScrollbar = listScrollHeight > listClientHeight;
            
            // If list has a vertical scrollbar, pagination should align with list content area (clientWidth)
            // If no scrollbar, use 100% width
            if (hasScrollbar) {
                // Pagination component should align with list content area, excluding scrollbar
                paginationContainer.style.width = `${listClientWidth}px`;
            } else {
                // If no scrollbar, use 100% width
                paginationContainer.style.width = '100%';
            }
        }
    }
    
    // Execute once immediately
    alignPaginationWidth();
    
    // Listen for window resize and list content changes
    const resizeObserver = new ResizeObserver(() => {
        alignPaginationWidth();
    });
    
    const batchQueuesList = document.getElementById('batch-queues-list');
    if (batchQueuesList) {
        resizeObserver.observe(batchQueuesList);
    }
}

// Jump to specified page
function goBatchQueuesPage(page) {
    const { totalPages } = batchQueuesState;
    if (page < 1 || page > totalPages) return;
    
    loadBatchQueues(page);
    
    // Scroll to top of list
    const list = document.getElementById('batch-queues-list');
    if (list) {
        list.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

// Change per-page count
function changeBatchQueuesPageSize() {
    const pageSizeSelect = document.getElementById('batch-queues-page-size-pagination');
    if (!pageSizeSelect) return;
    
    const newPageSize = parseInt(pageSizeSelect.value, 10);
    if (newPageSize && newPageSize > 0) {
        batchQueuesState.pageSize = newPageSize;
        batchQueuesState.currentPage = 1; // Reset to first page
        loadBatchQueues(1);
    }
}

// Show batch task queue details
async function showBatchQueueDetail(queueId) {
    const modal = document.getElementById('batch-queue-detail-modal');
    const title = document.getElementById('batch-queue-detail-title');
    const content = document.getElementById('batch-queue-detail-content');
        const startBtn = document.getElementById('batch-queue-start-btn');
        const cancelBtn = document.getElementById('batch-queue-cancel-btn');
        const deleteBtn = document.getElementById('batch-queue-delete-btn');
        const addTaskBtn = document.getElementById('batch-queue-add-task-btn');
        
        if (!modal || !content) return;
        
        try {
        // Load role list (if not already loaded)
        let loadedRoles = [];
        if (typeof loadRoles === 'function') {
            try {
                loadedRoles = await loadRoles();
            } catch (error) {
                console.warn('Failed to load role list, will use default icon:', error);
            }
        }
        
        const response = await apiFetch(`/api/batch-tasks/${queueId}`);
        if (!response.ok) {
            throw new Error('Failed to get queue details');
        }
        
        const result = await response.json();
        const queue = result.queue;
        batchQueuesState.currentQueueId = queueId;
        
        if (title) {
            // textContent itself escapes; do not use escapeHtml again here, otherwise && will display as &amp;... (looks like garbled text)
            title.textContent = queue.title ? `Batch Task Queue - ${String(queue.title)}` : 'Batch Task Queue';
        }
        
        // Update button display
        const pauseBtn = document.getElementById('batch-queue-pause-btn');
        if (addTaskBtn) {
            addTaskBtn.style.display = queue.status === 'pending' ? 'inline-block' : 'none';
        }
        if (startBtn) {
            // Show "Start Execution" for pending status, "Resume Execution" for paused status
            startBtn.style.display = (queue.status === 'pending' || queue.status === 'paused') ? 'inline-block' : 'none';
            if (startBtn && queue.status === 'paused') {
                startBtn.textContent = 'Resume Execution';
            } else if (startBtn && queue.status === 'pending') {
                startBtn.textContent = 'Start Execution';
            }
        }
        if (pauseBtn) {
            // Show "Pause Queue" for running status
            pauseBtn.style.display = queue.status === 'running' ? 'inline-block' : 'none';
        }
        if (deleteBtn) {
            // Allow deleting queues in pending, completed or cancelled status
            deleteBtn.style.display = (queue.status === 'pending' || queue.status === 'completed' || queue.status === 'cancelled' || queue.status === 'paused') ? 'inline-block' : 'none';
        }
        
        // Queue status map
        const queueStatusMap = {
            'pending': { text: 'Pending', class: 'batch-queue-status-pending' },
            'running': { text: 'Running', class: 'batch-queue-status-running' },
            'paused': { text: 'Paused', class: 'batch-queue-status-paused' },
            'completed': { text: 'Completed', class: 'batch-queue-status-completed' },
            'cancelled': { text: 'Cancelled', class: 'batch-queue-status-cancelled' }
        };
        
        // Task status map
        const taskStatusMap = {
            'pending': { text: 'Pending', class: 'batch-task-status-pending' },
            'running': { text: 'Running', class: 'batch-task-status-running' },
            'completed': { text: 'Completed', class: 'batch-task-status-completed' },
            'failed': { text: 'Failed', class: 'batch-task-status-failed' },
            'cancelled': { text: 'Cancelled', class: 'batch-task-status-cancelled' }
        };
        
        // Get role info (if queue has role configuration)
        let roleDisplay = '';
        if (queue.role && queue.role !== '') {
            // If role is configured, try to get role details
            let roleName = queue.role;
            let roleIcon = '👤';
            // Find role icon from loaded role list
            if (Array.isArray(loadedRoles) && loadedRoles.length > 0) {
                const role = loadedRoles.find(r => r.name === roleName);
                if (role && role.icon) {
                    let icon = role.icon;
                    const unicodeMatch = icon.match(/^"?\\U([0-9A-F]{8})"?$/i);
                    if (unicodeMatch) {
                        try {
                            const codePoint = parseInt(unicodeMatch[1], 16);
                            icon = String.fromCodePoint(codePoint);
                        } catch (e) {
                            // Conversion failed, use default icon
                        }
                    }
                    roleIcon = icon;
                }
            }
            roleDisplay = `<div class="detail-item">
                <span class="detail-label">Role</span>
                <span class="detail-value">${roleIcon} ${escapeHtml(roleName)}</span>
            </div>`;
        } else {
            // Default role
            roleDisplay = `<div class="detail-item">
                <span class="detail-label">Role</span>
                <span class="detail-value">🔵 Default</span>
            </div>`;
        }
        
        content.innerHTML = `
            <div class="batch-queue-detail-info">
                ${queue.title ? `<div class="detail-item">
                    <span class="detail-label">Task Title</span>
                    <span class="detail-value">${escapeHtml(queue.title)}</span>
                </div>` : ''}
                ${roleDisplay}
                <div class="detail-item">
                    <span class="detail-label">Queue ID</span>
                    <span class="detail-value"><code>${escapeHtml(queue.id)}</code></span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Status</span>
                    <span class="detail-value"><span class="batch-queue-status ${queueStatusMap[queue.status]?.class || ''}">${queueStatusMap[queue.status]?.text || queue.status}</span></span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Created Time</span>
                    <span class="detail-value">${new Date(queue.createdAt).toLocaleString('en-US')}</span>
                </div>
                ${queue.startedAt ? `<div class="detail-item">
                    <span class="detail-label">Start Time</span>
                    <span class="detail-value">${new Date(queue.startedAt).toLocaleString('en-US')}</span>
                </div>` : ''}
                ${queue.completedAt ? `<div class="detail-item">
                    <span class="detail-label">Completed Time</span>
                    <span class="detail-value">${new Date(queue.completedAt).toLocaleString('en-US')}</span>
                </div>` : ''}
                <div class="detail-item">
                    <span class="detail-label">Total Tasks</span>
                    <span class="detail-value">${queue.tasks.length}</span>
                </div>
            </div>
            <div class="batch-queue-tasks-list">
                <h4>Task List</h4>
                ${queue.tasks.map((task, index) => {
                    const taskStatus = taskStatusMap[task.status] || { text: task.status, class: 'batch-task-status-unknown' };
                    const canEdit = queue.status === 'pending' && task.status === 'pending';
                    const taskMessageEscaped = escapeHtml(task.message).replace(/'/g, "&#39;").replace(/"/g, "&quot;").replace(/\n/g, "\\n");
                    return `
                        <div class="batch-task-item ${task.status === 'running' ? 'batch-task-item-active' : ''}" data-queue-id="${queue.id}" data-task-id="${task.id}" data-task-message="${taskMessageEscaped}">
                            <div class="batch-task-header">
                                <span class="batch-task-index">#${index + 1}</span>
                                <span class="batch-task-status ${taskStatus.class}">${taskStatus.text}</span>
                                <span class="batch-task-message" title="${escapeHtml(task.message)}">${escapeHtml(task.message)}</span>
                                ${canEdit ? `<button class="btn-secondary btn-small batch-task-edit-btn" onclick="editBatchTaskFromElement(this); event.stopPropagation();">Edit</button>` : ''}
                                ${canEdit ? `<button class="btn-secondary btn-small btn-danger batch-task-delete-btn" onclick="deleteBatchTaskFromElement(this); event.stopPropagation();">Delete</button>` : ''}
                                ${task.conversationId ? `<button class="btn-secondary btn-small" onclick="viewBatchTaskConversation('${task.conversationId}'); event.stopPropagation();">View Conversation</button>` : ''}
                            </div>
                            ${task.startedAt ? `<div class="batch-task-time">Started: ${new Date(task.startedAt).toLocaleString('en-US')}</div>` : ''}
                            ${task.completedAt ? `<div class="batch-task-time">Completed: ${new Date(task.completedAt).toLocaleString('en-US')}</div>` : ''}
                            ${task.error ? `<div class="batch-task-error">Error: ${escapeHtml(task.error)}</div>` : ''}
                            ${task.result ? `<div class="batch-task-result">Result: ${escapeHtml(task.result.substring(0, 200))}${task.result.length > 200 ? '...' : ''}</div>` : ''}
                        </div>
                    `;
                }).join('')}
            </div>
        `;
        
        modal.style.display = 'block';
        
        // If queue is running, auto-refresh
        if (queue.status === 'running') {
            startBatchQueueRefresh(queueId);
        }
    } catch (error) {
        console.error('Failed to get queue details:', error);
        alert('Failed to get queue details: ' + error.message);
    }
}

// Start batch task queue
async function startBatchQueue() {
    const queueId = batchQueuesState.currentQueueId;
    if (!queueId) return;
    
    try {
        const response = await apiFetch(`/api/batch-tasks/${queueId}/start`, {
            method: 'POST',
        });
        
        if (!response.ok) {
            const result = await response.json().catch(() => ({}));
            throw new Error(result.error || 'Failed to start batch task');
        }
        
        // Refresh details
        showBatchQueueDetail(queueId);
        refreshBatchQueues();
    } catch (error) {
        console.error('Failed to start batch task:', error);
        alert('Failed to start batch task: ' + error.message);
    }
}

// Pause batch task queue
async function pauseBatchQueue() {
    const queueId = batchQueuesState.currentQueueId;
    if (!queueId) return;
    
    if (!confirm('Are you sure you want to pause this batch task queue? The currently running task will be stopped, and subsequent tasks will remain in pending status.')) {
        return;
    }
    
    try {
        const response = await apiFetch(`/api/batch-tasks/${queueId}/pause`, {
            method: 'POST',
        });
        
        if (!response.ok) {
            const result = await response.json().catch(() => ({}));
            throw new Error(result.error || 'Failed to pause batch task');
        }
        
        // Refresh details
        showBatchQueueDetail(queueId);
        refreshBatchQueues();
    } catch (error) {
        console.error('Failed to pause batch task:', error);
        alert('Failed to pause batch task: ' + error.message);
    }
}

// Delete batch task queue (from details modal)
async function deleteBatchQueue() {
    const queueId = batchQueuesState.currentQueueId;
    if (!queueId) return;
    
    if (!confirm('Are you sure you want to delete this batch task queue? This action cannot be undone.')) {
        return;
    }
    
    try {
        const response = await apiFetch(`/api/batch-tasks/${queueId}`, {
            method: 'DELETE',
        });
        
        if (!response.ok) {
            const result = await response.json().catch(() => ({}));
            throw new Error(result.error || 'Failed to delete batch task queue');
        }
        
        closeBatchQueueDetailModal();
        refreshBatchQueues();
    } catch (error) {
        console.error('Failed to delete batch task queue:', error);
        alert('Failed to delete batch task queue: ' + error.message);
    }
}

// Delete batch task queue from list
async function deleteBatchQueueFromList(queueId) {
    if (!queueId) return;
    
    if (!confirm('Are you sure you want to delete this batch task queue? This action cannot be undone.')) {
        return;
    }
    
    try {
        const response = await apiFetch(`/api/batch-tasks/${queueId}`, {
            method: 'DELETE',
        });
        
        if (!response.ok) {
            const result = await response.json().catch(() => ({}));
            throw new Error(result.error || 'Failed to delete batch task queue');
        }
        
        // If currently viewing this queue's details, close the details modal
        if (batchQueuesState.currentQueueId === queueId) {
            closeBatchQueueDetailModal();
        }
        
        // Refresh queue list
        refreshBatchQueues();
    } catch (error) {
        console.error('Failed to delete batch task queue:', error);
        alert('Failed to delete batch task queue: ' + error.message);
    }
}

// Close batch task queue details modal
function closeBatchQueueDetailModal() {
    const modal = document.getElementById('batch-queue-detail-modal');
    if (modal) {
        modal.style.display = 'none';
    }
    batchQueuesState.currentQueueId = null;
    stopBatchQueueRefresh();
}

// Start batch queue refresh
function startBatchQueueRefresh(queueId) {
    if (batchQueuesState.refreshInterval) {
        clearInterval(batchQueuesState.refreshInterval);
    }
    
    batchQueuesState.refreshInterval = setInterval(() => {
        if (batchQueuesState.currentQueueId === queueId) {
            showBatchQueueDetail(queueId);
            refreshBatchQueues();
        } else {
            stopBatchQueueRefresh();
        }
    }, 3000); // Refresh every 3 seconds
}

// Stop batch queue refresh
function stopBatchQueueRefresh() {
    if (batchQueuesState.refreshInterval) {
        clearInterval(batchQueuesState.refreshInterval);
        batchQueuesState.refreshInterval = null;
    }
}

// Refresh batch task queue list
async function refreshBatchQueues() {
    await loadBatchQueues(batchQueuesState.currentPage);
}

// View batch task conversation
function viewBatchTaskConversation(conversationId) {
    if (!conversationId) return;
    
    // Close batch task details modal
    closeBatchQueueDetailModal();
    
    // Use URL hash navigation directly, let router handle page switching and conversation loading
    // This is more reliable because the router ensures the page switch is done before loading the conversation
    window.location.hash = `chat?conversation=${conversationId}`;
}

// Edit batch task state
const editBatchTaskState = {
    queueId: null,
    taskId: null
};

// Get task info from element and open edit modal
function editBatchTaskFromElement(button) {
    const taskItem = button.closest('.batch-task-item');
    if (!taskItem) {
        console.error('Could not find task item element');
        return;
    }
    
    const queueId = taskItem.getAttribute('data-queue-id');
    const taskId = taskItem.getAttribute('data-task-id');
    const taskMessage = taskItem.getAttribute('data-task-message');
    
    if (!queueId || !taskId) {
        console.error('Task info is incomplete');
        return;
    }
    
    // Decode HTML entities
    const decodedMessage = taskMessage
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/\\n/g, '\n');
    
    editBatchTask(queueId, taskId, decodedMessage);
}

// Open edit batch task modal
function editBatchTask(queueId, taskId, currentMessage) {
    editBatchTaskState.queueId = queueId;
    editBatchTaskState.taskId = taskId;
    
    const modal = document.getElementById('edit-batch-task-modal');
    const messageInput = document.getElementById('edit-task-message');
    
    if (!modal || !messageInput) {
        console.error('Edit task modal element does not exist');
        return;
    }
    
    messageInput.value = currentMessage;
    modal.style.display = 'block';
    
    // Focus on input field
    setTimeout(() => {
        messageInput.focus();
        messageInput.select();
    }, 100);
    
    // Add ESC key listener
    const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
            closeEditBatchTaskModal();
            document.removeEventListener('keydown', handleKeyDown);
        }
    };
    document.addEventListener('keydown', handleKeyDown);
    
    // Add Enter+Ctrl/Cmd save functionality
    const handleKeyPress = (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            saveBatchTask();
            document.removeEventListener('keydown', handleKeyPress);
        }
    };
    messageInput.addEventListener('keydown', handleKeyPress);
}

// Close edit batch task modal
function closeEditBatchTaskModal() {
    const modal = document.getElementById('edit-batch-task-modal');
    if (modal) {
        modal.style.display = 'none';
    }
    editBatchTaskState.queueId = null;
    editBatchTaskState.taskId = null;
}

// Save batch task
async function saveBatchTask() {
    const queueId = editBatchTaskState.queueId;
    const taskId = editBatchTaskState.taskId;
    const messageInput = document.getElementById('edit-task-message');
    
    if (!queueId || !taskId) {
        alert('Task info is incomplete');
        return;
    }
    
    if (!messageInput) {
        alert('Unable to get task message input field');
        return;
    }
    
    const message = messageInput.value.trim();
    if (!message) {
        alert('Task message cannot be empty');
        return;
    }
    
    try {
        const response = await apiFetch(`/api/batch-tasks/${queueId}/tasks/${taskId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message: message }),
        });
        
        if (!response.ok) {
            const result = await response.json().catch(() => ({}));
            throw new Error(result.error || 'Failed to update task');
        }
        
        // Close edit modal
        closeEditBatchTaskModal();
        
        // Refresh queue details
        if (batchQueuesState.currentQueueId === queueId) {
            showBatchQueueDetail(queueId);
        }
        
        // Refresh queue list
        refreshBatchQueues();
    } catch (error) {
        console.error('Failed to save task:', error);
        alert('Failed to save task: ' + error.message);
    }
}

// Show add batch task modal
function showAddBatchTaskModal() {
    const queueId = batchQueuesState.currentQueueId;
    if (!queueId) {
        alert('Queue info does not exist');
        return;
    }
    
    const modal = document.getElementById('add-batch-task-modal');
    const messageInput = document.getElementById('add-task-message');
    
    if (!modal || !messageInput) {
        console.error('Add task modal element does not exist');
        return;
    }
    
    messageInput.value = '';
    modal.style.display = 'block';
    
    // Focus on input field
    setTimeout(() => {
        messageInput.focus();
    }, 100);
    
    // Add ESC key listener
    const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
            closeAddBatchTaskModal();
            document.removeEventListener('keydown', handleKeyDown);
        }
    };
    document.addEventListener('keydown', handleKeyDown);
    
    // Add Enter+Ctrl/Cmd save functionality
    const handleKeyPress = (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            saveAddBatchTask();
            messageInput.removeEventListener('keydown', handleKeyPress);
        }
    };
    messageInput.addEventListener('keydown', handleKeyPress);
}

// Close add batch task modal
function closeAddBatchTaskModal() {
    const modal = document.getElementById('add-batch-task-modal');
    const messageInput = document.getElementById('add-task-message');
    if (modal) {
        modal.style.display = 'none';
    }
    if (messageInput) {
        messageInput.value = '';
    }
}

// Save added batch task
async function saveAddBatchTask() {
    const queueId = batchQueuesState.currentQueueId;
    const messageInput = document.getElementById('add-task-message');
    
    if (!queueId) {
        alert('Queue info does not exist');
        return;
    }
    
    if (!messageInput) {
        alert('Unable to get task message input field');
        return;
    }
    
    const message = messageInput.value.trim();
    if (!message) {
        alert('Task message cannot be empty');
        return;
    }
    
    try {
        const response = await apiFetch(`/api/batch-tasks/${queueId}/tasks`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message: message }),
        });
        
        if (!response.ok) {
            const result = await response.json().catch(() => ({}));
            throw new Error(result.error || 'Failed to add task');
        }
        
        // Close add task modal
        closeAddBatchTaskModal();
        
        // Refresh queue details
        if (batchQueuesState.currentQueueId === queueId) {
            showBatchQueueDetail(queueId);
        }
        
        // Refresh queue list
        refreshBatchQueues();
    } catch (error) {
        console.error('Failed to add task:', error);
        alert('Failed to add task: ' + error.message);
    }
}

// Get task info from element and delete task
function deleteBatchTaskFromElement(button) {
    const taskItem = button.closest('.batch-task-item');
    if (!taskItem) {
        console.error('Could not find task item element');
        return;
    }
    
    const queueId = taskItem.getAttribute('data-queue-id');
    const taskId = taskItem.getAttribute('data-task-id');
    const taskMessage = taskItem.getAttribute('data-task-message');
    
    if (!queueId || !taskId) {
        console.error('Task info is incomplete');
        return;
    }
    
    // Decode HTML entities for display
    const decodedMessage = taskMessage
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/\\n/g, '\n');
    
    // Truncate long message for confirmation dialog
    const displayMessage = decodedMessage.length > 50 
        ? decodedMessage.substring(0, 50) + '...' 
        : decodedMessage;
    
    if (!confirm(`Are you sure you want to delete this task?\n\nTask content: ${displayMessage}\n\nThis action cannot be undone.`)) {
        return;
    }
    
    deleteBatchTask(queueId, taskId);
}

// Delete batch task
async function deleteBatchTask(queueId, taskId) {
    if (!queueId || !taskId) {
        alert('Task info is incomplete');
        return;
    }
    
    try {
        const response = await apiFetch(`/api/batch-tasks/${queueId}/tasks/${taskId}`, {
            method: 'DELETE',
        });
        
        if (!response.ok) {
            const result = await response.json().catch(() => ({}));
            throw new Error(result.error || 'Failed to delete task');
        }
        
        // Refresh queue details
        if (batchQueuesState.currentQueueId === queueId) {
            showBatchQueueDetail(queueId);
        }
        
        // Refresh queue list
        refreshBatchQueues();
    } catch (error) {
        console.error('Failed to delete task:', error);
        alert('Failed to delete task: ' + error.message);
    }
}

// Export functions
window.showBatchImportModal = showBatchImportModal;
window.closeBatchImportModal = closeBatchImportModal;
window.createBatchQueue = createBatchQueue;
window.showBatchQueueDetail = showBatchQueueDetail;
window.startBatchQueue = startBatchQueue;
window.pauseBatchQueue = pauseBatchQueue;
window.deleteBatchQueue = deleteBatchQueue;
window.closeBatchQueueDetailModal = closeBatchQueueDetailModal;
window.refreshBatchQueues = refreshBatchQueues;
window.viewBatchTaskConversation = viewBatchTaskConversation;
window.editBatchTask = editBatchTask;
window.editBatchTaskFromElement = editBatchTaskFromElement;
window.closeEditBatchTaskModal = closeEditBatchTaskModal;
window.saveBatchTask = saveBatchTask;
window.filterBatchQueues = filterBatchQueues;
window.goBatchQueuesPage = goBatchQueuesPage;
window.changeBatchQueuesPageSize = changeBatchQueuesPageSize;
window.showAddBatchTaskModal = showAddBatchTaskModal;
window.closeAddBatchTaskModal = closeAddBatchTaskModal;
window.saveAddBatchTask = saveAddBatchTask;
window.deleteBatchTaskFromElement = deleteBatchTaskFromElement;
window.deleteBatchQueueFromList = deleteBatchQueueFromList;

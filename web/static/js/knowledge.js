// Knowledge base management related functions
let knowledgeCategories = [];
let knowledgeItems = [];
let currentEditingItemId = null;
let isSavingKnowledgeItem = false; // Prevent duplicate submissions
let retrievalLogsData = []; // Store retrieval log data for details view
let knowledgePagination = {
    currentPage: 1,
    pageSize: 10, // Number of categories per page (changed to paginate by category)
    total: 0,
    currentCategory: ''
};
let knowledgeSearchTimeout = null; // Search debounce timer

// Load knowledge categories
async function loadKnowledgeCategories() {
    try {
        // Add timestamp parameter to avoid caching
        const timestamp = Date.now();
        const response = await apiFetch(`/api/knowledge/categories?_t=${timestamp}`, {
            method: 'GET',
            headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            }
        });
        if (!response.ok) {
            throw new Error('Failed to fetch categories');
        }
        const data = await response.json();

        // Check whether the knowledge base feature is enabled
        if (data.enabled === false) {
            // Feature not enabled, show a friendly message
            const container = document.getElementById('knowledge-items-list');
            if (container) {
                container.innerHTML = `
                    <div class="empty-state" style="text-align: center; padding: 40px 20px;">
                        <div style="font-size: 48px; margin-bottom: 20px;">📚</div>
                        <h3 style="margin-bottom: 10px; color: #666;">Knowledge base feature is not enabled</h3>
                        <p style="color: #999; margin-bottom: 20px;">${data.message || 'Please go to system settings to enable the knowledge retrieval feature'}</p>
                        <button onclick="switchToSettings()" style="
                            background: #007bff;
                            color: white;
                            border: none;
                            padding: 10px 20px;
                            border-radius: 5px;
                            cursor: pointer;
                            font-size: 14px;
                        ">Go to Settings</button>
                    </div>
                `;
            }
            return [];
        }

        knowledgeCategories = data.categories || [];

        // Update the category filter dropdown
        const filterDropdown = document.getElementById('knowledge-category-filter-dropdown');
        if (filterDropdown) {
            filterDropdown.innerHTML = '<div class="custom-select-option" data-value="" onclick="selectKnowledgeCategory(\'\')">All</div>';
            knowledgeCategories.forEach(category => {
                const option = document.createElement('div');
                option.className = 'custom-select-option';
                option.setAttribute('data-value', category);
                option.textContent = category;
                option.onclick = function() {
                    selectKnowledgeCategory(category);
                };
                filterDropdown.appendChild(option);
            });
        }
        
        return knowledgeCategories;
    } catch (error) {
        console.error('Failed to load categories:', error);
        // Only show error when it is not a "feature not enabled" case
        if (!error.message.includes('Knowledge base feature is not enabled')) {
            showNotification('Failed to load categories: ' + error.message, 'error');
        }
        return [];
    }
}

// Load knowledge items list (supports pagination by category, does not load full content by default)
async function loadKnowledgeItems(category = '', page = 1, pageSize = 10) {
    try {
        // Update pagination status
        knowledgePagination.currentCategory = category;
        knowledgePagination.currentPage = page;
        knowledgePagination.pageSize = pageSize;

        // Build URL (paginate by category mode, does not include full content)
        const timestamp = Date.now();
        const offset = (page - 1) * pageSize;
        let url = `/api/knowledge/items?categoryPage=true&limit=${pageSize}&offset=${offset}&_t=${timestamp}`;
        if (category) {
            url += `&category=${encodeURIComponent(category)}`;
        }
        
        const response = await apiFetch(url, {
            method: 'GET',
            headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            }
        });
        
        if (!response.ok) {
            throw new Error('Failed to fetch knowledge items');
        }
        const data = await response.json();

        // Check whether the knowledge base feature is enabled
        if (data.enabled === false) {
            // Feature not enabled, show a friendly message (if not already shown)
            const container = document.getElementById('knowledge-items-list');
            if (container && !container.querySelector('.empty-state')) {
                container.innerHTML = `
                    <div class="empty-state" style="text-align: center; padding: 40px 20px;">
                        <div style="font-size: 48px; margin-bottom: 20px;">📚</div>
                        <h3 style="margin-bottom: 10px; color: #666;">Knowledge base feature is not enabled</h3>
                        <p style="color: #999; margin-bottom: 20px;">${data.message || 'Please go to system settings to enable the knowledge retrieval feature'}</p>
                        <button onclick="switchToSettings()" style="
                            background: #007bff;
                            color: white;
                            border: none;
                            padding: 10px 20px;
                            border-radius: 5px;
                            cursor: pointer;
                            font-size: 14px;
                        ">Go to Settings</button>
                    </div>
                `;
            }
            knowledgeItems = [];
            knowledgePagination.total = 0;
            renderKnowledgePagination();
            return [];
        }

        // Process response data paginated by category
        const categoriesWithItems = data.categories || [];
        knowledgePagination.total = data.total || 0; // Total number of categories

        renderKnowledgeItemsByCategories(categoriesWithItems);

        // If a single category is selected, do not show pagination (only one category is displayed)
        if (category) {
            const paginationContainer = document.getElementById('knowledge-pagination');
            if (paginationContainer) {
                paginationContainer.innerHTML = '';
            }
        } else {
            renderKnowledgePagination();
        }
        return categoriesWithItems;
    } catch (error) {
        console.error('Failed to load knowledge items:', error);
        // Only show error when it is not a "feature not enabled" case
        if (!error.message.includes('Knowledge base feature is not enabled')) {
            showNotification('Failed to load knowledge items: ' + error.message, 'error');
        }
        return [];
    }
}

// Render knowledge items list (data structure paginated by category)
function renderKnowledgeItemsByCategories(categoriesWithItems) {
    const container = document.getElementById('knowledge-items-list');
    if (!container) return;

    if (categoriesWithItems.length === 0) {
        container.innerHTML = '<div class="empty-state">No knowledge items</div>';
        return;
    }

    // Calculate total items and category count
    const totalItems = categoriesWithItems.reduce((sum, cat) => sum + (cat.items?.length || 0), 0);
    const categoryCount = categoriesWithItems.length;

    // Update statistics
    updateKnowledgeStats(categoriesWithItems, categoryCount);

    // Render categories and knowledge items
    let html = '<div class="knowledge-categories-container">';

    categoriesWithItems.forEach(categoryData => {
        const category = categoryData.category || 'Uncategorized';
        const categoryItems = categoryData.items || [];
        const categoryCount = categoryData.itemCount || categoryItems.length;
        
        html += `
            <div class="knowledge-category-section" data-category="${escapeHtml(category)}">
                <div class="knowledge-category-header">
                    <div class="knowledge-category-info">
                        <h3 class="knowledge-category-title">${escapeHtml(category)}</h3>
                        <span class="knowledge-category-count">${categoryCount} items</span>
                    </div>
                </div>
                <div class="knowledge-items-grid">
                    ${categoryItems.map(item => renderKnowledgeItemCard(item)).join('')}
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    container.innerHTML = html;
}

// Render knowledge items list (backward compatible, for old code paginated by item)
function renderKnowledgeItems(items) {
    const container = document.getElementById('knowledge-items-list');
    if (!container) return;

    if (items.length === 0) {
        container.innerHTML = '<div class="empty-state">No knowledge items</div>';
        return;
    }

    // Group by category
    const groupedByCategory = {};
    items.forEach(item => {
        const category = item.category || 'Uncategorized';
        if (!groupedByCategory[category]) {
            groupedByCategory[category] = [];
        }
        groupedByCategory[category].push(item);
    });

    // Update statistics
    updateKnowledgeStats(items, Object.keys(groupedByCategory).length);

    // Render grouped content
    const categories = Object.keys(groupedByCategory).sort();
    let html = '<div class="knowledge-categories-container">';
    
    categories.forEach(category => {
        const categoryItems = groupedByCategory[category];
        const categoryCount = categoryItems.length;
        
        html += `
            <div class="knowledge-category-section" data-category="${escapeHtml(category)}">
                <div class="knowledge-category-header">
                    <div class="knowledge-category-info">
                        <h3 class="knowledge-category-title">${escapeHtml(category)}</h3>
                        <span class="knowledge-category-count">${categoryCount} items</span>
                    </div>
                </div>
                <div class="knowledge-items-grid">
                    ${categoryItems.map(item => renderKnowledgeItemCard(item)).join('')}
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    container.innerHTML = html;
}

// Render pagination controls (paginated by category)
function renderKnowledgePagination() {
    const container = document.getElementById('knowledge-pagination');
    if (!container) return;

    const { currentPage, pageSize, total } = knowledgePagination;
    const totalPages = Math.ceil(total / pageSize); // total is the total number of categories

    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    let html = '<div class="knowledge-pagination" style="display: flex; justify-content: center; align-items: center; gap: 8px; padding: 20px; flex-wrap: wrap;">';

    // Previous page button
    html += `<button class="pagination-btn" onclick="loadKnowledgePage(${currentPage - 1})" ${currentPage <= 1 ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''}>Previous</button>`;

    // Page number display (shows category count)
    html += `<span style="padding: 0 12px;">Page ${currentPage} of ${totalPages} (${total} categories total)</span>`;

    // Next page button
    html += `<button class="pagination-btn" onclick="loadKnowledgePage(${currentPage + 1})" ${currentPage >= totalPages ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''}>Next</button>`;
    
    html += '</div>';
    container.innerHTML = html;
}

// Load knowledge items for a specified page number
function loadKnowledgePage(page) {
    const { currentCategory, pageSize, total } = knowledgePagination;
    const totalPages = Math.ceil(total / pageSize);
    
    if (page < 1 || page > totalPages) {
        return;
    }
    
    loadKnowledgeItems(currentCategory, page, pageSize);
}

// Render a single knowledge item card
function renderKnowledgeItemCard(item) {
    // Extract content preview (if item has no content field, it is a summary and no preview is shown)
    let previewText = '';
    if (item.content) {
        // Strip markdown formatting, take first 150 characters
        let preview = item.content;
        // Remove markdown heading markers
        preview = preview.replace(/^#+\s+/gm, '');
        // Remove code blocks
        preview = preview.replace(/```[\s\S]*?```/g, '');
        // Remove inline code
        preview = preview.replace(/`[^`]+`/g, '');
        // Remove links
        preview = preview.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');
        // Clean up extra whitespace
        preview = preview.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();

        previewText = preview.length > 150 ? preview.substring(0, 150) + '...' : preview;
    }

    // Extract file path for display
    const filePath = item.filePath || '';
    const relativePath = filePath.split(/[/\\]/).slice(-2).join('/'); // Show last two path segments

    // Format time
    const createdTime = formatTime(item.createdAt);
    const updatedTime = formatTime(item.updatedAt);

    // Prefer showing update time; fall back to create time if no update time
    const displayTime = updatedTime || createdTime;
    const timeLabel = updatedTime ? 'Updated' : 'Created';

    // Determine whether recently updated (within 7 days)
    let isRecent = false;
    if (item.updatedAt && updatedTime) {
        const updateDate = new Date(item.updatedAt);
        if (!isNaN(updateDate.getTime())) {
            isRecent = (Date.now() - updateDate.getTime()) < 7 * 24 * 60 * 60 * 1000;
        }
    }
    
    return `
        <div class="knowledge-item-card" data-id="${item.id}" data-category="${escapeHtml(item.category)}">
            <div class="knowledge-item-card-header">
                <div class="knowledge-item-card-title-row">
                    <h4 class="knowledge-item-card-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</h4>
                    <div class="knowledge-item-card-actions">
                        <button class="knowledge-item-action-btn" onclick="editKnowledgeItem('${item.id}')" title="Edit">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                        <button class="knowledge-item-action-btn knowledge-item-delete-btn" onclick="deleteKnowledgeItem('${item.id}')" title="Delete">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                    </div>
                </div>
                ${relativePath ? `<div class="knowledge-item-path">📁 ${escapeHtml(relativePath)}</div>` : ''}
            </div>
            ${previewText ? `
            <div class="knowledge-item-card-content">
                <p class="knowledge-item-preview">${escapeHtml(previewText)}</p>
            </div>
            ` : ''}
            <div class="knowledge-item-card-footer">
                <div class="knowledge-item-meta">
                    ${displayTime ? `<span class="knowledge-item-time" title="${timeLabel}">🕒 ${displayTime}</span>` : ''}
                    ${isRecent ? '<span class="knowledge-item-badge-new">New</span>' : ''}
                </div>
            </div>
        </div>
    `;
}

// Update statistics (supports data structure paginated by category)
function updateKnowledgeStats(data, categoryCount) {
    const statsContainer = document.getElementById('knowledge-stats');
    if (!statsContainer) return;

    // Calculate the number of knowledge items on the current page
    let currentPageItemCount = 0;
    if (Array.isArray(data) && data.length > 0) {
        // Determine whether it is a categoriesWithItems or items array
        if (data[0].category !== undefined && data[0].items !== undefined) {
            // Data structure paginated by category
            currentPageItemCount = data.reduce((sum, cat) => sum + (cat.items?.length || 0), 0);
        } else {
            // Data structure paginated by item (backward compatible)
            currentPageItemCount = data.length;
        }
    }

    // Total category count (from pagination info; fall back to current page category count only when undefined)
    const totalCategories = (knowledgePagination.total != null) ? knowledgePagination.total : categoryCount;

    statsContainer.innerHTML = `
        <div class="knowledge-stat-item">
            <span class="knowledge-stat-label">Total Categories</span>
            <span class="knowledge-stat-value">${totalCategories}</span>
        </div>
        <div class="knowledge-stat-item">
            <span class="knowledge-stat-label">Current Page Categories</span>
            <span class="knowledge-stat-value">${categoryCount}</span>
        </div>
        <div class="knowledge-stat-item">
            <span class="knowledge-stat-label">Current Page Items</span>
            <span class="knowledge-stat-value">${currentPageItemCount}</span>
        </div>
    `;

    // Update index progress
    updateIndexProgress();
}

// Update index progress
let indexProgressInterval = null;

async function updateIndexProgress() {
    try {
        const response = await apiFetch('/api/knowledge/index-status', {
            method: 'GET',
            headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            }
        });
        
        if (!response.ok) {
            return; // Silent failure, does not affect the main interface
        }

        const status = await response.json();
        const progressContainer = document.getElementById('knowledge-index-progress');
        if (!progressContainer) return;

        // Check whether the knowledge base feature is enabled
        if (status.enabled === false) {
            // Feature not enabled, hide progress bar
            progressContainer.style.display = 'none';
            if (indexProgressInterval) {
                clearInterval(indexProgressInterval);
                indexProgressInterval = null;
            }
            return;
        }
        
        const totalItems = status.total_items || 0;
        const indexedItems = status.indexed_items || 0;
        const progressPercent = status.progress_percent || 0;
        const isComplete = status.is_complete || false;
        const lastError = status.last_error || '';
        
        if (totalItems === 0) {
            // No knowledge items, hide progress bar
            progressContainer.style.display = 'none';
            if (indexProgressInterval) {
                clearInterval(indexProgressInterval);
                indexProgressInterval = null;
            }
            return;
        }

        // Show progress bar
        progressContainer.style.display = 'block';

        // If there is an error message, show the error
        if (lastError) {
            progressContainer.innerHTML = `
                <div class="knowledge-index-progress-error" style="
                    background: #fee;
                    border: 1px solid #fcc;
                    border-radius: 8px;
                    padding: 16px;
                    margin-bottom: 16px;
                ">
                    <div style="display: flex; align-items: center; margin-bottom: 8px;">
                        <span style="font-size: 20px; margin-right: 8px;">❌</span>
                        <span style="font-weight: bold; color: #c00;">Index build failed</span>
                    </div>
                    <div style="color: #666; font-size: 14px; margin-bottom: 12px; line-height: 1.5;">
                        ${escapeHtml(lastError)}
                    </div>
                    <div style="color: #999; font-size: 12px; margin-bottom: 12px;">
                        Possible causes: embedding model configuration error, invalid API key, insufficient balance, etc. Please check the configuration and retry.
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button onclick="rebuildKnowledgeIndex()" style="
                            background: #007bff;
                            color: white;
                            border: none;
                            padding: 6px 12px;
                            border-radius: 4px;
                            cursor: pointer;
                            font-size: 13px;
                        ">Retry</button>
                        <button onclick="stopIndexProgressPolling()" style="
                            background: #6c757d;
                            color: white;
                            border: none;
                            padding: 6px 12px;
                            border-radius: 4px;
                            cursor: pointer;
                            font-size: 13px;
                        ">Close</button>
                    </div>
                </div>
            `;
            // Stop polling
            if (indexProgressInterval) {
                clearInterval(indexProgressInterval);
                indexProgressInterval = null;
            }
            // Show error notification
            showNotification('Index build failed: ' + lastError.substring(0, 100), 'error');
            return;
        }

        if (isComplete) {
            progressContainer.innerHTML = `
                <div class="knowledge-index-progress-complete">
                    <span class="progress-icon">✅</span>
                    <span class="progress-text">Index build complete (${indexedItems}/${totalItems})</span>
                </div>
            `;
            // Stop polling after completion
            if (indexProgressInterval) {
                clearInterval(indexProgressInterval);
                indexProgressInterval = null;
            }
        } else {
            progressContainer.innerHTML = `
                <div class="knowledge-index-progress">
                    <div class="progress-header">
                        <span class="progress-icon">🔨</span>
                        <span class="progress-text">Building index: ${indexedItems}/${totalItems} (${progressPercent.toFixed(1)}%)</span>
                    </div>
                    <div class="progress-bar-container">
                        <div class="progress-bar" style="width: ${progressPercent}%"></div>
                    </div>
                    <div class="progress-hint">Semantic search will be available once the index build is complete</div>
                </div>
            `;

            // If polling has not started yet, start it
            if (!indexProgressInterval) {
                indexProgressInterval = setInterval(updateIndexProgress, 3000); // Refresh every 3 seconds
            }
        }
    } catch (error) {
        // Show error message
        console.error('Failed to fetch index status:', error);
        const progressContainer = document.getElementById('knowledge-index-progress');
        if (progressContainer) {
            progressContainer.style.display = 'block';
            progressContainer.innerHTML = `
                <div class="knowledge-index-progress-error" style="
                    background: #fee;
                    border: 1px solid #fcc;
                    border-radius: 8px;
                    padding: 16px;
                    margin-bottom: 16px;
                ">
                    <div style="display: flex; align-items: center; margin-bottom: 8px;">
                        <span style="font-size: 20px; margin-right: 8px;">⚠️</span>
                        <span style="font-weight: bold; color: #c00;">Unable to fetch index status</span>
                    </div>
                    <div style="color: #666; font-size: 14px;">
                        Unable to connect to the server to fetch index status. Please check your network connection or refresh the page.
                    </div>
                </div>
            `;
        }
        // Stop polling
        if (indexProgressInterval) {
            clearInterval(indexProgressInterval);
            indexProgressInterval = null;
        }
    }
}

// Stop index progress polling
function stopIndexProgressPolling() {
    if (indexProgressInterval) {
        clearInterval(indexProgressInterval);
        indexProgressInterval = null;
    }
    const progressContainer = document.getElementById('knowledge-index-progress');
    if (progressContainer) {
        progressContainer.style.display = 'none';
    }
}

// Select knowledge category
function selectKnowledgeCategory(category) {
    const trigger = document.getElementById('knowledge-category-filter-trigger');
    const wrapper = document.getElementById('knowledge-category-filter-wrapper');
    const dropdown = document.getElementById('knowledge-category-filter-dropdown');
    
    if (trigger && wrapper && dropdown) {
        const displayText = category || 'All';
        trigger.querySelector('span').textContent = displayText;
        wrapper.classList.remove('open');
        
        // Update selection status
        dropdown.querySelectorAll('.custom-select-option').forEach(opt => {
            opt.classList.remove('selected');
            if (opt.getAttribute('data-value') === category) {
                opt.classList.add('selected');
            }
        });
    }
    // Reset to page 1 when toggling category (if category selected, API returns all items for that category)
    loadKnowledgeItems(category, 1, knowledgePagination.pageSize);
}

// Filter knowledge items
function filterKnowledgeItems() {
    const wrapper = document.getElementById('knowledge-category-filter-wrapper');
    if (wrapper) {
        const selectedOption = wrapper.querySelector('.custom-select-option.selected');
        const category = selectedOption ? selectedOption.getAttribute('data-value') : '';
        // Reset to first page
        loadKnowledgeItems(category, 1, knowledgePagination.pageSize);
    }
}

// Handle search input (with debounce)
function handleKnowledgeSearchInput() {
    const searchInput = document.getElementById('knowledge-search');
    const searchTerm = searchInput?.value.trim() || '';
    
    // Clear existing timer
    if (knowledgeSearchTimeout) {
        clearTimeout(knowledgeSearchTimeout);
    }
    
    // If search box is empty, restore list immediately
    if (!searchTerm) {
        const wrapper = document.getElementById('knowledge-category-filter-wrapper');
        let category = '';
        if (wrapper) {
            const selectedOption = wrapper.querySelector('.custom-select-option.selected');
            category = selectedOption ? selectedOption.getAttribute('data-value') : '';
        }
        loadKnowledgeItems(category, 1, knowledgePagination.pageSize);
        return;
    }
    
    // With search term, delay 500ms before executing search (debounce)
    knowledgeSearchTimeout = setTimeout(() => {
        searchKnowledgeItems();
    }, 500);
}

// Search knowledge items (backend keyword match, search across all data)
async function searchKnowledgeItems() {
    const searchInput = document.getElementById('knowledge-search');
    const searchTerm = searchInput?.value.trim() || '';
    
    if (!searchTerm) {
        // Restore original list (reset to first page)
        const wrapper = document.getElementById('knowledge-category-filter-wrapper');
        let category = '';
        if (wrapper) {
            const selectedOption = wrapper.querySelector('.custom-select-option.selected');
            category = selectedOption ? selectedOption.getAttribute('data-value') : '';
        }
        await loadKnowledgeItems(category, 1, knowledgePagination.pageSize);
        return;
    }
    
    try {
        // Get currently selected category
        const wrapper = document.getElementById('knowledge-category-filter-wrapper');
        let category = '';
        if (wrapper) {
            const selectedOption = wrapper.querySelector('.custom-select-option.selected');
            category = selectedOption ? selectedOption.getAttribute('data-value') : '';
        }
        
        // Call backend API for full search
        const timestamp = Date.now();
        let url = `/api/knowledge/items?search=${encodeURIComponent(searchTerm)}&_t=${timestamp}`;
        if (category) {
            url += `&category=${encodeURIComponent(category)}`;
        }
        
        const response = await apiFetch(url, {
            method: 'GET',
            headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            }
        });
        
        if (!response.ok) {
            throw new Error('SearchFailed');
        }
        
        const data = await response.json();
        
        // Check if knowledge base feature is enabled
        if (data.enabled === false) {
            const container = document.getElementById('knowledge-items-list');
            if (container) {
                container.innerHTML = `
                    <div class="empty-state" style="text-align: center; padding: 40px 20px;">
                        <div style="font-size: 48px; margin-bottom: 20px;">📚</div>
                        <h3 style="margin-bottom: 10px; color: #666;">Knowledge Base Feature Not Enabled</h3>
                        <p style="color: #999; margin-bottom: 20px;">${data.message || 'Please go to System Settings to enable the knowledge retrieval feature'}</p>
                        <button onclick="switchToSettings()" style="
                            background: #007bff;
                            color: white;
                            border: none;
                            padding: 10px 20px;
                            border-radius: 5px;
                            cursor: pointer;
                            font-size: 14px;
                        ">Go to Settings</button>
                    </div>
                `;
            }
            return;
        }
        
        // Handle search results
        const categoriesWithItems = data.categories || [];
        
        // Render search results
        const container = document.getElementById('knowledge-items-list');
        if (!container) return;
        
        if (categoriesWithItems.length === 0) {
            container.innerHTML = `
                <div class="empty-state" style="text-align: center; padding: 40px 20px;">
                    <div style="font-size: 48px; margin-bottom: 20px;">🔍</div>
                    <h3 style="margin-bottom: 10px;">No matching knowledge items found</h3>
                    <p style="color: #999;">Keyword "<strong>${escapeHtml(searchTerm)}</strong>" has no matches in all data</p>
                    <p style="color: #999; margin-top: 10px; font-size: 0.9em;">Try other keywords, or use the category filter</p>
                </div>
            `;
        } else {
            // Calculate total item count and category count
            const totalItems = categoriesWithItems.reduce((sum, cat) => sum + (cat.items?.length || 0), 0);
            const categoryCount = categoriesWithItems.length;
            
            // Update statistics
            updateKnowledgeStats(categoriesWithItems, categoryCount);
            
            // Render search results
            renderKnowledgeItemsByCategories(categoriesWithItems);
        }
        
        // Hide pagination during search (search results show all matches)
        const paginationContainer = document.getElementById('knowledge-pagination');
        if (paginationContainer) {
            paginationContainer.innerHTML = '';
        }
        
    } catch (error) {
        console.error('Failed to search knowledge items:', error);
        showNotification('SearchFailed: ' + error.message, 'error');
    }
}

// Refresh knowledge base
async function refreshKnowledgeBase() {
    try {
        showNotification('Scanning knowledge base...', 'info');
        const response = await apiFetch('/api/knowledge/scan', {
            method: 'POST'
        });
        if (!response.ok) {
            throw new Error('Failed to scan knowledge base');
        }
        const data = await response.json();
        // Show different notifications based on response message
        if (data.items_to_index && data.items_to_index > 0) {
            showNotification(`Scan complete, starting to index ${data.items_to_index} new or updated knowledge items`, 'success');
        } else {
            showNotification(data.message || 'Scan done, no new or updated items to index', 'success');
        }
        // Reload knowledge items (reset to first page)
        await loadKnowledgeCategories();
        await loadKnowledgeItems(knowledgePagination.currentCategory, 1, knowledgePagination.pageSize);
        
        // Stop existing polling
        if (indexProgressInterval) {
            clearInterval(indexProgressInterval);
            indexProgressInterval = null;
        }
        
        // If there are items to index, wait a moment then immediately update progress
        if (data.items_to_index && data.items_to_index > 0) {
            await new Promise(resolve => setTimeout(resolve, 500));
            updateIndexProgress();
            // Start polling progress (refresh every 2 seconds)
            if (!indexProgressInterval) {
                indexProgressInterval = setInterval(updateIndexProgress, 2000);
            }
        } else {
            // No items to index, update once to show current status
            updateIndexProgress();
        }
    } catch (error) {
        console.error('Failed to refresh knowledge base:', error);
        showNotification('Failed to refresh knowledge base: ' + error.message, 'error');
    }
}

// Rebuild index
async function rebuildKnowledgeIndex() {
    try {
        if (!confirm('Are you sure you want to rebuild the index? This may take some time.')) {
            return;
        }
        showNotification('Rebuilding index...', 'info');
        
        // Stop existing polling first
        if (indexProgressInterval) {
            clearInterval(indexProgressInterval);
            indexProgressInterval = null;
        }
        
        // Immediately show "Rebuilding" status, as rebuilding clears the old index
        const progressContainer = document.getElementById('knowledge-index-progress');
        if (progressContainer) {
            progressContainer.style.display = 'block';
            progressContainer.innerHTML = `
                <div class="knowledge-index-progress">
                    <div class="progress-header">
                        <span class="progress-icon">🔨</span>
                        <span class="progress-text">Rebuilding index: preparing...</span>
                    </div>
                    <div class="progress-bar-container">
                        <div class="progress-bar" style="width: 0%"></div>
                    </div>
                    <div class="progress-hint">Once the index is built, semantic search will be available</div>
                </div>
            `;
        }
        
        const response = await apiFetch('/api/knowledge/index', {
            method: 'POST'
        });
        if (!response.ok) {
            throw new Error('Failed to rebuild index');
        }
        showNotification('Index rebuild started and will run in the background', 'success');
        
        // Wait a moment to ensure backend has started processing and cleared old index
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Immediately update progress once
        updateIndexProgress();
        
        // Start polling progress (every 2 seconds, more frequent than default 3 seconds)
        if (!indexProgressInterval) {
            indexProgressInterval = setInterval(updateIndexProgress, 2000);
        }
    } catch (error) {
        console.error('Failed to rebuild index:', error);
        showNotification('Failed to rebuild index: ' + error.message, 'error');
    }
}

// Show Add Knowledge Item modal
function showAddKnowledgeItemModal() {
    currentEditingItemId = null;
    document.getElementById('knowledge-item-modal-title').textContent = 'Add Knowledge';
    document.getElementById('knowledge-item-category').value = '';
    document.getElementById('knowledge-item-title').value = '';
    document.getElementById('knowledge-item-content').value = '';
    document.getElementById('knowledge-item-modal').style.display = 'block';
}

// Edit knowledge item
async function editKnowledgeItem(id) {
    try {
        const response = await apiFetch(`/api/knowledge/items/${id}`);
        if (!response.ok) {
            throw new Error('Failed to get knowledge items');
        }
        const item = await response.json();
        
        currentEditingItemId = id;
        document.getElementById('knowledge-item-modal-title').textContent = 'Edit Knowledge';
        document.getElementById('knowledge-item-category').value = item.category;
        document.getElementById('knowledge-item-title').value = item.title;
        document.getElementById('knowledge-item-content').value = item.content;
        document.getElementById('knowledge-item-modal').style.display = 'block';
    } catch (error) {
        console.error('Failed to edit knowledge item:', error);
        showNotification('Failed to edit knowledge item: ' + error.message, 'error');
    }
}

// Save knowledge item
async function saveKnowledgeItem() {
    // Prevent duplicate submissions
    if (isSavingKnowledgeItem) {
        showNotification('Saving, please do not click again...', 'warning');
        return;
    }
    
    const category = document.getElementById('knowledge-item-category').value.trim();
    const title = document.getElementById('knowledge-item-title').value.trim();
    const content = document.getElementById('knowledge-item-content').value.trim();
    
    if (!category || !title || !content) {
        showNotification('Please fill in all required fields', 'error');
        return;
    }
    
    // Set saving flag
    isSavingKnowledgeItem = true;
    
    // Get save button and cancel button
    const saveButton = document.querySelector('#knowledge-item-modal .modal-footer .btn-primary');
    const cancelButton = document.querySelector('#knowledge-item-modal .modal-footer .btn-secondary');
    const modal = document.getElementById('knowledge-item-modal');
    
    const originalButtonText = saveButton ? saveButton.textContent : 'Save';
    const originalButtonDisabled = saveButton ? saveButton.disabled : false;
    
    // Disable all input fields and buttons
    const categoryInput = document.getElementById('knowledge-item-category');
    const titleInput = document.getElementById('knowledge-item-title');
    const contentInput = document.getElementById('knowledge-item-content');
    
    if (categoryInput) categoryInput.disabled = true;
    if (titleInput) titleInput.disabled = true;
    if (contentInput) contentInput.disabled = true;
    if (cancelButton) cancelButton.disabled = true;
    
    // Set save button loading status
    if (saveButton) {
        saveButton.disabled = true;
        saveButton.style.opacity = '0.6';
        saveButton.style.cursor = 'not-allowed';
        saveButton.textContent = 'Saving...';
    }
    
    try {
        const url = currentEditingItemId 
            ? `/api/knowledge/items/${currentEditingItemId}`
            : '/api/knowledge/items';
        const method = currentEditingItemId ? 'PUT' : 'POST';
        
        const response = await apiFetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                category,
                title,
                content
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Failed to save knowledge item');
        }
        
        const item = await response.json();
        const action = currentEditingItemId ? 'Update' : 'Create';
        const newItemCategory = item.category || category; // Save newly added item category
        
        // Get current filter status to preserve after refresh
        const currentCategory = document.getElementById('knowledge-category-filter-wrapper');
        let selectedCategory = '';
        if (currentCategory) {
            const selectedOption = currentCategory.querySelector('.custom-select-option.selected');
            if (selectedOption) {
                selectedCategory = selectedOption.getAttribute('data-value') || '';
            }
        }
        
        // Close modal immediately to give user clear feedback
        closeKnowledgeItemModal();
        
        // Show loading status and refresh data (wait for completion to ensure data sync)
        const itemsListContainer = document.getElementById('knowledge-items-list');
        const originalContent = itemsListContainer ? itemsListContainer.innerHTML : '';
        
        if (itemsListContainer) {
            itemsListContainer.innerHTML = '<div class="loading-spinner">Refreshing...</div>';
        }
        
        try {
            // Refresh categories first, then knowledge items
            console.log('Starting to refresh knowledge base data...');
            await loadKnowledgeCategories();
            console.log('Categories refreshed, starting to refresh knowledge items...');
            
            // If newly added item is not in the currently filtered category, switch to that category
            let categoryToShow = selectedCategory;
            if (!currentEditingItemId && selectedCategory && selectedCategory !== '' && newItemCategory !== selectedCategory) {
                // For newly added item, if current filter is not that category, switch to new item category
                categoryToShow = newItemCategory;
                // Update filter display (do not trigger load, we will load manually below)
                const trigger = document.getElementById('knowledge-category-filter-trigger');
                const wrapper = document.getElementById('knowledge-category-filter-wrapper');
                const dropdown = document.getElementById('knowledge-category-filter-dropdown');
                if (trigger && wrapper && dropdown) {
                    trigger.querySelector('span').textContent = newItemCategory || 'All';
                    dropdown.querySelectorAll('.custom-select-option').forEach(opt => {
                        opt.classList.remove('selected');
                        if (opt.getAttribute('data-value') === newItemCategory) {
                            opt.classList.add('selected');
                        }
                    });
                }
                showNotification(`✅ ${action} successful! Switched to category "${newItemCategory}" to view the newly added knowledge item.`, 'success');
            }
            
            // Refresh knowledge item list (reset to first page)
            await loadKnowledgeItems(categoryToShow, 1, knowledgePagination.pageSize);
            console.log('Knowledge items refreshed');
        } catch (err) {
            console.error('Failed to refresh data:', err);
            // If refresh fails, restore original content
            if (itemsListContainer && originalContent) {
                itemsListContainer.innerHTML = originalContent;
            }
            showNotification('⚠️ Knowledge item saved, but failed to refresh list. Please manually refresh the page.', 'warning');
        }
        
    } catch (error) {
        console.error('Failed to save knowledge item:', error);
        showNotification('❌ Failed to save knowledge item: ' + error.message, 'error');
        
        // If notification system unavailable, use alert
        if (typeof window.showNotification !== 'function') {
            alert('❌ Failed to save knowledge item: ' + error.message);
        }
        
        // Restore input fields and button status (on error, do not close modal, let user retry)
        if (categoryInput) categoryInput.disabled = false;
        if (titleInput) titleInput.disabled = false;
        if (contentInput) contentInput.disabled = false;
        if (cancelButton) cancelButton.disabled = false;
        if (saveButton) {
            saveButton.disabled = false;
            saveButton.style.opacity = '';
            saveButton.style.cursor = '';
            saveButton.textContent = originalButtonText;
        }
    } finally {
        // Clear saving flag
        isSavingKnowledgeItem = false;
    }
}

// Delete knowledge item
async function deleteKnowledgeItem(id) {
    if (!confirm('Are you sure you want to delete this knowledge item?')) {
        return;
    }
    
    // Find the knowledge item card and delete button
    const itemCard = document.querySelector(`.knowledge-item-card[data-id="${id}"]`);
    const deleteButton = itemCard ? itemCard.querySelector('.knowledge-item-delete-btn') : null;
    const categorySection = itemCard ? itemCard.closest('.knowledge-category-section') : null;
    let originalDisplay = '';
    let originalOpacity = '';
    let originalButtonOpacity = '';
    
    // Set delete button loading status
    if (deleteButton) {
        originalButtonOpacity = deleteButton.style.opacity;
        deleteButton.style.opacity = '0.5';
        deleteButton.style.cursor = 'not-allowed';
        deleteButton.disabled = true;
        
        // Add loading animation
        const svg = deleteButton.querySelector('svg');
        if (svg) {
            svg.style.animation = 'spin 1s linear infinite';
        }
    }
    
    // Immediately remove item from UI (optimistic update)
    if (itemCard) {
        originalDisplay = itemCard.style.display;
        originalOpacity = itemCard.style.opacity;
        itemCard.style.transition = 'opacity 0.3s ease-out, transform 0.3s ease-out';
        itemCard.style.opacity = '0';
        itemCard.style.transform = 'translateX(-20px)';
        
        // Remove after animation completes
        setTimeout(() => {
            if (itemCard.parentElement) {
                itemCard.remove();
                
                // Check if category still has items, hide category header if not
                if (categorySection) {
                    const remainingItems = categorySection.querySelectorAll('.knowledge-item-card');
                    if (remainingItems.length === 0) {
                        categorySection.style.transition = 'opacity 0.3s ease-out';
                        categorySection.style.opacity = '0';
                        setTimeout(() => {
                            if (categorySection.parentElement) {
                                categorySection.remove();
                            }
                        }, 300);
                    } else {
                        // Update category count
                        const categoryCount = categorySection.querySelector('.knowledge-category-count');
                        if (categoryCount) {
                            const newCount = remainingItems.length;
                            categoryCount.textContent = `${newCount} items`;
                        }
                    }
                }
                
                // Do not update statistics here, wait for data reload to update correctly
            }
        }, 300);
    }
    
    try {
        const response = await apiFetch(`/api/knowledge/items/${id}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Failed to delete knowledge item');
        }
        
        // Show success notification
        showNotification('✅ Deleted successfully! Knowledge item has been removed from the system.', 'success');
        
        // Reload data to ensure data sync (keep current page)
        await loadKnowledgeCategories();
        await loadKnowledgeItems(knowledgePagination.currentCategory, knowledgePagination.currentPage, knowledgePagination.pageSize);
        
    } catch (error) {
        console.error('Failed to delete knowledge item:', error);
        
        // If delete fails, restore item display
        if (itemCard && originalDisplay !== 'none') {
            itemCard.style.display = originalDisplay || '';
            itemCard.style.opacity = originalOpacity || '1';
            itemCard.style.transform = '';
            itemCard.style.transition = '';
            
            // If category was removed, need to restore
            if (categorySection && !categorySection.parentElement) {
                // Need to reload to restore (preserve current pagination status)
                await loadKnowledgeItems(knowledgePagination.currentCategory, knowledgePagination.currentPage, knowledgePagination.pageSize);
            }
        }
        
        // Restore delete button status
        if (deleteButton) {
            deleteButton.style.opacity = originalButtonOpacity || '';
            deleteButton.style.cursor = '';
            deleteButton.disabled = false;
            const svg = deleteButton.querySelector('svg');
            if (svg) {
                svg.style.animation = '';
            }
        }
        
        showNotification('❌ Failed to delete knowledge item: ' + error.message, 'error');
    }
}

// Temporarily update statistics (after delete)
function updateKnowledgeStatsAfterDelete() {
    const statsContainer = document.getElementById('knowledge-stats');
    if (!statsContainer) return;
    
    const allItems = document.querySelectorAll('.knowledge-item-card');
    const allCategories = document.querySelectorAll('.knowledge-category-section');
    
    const totalItems = allItems.length;
    const categoryCount = allCategories.length;
    
    // Calculate total content size (simplified here, should actually be fetched from server)
    const statsItems = statsContainer.querySelectorAll('.knowledge-stat-item');
    if (statsItems.length >= 2) {
        const totalItemsSpan = statsItems[0].querySelector('.knowledge-stat-value');
        const categoryCountSpan = statsItems[1].querySelector('.knowledge-stat-value');
        
        if (totalItemsSpan) {
            totalItemsSpan.textContent = totalItems;
        }
        if (categoryCountSpan) {
            categoryCountSpan.textContent = categoryCount;
        }
    }
}

// Close knowledge item modal
function closeKnowledgeItemModal() {
    const modal = document.getElementById('knowledge-item-modal');
    if (modal) {
        modal.style.display = 'none';
    }
    
    // ResetEditStatus
    currentEditingItemId = null;
    isSavingKnowledgeItem = false;
    
    // Restore all input fields and button status
    const categoryInput = document.getElementById('knowledge-item-category');
    const titleInput = document.getElementById('knowledge-item-title');
    const contentInput = document.getElementById('knowledge-item-content');
    const saveButton = document.querySelector('#knowledge-item-modal .modal-footer .btn-primary');
    const cancelButton = document.querySelector('#knowledge-item-modal .modal-footer .btn-secondary');
    
    if (categoryInput) {
        categoryInput.disabled = false;
        categoryInput.value = '';
    }
    if (titleInput) {
        titleInput.disabled = false;
        titleInput.value = '';
    }
    if (contentInput) {
        contentInput.disabled = false;
        contentInput.value = '';
    }
    if (saveButton) {
        saveButton.disabled = false;
        saveButton.style.opacity = '';
        saveButton.style.cursor = '';
        saveButton.textContent = 'Save';
    }
    if (cancelButton) {
        cancelButton.disabled = false;
    }
}

// Load retrieval logs
async function loadRetrievalLogs(conversationId = '', messageId = '') {
    try {
        let url = '/api/knowledge/retrieval-logs?limit=100';
        if (conversationId) {
            url += `&conversationId=${encodeURIComponent(conversationId)}`;
        }
        if (messageId) {
            url += `&messageId=${encodeURIComponent(messageId)}`;
        }
        
        const response = await apiFetch(url);
        if (!response.ok) {
            throw new Error('Failed to get retrieval logs');
        }
        const data = await response.json();
        renderRetrievalLogs(data.logs || []);
    } catch (error) {
        console.error('Failed to load retrieval logs:', error);
        // Even if load fails, show empty status instead of perpetual "Loading..."
        renderRetrievalLogs([]);
        // Only show error notification when filter is active (avoid showing error when no data)
        if (conversationId || messageId) {
            showNotification('Failed to load retrieval logs: ' + error.message, 'error');
        }
    }
}

// Render retrieval logs
function renderRetrievalLogs(logs) {
    const container = document.getElementById('retrieval-logs-list');
    if (!container) return;
    
    // Update statistics (update even for empty array)
    updateRetrievalStats(logs);
    
    if (logs.length === 0) {
        container.innerHTML = '<div class="empty-state">No retrieval records</div>';
        retrievalLogsData = [];
        return;
    }
    
    // Save log data for detail view
    retrievalLogsData = logs;
    
    container.innerHTML = logs.map((log, index) => {
        // Handle retrievedItems: may be array, string array, or special markers
        let itemCount = 0;
        let hasResults = false;
        
        if (log.retrievedItems) {
            if (Array.isArray(log.retrievedItems)) {
                // Filter out special markers
                const realItems = log.retrievedItems.filter(id => id !== '_has_results');
                itemCount = realItems.length;
                // If there are special markers, means results exist but ID unknown, show as "has results"
                if (log.retrievedItems.includes('_has_results')) {
                    hasResults = true;
                    // If there are real IDs, use real count; otherwise show "has results" (no specific count)
                    if (itemCount === 0) {
                        itemCount = -1; // -1 means has results but count unknown
                    }
                } else {
                    hasResults = itemCount > 0;
                }
            } else if (typeof log.retrievedItems === 'string') {
                // If it is a string, try to parse as JSON
                try {
                    const parsed = JSON.parse(log.retrievedItems);
                    if (Array.isArray(parsed)) {
                        const realItems = parsed.filter(id => id !== '_has_results');
                        itemCount = realItems.length;
                        if (parsed.includes('_has_results')) {
                            hasResults = true;
                            if (itemCount === 0) {
                                itemCount = -1;
                            }
                        } else {
                            hasResults = itemCount > 0;
                        }
                    }
                } catch (e) {
                    // Parse failed, ignore
                }
            }
        }
        
        const timeAgo = getTimeAgo(log.createdAt);
        
        return `
            <div class="retrieval-log-card ${hasResults ? 'has-results' : 'no-results'}" data-index="${index}">
                <div class="retrieval-log-card-header">
                    <div class="retrieval-log-icon">
                        ${hasResults ? '🔍' : '⚠️'}
                    </div>
                    <div class="retrieval-log-main-info">
                        <div class="retrieval-log-query">
                            ${escapeHtml(log.query || 'No query content')}
                        </div>
                        <div class="retrieval-log-meta">
                            <span class="retrieval-log-time" title="${formatTime(log.createdAt)}">
                                🕒 ${timeAgo}
                            </span>
                            ${log.riskType ? `<span class="retrieval-log-risk-type">📁 ${escapeHtml(log.riskType)}</span>` : ''}
                        </div>
                    </div>
                    <div class="retrieval-log-result-badge ${hasResults ? 'success' : 'empty'}">
                        ${hasResults ? (itemCount > 0 ? `${itemCount} items` : 'Has results') : 'No results'}
                    </div>
                </div>
                <div class="retrieval-log-card-body">
                    <div class="retrieval-log-details-grid">
                        ${log.conversationId ? `
                            <div class="retrieval-log-detail-item">
                                <span class="detail-label">Conversation ID</span>
                                <code class="detail-value" title="Click to copy" onclick="navigator.clipboard.writeText('${escapeHtml(log.conversationId)}'); this.title='Copied!'; setTimeout(() => this.title='Click to copy', 2000);" style="cursor: pointer;">${escapeHtml(log.conversationId)}</code>
                            </div>
                        ` : ''}
                        ${log.messageId ? `
                            <div class="retrieval-log-detail-item">
                                <span class="detail-label">Message ID</span>
                                <code class="detail-value" title="Click to copy" onclick="navigator.clipboard.writeText('${escapeHtml(log.messageId)}'); this.title='Copied!'; setTimeout(() => this.title='Click to copy', 2000);" style="cursor: pointer;">${escapeHtml(log.messageId)}</code>
                            </div>
                        ` : ''}
                        <div class="retrieval-log-detail-item">
                            <span class="detail-label">Retrieval Results</span>
                            <span class="detail-value ${hasResults ? 'text-success' : 'text-muted'}">
                                ${hasResults ? (itemCount > 0 ? `Found ${itemCount} relevant knowledge items` : 'Found relevant knowledge items (count unknown)') : 'No matching knowledge items found'}
                            </span>
                        </div>
                    </div>
                    ${hasResults && log.retrievedItems && log.retrievedItems.length > 0 ? `
                        <div class="retrieval-log-items-preview">
                            <div class="retrieval-log-items-label">Retrieved knowledge items:</div>
                            <div class="retrieval-log-items-list">
                                ${log.retrievedItems.slice(0, 3).map((itemId, idx) => `
                                    <span class="retrieval-log-item-tag">${idx + 1}</span>
                                `).join('')}
                                ${log.retrievedItems.length > 3 ? `<span class="retrieval-log-item-tag more">+${log.retrievedItems.length - 3}</span>` : ''}
                            </div>
                        </div>
                    ` : ''}
                    <div class="retrieval-log-actions">
                        <button class="btn-secondary btn-sm" onclick="showRetrievalLogDetails(${index})" style="margin-top: 12px; display: inline-flex; align-items: center; gap: 4px;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                            ViewDetails
                        </button>
                        <button class="btn-secondary btn-sm retrieval-log-delete-btn" onclick="deleteRetrievalLog('${escapeHtml(log.id)}', ${index})" style="margin-top: 12px; margin-left: 8px; display: inline-flex; align-items: center; gap: 4px; color: var(--error-color, #dc3545); border-color: var(--error-color, #dc3545);" onmouseover="this.style.backgroundColor='rgba(220, 53, 69, 0.1)'; this.style.color='#dc3545';" onmouseout="this.style.backgroundColor=''; this.style.color='var(--error-color, #dc3545)';" title="Delete">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                            Delete
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Update retrieval statistics
function updateRetrievalStats(logs) {
    const statsContainer = document.getElementById('retrieval-stats');
    if (!statsContainer) return;
    
    const totalLogs = logs.length;
    // Determine if there are results: check retrievedItems array, filter out special markers, length > 0, or contains special markers
    const successfulLogs = logs.filter(log => {
        if (!log.retrievedItems) return false;
        if (Array.isArray(log.retrievedItems)) {
            const realItems = log.retrievedItems.filter(id => id !== '_has_results');
            return realItems.length > 0 || log.retrievedItems.includes('_has_results');
        }
        return false;
    }).length;
    // Calculate total knowledge item count (only real IDs, no special markers)
    const totalItems = logs.reduce((sum, log) => {
        if (!log.retrievedItems) return sum;
        if (Array.isArray(log.retrievedItems)) {
            const realItems = log.retrievedItems.filter(id => id !== '_has_results');
            return sum + realItems.length;
        }
        return sum;
    }, 0);
    const successRate = totalLogs > 0 ? ((successfulLogs / totalLogs) * 100).toFixed(1) : 0;
    
    statsContainer.innerHTML = `
        <div class="retrieval-stat-item">
            <span class="retrieval-stat-label">Total Retrievals</span>
            <span class="retrieval-stat-value">${totalLogs}</span>
        </div>
        <div class="retrieval-stat-item">
            <span class="retrieval-stat-label">Successful</span>
            <span class="retrieval-stat-value text-success">${successfulLogs}</span>
        </div>
        <div class="retrieval-stat-item">
            <span class="retrieval-stat-label">Success Rate</span>
            <span class="retrieval-stat-value">${successRate}%</span>
        </div>
        <div class="retrieval-stat-item">
            <span class="retrieval-stat-label">Items Retrieved</span>
            <span class="retrieval-stat-value">${totalItems}</span>
        </div>
    `;
}

// Get relative time
function getTimeAgo(timeStr) {
    if (!timeStr) return '';
    
    // Handle time string, supports multiple formats
    let date;
    if (typeof timeStr === 'string') {
        // First try direct parsing (supports RFC3339/ISO8601 format)
        date = new Date(timeStr);
        
        // If parsing fails, try other formats
        if (isNaN(date.getTime())) {
            // SQLite format: "2006-01-02 15:04:05" or with timezone
            const sqliteMatch = timeStr.match(/(\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[+-]\d{2}:\d{2}|Z)?)/);
            if (sqliteMatch) {
                let timeStr2 = sqliteMatch[1].replace(' ', 'T');
                // If no timezone info, add Z to indicate UTC
                if (!timeStr2.includes('Z') && !timeStr2.match(/[+-]\d{2}:\d{2}$/)) {
                    timeStr2 += 'Z';
                }
                date = new Date(timeStr2);
            }
        }
        
        // If still failing, try more relaxed format
        if (isNaN(date.getTime())) {
            // Try matching "YYYY-MM-DD HH:MM:SS" format
            const match = timeStr.match(/(\d{4})-(\d{2})-(\d{2})[\sT](\d{2}):(\d{2}):(\d{2})/);
            if (match) {
                date = new Date(
                    parseInt(match[1]), 
                    parseInt(match[2]) - 1, 
                    parseInt(match[3]),
                    parseInt(match[4]),
                    parseInt(match[5]),
                    parseInt(match[6])
                );
            }
        }
    } else {
        date = new Date(timeStr);
    }
    
    // Check if date is valid
    if (isNaN(date.getTime())) {
        return formatTime(timeStr);
    }
    
    // Check if date is reasonable (not before 1970, not too far in future)
    const year = date.getFullYear();
    if (year < 1970 || year > 2100) {
        return formatTime(timeStr);
    }
    
    const now = new Date();
    const diff = now - date;
    
    // If time diff is negative or too large (possible parse error), return formatted time
    if (diff < 0 || diff > 365 * 24 * 60 * 60 * 1000 * 10) { // Over 10 years treated as error
        return formatTime(timeStr);
    }
    
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days} day(s) ago`;
    if (hours > 0) return `${hours} hour(s) ago`;
    if (minutes > 0) return `${minutes} minute(s) ago`;
    return 'Just now';
}

// Truncate ID display
function truncateId(id) {
    if (!id || id.length <= 16) return id;
    return id.substring(0, 8) + '...' + id.substring(id.length - 8);
}

// Filter retrieval logs
function filterRetrievalLogs() {
    const conversationId = document.getElementById('retrieval-logs-conversation-id').value.trim();
    const messageId = document.getElementById('retrieval-logs-message-id').value.trim();
    loadRetrievalLogs(conversationId, messageId);
}

// Refresh retrieval logs
function refreshRetrievalLogs() {
    filterRetrievalLogs();
}

// Delete retrieval log
async function deleteRetrievalLog(id, index) {
    if (!confirm('Are you sure you want to delete this retrieval record?')) {
        return;
    }
    
    // Find the log card and delete button
    const logCard = document.querySelector(`.retrieval-log-card[data-index="${index}"]`);
    const deleteButton = logCard ? logCard.querySelector('.retrieval-log-delete-btn') : null;
    let originalButtonOpacity = '';
    let originalButtonDisabled = false;
    
    // Set delete button loading status
    if (deleteButton) {
        originalButtonOpacity = deleteButton.style.opacity;
        originalButtonDisabled = deleteButton.disabled;
        deleteButton.style.opacity = '0.5';
        deleteButton.style.cursor = 'not-allowed';
        deleteButton.disabled = true;
        
        // Add loading animation
        const svg = deleteButton.querySelector('svg');
        if (svg) {
            svg.style.animation = 'spin 1s linear infinite';
        }
    }
    
    // Immediately remove item from UI (optimistic update)
    if (logCard) {
        logCard.style.transition = 'opacity 0.3s ease-out, transform 0.3s ease-out';
        logCard.style.opacity = '0';
        logCard.style.transform = 'translateX(-20px)';
        
        // Remove after animation completes
        setTimeout(() => {
            if (logCard.parentElement) {
                logCard.remove();
                
                // Update statistics (temporary update, will reload later)
                updateRetrievalStatsAfterDelete();
            }
        }, 300);
    }
    
    try {
        const response = await apiFetch(`/api/knowledge/retrieval-logs/${id}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Failed to delete retrieval log');
        }
        
        // Show success notification
        showNotification('✅ Deleted successfully! Retrieval record has been removed from the system.', 'success');
        
        // Remove item from memory
        if (retrievalLogsData && index >= 0 && index < retrievalLogsData.length) {
            retrievalLogsData.splice(index, 1);
        }
        
        // Reload data to ensure data sync
        const conversationId = document.getElementById('retrieval-logs-conversation-id')?.value.trim() || '';
        const messageId = document.getElementById('retrieval-logs-message-id')?.value.trim() || '';
        await loadRetrievalLogs(conversationId, messageId);
        
    } catch (error) {
        console.error('Failed to delete retrieval log:', error);
        
        // If delete fails, restore item display
        if (logCard) {
            logCard.style.opacity = '1';
            logCard.style.transform = '';
            logCard.style.transition = '';
        }
        
        // Restore delete button status
        if (deleteButton) {
            deleteButton.style.opacity = originalButtonOpacity || '';
            deleteButton.style.cursor = '';
            deleteButton.disabled = originalButtonDisabled;
            const svg = deleteButton.querySelector('svg');
            if (svg) {
                svg.style.animation = '';
            }
        }
        
        showNotification('❌ Failed to delete retrieval log: ' + error.message, 'error');
    }
}

// Temporarily update statistics (after delete)
function updateRetrievalStatsAfterDelete() {
    const statsContainer = document.getElementById('retrieval-stats');
    if (!statsContainer) return;
    
    const allLogs = document.querySelectorAll('.retrieval-log-card');
    const totalLogs = allLogs.length;
    
    // Calculate successful retrieval count
    const successfulLogs = Array.from(allLogs).filter(card => {
        return card.classList.contains('has-results');
    }).length;
    
    // Calculate total knowledge items (simplified, should be fetched from server)
    const totalItems = Array.from(allLogs).reduce((sum, card) => {
        const badge = card.querySelector('.retrieval-log-result-badge');
        if (badge && badge.classList.contains('success')) {
            const text = badge.textContent.trim();
            const match = text.match(/(\d+)\s*items?/);
            if (match) {
                return sum + parseInt(match[1]);
            } else if (text === 'Has results') {
                return sum + 1; // Simplified: assume 1
            }
        }
        return sum;
    }, 0);
    
    const successRate = totalLogs > 0 ? ((successfulLogs / totalLogs) * 100).toFixed(1) : 0;
    
    statsContainer.innerHTML = `
        <div class="retrieval-stat-item">
            <span class="retrieval-stat-label">Total Retrievals</span>
            <span class="retrieval-stat-value">${totalLogs}</span>
        </div>
        <div class="retrieval-stat-item">
            <span class="retrieval-stat-label">Successful</span>
            <span class="retrieval-stat-value text-success">${successfulLogs}</span>
        </div>
        <div class="retrieval-stat-item">
            <span class="retrieval-stat-label">Success Rate</span>
            <span class="retrieval-stat-value">${successRate}%</span>
        </div>
        <div class="retrieval-stat-item">
            <span class="retrieval-stat-label">Items Retrieved</span>
            <span class="retrieval-stat-value">${totalItems}</span>
        </div>
    `;
}

// Show retrieval log details
async function showRetrievalLogDetails(index) {
    if (!retrievalLogsData || index < 0 || index >= retrievalLogsData.length) {
        showNotification('Unable to get retrieval details', 'error');
        return;
    }
    
    const log = retrievalLogsData[index];
    
    // Get retrieved knowledge item details
    let retrievedItemsDetails = [];
    if (log.retrievedItems && Array.isArray(log.retrievedItems)) {
        const realItemIds = log.retrievedItems.filter(id => id !== '_has_results');
        if (realItemIds.length > 0) {
            try {
                // Batch get knowledge item details
                const itemPromises = realItemIds.map(async (itemId) => {
                    try {
                        const response = await apiFetch(`/api/knowledge/items/${itemId}`);
                        if (response.ok) {
                            return await response.json();
                        }
                        return null;
                    } catch (err) {
                        console.error(`Failed to get knowledge item ${itemId}:`, err);
                        return null;
                    }
                });
                
                const items = await Promise.all(itemPromises);
                retrievedItemsDetails = items.filter(item => item !== null);
            } catch (err) {
                console.error('Failed to batch get knowledge item details:', err);
            }
        }
    }
    
    // Show details modal
    showRetrievalLogDetailsModal(log, retrievedItemsDetails);
}

// Show retrieval log details modal
function showRetrievalLogDetailsModal(log, retrievedItems) {
    // Create or get modal
    let modal = document.getElementById('retrieval-log-details-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'retrieval-log-details-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 900px; max-height: 90vh; overflow-y: auto;">
                <div class="modal-header">
                    <h2>Retrieval Details</h2>
                    <span class="modal-close" onclick="closeRetrievalLogDetailsModal()">&times;</span>
                </div>
                <div class="modal-body" id="retrieval-log-details-content">
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" onclick="closeRetrievalLogDetailsModal()">Close</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    
    // Fill content
    const content = document.getElementById('retrieval-log-details-content');
    const timeAgo = getTimeAgo(log.createdAt);
    const fullTime = formatTime(log.createdAt);
    
    let itemsHtml = '';
    if (retrievedItems.length > 0) {
        itemsHtml = retrievedItems.map((item, idx) => {
            // Extract content preview
            let preview = item.content || '';
            preview = preview.replace(/^#+\s+/gm, '');
            preview = preview.replace(/```[\s\S]*?```/g, '');
            preview = preview.replace(/`[^`]+`/g, '');
            preview = preview.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');
            preview = preview.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
            const previewText = preview.length > 200 ? preview.substring(0, 200) + '...' : preview;
            
            return `
                <div class="retrieval-detail-item-card" style="margin-bottom: 16px; padding: 16px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-secondary);">
                    <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
                        <h4 style="margin: 0; color: var(--text-primary);">${idx + 1}. ${escapeHtml(item.title || 'Unnamed')}</h4>
                        <span style="font-size: 0.875rem; color: var(--text-secondary);">${escapeHtml(item.category || 'Uncategorized')}</span>
                    </div>
                    ${item.filePath ? `<div style="font-size: 0.875rem; color: var(--text-muted); margin-bottom: 8px;">📁 ${escapeHtml(item.filePath)}</div>` : ''}
                    <div style="font-size: 0.875rem; color: var(--text-secondary); line-height: 1.6;">
                        ${escapeHtml(previewText || 'No content preview')}
                    </div>
                </div>
            `;
        }).join('');
    } else {
        itemsHtml = '<div style="padding: 16px; text-align: center; color: var(--text-muted);">Knowledge item details not found</div>';
    }
    
    content.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 20px;">
            <div class="retrieval-detail-section">
                <h3 style="margin: 0 0 12px 0; font-size: 1.125rem; color: var(--text-primary);">Query Information</h3>
                <div style="padding: 12px; background: var(--bg-secondary); border-radius: 6px; border-left: 3px solid var(--accent-color);">
                    <div style="font-weight: 500; margin-bottom: 8px; color: var(--text-primary);">Query content:</div>
                    <div style="color: var(--text-primary); line-height: 1.6; word-break: break-word;">${escapeHtml(log.query || 'No query content')}</div>
                </div>
            </div>
            
            <div class="retrieval-detail-section">
                <h3 style="margin: 0 0 12px 0; font-size: 1.125rem; color: var(--text-primary);">Retrieval Information</h3>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px;">
                    ${log.riskType ? `
                        <div style="padding: 12px; background: var(--bg-secondary); border-radius: 6px;">
                            <div style="font-size: 0.875rem; color: var(--text-secondary); margin-bottom: 4px;">Risk Type</div>
                            <div style="font-weight: 500; color: var(--text-primary);">${escapeHtml(log.riskType)}</div>
                        </div>
                    ` : ''}
                    <div style="padding: 12px; background: var(--bg-secondary); border-radius: 6px;">
                        <div style="font-size: 0.875rem; color: var(--text-secondary); margin-bottom: 4px;">Retrieval Time</div>
                        <div style="font-weight: 500; color: var(--text-primary);" title="${fullTime}">${timeAgo}</div>
                    </div>
                    <div style="padding: 12px; background: var(--bg-secondary); border-radius: 6px;">
                        <div style="font-size: 0.875rem; color: var(--text-secondary); margin-bottom: 4px;">Retrieval Results</div>
                        <div style="font-weight: 500; color: var(--text-primary);">${retrievedItems.length} knowledge item(s)</div>
                    </div>
                </div>
            </div>
            
            ${log.conversationId || log.messageId ? `
                <div class="retrieval-detail-section">
                    <h3 style="margin: 0 0 12px 0; font-size: 1.125rem; color: var(--text-primary);">Associated Information</h3>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px;">
                        ${log.conversationId ? `
                            <div style="padding: 12px; background: var(--bg-secondary); border-radius: 6px;">
                                <div style="font-size: 0.875rem; color: var(--text-secondary); margin-bottom: 4px;">Conversation ID</div>
                                <code style="font-size: 0.8125rem; color: var(--text-primary); word-break: break-all; cursor: pointer;" 
                                      onclick="navigator.clipboard.writeText('${escapeHtml(log.conversationId)}'); this.title='Copied!'; setTimeout(() => this.title='Click to copy', 2000);" 
                                      title="Click to copy">${escapeHtml(log.conversationId)}</code>
                            </div>
                        ` : ''}
                        ${log.messageId ? `
                            <div style="padding: 12px; background: var(--bg-secondary); border-radius: 6px;">
                                <div style="font-size: 0.875rem; color: var(--text-secondary); margin-bottom: 4px;">Message ID</div>
                                <code style="font-size: 0.8125rem; color: var(--text-primary); word-break: break-all; cursor: pointer;" 
                                      onclick="navigator.clipboard.writeText('${escapeHtml(log.messageId)}'); this.title='Copied!'; setTimeout(() => this.title='Click to copy', 2000);" 
                                      title="Click to copy">${escapeHtml(log.messageId)}</code>
                            </div>
                        ` : ''}
                    </div>
                </div>
            ` : ''}
            
            <div class="retrieval-detail-section">
                <h3 style="margin: 0 0 12px 0; font-size: 1.125rem; color: var(--text-primary);">Retrieved Knowledge Items (${retrievedItems.length})</h3>
                ${itemsHtml}
            </div>
        </div>
    `;
    
    modal.style.display = 'block';
}

// Close retrieval log details modal
function closeRetrievalLogDetailsModal() {
    const modal = document.getElementById('retrieval-log-details-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Click outside modal to close
window.addEventListener('click', function(event) {
    const modal = document.getElementById('retrieval-log-details-modal');
    if (event.target === modal) {
        closeRetrievalLogDetailsModal();
    }
});

// Load data when page switches
if (typeof switchPage === 'function') {
    const originalSwitchPage = switchPage;
    window.switchPage = function(page) {
        originalSwitchPage(page);
        
        if (page === 'knowledge-management') {
            loadKnowledgeCategories();
            loadKnowledgeItems(knowledgePagination.currentCategory, 1, knowledgePagination.pageSize);
            updateIndexProgress(); // Update index progress
        } else if (page === 'knowledge-retrieval-logs') {
            loadRetrievalLogs();
            // Stop polling when switching to other pages
            if (indexProgressInterval) {
                clearInterval(indexProgressInterval);
                indexProgressInterval = null;
            }
        } else {
            // Stop polling when switching to other pages
            if (indexProgressInterval) {
                clearInterval(indexProgressInterval);
                indexProgressInterval = null;
            }
        }
    };
}

// Clean up timers on page unload
window.addEventListener('beforeunload', function() {
    if (indexProgressInterval) {
        clearInterval(indexProgressInterval);
        indexProgressInterval = null;
    }
});

// Utility functions
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatTime(timeStr) {
    if (!timeStr) return '';
    
    // Handle time string, supports multiple formats
    let date;
    if (typeof timeStr === 'string') {
        // First try direct parsing (supports RFC3339/ISO8601 format)
        date = new Date(timeStr);
        
        // If parsing fails, try other formats
        if (isNaN(date.getTime())) {
            // SQLite format: "2006-01-02 15:04:05" or with timezone
            const sqliteMatch = timeStr.match(/(\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[+-]\d{2}:\d{2}|Z)?)/);
            if (sqliteMatch) {
                let timeStr2 = sqliteMatch[1].replace(' ', 'T');
                // If no timezone info, add Z to indicate UTC
                if (!timeStr2.includes('Z') && !timeStr2.match(/[+-]\d{2}:\d{2}$/)) {
                    timeStr2 += 'Z';
                }
                date = new Date(timeStr2);
            }
        }
        
        // If still failing, try more relaxed format
        if (isNaN(date.getTime())) {
            // Try matching "YYYY-MM-DD HH:MM:SS" format
            const match = timeStr.match(/(\d{4})-(\d{2})-(\d{2})[\sT](\d{2}):(\d{2}):(\d{2})/);
            if (match) {
                date = new Date(
                    parseInt(match[1]), 
                    parseInt(match[2]) - 1, 
                    parseInt(match[3]),
                    parseInt(match[4]),
                    parseInt(match[5]),
                    parseInt(match[6])
                );
            }
        }
    } else {
        date = new Date(timeStr);
    }
    
    // If date is invalid, check if it is a zero-value time
    if (isNaN(date.getTime())) {
        // Check if it is the string form of zero-value time
        if (typeof timeStr === 'string' && (timeStr.includes('0001-01-01') || timeStr.startsWith('0001'))) {
            return '';
        }
        console.warn('Unable to parse time:', timeStr);
        return '';
    }
    
    // Check if date is reasonable (not before 1970, not too far in future)
    const year = date.getFullYear();
    if (year < 1970 || year > 2100) {
        // If it is zero-value time (0001-01-01), return empty string, do not display
        if (year === 1) {
            return '';
        }
        console.warn('Unreasonable time value:', timeStr, 'parsed as:', date);
        return '';
    }
    
    return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
}

// Show notification
function showNotification(message, type = 'info') {
    // If global notification system exists (and is not the current function), use it
    if (typeof window.showNotification === 'function' && window.showNotification !== showNotification) {
        window.showNotification(message, type);
        return;
    }
    
    // Otherwise use custom toast notification
    showToastNotification(message, type);
}

// Show toast notification
function showToastNotification(message, type = 'info') {
    // Create notification container (if not exists)
    let container = document.getElementById('toast-notification-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-notification-container';
        container.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 10000;
            display: flex;
            flex-direction: column;
            gap: 12px;
            pointer-events: none;
        `;
        document.body.appendChild(container);
    }
    
    // Create notification element
    const toast = document.createElement('div');
    toast.className = `toast-notification toast-${type}`;
    
    // Set color based on type
    const typeStyles = {
        success: {
            background: '#28a745',
            color: '#fff',
            icon: '✅'
        },
        error: {
            background: '#dc3545',
            color: '#fff',
            icon: '❌'
        },
        info: {
            background: '#17a2b8',
            color: '#fff',
            icon: 'ℹ️'
        },
        warning: {
            background: '#ffc107',
            color: '#000',
            icon: '⚠️'
        }
    };
    
    const style = typeStyles[type] || typeStyles.info;
    
    toast.style.cssText = `
        background: ${style.background};
        color: ${style.color};
        padding: 14px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        min-width: 300px;
        max-width: 500px;
        pointer-events: auto;
        animation: slideInRight 0.3s ease-out;
        display: flex;
        align-items: center;
        gap: 12px;
        font-size: 0.9375rem;
        line-height: 1.5;
        word-wrap: break-word;
    `;
    
    toast.innerHTML = `
        <span style="font-size: 1.2em; flex-shrink: 0;">${style.icon}</span>
        <span style="flex: 1;">${escapeHtml(message)}</span>
        <button onclick="this.parentElement.remove()" style="
            background: transparent;
            border: none;
            color: ${style.color};
            cursor: pointer;
            font-size: 1.2em;
            padding: 0;
            margin-left: 8px;
            opacity: 0.7;
            flex-shrink: 0;
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
        " onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.7'">×</button>
    `;
    
    container.appendChild(toast);
    
    // Auto remove (success: 5s, error: 7s, others: 4s)
    const duration = type === 'success' ? 5000 : type === 'error' ? 7000 : 4000;
    setTimeout(() => {
        if (toast.parentElement) {
            toast.style.animation = 'slideOutRight 0.3s ease-out';
            setTimeout(() => {
                if (toast.parentElement) {
                    toast.remove();
                }
            }, 300);
        }
    }, duration);
}

// Add CSS animation (if not exists)
if (!document.getElementById('toast-notification-styles')) {
    const style = document.createElement('style');
    style.id = 'toast-notification-styles';
    style.textContent = `
        @keyframes slideInRight {
            from {
                transform: translateX(100%);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }
        @keyframes slideOutRight {
            from {
                transform: translateX(0);
                opacity: 1;
            }
            to {
                transform: translateX(100%);
                opacity: 0;
            }
        }
    `;
    document.head.appendChild(style);
}

// Click outside modal to close
window.addEventListener('click', function(event) {
    const modal = document.getElementById('knowledge-item-modal');
    if (event.target === modal) {
        closeKnowledgeItemModal();
    }
});

// Switch to settings page (used for feature-not-enabled prompts)
function switchToSettings() {
    if (typeof switchPage === 'function') {
        switchPage('settings');
        // After settings page loads, switch to knowledge base config section
        setTimeout(() => {
            if (typeof switchSettingsSection === 'function') {
                // Find knowledge base config section (usually in basic settings)
                const knowledgeSection = document.querySelector('[data-section="knowledge"]');
                if (knowledgeSection) {
                    switchSettingsSection('knowledge');
                } else {
                    // If no independent knowledge base section, switch to basic settings
                    switchSettingsSection('basic');
                    // Scroll to knowledge base config area
                    setTimeout(() => {
                        const knowledgeEnabledCheckbox = document.getElementById('knowledge-enabled');
                        if (knowledgeEnabledCheckbox) {
                            knowledgeEnabledCheckbox.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            // Highlight
                            knowledgeEnabledCheckbox.parentElement.style.transition = 'background-color 0.3s';
                            knowledgeEnabledCheckbox.parentElement.style.backgroundColor = '#e3f2fd';
                            setTimeout(() => {
                                knowledgeEnabledCheckbox.parentElement.style.backgroundColor = '';
                            }, 2000);
                        }
                    }, 300);
                }
            }
        }, 100);
    }
}

// Custom dropdown component interaction
document.addEventListener('DOMContentLoaded', function() {
    const wrapper = document.getElementById('knowledge-category-filter-wrapper');
    const trigger = document.getElementById('knowledge-category-filter-trigger');
    
    if (wrapper && trigger) {
        // Click trigger to open/close dropdown
        trigger.addEventListener('click', function(e) {
            e.stopPropagation();
            wrapper.classList.toggle('open');
        });
        
        // Click outside to close dropdown
        document.addEventListener('click', function(e) {
            if (!wrapper.contains(e.target)) {
                wrapper.classList.remove('open');
            }
        });
        
        // Update selection status when option is selected
        const dropdown = document.getElementById('knowledge-category-filter-dropdown');
        if (dropdown) {
            // Default select "All" option
            const defaultOption = dropdown.querySelector('.custom-select-option[data-value=""]');
            if (defaultOption) {
                defaultOption.classList.add('selected');
            }
            
            dropdown.addEventListener('click', function(e) {
                const option = e.target.closest('.custom-select-option');
                if (option) {
                    // Remove previous selection status
                    dropdown.querySelectorAll('.custom-select-option').forEach(opt => {
                        opt.classList.remove('selected');
                    });
                    // Add selection status
                    option.classList.add('selected');
                }
            });
        }
    }
});


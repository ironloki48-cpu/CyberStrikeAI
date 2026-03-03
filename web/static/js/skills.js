// Skills management functionality
let skillsList = [];
let currentEditingSkillName = null;
let isSavingSkill = false; // Prevent duplicate submissions
let skillsSearchKeyword = '';
let skillsSearchTimeout = null; // Search debounce timer
let skillsPagination = {
    currentPage: 1,
    pageSize: 20, // 20 items per page (default, actual value read from localStorage)
    total: 0
};
let skillsStats = {
    total: 0,
    totalCalls: 0,
    totalSuccess: 0,
    totalFailed: 0,
    skillsDir: '',
    stats: []
};

// Get saved per-page count
function getSkillsPageSize() {
    try {
        const saved = localStorage.getItem('skillsPageSize');
        if (saved) {
            const size = parseInt(saved);
            if ([10, 20, 50, 100].includes(size)) {
                return size;
            }
        }
    } catch (e) {
        console.warn('Cannot read pagination settings from localStorage:', e);
    }
    return 20; // Default: 20
}

// Initialize pagination settings
function initSkillsPagination() {
    const savedPageSize = getSkillsPageSize();
    skillsPagination.pageSize = savedPageSize;
}

// Load skills list (with pagination support)
async function loadSkills(page = 1, pageSize = null) {
    try {
        // If pageSize not specified, use saved value or default
        if (pageSize === null) {
            pageSize = getSkillsPageSize();
        }
        
        // Update pagination status (ensure correct pageSize is used)
        skillsPagination.currentPage = page;
        skillsPagination.pageSize = pageSize;
        
        // Clear search keyword (during normal pagination load)
        skillsSearchKeyword = '';
        const searchInput = document.getElementById('skills-search');
        if (searchInput) {
            searchInput.value = '';
        }
        
        // Build URL (with pagination support)
        const offset = (page - 1) * pageSize;
        const url = `/api/skills?limit=${pageSize}&offset=${offset}`;
        
        const response = await apiFetch(url);
        if (!response.ok) {
            throw new Error('Failed to fetch skills list');
        }
        const data = await response.json();
        skillsList = data.skills || [];
        skillsPagination.total = data.total || 0;
        
        renderSkillsList();
        renderSkillsPagination();
        updateSkillsManagementStats();
    } catch (error) {
        console.error('Failed to load skills list:', error);
        showNotification('Failed to load skills list: ' + error.message, 'error');
        const skillsListEl = document.getElementById('skills-list');
        if (skillsListEl) {
            skillsListEl.innerHTML = '<div class="empty-state">Failed to load: ' + error.message + '</div>';
        }
    }
}

// Render skills list
function renderSkillsList() {
    const skillsListEl = document.getElementById('skills-list');
    if (!skillsListEl) return;

    // Backend has already done search filtering, use skillsList directly
    const filteredSkills = skillsList;

    if (filteredSkills.length === 0) {
        skillsListEl.innerHTML = '<div class="empty-state">' + 
            (skillsSearchKeyword ? 'No matching skills found' : 'No skills yet, click "Add Skill" to create the first skill') + 
            '</div>';
        // Hide pagination during search
        const paginationContainer = document.getElementById('skills-pagination');
        if (paginationContainer) {
            paginationContainer.innerHTML = '';
        }
        return;
    }

    skillsListEl.innerHTML = filteredSkills.map(skill => {
        return `
            <div class="skill-card">
                <div class="skill-card-header">
                    <h3 class="skill-card-title">${escapeHtml(skill.name || '')}</h3>
                    <div class="skill-card-description">${escapeHtml(skill.description || 'No description')}</div>
                </div>
                <div class="skill-card-actions">
                    <button class="btn-secondary btn-small" onclick="viewSkill('${escapeHtml(skill.name)}')">View</button>
                    <button class="btn-secondary btn-small" onclick="editSkill('${escapeHtml(skill.name)}')">Edit</button>
                    <button class="btn-secondary btn-small btn-danger" onclick="deleteSkill('${escapeHtml(skill.name)}')">Delete</button>
                </div>
            </div>
        `;
    }).join('');
    
    // Ensure list container is scrollable and pagination bar is visible
    // Use setTimeout to ensure check happens after DOM update
    setTimeout(() => {
        const paginationContainer = document.getElementById('skills-pagination');
        if (paginationContainer && !skillsSearchKeyword) {
            // Ensure pagination bar is visible
            paginationContainer.style.display = 'block';
            paginationContainer.style.visibility = 'visible';
        }
    }, 0);
}

// Render pagination component (based on MCP management page style)
function renderSkillsPagination() {
    const paginationContainer = document.getElementById('skills-pagination');
    if (!paginationContainer) return;
    
    const total = skillsPagination.total;
    const pageSize = skillsPagination.pageSize;
    const currentPage = skillsPagination.currentPage;
    const totalPages = Math.ceil(total / pageSize);
    
    // Show pagination info even for single page (based on MCP style)
    if (total === 0) {
        paginationContainer.innerHTML = '';
        return;
    }
    
    // Calculate display range
    const start = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
    const end = total === 0 ? 0 : Math.min(currentPage * pageSize, total);
    
    let paginationHTML = '<div class="pagination">';
    
    // Left: display range info and per-page selector (based on MCP style)
    paginationHTML += `
        <div class="pagination-info">
            <span>Showing ${start}-${end} of ${total}</span>
            <label class="pagination-page-size">
                Per page:
                <select id="skills-page-size-pagination" onchange="changeSkillsPageSize()">
                    <option value="10" ${pageSize === 10 ? 'selected' : ''}>10</option>
                    <option value="20" ${pageSize === 20 ? 'selected' : ''}>20</option>
                    <option value="50" ${pageSize === 50 ? 'selected' : ''}>50</option>
                    <option value="100" ${pageSize === 100 ? 'selected' : ''}>100</option>
                </select>
            </label>
        </div>
    `;
    
    // Right: pagination buttons (based on MCP style: first, prev, X/Y, next, last)
    paginationHTML += `
        <div class="pagination-controls">
            <button class="btn-secondary" onclick="loadSkills(1, ${pageSize})" ${currentPage === 1 || total === 0 ? 'disabled' : ''}>First</button>
            <button class="btn-secondary" onclick="loadSkills(${currentPage - 1}, ${pageSize})" ${currentPage === 1 || total === 0 ? 'disabled' : ''}>Prev</button>
            <span class="pagination-page">Page ${currentPage} / ${totalPages || 1}</span>
            <button class="btn-secondary" onclick="loadSkills(${currentPage + 1}, ${pageSize})" ${currentPage >= totalPages || total === 0 ? 'disabled' : ''}>Next</button>
            <button class="btn-secondary" onclick="loadSkills(${totalPages || 1}, ${pageSize})" ${currentPage >= totalPages || total === 0 ? 'disabled' : ''}>Last</button>
        </div>
    `;
    
    paginationHTML += '</div>';
    
    paginationContainer.innerHTML = paginationHTML;
    
    // Ensure pagination aligns with list content area (excluding scrollbar)
    function alignPaginationWidth() {
        const skillsList = document.getElementById('skills-list');
        if (skillsList && paginationContainer) {
            // Ensure pagination container is always visible
            paginationContainer.style.display = '';
            paginationContainer.style.visibility = 'visible';
            paginationContainer.style.opacity = '1';
            
            // Get actual content width of list (excluding scrollbar)
            const listClientWidth = skillsList.clientWidth; // Visible area width (excluding scrollbar)
            const listScrollHeight = skillsList.scrollHeight; // Total content height
            const listClientHeight = skillsList.clientHeight; // Visible area height
            const hasScrollbar = listScrollHeight > listClientHeight;
            
            // If list has vertical scrollbar, pagination should align with list content area (clientWidth)
            // If no scrollbar, use 100% width
            if (hasScrollbar && listClientWidth > 0) {
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
    
    const skillsList = document.getElementById('skills-list');
    if (skillsList) {
        resizeObserver.observe(skillsList);
    }
    
    // Ensure pagination container is always visible (prevent being hidden)
    paginationContainer.style.display = 'block';
    paginationContainer.style.visibility = 'visible';
}

// Change per-page count
async function changeSkillsPageSize() {
    const pageSizeSelect = document.getElementById('skills-page-size-pagination');
    if (!pageSizeSelect) return;
    
    const newPageSize = parseInt(pageSizeSelect.value);
    if (isNaN(newPageSize) || newPageSize <= 0) return;
    
    // Save to localStorage
    try {
        localStorage.setItem('skillsPageSize', newPageSize.toString());
    } catch (e) {
        console.warn('Cannot save pagination settings to localStorage:', e);
    }
    
    // Update pagination status
    skillsPagination.pageSize = newPageSize;
    
    // Recalculate current page (ensure within range)
    const totalPages = Math.ceil(skillsPagination.total / newPageSize);
    const currentPage = Math.min(skillsPagination.currentPage, totalPages || 1);
    skillsPagination.currentPage = currentPage;
    
    // Reload data
    await loadSkills(currentPage, newPageSize);
}

// Update skills management stats
function updateSkillsManagementStats() {
    const statsEl = document.getElementById('skills-management-stats');
    if (!statsEl) return;

    const totalEl = statsEl.querySelector('.skill-stat-value');
    if (totalEl) {
        totalEl.textContent = skillsPagination.total;
    }
}

// Search skills
function handleSkillsSearchInput() {
    clearTimeout(skillsSearchTimeout);
    skillsSearchTimeout = setTimeout(() => {
        searchSkills();
    }, 300);
}

async function searchSkills() {
    const searchInput = document.getElementById('skills-search');
    if (!searchInput) return;
    
    skillsSearchKeyword = searchInput.value.trim();
    const clearBtn = document.getElementById('skills-search-clear');
    if (clearBtn) {
        clearBtn.style.display = skillsSearchKeyword ? 'block' : 'none';
    }
    
    if (skillsSearchKeyword) {
        // When search keyword exists, use backend search API (load all matches, no pagination)
        try {
            const response = await apiFetch(`/api/skills?search=${encodeURIComponent(skillsSearchKeyword)}&limit=10000&offset=0`);
            if (!response.ok) {
                throw new Error('Failed to fetch skills list');
            }
            const data = await response.json();
            skillsList = data.skills || [];
            skillsPagination.total = data.total || 0;
            renderSkillsList();
            // Hide pagination during search
            const paginationContainer = document.getElementById('skills-pagination');
            if (paginationContainer) {
                paginationContainer.innerHTML = '';
            }
            // Update stats (show search result count)
            updateSkillsManagementStats();
        } catch (error) {
            console.error('Skills search failed:', error);
            showNotification('Search failed: ' + error.message, 'error');
        }
    } else {
        // When no search keyword, restore paginated load
        await loadSkills(1, skillsPagination.pageSize);
    }
}

// Clear skills search
function clearSkillsSearch() {
    const searchInput = document.getElementById('skills-search');
    if (searchInput) {
        searchInput.value = '';
    }
    skillsSearchKeyword = '';
    const clearBtn = document.getElementById('skills-search-clear');
    if (clearBtn) {
        clearBtn.style.display = 'none';
    }
    // Restore paginated load
    loadSkills(1, skillsPagination.pageSize);
}

// Refresh skills
async function refreshSkills() {
    await loadSkills(skillsPagination.currentPage, skillsPagination.pageSize);
    showNotification('Refreshed', 'success');
}

// Show add skill modal
function showAddSkillModal() {
    const modal = document.getElementById('skill-modal');
    if (!modal) return;

    document.getElementById('skill-modal-title').textContent = 'Add Skill';
    document.getElementById('skill-name').value = '';
    document.getElementById('skill-name').disabled = false;
    document.getElementById('skill-description').value = '';
    document.getElementById('skill-content').value = '';
    
    modal.style.display = 'flex';
}

// Edit skill
async function editSkill(skillName) {
    try {
        const response = await apiFetch(`/api/skills/${encodeURIComponent(skillName)}`);
        if (!response.ok) {
            throw new Error('Failed to fetch skill details');
        }
        const data = await response.json();
        const skill = data.skill;

        const modal = document.getElementById('skill-modal');
        if (!modal) return;

        document.getElementById('skill-modal-title').textContent = 'Edit Skill';
        document.getElementById('skill-name').value = skill.name;
        document.getElementById('skill-name').disabled = true; // Cannot modify name when editing
        document.getElementById('skill-description').value = skill.description || '';
        document.getElementById('skill-content').value = skill.content || '';
        
        currentEditingSkillName = skillName;
        modal.style.display = 'flex';
    } catch (error) {
        console.error('Failed to load skill details:', error);
        showNotification('Failed to load skill details: ' + error.message, 'error');
    }
}

// View skill
async function viewSkill(skillName) {
    try {
        const response = await apiFetch(`/api/skills/${encodeURIComponent(skillName)}`);
        if (!response.ok) {
            throw new Error('Failed to fetch skill details');
        }
        const data = await response.json();
        const skill = data.skill;

        // Create view modal
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'skill-view-modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 900px; max-height: 90vh;">
                <div class="modal-header">
                    <h2>View Skill: ${escapeHtml(skill.name)}</h2>
                    <span class="modal-close" onclick="closeSkillViewModal()">&times;</span>
                </div>
                <div class="modal-body" style="overflow-y: auto; max-height: calc(90vh - 120px);">
                    ${skill.description ? `<div style="margin-bottom: 16px;"><strong>Description:</strong> ${escapeHtml(skill.description)}</div>` : ''}
                    <div style="margin-bottom: 8px;"><strong>Path:</strong> ${escapeHtml(skill.path || '')}</div>
                    <div style="margin-bottom: 16px;"><strong>Modified:</strong> ${escapeHtml(skill.mod_time || '')}</div>
                    <div style="margin-bottom: 8px;"><strong>Content:</strong></div>
                    <pre style="background: #f5f5f5; padding: 16px; border-radius: 4px; overflow-x: auto; white-space: pre-wrap; word-wrap: break-word;">${escapeHtml(skill.content || '')}</pre>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" onclick="closeSkillViewModal()">Close</button>
                    <button class="btn-primary" onclick="editSkill('${escapeHtml(skill.name)}'); closeSkillViewModal();">Edit</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.style.display = 'flex';
    } catch (error) {
        console.error('Failed to view skill:', error);
        showNotification('Failed to view skill: ' + error.message, 'error');
    }
}

// Close view modal
function closeSkillViewModal() {
    const modal = document.getElementById('skill-view-modal');
    if (modal) {
        modal.remove();
    }
}

// Close skill modal
function closeSkillModal() {
    const modal = document.getElementById('skill-modal');
    if (modal) {
        modal.style.display = 'none';
        currentEditingSkillName = null;
    }
}

// Save skill
async function saveSkill() {
    if (isSavingSkill) return;

    const name = document.getElementById('skill-name').value.trim();
    const description = document.getElementById('skill-description').value.trim();
    const content = document.getElementById('skill-content').value.trim();

    if (!name) {
        showNotification('Skill name cannot be empty', 'error');
        return;
    }

    if (!content) {
        showNotification('Skill content cannot be empty', 'error');
        return;
    }

    // Validate skill name
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
        showNotification('Skill name can only contain letters, numbers, hyphens and underscores', 'error');
        return;
    }

    isSavingSkill = true;
    const saveBtn = document.querySelector('#skill-modal .btn-primary');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
    }

    try {
        const isEdit = !!currentEditingSkillName;
        const url = isEdit ? `/api/skills/${encodeURIComponent(currentEditingSkillName)}` : '/api/skills';
        const method = isEdit ? 'PUT' : 'POST';

        const response = await apiFetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: name,
                description: description,
                content: content
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to save skill');
        }

        showNotification(isEdit ? 'Skill updated' : 'Skill created', 'success');
        closeSkillModal();
        await loadSkills(skillsPagination.currentPage, skillsPagination.pageSize);
    } catch (error) {
        console.error('Failed to save skill:', error);
        showNotification('Failed to save skill: ' + error.message, 'error');
    } finally {
        isSavingSkill = false;
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save';
        }
    }
}

// Delete skill
async function deleteSkill(skillName) {
    // First check if any roles are bound to this skill
    let boundRoles = [];
    try {
        const checkResponse = await apiFetch(`/api/skills/${encodeURIComponent(skillName)}/bound-roles`);
        if (checkResponse.ok) {
            const checkData = await checkResponse.json();
            boundRoles = checkData.bound_roles || [];
        }
    } catch (error) {
        console.warn('Failed to check skill binding:', error);
        // If check fails, continue with delete process
    }

    // Build confirmation message
    let confirmMessage = `Are you sure you want to delete skill "${skillName}"? This action cannot be undone.`;
    if (boundRoles.length > 0) {
        const rolesList = boundRoles.join(', ');
        confirmMessage = `Are you sure you want to delete skill "${skillName}"?\n\n⚠️ This skill is currently bound to the following ${boundRoles.length} role(s):\n${rolesList}\n\nAfter deletion, the system will automatically remove this skill's binding from these roles.\n\nThis action cannot be undone. Continue?`;
    }

    if (!confirm(confirmMessage)) {
        return;
    }

    try {
        const response = await apiFetch(`/api/skills/${encodeURIComponent(skillName)}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to delete skill');
        }

        const data = await response.json();
        let successMessage = 'Skill deleted';
        if (data.affected_roles && data.affected_roles.length > 0) {
            const rolesList = data.affected_roles.join(', ');
            successMessage = `Skill deleted, automatically removed binding from ${data.affected_roles.length} role(s): ${rolesList}`;
        }
        showNotification(successMessage, 'success');

        // If current page has no data, go back to previous page
        const currentPage = skillsPagination.currentPage;
        const totalAfterDelete = skillsPagination.total - 1;
        const totalPages = Math.ceil(totalAfterDelete / skillsPagination.pageSize);
        const pageToLoad = currentPage > totalPages && totalPages > 0 ? totalPages : currentPage;
        await loadSkills(pageToLoad, skillsPagination.pageSize);
    } catch (error) {
        console.error('Failed to delete skill:', error);
        showNotification('Failed to delete skill: ' + error.message, 'error');
    }
}

// ==================== Skills Status Monitoring Functions ====================

// Load skills monitoring data
async function loadSkillsMonitor() {
    try {
        const response = await apiFetch('/api/skills/stats');
        if (!response.ok) {
            throw new Error('Failed to fetch skills stats');
        }
        const data = await response.json();
        
        skillsStats = {
            total: data.total_skills || 0,
            totalCalls: data.total_calls || 0,
            totalSuccess: data.total_success || 0,
            totalFailed: data.total_failed || 0,
            skillsDir: data.skills_dir || '',
            stats: data.stats || []
        };

        renderSkillsMonitor();
    } catch (error) {
        console.error('Failed to load skills monitoring data:', error);
        showNotification('Failed to load skills monitoring data: ' + error.message, 'error');
        const statsEl = document.getElementById('skills-stats');
        if (statsEl) {
            statsEl.innerHTML = '<div class="monitor-error">Failed to load stats: ' + escapeHtml(error.message) + '</div>';
        }
        const monitorListEl = document.getElementById('skills-monitor-list');
        if (monitorListEl) {
            monitorListEl.innerHTML = '<div class="monitor-error">Failed to load call stats: ' + escapeHtml(error.message) + '</div>';
        }
    }
}

// Render skills monitoring page
function renderSkillsMonitor() {
    // Render overall stats
    const statsEl = document.getElementById('skills-stats');
    if (statsEl) {
        const successRate = skillsStats.totalCalls > 0 
            ? ((skillsStats.totalSuccess / skillsStats.totalCalls) * 100).toFixed(1) 
            : '0.0';
        
        statsEl.innerHTML = `
            <div class="monitor-stat-card">
                <div class="monitor-stat-label">Total Skills</div>
                <div class="monitor-stat-value">${skillsStats.total}</div>
            </div>
            <div class="monitor-stat-card">
                <div class="monitor-stat-label">Total Calls</div>
                <div class="monitor-stat-value">${skillsStats.totalCalls}</div>
            </div>
            <div class="monitor-stat-card">
                <div class="monitor-stat-label">Successful Calls</div>
                <div class="monitor-stat-value" style="color: #28a745;">${skillsStats.totalSuccess}</div>
            </div>
            <div class="monitor-stat-card">
                <div class="monitor-stat-label">Failed Calls</div>
                <div class="monitor-stat-value" style="color: #dc3545;">${skillsStats.totalFailed}</div>
            </div>
            <div class="monitor-stat-card">
                <div class="monitor-stat-label">Success Rate</div>
                <div class="monitor-stat-value">${successRate}%</div>
            </div>
        `;
    }

    // Render call stats table
    const monitorListEl = document.getElementById('skills-monitor-list');
    if (!monitorListEl) return;

    const stats = skillsStats.stats || [];
    
    // If no stats data, show empty state
    if (stats.length === 0) {
        monitorListEl.innerHTML = '<div class="monitor-empty">No skills call records</div>';
        return;
    }

    // Sort by call count (desc), if same count sort by name
    const sortedStats = [...stats].sort((a, b) => {
        const callsA = b.total_calls || 0;
        const callsB = a.total_calls || 0;
        if (callsA !== callsB) {
            return callsA - callsB;
        }
        return (a.skill_name || '').localeCompare(b.skill_name || '');
    });

    monitorListEl.innerHTML = `
        <table class="monitor-table">
            <thead>
                <tr>
                    <th style="text-align: left !important;">Skill Name</th>
                    <th style="text-align: center;">Total Calls</th>
                    <th style="text-align: center;">Success</th>
                    <th style="text-align: center;">Failed</th>
                    <th style="text-align: center;">Success Rate</th>
                    <th style="text-align: left;">Last Called</th>
                </tr>
            </thead>
            <tbody>
                ${sortedStats.map(stat => {
                    const totalCalls = stat.total_calls || 0;
                    const successCalls = stat.success_calls || 0;
                    const failedCalls = stat.failed_calls || 0;
                    const successRate = totalCalls > 0 ? ((successCalls / totalCalls) * 100).toFixed(1) : '0.0';
                    const lastCallTime = stat.last_call_time && stat.last_call_time !== '-' ? stat.last_call_time : '-';
                    
                    return `
                        <tr>
                            <td style="text-align: left !important;"><strong>${escapeHtml(stat.skill_name || '')}</strong></td>
                            <td style="text-align: center;">${totalCalls}</td>
                            <td style="text-align: center; color: #28a745; font-weight: 500;">${successCalls}</td>
                            <td style="text-align: center; color: #dc3545; font-weight: 500;">${failedCalls}</td>
                            <td style="text-align: center;">${successRate}%</td>
                            <td style="color: var(--text-secondary);">${escapeHtml(lastCallTime)}</td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;
}

// Refresh skills monitoring
async function refreshSkillsMonitor() {
    await loadSkillsMonitor();
    showNotification('Refreshed', 'success');
}

// Clear skills stats data
async function clearSkillsStats() {
    if (!confirm('Are you sure you want to clear all skills stats? This action cannot be undone.')) {
        return;
    }

    try {
        const response = await apiFetch('/api/skills/stats', {
            method: 'DELETE'
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to clear stats');
        }

        showNotification('All skills stats cleared', 'success');
        // Reload stats data
        await loadSkillsMonitor();
    } catch (error) {
        console.error('Failed to clear stats:', error);
        showNotification('Failed to clear stats: ' + error.message, 'error');
    }
}

// HTML escape function
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

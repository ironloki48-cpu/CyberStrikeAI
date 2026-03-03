// Role management related functionality
let currentRole = localStorage.getItem('currentRole') || '';
let roles = [];
let rolesSearchKeyword = ''; // Role search keyword
let rolesSearchTimeout = null; // Search debounce timer
let allRoleTools = []; // Store all tool list (for role tool selection)
let roleToolsPagination = {
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 1
};
let roleToolsSearchKeyword = ''; // Tool search keyword
let roleToolStateMap = new Map(); // Tool status map: toolKey -> { enabled: boolean, ... }
let roleUsesAllTools = false; // Flag whether the role uses all tools (when no tools are configured)
let totalEnabledToolsInMCP = 0; // Total number of enabled tools (obtained from MCP management, retrieved from API response)
let roleConfiguredTools = new Set(); // Configured tool list for the role (used to determine which tools should be selected)

// Skills related
let allRoleSkills = []; // Store all skills list
let roleSkillsSearchKeyword = ''; // Skills search keyword
let roleSelectedSkills = new Set(); // Set of selected skills

// Sort role list: Default role comes first, others sorted by name
function sortRoles(rolesArray) {
    const sortedRoles = [...rolesArray];
    // Separate the "Default" role
    const defaultRole = sortedRoles.find(r => r.name === 'Default');
    const otherRoles = sortedRoles.filter(r => r.name !== 'Default');

    // Sort other roles by name, maintaining a fixed order
    otherRoles.sort((a, b) => {
        const nameA = a.name || '';
        const nameB = b.name || '';
        return nameA.localeCompare(nameB);
    });

    // Place the "Default" role first, followed by other roles in sorted order
    const result = defaultRole ? [defaultRole, ...otherRoles] : otherRoles;
    return result;
}

// Load all roles
async function loadRoles() {
    try {
        const response = await apiFetch('/api/roles');
        if (!response.ok) {
            throw new Error('Load roles failed');
        }
        const data = await response.json();
        roles = data.roles || [];
        updateRoleSelectorDisplay();
        renderRoleSelectionSidebar(); // Render sidebar role list
        return roles;
    } catch (error) {
        console.error('Load roles failed:', error);
        showNotification('Load roles failed: ' + error.message, 'error');
        return [];
    }
}

// Handle role change
function handleRoleChange(roleName) {
    const oldRole = currentRole;
    currentRole = roleName || '';
    localStorage.setItem('currentRole', currentRole);
    updateRoleSelectorDisplay();
    renderRoleSelectionSidebar(); // Update sidebar selected status

    // When role switches, if the tool list has been loaded, mark it as needing reload
    // So the next time @ tool suggestions are triggered, the tool list will reload with the new role
    if (oldRole !== currentRole && typeof window !== 'undefined') {
        // Notify chat.js that the tool list needs to be reloaded by setting a flag
        window._mentionToolsRoleChanged = true;
    }
}

// Update role selector display
function updateRoleSelectorDisplay() {
    const roleSelectorBtn = document.getElementById('role-selector-btn');
    const roleSelectorIcon = document.getElementById('role-selector-icon');
    const roleSelectorText = document.getElementById('role-selector-text');

    if (!roleSelectorBtn || !roleSelectorIcon || !roleSelectorText) return;

    let selectedRole;
    if (currentRole && currentRole !== 'Default') {
        selectedRole = roles.find(r => r.name === currentRole);
    } else {
        selectedRole = roles.find(r => r.name === 'Default');
    }

    if (selectedRole) {
        // Use the icon from the configuration; use the default icon if not set
        let icon = selectedRole.icon || '🔵';
        // If icon is in Unicode escape format (\U0001F3C6), convert to emoji
        if (icon && typeof icon === 'string') {
            const unicodeMatch = icon.match(/^"?\\U([0-9A-F]{8})"?$/i);
            if (unicodeMatch) {
                try {
                    const codePoint = parseInt(unicodeMatch[1], 16);
                    icon = String.fromCodePoint(codePoint);
                } catch (e) {
                    // If conversion fails, use the default icon
                    console.warn('Failed to convert icon Unicode escape:', icon, e);
                    icon = '🔵';
                }
            }
        }
        roleSelectorIcon.textContent = icon;
        roleSelectorText.textContent = selectedRole.name || 'Default';
    } else {
        // Default role
        roleSelectorIcon.textContent = '🔵';
        roleSelectorText.textContent = 'Default';
    }
}

// Render main content area role selection list
function renderRoleSelectionSidebar() {
    const roleList = document.getElementById('role-selection-list');
    if (!roleList) return;

    // Clear list
    roleList.innerHTML = '';

    // Get icon from role configuration; use default icon if not configured
    function getRoleIcon(role) {
        if (role.icon) {
            // If icon is in Unicode escape format (\U0001F3C6), convert to emoji
            let icon = role.icon;
            // Check if it is in Unicode escape format (may include quotes)
            const unicodeMatch = icon.match(/^"?\\U([0-9A-F]{8})"?$/i);
            if (unicodeMatch) {
                try {
                    const codePoint = parseInt(unicodeMatch[1], 16);
                    icon = String.fromCodePoint(codePoint);
                } catch (e) {
                    // If conversion fails, use the original value
                    console.warn('Failed to convert icon Unicode escape:', icon, e);
                }
            }
            return icon;
        }
        // If no icon is configured, generate a default icon based on the first character of the role name
        // Use some common default icons
        return '👤';
    }

    // Sort roles: Default role first, others sorted by name
    const sortedRoles = sortRoles(roles);

    // Only show enabled roles
    const enabledSortedRoles = sortedRoles.filter(r => r.enabled !== false);

    enabledSortedRoles.forEach(role => {
        const isDefaultRole = role.name === 'Default';
        const isSelected = isDefaultRole ? (currentRole === '' || currentRole === 'Default') : (currentRole === role.name);
        const roleItem = document.createElement('div');
        roleItem.className = 'role-selection-item-main' + (isSelected ? ' selected' : '');
        roleItem.onclick = () => {
            selectRole(role.name);
            closeRoleSelectionPanel(); // Automatically close panel after selection
        };
        const icon = getRoleIcon(role);

        // Handle the description for the Default role
        let description = role.description || 'No description';
        if (isDefaultRole && !role.description) {
            description = 'Default role, does not carry extra user prompts, uses default MCP';
        }

        roleItem.innerHTML = `
            <div class="role-selection-item-icon-main">${icon}</div>
            <div class="role-selection-item-content-main">
                <div class="role-selection-item-name-main">${escapeHtml(role.name)}</div>
                <div class="role-selection-item-description-main">${escapeHtml(description)}</div>
            </div>
            ${isSelected ? '<div class="role-selection-checkmark-main">✓</div>' : ''}
        `;
        roleList.appendChild(roleItem);
    });
}

// Select role
function selectRole(roleName) {
    // Map "Default" to empty string (representing the default role)
    if (roleName === 'Default') {
        roleName = '';
    }
    handleRoleChange(roleName);
    renderRoleSelectionSidebar(); // Re-render to update selected status
}

// Toggle role selection panel show/hide
function toggleRoleSelectionPanel() {
    const panel = document.getElementById('role-selection-panel');
    const roleSelectorBtn = document.getElementById('role-selector-btn');
    if (!panel) return;

    const isHidden = panel.style.display === 'none' || !panel.style.display;

    if (isHidden) {
        panel.style.display = 'flex'; // Use flex layout
        // Add visual feedback for open status
        if (roleSelectorBtn) {
            roleSelectorBtn.classList.add('active');
        }

        // Check position after panel has rendered
        setTimeout(() => {
            const wrapper = document.querySelector('.role-selector-wrapper');
            if (wrapper) {
                const rect = wrapper.getBoundingClientRect();
                const panelHeight = panel.offsetHeight || 400;
                const viewportHeight = window.innerHeight;

                // If panel top exceeds viewport, scroll to appropriate position
                if (rect.top - panelHeight < 0) {
                    const scrollY = window.scrollY + rect.top - panelHeight - 20;
                    window.scrollTo({ top: Math.max(0, scrollY), behavior: 'smooth' });
                }
            }
        }, 10);
    } else {
        panel.style.display = 'none';
        // Remove visual feedback for open status
        if (roleSelectorBtn) {
            roleSelectorBtn.classList.remove('active');
        }
    }
}

// Close role selection panel (called automatically after selecting a role)
function closeRoleSelectionPanel() {
    const panel = document.getElementById('role-selection-panel');
    const roleSelectorBtn = document.getElementById('role-selector-btn');
    if (panel) {
        panel.style.display = 'none';
    }
    if (roleSelectorBtn) {
        roleSelectorBtn.classList.remove('active');
    }
}

// Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Refresh role list
async function refreshRoles() {
    await loadRoles();
    // Check if the current page is the role management page
    const currentPage = typeof window.currentPage === 'function' ? window.currentPage() : (window.currentPage || 'chat');
    if (currentPage === 'roles-management') {
        renderRolesList();
    }
    // Always update sidebar role selection list
    renderRoleSelectionSidebar();
    showNotification('Refreshed', 'success');
}

// Render role list
function renderRolesList() {
    const rolesList = document.getElementById('roles-list');
    if (!rolesList) return;

    // Filter roles (based on search keyword)
    let filteredRoles = roles;
    if (rolesSearchKeyword) {
        const keyword = rolesSearchKeyword.toLowerCase();
        filteredRoles = roles.filter(role =>
            role.name.toLowerCase().includes(keyword) ||
            (role.description && role.description.toLowerCase().includes(keyword))
        );
    }

    if (filteredRoles.length === 0) {
        rolesList.innerHTML = '<div class="empty-state">' +
            (rolesSearchKeyword ? 'No matching roles found' : 'No roles') +
            '</div>';
        return;
    }

    // Sort roles: Default role first, others sorted by name
    const sortedRoles = sortRoles(filteredRoles);

    rolesList.innerHTML = sortedRoles.map(role => {
        // Get role icon; if in Unicode escape format, convert to emoji
        let roleIcon = role.icon || '👤';
        if (roleIcon && typeof roleIcon === 'string') {
            // Check if it is in Unicode escape format (may include quotes)
            const unicodeMatch = roleIcon.match(/^"?\\U([0-9A-F]{8})"?$/i);
            if (unicodeMatch) {
                try {
                    const codePoint = parseInt(unicodeMatch[1], 16);
                    roleIcon = String.fromCodePoint(codePoint);
                } catch (e) {
                    // If conversion fails, use the default icon
                    console.warn('Failed to convert icon Unicode escape:', roleIcon, e);
                    roleIcon = '👤';
                }
            }
        }

        // Get tool list display
        let toolsDisplay = '';
        let toolsCount = 0;
        if (role.name === 'Default') {
            toolsDisplay = 'Use all tools';
        } else if (role.tools && role.tools.length > 0) {
            toolsCount = role.tools.length;
            // Show first 5 tool names
            const toolNames = role.tools.slice(0, 5).map(tool => {
                // If it is an external tool, format is external_mcp::tool_name, show only the tool name
                const toolName = tool.includes('::') ? tool.split('::')[1] : tool;
                return escapeHtml(toolName);
            });
            if (toolsCount <= 5) {
                toolsDisplay = toolNames.join(', ');
            } else {
                toolsDisplay = toolNames.join(', ') + ` and ${toolsCount} more`;
            }
        } else if (role.mcps && role.mcps.length > 0) {
            toolsCount = role.mcps.length;
            toolsDisplay = `${toolsCount} total`;
        } else {
            toolsDisplay = 'Use all tools';
        }

        return `
        <div class="role-card">
            <div class="role-card-header">
                <h3 class="role-card-title">
                    <span class="role-card-icon">${roleIcon}</span>
                    ${escapeHtml(role.name)}
                </h3>
                <span class="role-card-badge ${role.enabled !== false ? 'enabled' : 'disabled'}">
                    ${role.enabled !== false ? 'Enabled' : 'Disabled'}
                </span>
            </div>
            <div class="role-card-description">${escapeHtml(role.description || 'No description')}</div>
            <div class="role-card-tools">
                <span class="role-card-tools-label">Tools:</span>
                <span class="role-card-tools-value">${toolsDisplay}</span>
            </div>
            <div class="role-card-actions">
                <button class="btn-secondary btn-small" onclick="editRole('${escapeHtml(role.name)}')">Edit</button>
                ${role.name !== 'Default' ? `<button class="btn-secondary btn-small btn-danger" onclick="deleteRole('${escapeHtml(role.name)}')">Delete</button>` : ''}
            </div>
        </div>
    `;
    }).join('');
}

// Handle role search input
function handleRolesSearchInput() {
    clearTimeout(rolesSearchTimeout);
    rolesSearchTimeout = setTimeout(() => {
        searchRoles();
    }, 300);
}

// Search roles
function searchRoles() {
    const searchInput = document.getElementById('roles-search');
    if (!searchInput) return;

    rolesSearchKeyword = searchInput.value.trim();
    const clearBtn = document.getElementById('roles-search-clear');
    if (clearBtn) {
        clearBtn.style.display = rolesSearchKeyword ? 'block' : 'none';
    }

    renderRolesList();
}

// Clear role search
function clearRolesSearch() {
    const searchInput = document.getElementById('roles-search');
    if (searchInput) {
        searchInput.value = '';
    }
    rolesSearchKeyword = '';
    const clearBtn = document.getElementById('roles-search-clear');
    if (clearBtn) {
        clearBtn.style.display = 'none';
    }
    renderRolesList();
}

// Generate unique tool identifier (consistent with getToolKey in settings.js)
function getToolKey(tool) {
    // If it's an external tool, use external_mcp::tool.name as the unique identifier
    if (tool.is_external && tool.external_mcp) {
        return `${tool.external_mcp}::${tool.name}`;
    }
    // Built-in tools use the tool name directly
    return tool.name;
}

// Save current page tool states to global map
function saveCurrentRolePageToolStates() {
    document.querySelectorAll('#role-tools-list .role-tool-item').forEach(item => {
        const toolKey = item.dataset.toolKey;
        const checkbox = item.querySelector('input[type="checkbox"]');
        if (toolKey && checkbox) {
            const toolName = item.dataset.toolName;
            const isExternal = item.dataset.isExternal === 'true';
            const externalMcp = item.dataset.externalMcp || '';
            const existingState = roleToolStateMap.get(toolKey);
            roleToolStateMap.set(toolKey, {
                enabled: checkbox.checked,
                is_external: isExternal,
                external_mcp: externalMcp,
                name: toolName,
                mcpEnabled: existingState ? existingState.mcpEnabled : true // Retain MCP enabled status
            });
        }
    });
}

// Load all tool lists (for role tool selection)
async function loadRoleTools(page = 1, searchKeyword = '') {
    try {
        // Before loading a new page, save the current page's status to the global map
        saveCurrentRolePageToolStates();

        const pageSize = roleToolsPagination.pageSize;
        let url = `/api/config/tools?page=${page}&page_size=${pageSize}`;
        if (searchKeyword) {
            url += `&search=${encodeURIComponent(searchKeyword)}`;
        }

        const response = await apiFetch(url);
        if (!response.ok) {
            throw new Error('Failed to fetch tool list');
        }

        const result = await response.json();
        allRoleTools = result.tools || [];
        roleToolsPagination = {
            page: result.page || page,
            pageSize: result.page_size || pageSize,
            total: result.total || 0,
            totalPages: result.total_pages || 1
        };

        // Update total number of enabled tools (obtained from API response)
        if (result.total_enabled !== undefined) {
            totalEnabledToolsInMCP = result.total_enabled;
        }

        // Initialize tool status map (if a tool is not in the map, use the status returned by the server)
        // Note: if a tool is already in the map (e.g., pre-selected tools when editing a role), retain the map status
        allRoleTools.forEach(tool => {
            const toolKey = getToolKey(tool);
            if (!roleToolStateMap.has(toolKey)) {
                // Tool is not in the map
                let enabled = false;
                if (roleUsesAllTools) {
                    // If using all tools, and the tool is enabled in MCP management, mark as selected
                    enabled = tool.enabled ? true : false;
                } else {
                    // If not using all tools, only mark as selected if the tool is in the role's configured tool list
                    enabled = roleConfiguredTools.has(toolKey);
                }
                roleToolStateMap.set(toolKey, {
                    enabled: enabled,
                    is_external: tool.is_external || false,
                    external_mcp: tool.external_mcp || '',
                    name: tool.name,
                    mcpEnabled: tool.enabled // Save original enabled status from MCP management
                });
            } else {
                // Tool is already in the map (may be pre-selected or manually selected by user), retain map status
                // Note: even when using all tools, do not forcibly overwrite tool selections already cancelled by user
                const state = roleToolStateMap.get(toolKey);
                // If using all tools, and the tool is enabled in MCP management, ensure it is marked as selected
                if (roleUsesAllTools && tool.enabled) {
                    // When using all tools, ensure all enabled tools are selected
                    state.enabled = true;
                }
                // If not using all tools, retain the map status (do not overwrite, since status was correctly set during initialization)
                state.is_external = tool.is_external || false;
                state.external_mcp = tool.external_mcp || '';
                state.mcpEnabled = tool.enabled; // Update original enabled status from MCP management
                if (!state.name || state.name === toolKey.split('::').pop()) {
                    state.name = tool.name; // Update tool name
                }
            }
        });

        renderRoleToolsList();
        renderRoleToolsPagination();
        updateRoleToolsStats();
    } catch (error) {
        console.error('Failed to load tool list:', error);
        const toolsList = document.getElementById('role-tools-list');
        if (toolsList) {
            toolsList.innerHTML = `<div class="tools-error">Failed to load tool list: ${escapeHtml(error.message)}</div>`;
        }
    }
}

// Render role tool selection list
function renderRoleToolsList() {
    const toolsList = document.getElementById('role-tools-list');
    if (!toolsList) return;

    // Clear loading indicator and old content
    toolsList.innerHTML = '';

    const listContainer = document.createElement('div');
    listContainer.className = 'role-tools-list-items';
    listContainer.innerHTML = '';

    if (allRoleTools.length === 0) {
        listContainer.innerHTML = '<div class="tools-empty">No tools</div>';
        toolsList.appendChild(listContainer);
        return;
    }

    allRoleTools.forEach(tool => {
        const toolKey = getToolKey(tool);
        const toolItem = document.createElement('div');
        toolItem.className = 'role-tool-item';
        toolItem.dataset.toolKey = toolKey;
        toolItem.dataset.toolName = tool.name;
        toolItem.dataset.isExternal = tool.is_external ? 'true' : 'false';
        toolItem.dataset.externalMcp = tool.external_mcp || '';

        // Get tool status from status map
        const toolState = roleToolStateMap.get(toolKey) || {
            enabled: tool.enabled,
            is_external: tool.is_external || false,
            external_mcp: tool.external_mcp || ''
        };

        // External tool badge
        let externalBadge = '';
        if (toolState.is_external || tool.is_external) {
            const externalMcpName = toolState.external_mcp || tool.external_mcp || '';
            const badgeText = externalMcpName ? `External (${escapeHtml(externalMcpName)})` : 'External';
            const badgeTitle = externalMcpName ? `External MCP tool - Source: ${escapeHtml(externalMcpName)}` : 'External MCP tool';
            externalBadge = `<span class="external-tool-badge" title="${badgeTitle}">${badgeText}</span>`;
        }

        // Generate unique checkbox id
        const checkboxId = `role-tool-${escapeHtml(toolKey).replace(/::/g, '--')}`;

        toolItem.innerHTML = `
            <input type="checkbox" id="${checkboxId}" ${toolState.enabled ? 'checked' : ''}
                   onchange="handleRoleToolCheckboxChange('${escapeHtml(toolKey)}', this.checked)" />
            <div class="role-tool-item-info">
                <div class="role-tool-item-name">
                    ${escapeHtml(tool.name)}
                    ${externalBadge}
                </div>
                <div class="role-tool-item-desc">${escapeHtml(tool.description || 'No description')}</div>
            </div>
        `;
        listContainer.appendChild(toolItem);
    });

    toolsList.appendChild(listContainer);
}

// Render tool list pagination controls
function renderRoleToolsPagination() {
    const toolsList = document.getElementById('role-tools-list');
    if (!toolsList) return;

    // Remove old pagination controls
    const oldPagination = toolsList.querySelector('.role-tools-pagination');
    if (oldPagination) {
        oldPagination.remove();
    }

    // If there is only one page or no data, do not show pagination
    if (roleToolsPagination.totalPages <= 1) {
        return;
    }

    const pagination = document.createElement('div');
    pagination.className = 'role-tools-pagination';

    const { page, totalPages, total } = roleToolsPagination;
    const startItem = (page - 1) * roleToolsPagination.pageSize + 1;
    const endItem = Math.min(page * roleToolsPagination.pageSize, total);

    pagination.innerHTML = `
        <div class="pagination-info">
            Showing ${startItem}-${endItem} of ${total} tools${roleToolsSearchKeyword ? ` (Search: "${escapeHtml(roleToolsSearchKeyword)}")` : ''}
        </div>
        <div class="pagination-controls">
            <button class="btn-secondary" onclick="loadRoleTools(1, '${escapeHtml(roleToolsSearchKeyword)}')" ${page === 1 ? 'disabled' : ''}>First</button>
            <button class="btn-secondary" onclick="loadRoleTools(${page - 1}, '${escapeHtml(roleToolsSearchKeyword)}')" ${page === 1 ? 'disabled' : ''}>Previous</button>
            <span class="pagination-page">Page ${page} / ${totalPages}</span>
            <button class="btn-secondary" onclick="loadRoleTools(${page + 1}, '${escapeHtml(roleToolsSearchKeyword)}')" ${page === totalPages ? 'disabled' : ''}>Next</button>
            <button class="btn-secondary" onclick="loadRoleTools(${totalPages}, '${escapeHtml(roleToolsSearchKeyword)}')" ${page === totalPages ? 'disabled' : ''}>Last</button>
        </div>
    `;

    toolsList.appendChild(pagination);
}

// Handle tool checkbox status change
function handleRoleToolCheckboxChange(toolKey, enabled) {
    const toolItem = document.querySelector(`.role-tool-item[data-tool-key="${toolKey}"]`);
    if (toolItem) {
        const toolName = toolItem.dataset.toolName;
        const isExternal = toolItem.dataset.isExternal === 'true';
        const externalMcp = toolItem.dataset.externalMcp || '';
        const existingState = roleToolStateMap.get(toolKey);
        roleToolStateMap.set(toolKey, {
            enabled: enabled,
            is_external: isExternal,
            external_mcp: externalMcp,
            name: toolName,
            mcpEnabled: existingState ? existingState.mcpEnabled : true // Retain MCP enabled status
        });
    }
    updateRoleToolsStats();
}

// Select all tools
function selectAllRoleTools() {
    document.querySelectorAll('#role-tools-list input[type="checkbox"]').forEach(checkbox => {
        const toolItem = checkbox.closest('.role-tool-item');
        if (toolItem) {
            const toolKey = toolItem.dataset.toolKey;
            const toolName = toolItem.dataset.toolName;
            const isExternal = toolItem.dataset.isExternal === 'true';
            const externalMcp = toolItem.dataset.externalMcp || '';
            if (toolKey) {
                const existingState = roleToolStateMap.get(toolKey);
                // Only select tools that are enabled in MCP management
                const shouldEnable = existingState && existingState.mcpEnabled !== false;
                checkbox.checked = shouldEnable;
                roleToolStateMap.set(toolKey, {
                    enabled: shouldEnable,
                    is_external: isExternal,
                    external_mcp: externalMcp,
                    name: toolName,
                    mcpEnabled: existingState ? existingState.mcpEnabled : true
                });
            }
        }
    });
    updateRoleToolsStats();
}

// Deselect all tools
function deselectAllRoleTools() {
    document.querySelectorAll('#role-tools-list input[type="checkbox"]').forEach(checkbox => {
        checkbox.checked = false;
        const toolItem = checkbox.closest('.role-tool-item');
        if (toolItem) {
            const toolKey = toolItem.dataset.toolKey;
            const toolName = toolItem.dataset.toolName;
            const isExternal = toolItem.dataset.isExternal === 'true';
            const externalMcp = toolItem.dataset.externalMcp || '';
            if (toolKey) {
                const existingState = roleToolStateMap.get(toolKey);
                roleToolStateMap.set(toolKey, {
                    enabled: false,
                    is_external: isExternal,
                    external_mcp: externalMcp,
                    name: toolName,
                    mcpEnabled: existingState ? existingState.mcpEnabled : true // Retain MCP enabled status
                });
            }
        }
    });
    updateRoleToolsStats();
}

// Search tools
function searchRoleTools(keyword) {
    roleToolsSearchKeyword = keyword;
    const clearBtn = document.getElementById('role-tools-search-clear');
    if (clearBtn) {
        clearBtn.style.display = keyword ? 'block' : 'none';
    }
    loadRoleTools(1, keyword);
}

// Clear search
function clearRoleToolsSearch() {
    document.getElementById('role-tools-search').value = '';
    searchRoleTools('');
}

// Update tool statistics
function updateRoleToolsStats() {
    const statsEl = document.getElementById('role-tools-stats');
    if (!statsEl) return;

    // Count selected tools on the current page
    const currentPageEnabled = Array.from(document.querySelectorAll('#role-tools-list input[type="checkbox"]:checked')).length;

    // Count enabled tools on the current page (tools enabled in MCP management)
    // Prefer to get from the status map; fall back to tool data if not available
    let currentPageEnabledInMCP = 0;
    allRoleTools.forEach(tool => {
        const toolKey = getToolKey(tool);
        const state = roleToolStateMap.get(toolKey);
        // If the tool is enabled in MCP management (from status map or tool data), count it
        const mcpEnabled = state ? (state.mcpEnabled !== false) : (tool.enabled !== false);
        if (mcpEnabled) {
            currentPageEnabledInMCP++;
        }
    });

    // If using all tools, use the total enabled tool count from the API
    if (roleUsesAllTools) {
        // Use the total enabled tool count from the API response
        const totalEnabled = totalEnabledToolsInMCP || 0;
        // The denominator for the current page should be the total number of tools on the page (20 per page), not the number of enabled tools
        const currentPageTotal = document.querySelectorAll('#role-tools-list input[type="checkbox"]').length;
        // Total number of tools (all tools, including enabled and disabled)
        const totalTools = roleToolsPagination.total || 0;
        statsEl.innerHTML = `
            <span title="Number of selected tools on current page">✅ Current page selected: <strong>${currentPageEnabled}</strong> / ${currentPageTotal}</span>
            <span title="Total selected tools among all enabled tools (based on MCP management)">📊 Total selected: <strong>${totalEnabled}</strong> / ${totalTools} <em>(using all enabled tools)</em></span>
        `;
        return;
    }

    // Count the actual number of tools selected for the role (only count tools enabled in MCP management)
    let totalSelected = 0;
    roleToolStateMap.forEach(state => {
        // Only count tools that are enabled in MCP management and selected by the role
        if (state.enabled && state.mcpEnabled !== false) {
            totalSelected++;
        }
    });

    // If the current page has unsaved status, merge the calculations
    document.querySelectorAll('#role-tools-list input[type="checkbox"]').forEach(checkbox => {
        const toolItem = checkbox.closest('.role-tool-item');
        if (toolItem) {
            const toolKey = toolItem.dataset.toolKey;
            const savedState = roleToolStateMap.get(toolKey);
            if (savedState && savedState.enabled !== checkbox.checked && savedState.mcpEnabled !== false) {
                // Status inconsistency, use checkbox status (but only count tools enabled in MCP management)
                if (checkbox.checked && !savedState.enabled) {
                    totalSelected++;
                } else if (!checkbox.checked && savedState.enabled) {
                    totalSelected--;
                }
            }
        }
    });

    // Total number of all enabled tools selectable for the role (should be based on the total count in MCP management, not the status map)
    // Since the role can select any enabled tool, the total should be all enabled tools
    let totalEnabledForRole = totalEnabledToolsInMCP || 0;

    // If the API total is 0 or not set, try to count from the status map (as a fallback)
    if (totalEnabledForRole === 0) {
        roleToolStateMap.forEach(state => {
            // Only count tools enabled in MCP management
            if (state.mcpEnabled !== false) { // mcpEnabled is true or undefined (default enabled when not set)
                totalEnabledForRole++;
            }
        });
    }

    // The denominator for the current page should be the total number of tools on the page (20 per page), not the number of enabled tools
    const currentPageTotal = document.querySelectorAll('#role-tools-list input[type="checkbox"]').length;
    // Total number of tools (all tools, including enabled and disabled)
    const totalTools = roleToolsPagination.total || 0;

    statsEl.innerHTML = `
        <span title="Number of selected tools on current page (only counting enabled tools)">✅ Current page selected: <strong>${currentPageEnabled}</strong> / ${currentPageTotal}</span>
        <span title="Total tools associated with the role (based on actual role configuration)">📊 Total selected: <strong>${totalSelected}</strong> / ${totalTools}</span>
    `;
}

// Get the list of selected tools (returns toolKey array)
async function getSelectedRoleTools() {
    // Save the current page status first
    saveCurrentRolePageToolStates();

    // If there is no search keyword, we need to load all pages of tools to ensure the status map is complete
    // But for performance, we can just get the selected tools from the status map
    // Issue: if the user only selected tools on certain pages, other pages' tool statuses may not be in the map

    // If the total number of tools is greater than the loaded number, we need to ensure unloaded pages are also considered
    // But for role tool selection, we only need the tools explicitly selected by the user
    // So we can get selected tools directly from the status map

    // Get all selected tools from the status map (only return tools enabled in MCP management)
    const selectedTools = [];
    roleToolStateMap.forEach((state, toolKey) => {
        // Only return tools enabled in MCP management and selected by the role
        if (state.enabled && state.mcpEnabled !== false) {
            selectedTools.push(toolKey);
        }
    });

    // If the user may have selected tools on other pages, ensure the current page status is also saved
    // But the status map should already contain all visited pages' statuses

    return selectedTools;
}

// Set selected tools (used when editing a role)
function setSelectedRoleTools(selectedToolKeys) {
    const selectedSet = new Set(selectedToolKeys || []);

    // Update status map
    roleToolStateMap.forEach((state, toolKey) => {
        state.enabled = selectedSet.has(toolKey);
    });

    // Update current page checkbox status
    document.querySelectorAll('#role-tools-list .role-tool-item').forEach(item => {
        const toolKey = item.dataset.toolKey;
        const checkbox = item.querySelector('input[type="checkbox"]');
        if (toolKey && checkbox) {
            checkbox.checked = selectedSet.has(toolKey);
        }
    });

    updateRoleToolsStats();
}

// Show add role modal
async function showAddRoleModal() {
    const modal = document.getElementById('role-modal');
    if (!modal) return;

    document.getElementById('role-modal-title').textContent = 'Add Role';
    document.getElementById('role-name').value = '';
    document.getElementById('role-name').disabled = false;
    document.getElementById('role-description').value = '';
    document.getElementById('role-icon').value = '';
    document.getElementById('role-user-prompt').value = '';
    document.getElementById('role-enabled').checked = true;

    // When adding a role: show tool selection interface, hide default role hint
    const toolsSection = document.getElementById('role-tools-section');
    const defaultHint = document.getElementById('role-tools-default-hint');
    const toolsControls = document.querySelector('.role-tools-controls');
    const toolsList = document.getElementById('role-tools-list');
    const formHint = toolsSection ? toolsSection.querySelector('.form-hint') : null;

    if (defaultHint) {
        defaultHint.style.display = 'none';
    }
    if (toolsControls) {
        toolsControls.style.display = 'block';
    }
    if (toolsList) {
        toolsList.style.display = 'block';
    }
    if (formHint) {
        formHint.style.display = 'block';
    }

    // Reset tool status
    roleToolStateMap.clear();
    roleConfiguredTools.clear(); // Clear the role's configured tool list
    roleUsesAllTools = false; // Default to not using all tools when adding a role
    roleToolsSearchKeyword = '';
    const searchInput = document.getElementById('role-tools-search');
    if (searchInput) {
        searchInput.value = '';
    }
    const clearBtn = document.getElementById('role-tools-search-clear');
    if (clearBtn) {
        clearBtn.style.display = 'none';
    }

    // Clear the tool list DOM to avoid saveCurrentRolePageToolStates in loadRoleTools reading stale status
    if (toolsList) {
        toolsList.innerHTML = '';
    }

    // Reset skills status
    roleSelectedSkills.clear();
    roleSkillsSearchKeyword = '';
    const skillsSearchInput = document.getElementById('role-skills-search');
    if (skillsSearchInput) {
        skillsSearchInput.value = '';
    }
    const skillsClearBtn = document.getElementById('role-skills-search-clear');
    if (skillsClearBtn) {
        skillsClearBtn.style.display = 'none';
    }

    // Load and render tool list
    await loadRoleTools(1, '');

    // Ensure tool list is visible
    if (toolsList) {
        toolsList.style.display = 'block';
    }

    // Ensure statistics are correctly updated (show 0/108)
    updateRoleToolsStats();

    // Load and render skills list
    await loadRoleSkills();

    modal.style.display = 'flex';
}

// Edit role
async function editRole(roleName) {
    const role = roles.find(r => r.name === roleName);
    if (!role) {
        showNotification('Role does not exist', 'error');
        return;
    }

    const modal = document.getElementById('role-modal');
    if (!modal) return;

    document.getElementById('role-modal-title').textContent = 'Edit Role';
    document.getElementById('role-name').value = role.name;
    document.getElementById('role-name').disabled = true; // Do not allow name modification when editing
    document.getElementById('role-description').value = role.description || '';
    // Handle the icon field: if in Unicode escape format, convert to emoji; otherwise use directly
    let iconValue = role.icon || '';
    if (iconValue && iconValue.startsWith('\\U')) {
        // Convert Unicode escape format (e.g. \U0001F3C6) to emoji
        try {
            const codePoint = parseInt(iconValue.substring(2), 16);
            iconValue = String.fromCodePoint(codePoint);
        } catch (e) {
            // If conversion fails, use the original value
        }
    }
    document.getElementById('role-icon').value = iconValue;
    document.getElementById('role-user-prompt').value = role.user_prompt || '';
    document.getElementById('role-enabled').checked = role.enabled !== false;

    // Check if this is the Default role
    const isDefaultRole = roleName === 'Default';
    const toolsSection = document.getElementById('role-tools-section');
    const defaultHint = document.getElementById('role-tools-default-hint');
    const toolsControls = document.querySelector('.role-tools-controls');
    const toolsList = document.getElementById('role-tools-list');
    const formHint = toolsSection ? toolsSection.querySelector('.form-hint') : null;

    if (isDefaultRole) {
        // Default role: hide tool selection interface, show hint message
        if (defaultHint) {
            defaultHint.style.display = 'block';
        }
        if (toolsControls) {
            toolsControls.style.display = 'none';
        }
        if (toolsList) {
            toolsList.style.display = 'none';
        }
        if (formHint) {
            formHint.style.display = 'none';
        }
    } else {
        // Non-default role: show tool selection interface, hide hint message
        if (defaultHint) {
            defaultHint.style.display = 'none';
        }
        if (toolsControls) {
            toolsControls.style.display = 'block';
        }
        if (toolsList) {
            toolsList.style.display = 'block';
        }
        if (formHint) {
            formHint.style.display = 'block';
        }

        // Reset tool status
        roleToolStateMap.clear();
        roleConfiguredTools.clear(); // Clear the role's configured tool list
        roleToolsSearchKeyword = '';
        const searchInput = document.getElementById('role-tools-search');
        if (searchInput) {
            searchInput.value = '';
        }
        const clearBtn = document.getElementById('role-tools-search-clear');
        if (clearBtn) {
            clearBtn.style.display = 'none';
        }

        // Prefer the tools field; if missing, fall back to mcps field (backward compatibility)
        const selectedTools = role.tools || (role.mcps && role.mcps.length > 0 ? role.mcps : []);

        // Determine whether to use all tools: if tools is not configured (or is an empty array), use all tools
        roleUsesAllTools = !role.tools || role.tools.length === 0;

        // Save the role's configured tool list
        if (selectedTools.length > 0) {
            selectedTools.forEach(toolKey => {
                roleConfiguredTools.add(toolKey);
            });
        }

        // If there are selected tools, initialize the status map first
        if (selectedTools.length > 0) {
            roleUsesAllTools = false; // Tools are configured, do not use all tools
            // Add selected tools to the status map (mark as selected)
            selectedTools.forEach(toolKey => {
                // If the tool is not yet in the map, create a default status (enabled = true)
                if (!roleToolStateMap.has(toolKey)) {
                    roleToolStateMap.set(toolKey, {
                        enabled: true,
                        is_external: false,
                        external_mcp: '',
                        name: toolKey.split('::').pop() || toolKey // Extract tool name from toolKey
                    });
                } else {
                    // If already exists, update to selected status
                    const state = roleToolStateMap.get(toolKey);
                    state.enabled = true;
                }
            });
        }

        // Load tool list (first page)
        await loadRoleTools(1, '');

        // If using all tools, mark all enabled tools on the current page as selected
        if (roleUsesAllTools) {
            // Mark all tools enabled in MCP management on the current page as selected
            document.querySelectorAll('#role-tools-list input[type="checkbox"]').forEach(checkbox => {
                const toolItem = checkbox.closest('.role-tool-item');
                if (toolItem) {
                    const toolKey = toolItem.dataset.toolKey;
                    const toolName = toolItem.dataset.toolName;
                    const isExternal = toolItem.dataset.isExternal === 'true';
                    const externalMcp = toolItem.dataset.externalMcp || '';
                    if (toolKey) {
                        const state = roleToolStateMap.get(toolKey);
                        // Only select tools enabled in MCP management
                        // If status exists, use mcpEnabled from the status; otherwise assume enabled
                        // (because loadRoleTools should have initialized all tools)
                        const shouldEnable = state ? (state.mcpEnabled !== false) : true;
                        checkbox.checked = shouldEnable;
                        if (state) {
                            state.enabled = shouldEnable;
                        } else {
                            // If status does not exist, create new status (this should not happen, as loadRoleTools should have initialized it)
                            roleToolStateMap.set(toolKey, {
                                enabled: shouldEnable,
                                is_external: isExternal,
                                external_mcp: externalMcp,
                                name: toolName,
                                mcpEnabled: true // Assume enabled; actual value will be updated in loadRoleTools
                            });
                        }
                    }
                }
            });
            // Update statistics to ensure correct selected count is shown
            updateRoleToolsStats();
        } else if (selectedTools.length > 0) {
            // After loading, set the selected status again (ensure tools on current page are correctly set)
            setSelectedRoleTools(selectedTools);
        }
    }

    // Load and set skills
    await loadRoleSkills();
    // Set role-configured skills
    const selectedSkills = role.skills || [];
    roleSelectedSkills.clear();
    selectedSkills.forEach(skill => {
        roleSelectedSkills.add(skill);
    });
    renderRoleSkills();

    modal.style.display = 'flex';
}

// Close role modal
function closeRoleModal() {
    const modal = document.getElementById('role-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Get all selected tools (including tools not enabled in MCP management)
function getAllSelectedRoleTools() {
    // Save current page status first
    saveCurrentRolePageToolStates();

    // Get all selected tools from the status map (regardless of whether enabled in MCP management)
    const selectedTools = [];
    roleToolStateMap.forEach((state, toolKey) => {
        if (state.enabled) {
            selectedTools.push({
                key: toolKey,
                name: state.name || toolKey.split('::').pop() || toolKey,
                mcpEnabled: state.mcpEnabled !== false // mcpEnabled = false means disabled; otherwise treated as enabled
            });
        }
    });

    return selectedTools;
}

// Check and get tools not enabled in MCP management
function getDisabledTools(selectedTools) {
    return selectedTools.filter(tool => {
        const state = roleToolStateMap.get(tool.key);
        // If mcpEnabled is explicitly false, consider it disabled
        return state && state.mcpEnabled === false;
    });
}

// Load all tools into the status map (used when switching from using all tools to partial tools)
async function loadAllToolsToStateMap() {
    try {
        const pageSize = 100; // Use a larger page size to reduce the number of requests
        let page = 1;
        let hasMore = true;

        // Iterate through all pages to get all tools
        while (hasMore) {
            const url = `/api/config/tools?page=${page}&page_size=${pageSize}`;
            const response = await apiFetch(url);
            if (!response.ok) {
                throw new Error('Failed to fetch tool list');
            }

            const result = await response.json();

            // Add all tools to the status map
            result.tools.forEach(tool => {
                const toolKey = getToolKey(tool);
                if (!roleToolStateMap.has(toolKey)) {
                    // Tool is not in the map; initialize based on current mode
                    let enabled = false;
                    if (roleUsesAllTools) {
                        // If using all tools, and the tool is enabled in MCP management, mark as selected
                        enabled = tool.enabled ? true : false;
                    } else {
                        // If not using all tools, only mark as selected if the tool is in the role's configured tool list
                        enabled = roleConfiguredTools.has(toolKey);
                    }
                    roleToolStateMap.set(toolKey, {
                        enabled: enabled,
                        is_external: tool.is_external || false,
                        external_mcp: tool.external_mcp || '',
                        name: tool.name,
                        mcpEnabled: tool.enabled // Save original enabled status from MCP management
                    });
                } else {
                    // Tool is already in the map; update other attributes but retain enabled status
                    const state = roleToolStateMap.get(toolKey);
                    state.is_external = tool.is_external || false;
                    state.external_mcp = tool.external_mcp || '';
                    state.mcpEnabled = tool.enabled; // Update original enabled status from MCP management
                    if (!state.name || state.name === toolKey.split('::').pop()) {
                        state.name = tool.name; // Update tool name
                    }
                }
            });

            // Check if there are more pages
            if (page >= result.total_pages) {
                hasMore = false;
            } else {
                page++;
            }
        }
    } catch (error) {
        console.error('Failed to load all tools into status map:', error);
        throw error;
    }
}

// Save role
async function saveRole() {
    const name = document.getElementById('role-name').value.trim();
    if (!name) {
        showNotification('Role name cannot be empty', 'error');
        return;
    }

    const description = document.getElementById('role-description').value.trim();
    let icon = document.getElementById('role-icon').value.trim();
    // Convert emoji to Unicode escape format to match YAML format (e.g. \U0001F3C6)
    if (icon) {
        // Get the Unicode code point of the first character (handle cases where emoji may be multiple characters)
        const codePoint = icon.codePointAt(0);
        if (codePoint && codePoint > 0x7F) {
            // Convert to 8-digit hex format (\U0001F3C6)
            icon = '\\U' + codePoint.toString(16).toUpperCase().padStart(8, '0');
        }
    }
    const userPrompt = document.getElementById('role-user-prompt').value.trim();
    const enabled = document.getElementById('role-enabled').checked;

    const isEdit = document.getElementById('role-name').disabled;

    // Check if this is the Default role
    const isDefaultRole = name === 'Default';

    // Check if this is the first user role being added (excluding Default role, no user-created roles yet)
    const isFirstUserRole = !isEdit && !isDefaultRole && roles.filter(r => r.name !== 'Default').length === 0;

    // Default role does not save the tools field (uses all tools)
    // Non-default role: if using all tools (roleUsesAllTools is true), also do not save the tools field
    let tools = [];
    let disabledTools = []; // Store tools not enabled in MCP management

    if (!isDefaultRole) {
        // Save current page status
        saveCurrentRolePageToolStates();

        // Collect all selected tools (including those not enabled in MCP management)
        let allSelectedTools = getAllSelectedRoleTools();

        // If this is the first role being added and no tools are selected, default to using all tools
        if (isFirstUserRole && allSelectedTools.length === 0) {
            roleUsesAllTools = true;
            showNotification('Detected this is the first role added with no tools selected; will default to using all tools', 'info');
        } else if (roleUsesAllTools) {
            // If currently using all tools, check if the user has deselected some tools
            // Check if there are any unselected enabled tools in the status map
            let hasUnselectedTools = false;
            roleToolStateMap.forEach((state) => {
                // If the tool is enabled in MCP management but not selected, the user has deselected it
                if (state.mcpEnabled !== false && !state.enabled) {
                    hasUnselectedTools = true;
                }
            });

            // If the user deselected some enabled tools, switch to partial tools mode
            if (hasUnselectedTools) {
                // Before switching, load all tools into the status map
                // So we can correctly save all tools' statuses (except those deselected by the user)
                await loadAllToolsToStateMap();

                // Mark all enabled tools as selected (except those already deselected by the user)
                // Tools deselected by the user have enabled = false in the status map; keep them unchanged
                roleToolStateMap.forEach((state, toolKey) => {
                    // If the tool is enabled in MCP management, and it is not explicitly marked as unselected (i.e. enabled is not false)
                    // then mark as selected
                    if (state.mcpEnabled !== false && state.enabled !== false) {
                        state.enabled = true;
                    }
                });

                roleUsesAllTools = false;
            } else {
                // Even when using all tools, load all tools into the status map to check if any disabled tools are selected
                // This allows detecting whether the user manually selected some disabled tools
                await loadAllToolsToStateMap();

                // Check if any disabled tools have been manually selected (enabled = true but mcpEnabled = false)
                let hasDisabledToolsSelected = false;
                roleToolStateMap.forEach((state) => {
                    if (state.enabled && state.mcpEnabled === false) {
                        hasDisabledToolsSelected = true;
                    }
                });

                // If no disabled tools are selected, mark all enabled tools as selected (this is the default behavior for using all tools)
                if (!hasDisabledToolsSelected) {
                    roleToolStateMap.forEach((state) => {
                        if (state.mcpEnabled !== false) {
                            state.enabled = true;
                        }
                    });
                }

                // Update allSelectedTools, since the status map now contains all tools
                allSelectedTools = getAllSelectedRoleTools();
            }
        }

        // Check which tools are not enabled in MCP management (check regardless of using all tools or not)
        disabledTools = getDisabledTools(allSelectedTools);

        // If there are disabled tools, prompt the user
        if (disabledTools.length > 0) {
            const toolNames = disabledTools.map(t => t.name).join(', ');
            const message = `The following ${disabledTools.length} tool(s) are not enabled in MCP management and cannot be configured for the role:\n\n${toolNames}\n\nPlease enable these tools in "MCP Management" first, then configure them in the role.\n\nContinue saving? (Only enabled tools will be saved)`;

            if (!confirm(message)) {
                return; // User cancelled save
            }
        }

        // If using all tools, no need to get the tool list
        if (!roleUsesAllTools) {
            // Get the list of selected tools (only including tools enabled in MCP management)
            tools = await getSelectedRoleTools();
        }
    }

    // Get selected skills
    const skills = Array.from(roleSelectedSkills);

    const roleData = {
        name: name,
        description: description,
        icon: icon || undefined, // If empty string, do not send this field
        user_prompt: userPrompt,
        tools: tools, // Default role has empty array, meaning use all tools
        skills: skills, // Skills list
        enabled: enabled
    };
    const url = isEdit ? `/api/roles/${encodeURIComponent(name)}` : '/api/roles';
    const method = isEdit ? 'PUT' : 'POST';

    try {
        const response = await apiFetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(roleData)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Save role failed');
        }

        // If some disabled tools were filtered out, notify the user
        if (disabledTools.length > 0) {
            let toolNames = disabledTools.map(t => t.name).join(', ');
            // If the tool name list is too long, truncate the display
            if (toolNames.length > 100) {
                toolNames = toolNames.substring(0, 100) + '...';
            }
            showNotification(
                `${isEdit ? 'Role updated' : 'Role created'}, but ${disabledTools.length} tool(s) not enabled in MCP management were filtered: ${toolNames}. Please enable these tools in "MCP Management" first, then configure them in the role.`,
                'warning'
            );
        } else {
            showNotification(isEdit ? 'Role updated' : 'Role created', 'success');
        }

        closeRoleModal();
        await refreshRoles();
    } catch (error) {
        console.error('Save role failed:', error);
        showNotification('Save role failed: ' + error.message, 'error');
    }
}

// Delete role
async function deleteRole(roleName) {
    if (roleName === 'Default') {
        showNotification('Cannot delete the Default role', 'error');
        return;
    }

    if (!confirm(`Are you sure you want to delete the role "${roleName}"? This action cannot be undone.`)) {
        return;
    }

    try {
        const response = await apiFetch(`/api/roles/${encodeURIComponent(roleName)}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Delete role failed');
        }

        showNotification('Role deleted', 'success');

        // If the deleted role is the currently selected one, switch to the Default role
        if (currentRole === roleName) {
            handleRoleChange('');
        }

        await refreshRoles();
    } catch (error) {
        console.error('Delete role failed:', error);
        showNotification('Delete role failed: ' + error.message, 'error');
    }
}

// Initialize role list on page switch
if (typeof switchPage === 'function') {
    const originalSwitchPage = switchPage;
    switchPage = function(page) {
        originalSwitchPage(page);
        if (page === 'roles-management') {
            loadRoles().then(() => renderRolesList());
        }
    };
}

// Click outside modal to close
document.addEventListener('click', (e) => {
    const roleSelectModal = document.getElementById('role-select-modal');
    if (roleSelectModal && e.target === roleSelectModal) {
        closeRoleSelectModal();
    }

    const roleModal = document.getElementById('role-modal');
    if (roleModal && e.target === roleModal) {
        closeRoleModal();
    }

    // Click outside role selection panel to close it (but not the role selector button and panel itself)
    const roleSelectionPanel = document.getElementById('role-selection-panel');
    const roleSelectorWrapper = document.querySelector('.role-selector-wrapper');
    if (roleSelectionPanel && roleSelectionPanel.style.display !== 'none' && roleSelectionPanel.style.display) {
        // Check if the click is on the panel or wrapper
        if (!roleSelectorWrapper?.contains(e.target)) {
            closeRoleSelectionPanel();
        }
    }
});

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    loadRoles();
    updateRoleSelectorDisplay();
});

// Get currently selected role (for use by chat.js)
function getCurrentRole() {
    return currentRole || '';
}

// Expose functions to global scope
if (typeof window !== 'undefined') {
    window.getCurrentRole = getCurrentRole;
    window.toggleRoleSelectionPanel = toggleRoleSelectionPanel;
    window.closeRoleSelectionPanel = closeRoleSelectionPanel;
    window.currentSelectedRole = getCurrentRole();

    // Listen for role changes, update global variable
    const originalHandleRoleChange = handleRoleChange;
    handleRoleChange = function(roleName) {
        originalHandleRoleChange(roleName);
        if (typeof window !== 'undefined') {
            window.currentSelectedRole = getCurrentRole();
        }
    };
}

// ==================== Skills related functions ====================

// Load skills list
async function loadRoleSkills() {
    try {
        const response = await apiFetch('/api/roles/skills/list');
        if (!response.ok) {
            throw new Error('Load skills list failed');
        }
        const data = await response.json();
        allRoleSkills = data.skills || [];
        renderRoleSkills();
    } catch (error) {
        console.error('Load skills list failed:', error);
        allRoleSkills = [];
        const skillsList = document.getElementById('role-skills-list');
        if (skillsList) {
            skillsList.innerHTML = '<div class="skills-error">Load skills list failed: ' + error.message + '</div>';
        }
    }
}

// Render skills list
function renderRoleSkills() {
    const skillsList = document.getElementById('role-skills-list');
    if (!skillsList) return;

    // Filter skills
    let filteredSkills = allRoleSkills;
    if (roleSkillsSearchKeyword) {
        const keyword = roleSkillsSearchKeyword.toLowerCase();
        filteredSkills = allRoleSkills.filter(skill =>
            skill.toLowerCase().includes(keyword)
        );
    }

    if (filteredSkills.length === 0) {
        skillsList.innerHTML = '<div class="skills-empty">' +
            (roleSkillsSearchKeyword ? 'No matching skills found' : 'No available skills') +
            '</div>';
        updateRoleSkillsStats();
        return;
    }

    // Render skills list
    skillsList.innerHTML = filteredSkills.map(skill => {
        const isSelected = roleSelectedSkills.has(skill);
        return `
            <div class="role-skill-item" data-skill="${skill}">
                <label class="checkbox-label">
                    <input type="checkbox" class="modern-checkbox"
                           ${isSelected ? 'checked' : ''}
                           onchange="toggleRoleSkill('${skill}', this.checked)" />
                    <span class="checkbox-custom"></span>
                    <span class="checkbox-text">${escapeHtml(skill)}</span>
                </label>
            </div>
        `;
    }).join('');

    updateRoleSkillsStats();
}

// Toggle skill selected status
function toggleRoleSkill(skill, checked) {
    if (checked) {
        roleSelectedSkills.add(skill);
    } else {
        roleSelectedSkills.delete(skill);
    }
    updateRoleSkillsStats();
}

// Select all skills
function selectAllRoleSkills() {
    let filteredSkills = allRoleSkills;
    if (roleSkillsSearchKeyword) {
        const keyword = roleSkillsSearchKeyword.toLowerCase();
        filteredSkills = allRoleSkills.filter(skill =>
            skill.toLowerCase().includes(keyword)
        );
    }
    filteredSkills.forEach(skill => {
        roleSelectedSkills.add(skill);
    });
    renderRoleSkills();
}

// Deselect all skills
function deselectAllRoleSkills() {
    let filteredSkills = allRoleSkills;
    if (roleSkillsSearchKeyword) {
        const keyword = roleSkillsSearchKeyword.toLowerCase();
        filteredSkills = allRoleSkills.filter(skill =>
            skill.toLowerCase().includes(keyword)
        );
    }
    filteredSkills.forEach(skill => {
        roleSelectedSkills.delete(skill);
    });
    renderRoleSkills();
}

// Search skills
function searchRoleSkills(keyword) {
    roleSkillsSearchKeyword = keyword;
    const clearBtn = document.getElementById('role-skills-search-clear');
    if (clearBtn) {
        clearBtn.style.display = keyword ? 'block' : 'none';
    }
    renderRoleSkills();
}

// Clear skills search
function clearRoleSkillsSearch() {
    const searchInput = document.getElementById('role-skills-search');
    if (searchInput) {
        searchInput.value = '';
    }
    roleSkillsSearchKeyword = '';
    const clearBtn = document.getElementById('role-skills-search-clear');
    if (clearBtn) {
        clearBtn.style.display = 'none';
    }
    renderRoleSkills();
}

// Update skills statistics
function updateRoleSkillsStats() {
    const statsEl = document.getElementById('role-skills-stats');
    if (!statsEl) return;

    let filteredSkills = allRoleSkills;
    if (roleSkillsSearchKeyword) {
        const keyword = roleSkillsSearchKeyword.toLowerCase();
        filteredSkills = allRoleSkills.filter(skill =>
            skill.toLowerCase().includes(keyword)
        );
    }

    const selectedCount = Array.from(roleSelectedSkills).filter(skill =>
        filteredSkills.includes(skill)
    ).length;

    statsEl.textContent = `Selected ${selectedCount} / ${filteredSkills.length}`;
}

// HTML escape function
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

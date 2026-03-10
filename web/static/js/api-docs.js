// API documentation page JavaScript

let apiSpec = null;
let currentToken = null;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    await loadToken();
    await loadAPISpec();
    if (apiSpec) {
        renderAPIDocs();
    }
});

// Load token
async function loadToken() {
    try {
        const authData = localStorage.getItem('cyberstrike-auth');
        if (authData) {
            const parsed = JSON.parse(authData);
            if (parsed && parsed.token) {
                const expiry = parsed.expiresAt ? new Date(parsed.expiresAt) : null;
                if (!expiry || expiry.getTime() > Date.now()) {
                    currentToken = parsed.token;
                    return;
                }
            }
        }
        currentToken = localStorage.getItem('swagger_auth_token');
    } catch (e) {
        console.error('Failed to load token:', e);
    }
}

// Load OpenAPI specification
async function loadAPISpec() {
    try {
        const headers = new Headers();
        if (currentToken) {
            headers.set('Authorization', 'Bearer ' + currentToken);
        }

        const response = await fetch('/api/openapi/spec', { headers });
        if (!response.ok) {
            if (response.status === 401) {
                showError('Login required to view API documentation. Please log in on the frontend page first, then refresh this page.');
                return;
            }
            throw new Error('Failed to load API spec: ' + response.status);
        }
        
        apiSpec = await response.json();
    } catch (error) {
        console.error('Failed to load API spec:', error);
        showError('Failed to load API docs: ' + error.message);
    }
}

// Show error
function showError(message) {
    const main = document.getElementById('api-docs-main');
    main.innerHTML = `
        <div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="15" y1="9" x2="9" y2="15"/>
                <line x1="9" y1="9" x2="15" y2="15"/>
            </svg>
            <h3>Failed to load</h3>
            <p>${message}</p>
            <div style="margin-top: 16px;">
                <a href="/" style="color: var(--accent-color); text-decoration: none;">Back to Login</a>
            </div>
        </div>
    `;
}

// Render API documentation
function renderAPIDocs() {
    if (!apiSpec || !apiSpec.paths) {
        showError('API spec format error');
        return;
    }
    
    // Show authentication info
    renderAuthInfo();
    
    // Render sidebar groups
    renderSidebar();
    
    // Render API endpoints
    renderEndpoints();
}

// Render authentication info
function renderAuthInfo() {
    const authSection = document.getElementById('auth-info-section');
    if (!authSection) return;
    
    // Show authentication section
    authSection.style.display = 'block';
    
    // Check if token exists
    const tokenStatus = document.getElementById('token-status');
    if (currentToken && tokenStatus) {
        tokenStatus.style.display = 'block';
    } else if (tokenStatus) {
        // If no token, show hint
        tokenStatus.style.display = 'block';
        tokenStatus.style.background = 'rgba(255, 152, 0, 0.1)';
        tokenStatus.style.borderLeftColor = '#ff9800';
        tokenStatus.innerHTML = '<p style="margin: 0; font-size: 0.8125rem; color: #ff9800;"><strong>⚠ Token not detected</strong> - Please log in on the frontend page first, then refresh this page. When testing, add Authorization: Bearer token</p>';
    }
}

// Render sidebar
function renderSidebar() {
    const groups = new Set();
    Object.keys(apiSpec.paths).forEach(path => {
        Object.keys(apiSpec.paths[path]).forEach(method => {
            const endpoint = apiSpec.paths[path][method];
            if (endpoint.tags && endpoint.tags.length > 0) {
                endpoint.tags.forEach(tag => groups.add(tag));
            }
        });
    });
    
    const groupList = document.getElementById('api-group-list');
    const allGroups = Array.from(groups).sort();
    
    allGroups.forEach(group => {
        const li = document.createElement('li');
        li.className = 'api-group-item';
        li.innerHTML = `<a href="#" class="api-group-link" data-group="${group}">${group}</a>`;
        groupList.appendChild(li);
    });
    
    // Bind click events
    groupList.querySelectorAll('.api-group-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            groupList.querySelectorAll('.api-group-link').forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            const group = link.dataset.group;
            renderEndpoints(group === 'all' ? null : group);
        });
    });
}

// Render API endpoints
function renderEndpoints(filterGroup = null) {
    const main = document.getElementById('api-docs-main');
    main.innerHTML = '';
    
    const endpoints = [];
    Object.keys(apiSpec.paths).forEach(path => {
        Object.keys(apiSpec.paths[path]).forEach(method => {
            const endpoint = apiSpec.paths[path][method];
            const tags = endpoint.tags || [];
            if (!filterGroup || filterGroup === 'all' || tags.includes(filterGroup)) {
                endpoints.push({
                    path,
                    method,
                    ...endpoint
                });
            }
        });
    });
    
    // Sort by group
    endpoints.sort((a, b) => {
        const tagA = a.tags && a.tags.length > 0 ? a.tags[0] : '';
        const tagB = b.tags && b.tags.length > 0 ? b.tags[0] : '';
        if (tagA !== tagB) return tagA.localeCompare(tagB);
        return a.path.localeCompare(b.path);
    });
    
    if (endpoints.length === 0) {
        main.innerHTML = '<div class="empty-state"><h3>No API</h3><p>No API endpoints in this group</p></div>';
        return;
    }
    
    endpoints.forEach(endpoint => {
        main.appendChild(createEndpointCard(endpoint));
    });
}

// Create API endpoint card
function createEndpointCard(endpoint) {
    const card = document.createElement('div');
    card.className = 'api-endpoint';
    
    const methodClass = endpoint.method.toLowerCase();
    const tags = endpoint.tags || [];
    const tagHtml = tags.map(tag => `<span class="api-tag">${tag}</span>`).join('');
    
    card.innerHTML = `
        <div class="api-endpoint-header">
            <div class="api-endpoint-title">
                <span class="api-method ${methodClass}">${endpoint.method.toUpperCase()}</span>
                <span class="api-path">${endpoint.path}</span>
                ${tagHtml}
            </div>
        </div>
        <div class="api-endpoint-body">
            <div class="api-section">
                <div class="api-section-title">Description</div>
                ${endpoint.summary ? `<div class="api-description" style="font-weight: 500; margin-bottom: 8px; color: var(--text-primary);">${escapeHtml(endpoint.summary)}</div>` : ''}
                ${endpoint.description ? `
                    <div class="api-description-toggle">
                        <button class="description-toggle-btn" onclick="toggleDescription(this)">
                            <svg class="description-toggle-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="6 9 12 15 18 9"/>
                            </svg>
                            <span>View details</span>
                        </button>
                        <div class="api-description-detail" style="display: none;">
                            ${formatDescription(endpoint.description)}
                        </div>
                    </div>
                ` : endpoint.summary ? '' : '<div class="api-description">No description</div>'}
            </div>
            
            ${renderParameters(endpoint)}
            ${renderRequestBody(endpoint)}
            ${renderResponses(endpoint)}
            ${renderTestSection(endpoint)}
        </div>
    `;
    
    return card;
}

// Render parameters
function renderParameters(endpoint) {
    const params = endpoint.parameters || [];
    if (params.length === 0) return '';
    
    const rows = params.map(param => {
            const required = param.required ? '<span class="api-param-required">Required</span>' : '<span class="api-param-optional">Optional</span>';
        // Process description text, convert newlines to <br>
        let descriptionHtml = '-';
        if (param.description) {
            const escapedDesc = escapeHtml(param.description);
            descriptionHtml = escapedDesc.replace(/\n/g, '<br>');
        }
        
        return `
            <tr>
                <td><span class="api-param-name">${param.name}</span></td>
                <td><span class="api-param-type">${param.schema?.type || 'string'}</span></td>
                <td>${descriptionHtml}</td>
                <td>${required}</td>
            </tr>
        `;
    }).join('');
    
    return `
        <div class="api-section">
            <div class="api-section-title">Parameters</div>
            <div class="api-table-wrapper">
                <table class="api-params-table">
                    <thead>
                        <tr>
                            <th>Parameter</th>
                            <th>Type</th>
                            <th>Description</th>
                            <th>Required</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

// Render request body
function renderRequestBody(endpoint) {
    if (!endpoint.requestBody) return '';
    
    const content = endpoint.requestBody.content || {};
    let schema = content['application/json']?.schema || {};
    
    // Handle $ref references
    if (schema.$ref) {
        const refPath = schema.$ref.split('/');
        const refName = refPath[refPath.length - 1];
        if (apiSpec.components && apiSpec.components.schemas && apiSpec.components.schemas[refName]) {
            schema = apiSpec.components.schemas[refName];
        }
    }
    
    // Render parameters table
    let paramsTable = '';
    if (schema.properties) {
        const requiredFields = schema.required || [];
        const rows = Object.keys(schema.properties).map(key => {
            const prop = schema.properties[key];
            const required = requiredFields.includes(key) 
                ? '<span class="api-param-required">Required</span>' 
                : '<span class="api-param-optional">Optional</span>';
            
            // Handle nested types
            let typeDisplay = prop.type || 'object';
            if (prop.type === 'array' && prop.items) {
                typeDisplay = `array[${prop.items.type || 'object'}]`;
            } else if (prop.$ref) {
                const refPath = prop.$ref.split('/');
                typeDisplay = refPath[refPath.length - 1];
            }
            
            // Handle enums
            if (prop.enum) {
                typeDisplay += ` (${prop.enum.join(', ')})`;
            }
            
            // Process description text, convert newlines to <br>, preserving other formatting
            let descriptionHtml = '-';
            if (prop.description) {
                // Escape HTML then handle newlines
                const escapedDesc = escapeHtml(prop.description);
                // Convert \n to <br>, but don't convert already-escaped newlines
                descriptionHtml = escapedDesc.replace(/\n/g, '<br>');
            }
            
            return `
                <tr>
                    <td><span class="api-param-name">${escapeHtml(key)}</span></td>
                    <td><span class="api-param-type">${escapeHtml(typeDisplay)}</span></td>
                    <td>${descriptionHtml}</td>
                    <td>${required}</td>
                    <td>${prop.example !== undefined ? `<code>${escapeHtml(String(prop.example))}</code>` : '-'}</td>
                </tr>
            `;
        }).join('');
        
        if (rows) {
            paramsTable = `
                <div class="api-table-wrapper" style="margin-top: 12px;">
                    <table class="api-params-table">
                        <thead>
                            <tr>
                                <th>Parameter</th>
                                <th>Type</th>
                                <th>Description</th>
                                <th>Required</th>
                                <th>Example</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows}
                        </tbody>
                    </table>
                </div>
            `;
        }
    }
    
    // Generate example JSON
    let example = '';
    if (schema.example) {
        example = JSON.stringify(schema.example, null, 2);
    } else if (schema.properties) {
        const exampleObj = {};
        Object.keys(schema.properties).forEach(key => {
            const prop = schema.properties[key];
            if (prop.example !== undefined) {
                exampleObj[key] = prop.example;
            } else {
                // Generate default example by type
                if (prop.type === 'string') {
                    exampleObj[key] = prop.description || 'string';
                } else if (prop.type === 'number') {
                    exampleObj[key] = 0;
                } else if (prop.type === 'boolean') {
                    exampleObj[key] = false;
                } else if (prop.type === 'array') {
                    exampleObj[key] = [];
                } else {
                    exampleObj[key] = null;
                }
            }
        });
        example = JSON.stringify(exampleObj, null, 2);
    }
    
    return `
        <div class="api-section">
            <div class="api-section-title">Request Body</div>
            ${endpoint.requestBody.description ? `<div class="api-description">${endpoint.requestBody.description}</div>` : ''}
            ${paramsTable}
            ${example ? `
                <div style="margin-top: 16px;">
                    <div style="font-weight: 500; margin-bottom: 8px; color: var(--text-primary);">Example JSON:</div>
                    <div class="api-response-example">
                        <pre>${escapeHtml(example)}</pre>
                    </div>
                </div>
            ` : ''}
        </div>
    `;
}

// Render response
function renderResponses(endpoint) {
    const responses = endpoint.responses || {};
    const responseItems = Object.keys(responses).map(status => {
        const response = responses[status];
        const schema = response.content?.['application/json']?.schema || {};
        let example = '';
        if (schema.example) {
            example = JSON.stringify(schema.example, null, 2);
        }
        
        return `
            <div style="margin-bottom: 16px;">
                <strong style="color: ${status.startsWith('2') ? 'var(--success-color)' : status.startsWith('4') ? 'var(--error-color)' : 'var(--warning-color)'}">${status}</strong>
                ${response.description ? `<span style="color: var(--text-secondary); margin-left: 8px;">${response.description}</span>` : ''}
                ${example ? `
                    <div class="api-response-example" style="margin-top: 8px;">
                        <pre>${escapeHtml(example)}</pre>
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');
    
    if (!responseItems) return '';
    
    return `
        <div class="api-section">
            <div class="api-section-title">Response</div>
            ${responseItems}
        </div>
    `;
}

// Render test area
function renderTestSection(endpoint) {
    const method = endpoint.method.toUpperCase();
    const path = endpoint.path;
    const hasBody = endpoint.requestBody && ['POST', 'PUT', 'PATCH'].includes(method);
    
    let bodyInput = '';
    if (hasBody) {
        const schema = endpoint.requestBody.content?.['application/json']?.schema || {};
        let defaultBody = '';
        if (schema.example) {
            defaultBody = JSON.stringify(schema.example, null, 2);
        } else if (schema.properties) {
            const exampleObj = {};
            Object.keys(schema.properties).forEach(key => {
                const prop = schema.properties[key];
                exampleObj[key] = prop.example || (prop.type === 'string' ? '' : prop.type === 'number' ? 0 : prop.type === 'boolean' ? false : null);
            });
            defaultBody = JSON.stringify(exampleObj, null, 2);
        }
        
        const bodyInputId = `test-body-${escapeId(path)}-${method}`;
        bodyInput = `
            <div class="api-test-input-group">
                <label>Request Body (JSON)</label>
                <textarea id="${bodyInputId}" class="test-body-input" placeholder='Enter JSON request body'>${defaultBody}</textarea>
            </div>
        `;
    }
    
    // Handle path parameters
    const pathParams = (endpoint.parameters || []).filter(p => p.in === 'path');
    let pathParamsInput = '';
    if (pathParams.length > 0) {
        pathParamsInput = pathParams.map(param => {
            const inputId = `test-param-${param.name}-${escapeId(path)}-${method}`;
            return `
                <div class="api-test-input-group">
                    <label>${param.name} <span style="color: var(--error-color);">*</span></label>
                    <input type="text" id="${inputId}" placeholder="${param.description || param.name}" required>
                </div>
            `;
        }).join('');
    }
    
    // Handle query parameters
    const queryParams = (endpoint.parameters || []).filter(p => p.in === 'query');
    let queryParamsInput = '';
    if (queryParams.length > 0) {
        queryParamsInput = queryParams.map(param => {
            const inputId = `test-query-${param.name}-${escapeId(path)}-${method}`;
            const defaultValue = param.schema?.default !== undefined ? param.schema.default : '';
            const placeholder = param.description || param.name;
            const required = param.required ? '<span style="color: var(--error-color);">*</span>' : '<span style="color: var(--text-muted);">Optional</span>';
            return `
                <div class="api-test-input-group">
                    <label>${param.name} ${required}</label>
                    <input type="${param.schema?.type === 'number' || param.schema?.type === 'integer' ? 'number' : 'text'}" 
                           id="${inputId}" 
                           placeholder="${placeholder}" 
                           value="${defaultValue}"
                           ${param.required ? 'required' : ''}>
                </div>
            `;
        }).join('');
    }
    
    return `
        <div class="api-test-section">
            <div class="api-section-title">Test API</div>
            <div class="api-test-form">
                ${pathParamsInput}
                ${queryParamsInput ? `<div style="margin-top: 16px;"><div style="font-weight: 500; margin-bottom: 8px; color: var(--text-primary);">Query Parameters:</div>${queryParamsInput}</div>` : ''}
                ${bodyInput}
                <div class="api-test-buttons">
                    <button class="api-test-btn primary" onclick="testAPI('${method}', '${escapeHtml(path)}', '${endpoint.operationId || ''}')">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polygon points="5 3 19 12 5 21 5 3"/>
                        </svg>
                        Send Request
                    </button>
                    <button class="api-test-btn copy-curl" onclick="copyCurlCommand(event, '${method}', '${escapeHtml(path)}')" title="Copy curl command">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" stroke="currentColor" stroke-width="2"/>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="2"/>
                        </svg>
                        Copy curl
                    </button>
                    <button class="api-test-btn clear-result" onclick="clearTestResult('${escapeId(path)}-${method}')" title="Clear test result">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                        Clear Result
                    </button>
                </div>
                <div id="test-result-${escapeId(path)}-${method}" class="api-test-result" style="display: none;"></div>
            </div>
        </div>
    `;
}

// Test API
async function testAPI(method, path, operationId) {
    const resultId = `test-result-${escapeId(path)}-${method}`;
    const resultDiv = document.getElementById(resultId);
    if (!resultDiv) return;
    
    resultDiv.style.display = 'block';
    resultDiv.className = 'api-test-result loading';
    resultDiv.textContent = 'Sending request...';
    
    try {
        // Replace path parameters
        let actualPath = path;
        const pathParams = path.match(/\{([^}]+)\}/g) || [];
        pathParams.forEach(param => {
            const paramName = param.slice(1, -1);
            const inputId = `test-param-${paramName}-${escapeId(path)}-${method}`;
            const input = document.getElementById(inputId);
            if (input && input.value) {
                actualPath = actualPath.replace(param, encodeURIComponent(input.value));
            } else {
                throw new Error(`Path parameter ${paramName} cannot be empty`);
            }
        });
        
        // Ensure path starts with /api (if not already in the OpenAPI spec)
        if (!actualPath.startsWith('/api') && !actualPath.startsWith('http')) {
            actualPath = '/api' + actualPath;
        }
        
        // Build query parameters
        const queryParams = [];
        const endpointSpec = apiSpec.paths[path]?.[method.toLowerCase()];
        if (endpointSpec && endpointSpec.parameters) {
            endpointSpec.parameters.filter(p => p.in === 'query').forEach(param => {
                const inputId = `test-query-${param.name}-${escapeId(path)}-${method}`;
                const input = document.getElementById(inputId);
                if (input && input.value !== '' && input.value !== null && input.value !== undefined) {
                    queryParams.push(`${encodeURIComponent(param.name)}=${encodeURIComponent(input.value)}`);
                } else if (param.required) {
                    throw new Error(`Query parameter ${param.name} cannot be empty`);
                }
            });
        }
        
        // Add query string
        if (queryParams.length > 0) {
            actualPath += (actualPath.includes('?') ? '&' : '?') + queryParams.join('&');
        }
        
        // Build request options
        const options = {
            method: method,
            headers: {
                'Content-Type': 'application/json',
            }
        };
        
        // Add token
        if (currentToken) {
            options.headers['Authorization'] = 'Bearer ' + currentToken;
        } else {
            // If no token, prompt user
            throw new Error('Token not detected. Please log in on the frontend page first, then refresh. Or manually add Authorization: Bearer your_token in the request header.');
        }
        
        // Add request body
        if (['POST', 'PUT', 'PATCH'].includes(method)) {
            const bodyInputId = `test-body-${escapeId(path)}-${method}`;
            const bodyInput = document.getElementById(bodyInputId);
            if (bodyInput && bodyInput.value.trim()) {
                try {
                    options.body = JSON.stringify(JSON.parse(bodyInput.value.trim()));
                } catch (e) {
                    throw new Error('Request body JSON format error: ' + e.message);
                }
            }
        }
        
        // Send Request
        const response = await fetch(actualPath, options);
        const responseText = await response.text();
        
        let responseData;
        try {
            responseData = JSON.parse(responseText);
        } catch {
            responseData = responseText;
        }
        
        // Show result
        resultDiv.className = response.ok ? 'api-test-result success' : 'api-test-result error';
        resultDiv.textContent = `Status: ${response.status} ${response.statusText}\n\n${typeof responseData === 'string' ? responseData : JSON.stringify(responseData, null, 2)}`;
        
    } catch (error) {
        resultDiv.className = 'api-test-result error';
        resultDiv.textContent = 'Request failed: ' + error.message;
    }
}

// Clear test result
function clearTestResult(id) {
    const resultDiv = document.getElementById(`test-result-${id}`);
    if (resultDiv) {
        resultDiv.style.display = 'none';
        resultDiv.textContent = '';
    }
}

// Copy curl command
function copyCurlCommand(event, method, path) {
    try {
        // Replace path parameters
        let actualPath = path;
        const pathParams = path.match(/\{([^}]+)\}/g) || [];
        pathParams.forEach(param => {
            const paramName = param.slice(1, -1);
            const inputId = `test-param-${paramName}-${escapeId(path)}-${method}`;
            const input = document.getElementById(inputId);
            if (input && input.value) {
                actualPath = actualPath.replace(param, encodeURIComponent(input.value));
            }
        });
        
        // Ensure path starts with /api
        if (!actualPath.startsWith('/api') && !actualPath.startsWith('http')) {
            actualPath = '/api' + actualPath;
        }
        
        // Build query parameters
        const queryParams = [];
        const endpointSpec = apiSpec.paths[path]?.[method.toLowerCase()];
        if (endpointSpec && endpointSpec.parameters) {
            endpointSpec.parameters.filter(p => p.in === 'query').forEach(param => {
                const inputId = `test-query-${param.name}-${escapeId(path)}-${method}`;
                const input = document.getElementById(inputId);
                if (input && input.value !== '' && input.value !== null && input.value !== undefined) {
                    queryParams.push(`${encodeURIComponent(param.name)}=${encodeURIComponent(input.value)}`);
                }
            });
        }
        
        // Add query string
        if (queryParams.length > 0) {
            actualPath += (actualPath.includes('?') ? '&' : '?') + queryParams.join('&');
        }
        
        // Build complete URL
        const baseUrl = window.location.origin;
        const fullUrl = baseUrl + actualPath;
        
        // Build curl command
        let curlCommand = `curl -X ${method.toUpperCase()} "${fullUrl}"`;
        
        // Add request headers
        curlCommand += ` \\\n  -H "Content-Type: application/json"`;
        
        // Add Authorization header
        if (currentToken) {
            curlCommand += ` \\\n  -H "Authorization: Bearer ${currentToken}"`;
        } else {
            curlCommand += ` \\\n  -H "Authorization: Bearer YOUR_TOKEN_HERE"`;
        }
        
        // Add request body (if any)
        if (['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
            const bodyInputId = `test-body-${escapeId(path)}-${method}`;
            const bodyInput = document.getElementById(bodyInputId);
            if (bodyInput && bodyInput.value.trim()) {
                try {
                    // Validate JSON format and format
                    const jsonBody = JSON.parse(bodyInput.value.trim());
                    const jsonString = JSON.stringify(jsonBody);
                    // Inside single quotes, only need to escape single quotes
                    const escapedJson = jsonString.replace(/'/g, "'\\''");
                    curlCommand += ` \\\n  -d '${escapedJson}'`;
                } catch (e) {
                    // If not valid JSON, use raw value
                    const escapedBody = bodyInput.value.trim().replace(/'/g, "'\\''");
                    curlCommand += ` \\\n  -d '${escapedBody}'`;
                }
            }
        }
        
        // Copy to clipboard
        const button = event ? event.target.closest('button') : null;
        navigator.clipboard.writeText(curlCommand).then(() => {
            // Show success hint
            if (button) {
                const originalText = button.innerHTML;
                button.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>Copied';
                button.style.color = 'var(--success-color)';
                setTimeout(() => {
                    button.innerHTML = originalText;
                    button.style.color = '';
                }, 2000);
            } else {
                alert('curl command copied to clipboard!');
            }
        }).catch(err => {
            console.error('Copy failed:', err);
            // If clipboard API fails, use fallback method
            const textarea = document.createElement('textarea');
            textarea.value = curlCommand;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            try {
                document.execCommand('copy');
                if (button) {
                    const originalText = button.innerHTML;
                    button.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>Copied';
                    button.style.color = 'var(--success-color)';
                    setTimeout(() => {
                        button.innerHTML = originalText;
                        button.style.color = '';
                    }, 2000);
                } else {
                    alert('curl command copied to clipboard!');
                }
            } catch (e) {
                alert('Copy failed, please copy manually:\n\n' + curlCommand);
            }
            document.body.removeChild(textarea);
        });
        
    } catch (error) {
        console.error('Failed to generate curl command:', error);
        alert('Failed to generate curl command: ' + error.message);
    }
}

// Format description text (handle markdown)
function formatDescription(text) {
    if (!text) return '';
    
    // First extract code blocks (avoid processing markdown inside code blocks)
    let formatted = text;
    const codeBlocks = [];
    let codeBlockIndex = 0;
    
    // Extract code blocks (supports language identifiers like ```json or ```javascript)
    formatted = formatted.replace(/```(\w+)?\s*\n?([\s\S]*?)```/g, (match, lang, code) => {
        const placeholder = `__CODE_BLOCK_${codeBlockIndex}__`;
        codeBlocks[codeBlockIndex] = {
            lang: (lang && lang.trim()) || '',
            code: code.trim()
        };
        codeBlockIndex++;
        return placeholder;
    });
    
    // Extract inline code (avoid processing markdown inside inline code)
    const inlineCodes = [];
    let inlineCodeIndex = 0;
    formatted = formatted.replace(/`([^`\n]+)`/g, (match, code) => {
        const placeholder = `__INLINE_CODE_${inlineCodeIndex}__`;
        inlineCodes[inlineCodeIndex] = code;
        inlineCodeIndex++;
        return placeholder;
    });
    
    // Escape HTML (but keep placeholders)
    formatted = escapeHtml(formatted);
    
    // Restore inline code (needs escaping because placeholders were already escaped)
    inlineCodes.forEach((code, index) => {
        formatted = formatted.replace(
            `__INLINE_CODE_${index}__`,
            `<code class="inline-code">${escapeHtml(code)}</code>`
        );
    });
    
    // Restore code blocks (content already escaped, use directly)
    codeBlocks.forEach((block, index) => {
        const langLabel = block.lang ? `<span class="code-lang">${escapeHtml(block.lang)}</span>` : '';
        // Code block content was saved during extraction, no need to escape again
        formatted = formatted.replace(
            `__CODE_BLOCK_${index}__`,
            `<pre class="code-block">${langLabel}<code>${escapeHtml(block.code)}</code></pre>`
        );
    });
    
    // Handle headings (### heading)
    formatted = formatted.replace(/^###\s+(.+)$/gm, '<h3 class="md-h3">$1</h3>');
    formatted = formatted.replace(/^##\s+(.+)$/gm, '<h2 class="md-h2">$1</h2>');
    formatted = formatted.replace(/^#\s+(.+)$/gm, '<h1 class="md-h1">$1</h1>');
    
    // Handle bold text (**text** or __text__)
    formatted = formatted.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
    formatted = formatted.replace(/__([^_]+?)__/g, '<strong>$1</strong>');
    
    // Handle italic (*text* or _text_, but not conflicting with bold)
    formatted = formatted.replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, '<em>$1</em>');
    formatted = formatted.replace(/(?<!_)_([^_\n]+?)_(?!_)/g, '<em>$1</em>');
    
    // Handle links [text](url)
    formatted = formatted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="md-link">$1</a>');
    
    // Handle list items (ordered and unordered)
    const lines = formatted.split('\n');
    const result = [];
    let inUnorderedList = false;
    let inOrderedList = false;
    let orderedListStart = 1;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const unorderedMatch = line.match(/^[-*]\s+(.+)$/);
        const orderedMatch = line.match(/^\d+\.\s+(.+)$/);
        
        if (unorderedMatch) {
            if (inOrderedList) {
                result.push('</ol>');
                inOrderedList = false;
            }
            if (!inUnorderedList) {
                result.push('<ul class="md-list">');
                inUnorderedList = true;
            }
            result.push(`<li class="md-list-item">${unorderedMatch[1]}</li>`);
        } else if (orderedMatch) {
            if (inUnorderedList) {
                result.push('</ul>');
                inUnorderedList = false;
            }
            if (!inOrderedList) {
                result.push('<ol class="md-list">');
                inOrderedList = true;
                orderedListStart = parseInt(line.match(/^(\d+)\./)[1]) || 1;
            }
            result.push(`<li class="md-list-item">${orderedMatch[1]}</li>`);
        } else {
            if (inUnorderedList) {
                result.push('</ul>');
                inUnorderedList = false;
            }
            if (inOrderedList) {
                result.push('</ol>');
                inOrderedList = false;
            }
            if (line.trim()) {
                result.push(line);
            } else if (i < lines.length - 1) {
                // Add newline only for non-last lines
                result.push('<br>');
            }
        }
    }
    
    if (inUnorderedList) {
        result.push('</ul>');
    }
    if (inOrderedList) {
        result.push('</ol>');
    }
    
    formatted = result.join('\n');
    
    // Handle paragraphs (separated by empty lines)
    formatted = formatted.replace(/(<br>\s*){2,}/g, '</p><p class="md-paragraph">');
    formatted = '<p class="md-paragraph">' + formatted + '</p>';
    
    // Clean up excess <br> tags (before/after block elements)
    formatted = formatted.replace(/(<\/?(h[1-6]|ul|ol|li|pre|p)[^>]*>)\s*<br>/gi, '$1');
    formatted = formatted.replace(/<br>\s*(<\/?(h[1-6]|ul|ol|li|pre|p)[^>]*>)/gi, '$1');
    
    // Convert remaining single newlines to <br> (avoid inside block elements)
    formatted = formatted.replace(/\n(?!<\/?(h[1-6]|ul|ol|li|pre|p|code))/g, '<br>');
    
    return formatted;
}

// HTML escaping
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ID escaping (for HTML ID attributes)
function escapeId(text) {
    return text.replace(/[{}]/g, '').replace(/\//g, '-');
}

// Toggle description show/hide
function toggleDescription(button) {
    const icon = button.querySelector('.description-toggle-icon');
    const detail = button.parentElement.querySelector('.api-description-detail');
    const span = button.querySelector('span');
    
    if (detail.style.display === 'none') {
        detail.style.display = 'block';
        icon.style.transform = 'rotate(180deg)';
        span.textContent = 'Hide details';
    } else {
        detail.style.display = 'none';
        icon.style.transform = 'rotate(0deg)';
        span.textContent = 'View details';
    }
}

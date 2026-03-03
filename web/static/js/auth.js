const AUTH_STORAGE_KEY = 'cyberstrike-auth';
let authToken = null;
let authTokenExpiry = null;
let authPromise = null;
let authPromiseResolvers = [];
let isAppInitialized = false;

function isTokenValid() {
    return !!authToken && authTokenExpiry instanceof Date && authTokenExpiry.getTime() > Date.now();
}

function saveAuth(token, expiresAt) {
    const expiry = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
    authToken = token;
    authTokenExpiry = expiry;
    try {
        localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({
            token,
            expiresAt: expiry.toISOString(),
        }));
    } catch (error) {
        console.warn('Unable to persist authentication info:', error);
    }
}

function clearAuthStorage() {
    authToken = null;
    authTokenExpiry = null;
    try {
        localStorage.removeItem(AUTH_STORAGE_KEY);
    } catch (error) {
        console.warn('Unable to clear authentication info:', error);
    }
}

function loadAuthFromStorage() {
    try {
        const raw = localStorage.getItem(AUTH_STORAGE_KEY);
        if (!raw) {
            return false;
        }
        const stored = JSON.parse(raw);
        if (!stored.token || !stored.expiresAt) {
            clearAuthStorage();
            return false;
        }
        const expiry = new Date(stored.expiresAt);
        if (Number.isNaN(expiry.getTime())) {
            clearAuthStorage();
            return false;
        }
        authToken = stored.token;
        authTokenExpiry = expiry;
        return isTokenValid();
    } catch (error) {
        console.error('Failed to read authentication info:', error);
        clearAuthStorage();
        return false;
    }
}

function resolveAuthPromises(success) {
    authPromiseResolvers.forEach(resolve => resolve(success));
    authPromiseResolvers = [];
    authPromise = null;
}

function showLoginOverlay(message = '') {
    const overlay = document.getElementById('login-overlay');
    const errorBox = document.getElementById('login-error');
    const passwordInput = document.getElementById('login-password');
    if (!overlay) {
        return;
    }
    overlay.style.display = 'flex';
    if (errorBox) {
        if (message) {
            errorBox.textContent = message;
            errorBox.style.display = 'block';
        } else {
            errorBox.textContent = '';
            errorBox.style.display = 'none';
        }
    }
    setTimeout(() => {
        if (passwordInput) {
            passwordInput.focus();
        }
    }, 100);
}

function hideLoginOverlay() {
    const overlay = document.getElementById('login-overlay');
    const errorBox = document.getElementById('login-error');
    const passwordInput = document.getElementById('login-password');
    if (overlay) {
        overlay.style.display = 'none';
    }
    if (errorBox) {
        errorBox.textContent = '';
        errorBox.style.display = 'none';
    }
    if (passwordInput) {
        passwordInput.value = '';
    }
}

function ensureAuthPromise() {
    if (!authPromise) {
        authPromise = new Promise(resolve => {
            authPromiseResolvers.push(resolve);
        });
    }
    return authPromise;
}

async function ensureAuthenticated() {
    if (isTokenValid()) {
        return true;
    }
    showLoginOverlay();
    await ensureAuthPromise();
    return true;
}

function handleUnauthorized({ message = 'Session expired, please log in again', silent = false } = {}) {
    clearAuthStorage();
    authPromise = null;
    authPromiseResolvers = [];
    if (!silent) {
        showLoginOverlay(message);
    } else {
        showLoginOverlay();
    }
    return false;
}

async function apiFetch(url, options = {}) {
    await ensureAuthenticated();
    const opts = { ...options };
    const headers = new Headers(options && options.headers ? options.headers : undefined);
    if (authToken && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${authToken}`);
    }
    opts.headers = headers;

    const response = await fetch(url, opts);
    if (response.status === 401) {
        handleUnauthorized();
        throw new Error('Unauthorized access');
    }
    return response;
}

async function submitLogin(event) {
    event.preventDefault();
    const passwordInput = document.getElementById('login-password');
    const errorBox = document.getElementById('login-error');
    const submitBtn = document.querySelector('.login-submit');

    if (!passwordInput) {
        return;
    }

    const password = passwordInput.value.trim();
    if (!password) {
        if (errorBox) {
            errorBox.textContent = 'Please enter your password';
            errorBox.style.display = 'block';
        }
        return;
    }

    if (submitBtn) {
        submitBtn.disabled = true;
    }

    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ password }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.token) {
            if (errorBox) {
                errorBox.textContent = result.error || 'Login failed, please check your password';
                errorBox.style.display = 'block';
            }
            return;
        }

        saveAuth(result.token, result.expires_at);
        hideLoginOverlay();
        resolveAuthPromises(true);
        if (!isAppInitialized) {
            await bootstrapApp();
        } else {
            await refreshAppData();
        }
    } catch (error) {
        console.error('Login failed:', error);
        if (errorBox) {
            errorBox.textContent = 'Login failed, please try again later';
            errorBox.style.display = 'block';
        }
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
        }
    }
}

async function refreshAppData(showTaskErrors = false) {
    await Promise.allSettled([
        loadConversations(),
        loadActiveTasks(showTaskErrors),
    ]);
}

async function bootstrapApp() {
    if (!isAppInitialized) {
        initializeChatUI();
        isAppInitialized = true;
    }
    await refreshAppData();
}

// General utility functions
function getStatusText(status) {
    const statusMap = {
        'pending': 'Pending',
        'running': 'Running',
        'completed': 'Completed',
        'failed': 'Failed'
    };
    return statusMap[status] || status;
}

function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
        return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    } else {
        return `${seconds}s`;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatMarkdown(text) {
    const sanitizeConfig = {
        ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 's', 'code', 'pre', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr'],
        ALLOWED_ATTR: ['href', 'title', 'alt', 'src', 'class'],
        ALLOW_DATA_ATTR: false,
    };
    
    if (typeof DOMPurify !== 'undefined') {
        if (typeof marked !== 'undefined' && !/<[a-z][\s\S]*>/i.test(text)) {
            try {
                marked.setOptions({
                    breaks: true,
                    gfm: true,
                });
                let parsedContent = marked.parse(text);
                return DOMPurify.sanitize(parsedContent, sanitizeConfig);
            } catch (e) {
                console.error('Markdown parsing failed:', e);
                return DOMPurify.sanitize(text, sanitizeConfig);
            }
        } else {
            return DOMPurify.sanitize(text, sanitizeConfig);
        }
    } else if (typeof marked !== 'undefined') {
        try {
            marked.setOptions({
                breaks: true,
                gfm: true,
            });
            return marked.parse(text);
        } catch (e) {
            console.error('Markdown parsing failed:', e);
            return escapeHtml(text).replace(/\n/g, '<br>');
        }
    } else {
        return escapeHtml(text).replace(/\n/g, '<br>');
    }
}

function setupLoginUI() {
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', submitLogin);
    }
}

async function initializeApp() {
    setupLoginUI();
    const hasStoredAuth = loadAuthFromStorage();
    if (hasStoredAuth && isTokenValid()) {
        try {
            const response = await apiFetch('/api/auth/validate', {
                method: 'GET',
            });
            if (response.ok) {
                hideLoginOverlay();
                resolveAuthPromises(true);
                await bootstrapApp();
                return;
            }
        } catch (error) {
            console.warn('Local session has expired, please log in again');
        }
    }

    clearAuthStorage();
    showLoginOverlay();
}

// User menu control
function toggleUserMenu() {
    const dropdown = document.getElementById('user-menu-dropdown');
    if (!dropdown) return;
    
    const isVisible = dropdown.style.display !== 'none';
    dropdown.style.display = isVisible ? 'none' : 'block';
}

// Close the dropdown menu when clicking elsewhere on the page
document.addEventListener('click', function(event) {
    const dropdown = document.getElementById('user-menu-dropdown');
    const avatarBtn = document.querySelector('.user-avatar-btn');
    
    if (dropdown && avatarBtn && 
        !dropdown.contains(event.target) && 
        !avatarBtn.contains(event.target)) {
        dropdown.style.display = 'none';
    }
});

// Logout
async function logout() {
    // Close the dropdown menu
    const dropdown = document.getElementById('user-menu-dropdown');
    if (dropdown) {
        dropdown.style.display = 'none';
    }
    
    try {
        // First attempt to call the logout API (if token is valid)
        if (authToken) {
            const headers = new Headers();
            headers.set('Authorization', `Bearer ${authToken}`);
            await fetch('/api/auth/logout', {
                method: 'POST',
                headers: headers,
            }).catch(() => {
                // Ignore errors and continue clearing local auth info
            });
        }
    } catch (error) {
        console.error('Logout API call failed:', error);
    } finally {
        // Always clear local authentication info
        clearAuthStorage();
        hideLoginOverlay();
        showLoginOverlay('Logged out successfully');
    }
}

// Export functions for HTML use
window.toggleUserMenu = toggleUserMenu;
window.logout = logout;

document.addEventListener('DOMContentLoaded', initializeApp);

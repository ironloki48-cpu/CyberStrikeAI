/**
 * System Settings - Terminal: multi-tab, streaming output, command history, Ctrl+L to clear, long-running task can be cancelled
 */
(function () {
    var getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, attrs) {
        if (type === '2d') {
            attrs = (attrs && typeof attrs === 'object') ? Object.assign({ willReadFrequently: true }, attrs) : { willReadFrequently: true };
            return getContext.call(this, type, attrs);
        }
        return getContext.apply(this, arguments);
    };

    var terminals = [];
    var currentTabId = 1;
    var inited = false;
    var tabIdCounter = 1;
    var PROMPT = ''; // The real shell outputs its own prompt; no custom prompt here
    var HISTORY_MAX = 100;
    var CANCEL_AFTER_MS = 125000;

    function getCurrent() {
        for (var i = 0; i < terminals.length; i++) {
            if (terminals[i].id === currentTabId) return terminals[i];
        }
        return terminals[0] || null;
    }

    var WELCOME_LINE = 'CyberStrikeAI Terminal - Real shell session; type commands directly; Ctrl+L to clear\r\n';

    function writePrompt(tab) {
        // The backend shell outputs its own prompt; keep this placeholder to avoid errors in old code
    }

    function redrawTabDisplay(t) {
        if (!t || !t.term) return;
        t.term.clear();
        t.term.write(WELCOME_LINE);
    }

    function writeln(tabOrS, s) {
        var t, text;
        if (arguments.length === 1) { text = tabOrS; t = getCurrent(); } else { t = tabOrS; text = s; }
        if (!t || !t.term) return;
        if (text) t.term.writeln(text);
        else t.term.writeln('');
    }

    function writeOutput(tab, text, isError) {
        var t = tab || getCurrent();
        if (!t || !t.term || !text) return;
        var s = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        var lines = s.split('\n');
        var prefix = isError ? '\x1b[31m' : '';
        var suffix = isError ? '\x1b[0m' : '';
        t.term.write(prefix);
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].replace(/\r/g, '');
            t.term.writeln(line);
        }
        t.term.write(suffix);
    }

    // Build WebSocket URL (supports http/https). Authentication uses the
    // same-origin HttpOnly auth cookie set at login time.
    function buildTerminalWSURL() {
        var proto = (window.location.protocol === 'https:') ? 'wss://' : 'ws://';
        return proto + window.location.host + '/api/terminal/ws';
    }

    function ensureTerminalWS(tab) {
        if (tab.ws && (tab.ws.readyState === WebSocket.OPEN || tab.ws.readyState === WebSocket.CONNECTING)) {
            return;
        }
        try {
            var ws = new WebSocket(buildTerminalWSURL());
            tab.ws = ws;
            tab.running = true;

            ws.onopen = function () {
                if (tab.term) {
                    tab.term.focus();
                }
            };

            ws.onmessage = function (ev) {
                if (!tab.term) return;
                tab.term.write(ev.data);
            };

            ws.onclose = function () {
                tab.running = false;
                if (tab.term) {
                    tab.term.writeln('\r\n\x1b[2m[Session closed]\x1b[0m');
                }
            };

            ws.onerror = function () {
                tab.running = false;
                if (tab.term) {
                    tab.term.writeln('\r\n\x1b[31m[Terminal connection error]\x1b[0m');
                }
            };
        } catch (e) {
            if (tab.term) {
                tab.term.writeln('\r\n\x1b[31m[Unable to connect to terminal service: ' + String(e) + ']\x1b[0m');
            }
        }
    }

    function createTerminalInContainer(container, tab) {
        if (typeof Terminal === 'undefined') return null;
        if (!tab.history) tab.history = [];
        if (tab.historyIndex === undefined) tab.historyIndex = -1;
        if (tab.cursorIndex === undefined) tab.cursorIndex = 0;

        var term = new Terminal({
            cursorBlink: true,
            cursorStyle: 'bar',
            fontSize: 13,
            fontFamily: 'Menlo, Monaco, "Courier New", monospace',
            lineHeight: 1.2,
            scrollback: 1000,
            theme: {
                background: '#0d1117',
                foreground: '#e6edf3',
                cursor: '#58a6ff',
                cursorAccent: '#0d1117',
                selection: 'rgba(88, 166, 255, 0.3)',
                black: '#484f58',
                red: '#ff7b72',
                green: '#3fb950',
                yellow: '#d29922',
                blue: '#58a6ff',
                magenta: '#bc8cff',
                cyan: '#39c5cf',
                white: '#e6edf3',
                brightBlack: '#6e7681',
                brightRed: '#ffa198',
                brightGreen: '#56d364',
                brightYellow: '#e3b341',
                brightBlue: '#79c0ff',
                brightMagenta: '#d2a8ff',
                brightCyan: '#56d4dd',
                brightWhite: '#f0f6fc'
            }
        });
        var fitAddon = null;
        if (typeof FitAddon !== 'undefined') {
            var FitCtor = (FitAddon.FitAddon || FitAddon);
            fitAddon = new FitCtor();
            term.loadAddon(fitAddon);
        }
        term.open(container);
        term.write(WELCOME_LINE);
        container.addEventListener('click', function () {
            switchTerminalTab(tab.id);
            if (term) term.focus();
        });
        container.setAttribute('tabindex', '0');
        container.title = 'Click here to enter commands';

        function sendToWS(data) {
            ensureTerminalWS(tab);
            if (tab.ws && tab.ws.readyState === WebSocket.OPEN) {
                try {
                    tab.ws.send(data);
                } catch (e) {}
            }
        }

        term.onData(function (data) {
            // Ctrl+L: clear locally and also send ^L to the backend
            if (data === '\x0c') {
                term.clear();
                sendToWS(data);
                return;
            }
            sendToWS(data);
        });

        tab.term = term;
        tab.fitAddon = fitAddon;
        return term;
    }

    function switchTerminalTab(id) {
        var prevId = currentTabId;
        currentTabId = id;
        document.querySelectorAll('.terminal-tab').forEach(function (el) {
            el.classList.toggle('active', parseInt(el.getAttribute('data-tab-id'), 10) === id);
        });
        document.querySelectorAll('.terminal-pane').forEach(function (el) {
            var paneId = el.getAttribute('id');
            var match = paneId && paneId.match(/terminal-pane-(\d+)/);
            var paneTabId = match ? parseInt(match[1], 10) : 0;
            el.classList.toggle('active', paneTabId === id);
        });
        var t = getCurrent();
        if (t && t.term) {
            if (prevId !== id) {
                requestAnimationFrame(function () {
                    if (currentTabId === id && t.term) t.term.focus();
                });
            } else {
                t.term.focus();
            }
        }
    }

    function addTerminalTab() {
        if (typeof Terminal === 'undefined') return;
        tabIdCounter += 1;
        var id = tabIdCounter;
        var paneId = 'terminal-pane-' + id;
        var containerId = 'terminal-container-' + id;
        var tabsEl = document.querySelector('.terminal-tabs');
        var panesEl = document.querySelector('.terminal-panes');
        if (!tabsEl || !panesEl) return;

        var tabDiv = document.createElement('div');
        tabDiv.className = 'terminal-tab';
        tabDiv.setAttribute('data-tab-id', String(id));
        var label = document.createElement('span');
        label.className = 'terminal-tab-label';
        label.textContent = 'Terminal ' + id;
        label.onclick = function () { switchTerminalTab(id); };
        var closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'terminal-tab-close';
        closeBtn.title = 'Close';
        closeBtn.textContent = '×';
        closeBtn.onclick = function (e) { e.stopPropagation(); removeTerminalTab(id); };
        tabDiv.appendChild(label);
        tabDiv.appendChild(closeBtn);
        var plusBtn = tabsEl.querySelector('.terminal-tab-new');
        tabsEl.insertBefore(tabDiv, plusBtn);

        var paneDiv = document.createElement('div');
        paneDiv.id = paneId;
        paneDiv.className = 'terminal-pane';
        var containerDiv = document.createElement('div');
        containerDiv.id = containerId;
        containerDiv.className = 'terminal-container';
        paneDiv.appendChild(containerDiv);
        panesEl.appendChild(paneDiv);

        var tab = { id: id, paneId: paneId, containerId: containerId, lineBuffer: '', cursorIndex: 0, running: false, term: null, fitAddon: null, history: [], historyIndex: -1 };
        terminals.push(tab);
        createTerminalInContainer(containerDiv, tab);
        switchTerminalTab(id);
        updateTerminalTabCloseVisibility();
        setTimeout(function () {
            try { if (tab.fitAddon) tab.fitAddon.fit(); if (tab.term) tab.term.focus(); } catch (e) {}
        }, 50);
    }

    function updateTerminalTabCloseVisibility() {
        var tabsEl = document.querySelector('.terminal-tabs');
        if (!tabsEl) return;
        var tabDivs = tabsEl.querySelectorAll('.terminal-tab');
        var showClose = terminals.length > 1;
        for (var i = 0; i < tabDivs.length; i++) {
            var btn = tabDivs[i].querySelector('.terminal-tab-close');
            if (btn) btn.style.display = showClose ? '' : 'none';
        }
    }

    function removeTerminalTab(id) {
        if (terminals.length <= 1) return;
        var idx = -1;
        for (var i = 0; i < terminals.length; i++) { if (terminals[i].id === id) { idx = i; break; } }
        if (idx < 0) return;

        var deletingCurrent = (currentTabId === id);
        var switchToIndex = deletingCurrent ? (idx > 0 ? idx - 1 : 0) : -1;

        var tab = terminals[idx];
        if (tab.term && tab.term.dispose) tab.term.dispose();
        tab.term = null;
        tab.fitAddon = null;
        terminals.splice(idx, 1);

        var tabDiv = document.querySelector('.terminal-tab[data-tab-id="' + id + '"]');
        var paneDiv = document.getElementById('terminal-pane-' + id);
        if (tabDiv && tabDiv.parentNode) tabDiv.parentNode.removeChild(tabDiv);
        if (paneDiv && paneDiv.parentNode) paneDiv.parentNode.removeChild(paneDiv);

        var curIdxBeforeRenumber = -1;
        if (!deletingCurrent) {
            for (var i = 0; i < terminals.length; i++) {
                if (terminals[i].id === currentTabId) { curIdxBeforeRenumber = i; break; }
            }
        }

        for (var i = 0; i < terminals.length; i++) {
            var t = terminals[i];
            t.id = i + 1;
            t.paneId = 'terminal-pane-' + (i + 1);
            t.containerId = 'terminal-container-' + (i + 1);
        }
        tabIdCounter = terminals.length;
        if (curIdxBeforeRenumber >= 0) currentTabId = terminals[curIdxBeforeRenumber].id;

        var tabsEl = document.querySelector('.terminal-tabs');
        var panesEl = document.querySelector('.terminal-panes');
        if (tabsEl) {
            var tabDivs = tabsEl.querySelectorAll('.terminal-tab');
            for (var i = 0; i < tabDivs.length; i++) {
                var t = terminals[i];
                tabDivs[i].setAttribute('data-tab-id', String(t.id));
                var lbl = tabDivs[i].querySelector('.terminal-tab-label');
                if (lbl) lbl.textContent = 'Terminal ' + t.id;
                if (lbl) lbl.onclick = (function (tid) { return function () { switchTerminalTab(tid); }; })(t.id);
                var cb = tabDivs[i].querySelector('.terminal-tab-close');
                if (cb) cb.onclick = (function (tid) { return function (e) { e.stopPropagation(); removeTerminalTab(tid); }; })(t.id);
            }
        }
        if (panesEl) {
            var paneDivs = panesEl.querySelectorAll('.terminal-pane');
            for (var i = 0; i < paneDivs.length; i++) {
                var t = terminals[i];
                paneDivs[i].id = t.paneId;
                var cont = paneDivs[i].querySelector('.terminal-container');
                if (cont) cont.id = t.containerId;
            }
        }

        updateTerminalTabCloseVisibility();

        if (deletingCurrent && terminals.length > 0) {
            currentTabId = terminals[switchToIndex].id;
            switchTerminalTab(currentTabId);
        }
    }

    function initTerminal() {
        var pane1 = document.getElementById('terminal-pane-1');
        var container1 = document.getElementById('terminal-container-1');
        if (!pane1 || !container1) return;
        if (inited) {
            var t = getCurrent();
            if (t && t.term) t.term.focus();
            terminals.forEach(function (tab) { try { if (tab.fitAddon) tab.fitAddon.fit(); } catch (e) {} });
            return;
        }
        inited = true;

        if (typeof Terminal === 'undefined') {
            container1.innerHTML = '<p class="terminal-error">xterm.js not loaded. Please refresh the page or check your network connection.</p>';
            return;
        }

        currentTabId = 1;
        var tab = { id: 1, paneId: 'terminal-pane-1', containerId: 'terminal-container-1', lineBuffer: '', cursorIndex: 0, running: false, term: null, fitAddon: null, history: [], historyIndex: -1 };
        terminals.push(tab);
        createTerminalInContainer(container1, tab);

        updateTerminalTabCloseVisibility();

        setTimeout(function () {
            try { if (tab.fitAddon) tab.fitAddon.fit(); if (tab.term) tab.term.focus(); } catch (e) {}
        }, 100);

        var resizeTimer;
        window.addEventListener('resize', function () {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(function () {
                terminals.forEach(function (t) { try { if (t.fitAddon) t.fitAddon.fit(); } catch (e) {} });
            }, 150);
        });
    }

    function terminalClear() {
        var t = getCurrent();
        if (!t || !t.term) return;
        t.term.clear();
        t.lineBuffer = '';
        if (t.cursorIndex !== undefined) t.cursorIndex = 0;
        writePrompt(t);
        t.term.focus();
    }

    window.initTerminal = initTerminal;
    window.terminalClear = terminalClear;
    window.switchTerminalTab = switchTerminalTab;
    window.addTerminalTab = addTerminalTab;
    window.removeTerminalTab = removeTerminalTab;
})();

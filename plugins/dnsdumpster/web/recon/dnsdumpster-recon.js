(function() {
    window.submit_dnsdumpster = async function() {
        const query = document.getElementById('dnsdumpster-query').value.trim();
        const command = document.getElementById('dnsdumpster-command').value;
        const recordType = document.getElementById('dnsdumpster-type').value;

        if (!query && command !== 'validate') {
            showNotification('Enter a domain or IP address', 'error');
            return;
        }

        const meta = document.getElementById('dnsdumpster-results-meta');
        const body = document.getElementById('dnsdumpster-results-body');
        meta.textContent = 'Searching...';
        body.innerHTML = '<p class="muted">Loading...</p>';

        try {
            var toolQuery = query || 'validate';
            var msg = 'Use dnsdumpster_search tool with query="' + toolQuery + '" command="' + command + '"';
            if (recordType && command === 'domain') {
                msg += ' type="' + recordType + '"';
            }
            msg += '. Return the raw results.';

            const resp = await apiFetch('/api/agent-loop', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({message: msg})
            });
            const data = await resp.json();
            meta.textContent = 'Done';
            body.innerHTML = '<pre style="white-space:pre-wrap;font-size:12px;">' +
                (data.response || JSON.stringify(data, null, 2)) + '</pre>';
        } catch(e) {
            meta.textContent = 'Error';
            body.innerHTML = '<p style="color:red;">' + e.message + '</p>';
        }
    };

    window.reset_dnsdumpster = function() {
        document.getElementById('dnsdumpster-query').value = '';
        document.getElementById('dnsdumpster-command').value = 'domain';
        document.getElementById('dnsdumpster-type').value = '';
        document.getElementById('dnsdumpster-results-meta').textContent = '-';
        document.getElementById('dnsdumpster-results-body').innerHTML =
            '<p class="muted">Enter a domain or IP and click Search.</p>';
    };
})();

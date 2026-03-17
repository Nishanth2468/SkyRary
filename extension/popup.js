document.addEventListener('DOMContentLoaded', () => {
    const urlInput = document.getElementById('pr-url');
    const btn = document.getElementById('scan-btn');
    const loader = document.getElementById('loader');
    const results = document.getElementById('results');
    const findingsList = document.getElementById('findings-list');

    // Auto-fill URL if the active tab is a GitHub Pull Request
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        const activeTab = tabs[0];
        if (activeTab && activeTab.url.includes("github.com") && activeTab.url.includes("/pull/")) {
            urlInput.value = activeTab.url;
        }
    });

    btn.addEventListener('click', async () => {
        const urlStr = urlInput.value.trim();
        
        if (!urlStr.includes('github.com') || !urlStr.includes('/pull/')) {
            alert('Please enter a valid GitHub Pull Request URL');
            return;
        }

        try {
            const urlObj = new URL(urlStr);
            const parts = urlObj.pathname.split('/').filter(p => p);
            if (parts.length < 4) throw new Error("Invalid URL format");
            
            const repoFullName = `${parts[0]}/${parts[1]}`;
            const prNumber = parseInt(parts[3], 10);

            // UI state
            btn.disabled = true;
            btn.innerText = "Scanning...";
            loader.classList.remove('hidden');
            results.classList.add('hidden');
            findingsList.innerHTML = '';

            // Hit the webapp API backend!
            const response = await fetch('http://localhost:8000/api/webapp/review', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ repo: repoFullName, pr_number: prNumber })
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Server returned ${response.status}: ${errText}`);
            }

            const findings = await response.json();
            
            let critCount = 0;
            let warnCount = 0;

            if (findings.length === 0) {
                findingsList.innerHTML = '<div class="finding-item" style="text-align: center; color: var(--primary);">✅ No issues detected. Code looks solid!</div>';
            } else {
                findings.forEach(f => {
                    if (f.severity === 'CRITICAL' || f.severity === 'HIGH') critCount++;
                    else warnCount++;

                    const item = document.createElement('div');
                    item.className = 'finding-item';
                    const severityClass = (f.severity === 'CRITICAL' || f.severity === 'HIGH') ? 'severity-CRITICAL' : 'severity-WARNING';
                    
                    item.innerHTML = `
                        <h3><span class="severity-badge ${severityClass}">${f.severity}</span> ${f.issue || f.title || 'Finding'}</h3>
                        <div class="file-path">${f.file || 'General'}${f.line ? ` : Line ${f.line}` : ''}</div>
                        <p class="finding-desc">${f.fix || f.desc || ''}</p>
                    `;
                    findingsList.appendChild(item);
                });
            }

            // Update Counts
            document.getElementById('crit-count').innerText = critCount;
            document.getElementById('warn-count').innerText = warnCount;

            loader.classList.add('hidden');
            results.classList.remove('hidden');

        } catch (err) {
            alert('Error scanning PR: ' + err.message);
            console.error(err);
            loader.classList.add('hidden');
            results.classList.add('hidden');
        } finally {
            btn.disabled = false;
            btn.innerText = "Scan PR";
        }
    });
});

// Setup Monitoring UI
document.addEventListener('DOMContentLoaded', async () => {
    chrome.action.setBadgeText({ text: "" }); // Clear badge when opened

    const repoNameEl = document.getElementById('active-repo-name');
    const muteCb = document.getElementById('mute-repo-cb');
    const tokenInput = document.getElementById('gh-token-input');
    const healthContainer = document.getElementById('repo-health-container');
    const healthLink = document.getElementById('repo-health-link');
    const healthBadge = document.getElementById('repo-health-badge');

    const data = await chrome.storage.local.get(['activeRepo', 'mutedRepos', 'ghToken']);
    const activeRepo = data.activeRepo;
    let mutedRepos = data.mutedRepos || {};
    
    if (data.ghToken) {
        tokenInput.value = data.ghToken;
    }

    if (activeRepo) {
        repoNameEl.innerText = activeRepo.key;
        muteCb.checked = !!mutedRepos[activeRepo.key];

        // Generate the Repo Health badge if we have a valid owner/repo
        const parts = activeRepo.key.split('/');
        if (parts.length === 2) {
            const owner = parts[0];
            const repo = parts[1];
            healthLink.href = `https://repohealth.info/${owner}/${repo}`;
            healthBadge.src = `https://img.shields.io/endpoint?url=https://repohealth.info/api/badge/${owner}/${repo}`;
            healthContainer.style.display = 'flex';
        }
    } else {
        repoNameEl.innerText = "No GitHub repo detected";
        muteCb.disabled = true;
    }

    // Toggle Mute
    muteCb.addEventListener('change', async (e) => {
        if (!activeRepo) return;
        mutedRepos[activeRepo.key] = e.target.checked;
        await chrome.storage.local.set({ mutedRepos });
    });

    // Save Token
    tokenInput.addEventListener('change', async (e) => {
        await chrome.storage.local.set({ ghToken: e.target.value.trim() });
    });
});

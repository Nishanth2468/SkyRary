document.getElementById('scan-btn').addEventListener('click', async () => {
    const urlInput = document.getElementById('pr-url').value.trim();
    const btn = document.getElementById('scan-btn');
    const loader = document.getElementById('loader');
    const results = document.getElementById('results');
    const findingsList = document.getElementById('findings-list');
    
    if (!urlInput.includes('github.com') || !urlInput.includes('/pull/')) {
        alert('Please enter a valid GitHub Pull Request URL');
        return;
    }

    // Extract repo and PR number from URL
    try {
        const urlObj = new URL(urlInput);
        const parts = urlObj.pathname.split('/').filter(p => p);
        if (parts.length < 4) throw new Error("Invalid URL format");
        
        const repoFullName = `${parts[0]}/${parts[1]}`;
        const prNumber = parseInt(parts[3], 10);

        // Update UI
        btn.disabled = true;
        btn.innerText = "Scanning...";
        loader.classList.remove('hidden');
        results.classList.add('hidden');
        findingsList.innerHTML = '';

        // Call our local FastAPI endpoint
        const response = await fetch('/api/webapp/review', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ repo: repoFullName, pr_number: prNumber })
        });

        if (!response.ok) {
            throw new Error(`Server error: ${response.statusText}`);
        }

        const findings = await response.json();
        
        // Process findings
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
                    <h3>
                        <span class="severity-badge ${severityClass}">${f.severity}</span>
                        ${f.issue || f.title || 'Finding'}
                    </h3>
                    <div class="file-path">${f.file || 'General'}${f.line ? ` : Line ${f.line}` : ''}</div>
                    <p class="finding-desc">${f.fix || f.desc || ''}</p>
                `;
                findingsList.appendChild(item);
            });
        }

        document.getElementById('crit-count').innerText = critCount;
        document.getElementById('warn-count').innerText = warnCount;

        loader.classList.add('hidden');
        results.classList.remove('hidden');

    } catch (err) {
        alert('Error scanning PR: ' + err.message);
        console.error(err);
        loader.classList.add('hidden');
    } finally {
        btn.disabled = false;
        btn.innerText = "Scan PR";
    }
});
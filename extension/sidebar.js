/* sidebar.js - Logic for injecting the sidebar into GitHub PR page */

let globalSidebarFindings = [];

function buildSidebar(findings) {
    if (document.getElementById('sonic-guard-sidebar')) {
        document.getElementById('sonic-guard-sidebar').remove();
    }
    
    // Use actual findings, or default to an empty clean state
    globalSidebarFindings = findings || [];
    
    const sidebar = document.createElement('div');
    sidebar.id = 'sonic-guard-sidebar';
    sidebar.className = 'open';

    const header = document.createElement('div');
    header.className = 'sg-topbar';
    header.innerHTML = `
        <div class="sg-logo-wrap">
            <svg class="sg-logo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 22S4 16.25 4 9V5l8-3 8 3v4c0 7.25-8 13-8 13z"/>
            </svg>
            <h2 class="sg-title">SONIC-GUARD</h2>
        </div>
        <div style="display:flex; align-items:center; gap:10px;">
            <div class="sg-live-badge">LIVE</div>
            <button class="sg-close-btn" id="sg-close-btn">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        </div>
    `;

    const filter = document.createElement('div');
    filter.className = 'sg-filter-bar';
    filter.innerHTML = `
        <button class="sg-filter-btn active">ALL</button>
        <button class="sg-filter-btn">CRITICAL</button>
        <button class="sg-filter-btn">WARNINGS</button>
    `;

    const list = document.createElement('div');
    list.className = 'sg-findings-list';
    
    if (globalSidebarFindings.length === 0) {
        list.innerHTML = `<div style="padding:20px; text-align:center; color:var(--sg-accent-green);">✅ No issues detected! Code looks perfectly secure.</div>`;
    } else {
        globalSidebarFindings.forEach(f => {
            const card = document.createElement('div');
            card.className = 'sg-card';
            const badgeClass = (f.severity === 'CRITICAL' || f.severity === 'HIGH') ? 'critical' : 'warning';
            
            // XSS Prevention: Do not use .innerHTML for properties directly returned by potentially untrusted LLM payload
            const cardHeader = document.createElement('div');
            cardHeader.className = 'sg-card-header';
            cardHeader.innerHTML = `
                <span class="sg-badge ${badgeClass}">${String(f.severity).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>
                <span class="sg-file-info">${String(f.file || 'General').replace(/</g, '&lt;')} ${f.line ? ':'+f.line : ''}</span>
            `;

            const cardTitle = document.createElement('h3');
            cardTitle.className = 'sg-card-title';
            cardTitle.textContent = `🛡️ ${f.issue || f.title || 'Finding Detected'}`;

            const cardDesc = document.createElement('p');
            cardDesc.className = 'sg-card-desc';
            cardDesc.textContent = f.fix || f.desc || '';

            const cardActions = document.createElement('div');
            cardActions.className = 'sg-card-actions';
            cardActions.innerHTML = `
                <button class="sg-btn-link">View in code ↗</button>
                ${f.fix ? '<button class="sg-btn-action">Apply Fix</button>' : ''}
            `;
            
            card.appendChild(cardHeader);
            card.appendChild(cardTitle);
            card.appendChild(cardDesc);
            card.appendChild(cardActions);
            
            list.appendChild(card);
        });
    }

    const footer = document.createElement('div');
    footer.className = 'sg-footer';
    footer.innerHTML = `
        <span>Total Issues: ${globalSidebarFindings.length}</span>
        <span>Powered by Sonic-Guard AI</span>
    `;

    sidebar.appendChild(header);
    sidebar.appendChild(filter);
    sidebar.appendChild(list);
    sidebar.appendChild(footer);

    document.body.appendChild(sidebar);

    document.getElementById('sg-close-btn').addEventListener('click', () => {
        sidebar.classList.remove('open');
        setTimeout(() => sidebar.remove(), 300);
    });
}

// Automatically injected via message from backend/popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    console.log("Sidebar received message:", msg.action);
    if (msg.action === "injectSidebar") {
        buildSidebar(msg.findings);
        sendResponse && sendResponse({status: "ok"});
    }
});

// content.js - Runs naturally on GitHub Pull Request pages

console.log("🛡️ Sonic-Guard Chrome Extension injected!");

// Delay adding our button until the page is fully loaded (GitHub uses React, so we wait 2 seconds)
setTimeout(addSonicGuardButton, 2000);

function addSonicGuardButton() {
    // Try to find the GitHub discussion header to attach our button to
    const headerActions = document.querySelector(".gh-header-actions");
    if (!headerActions) return;

    // Create the "Scan with Sonic-Guard" button
    const btn = document.createElement("button");
    btn.innerText = "🛡️ Scan with Sonic-Guard";
    btn.className = "btn btn-sm btn-primary m-1"; // Using GitHub's own CSS classes!
    btn.style.backgroundColor = "#ff5722";
    btn.style.borderColor = "#e64a19";
    btn.style.color = "white";
    
    // When they click it, grab the screen's code and ask the AI!
    btn.onclick = async () => {
        btn.innerText = "⏳ Scanning Code...";
        
        // 1. We grab the diff data from the current page
        const match = window.location.href.match(/^(https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+)/);
        if (!match) {
            alert("Could not determine PR URL.");
            btn.innerText = "🛡️ Scan with Sonic-Guard";
            return;
        }
        const prUrl = match[1] + ".diff";
        const response = await fetch(prUrl);
        const diffText = await response.text();
        
        // 2. We ask our Background Worker to send this diff to the Python server
        chrome.runtime.sendMessage({
            type: "SCAN_DIFF",
            diff: diffText
        }, (backendResponse) => {
            console.log("Received AI findings:", backendResponse);
            btn.innerText = "🛡️ AI Review Complete";
            injectFindingsToPage(backendResponse.findings);
        });
    };
    
    // Put our button right at the top of the PR
    headerActions.prepend(btn);
}

function injectFindingsToPage(findings) {
    if (!findings || findings.length === 0) {
        alert("✅ Sonic-Guard found zero security issues!");
        return;
    }
    
    // Add a flashy warning box to the top of the PR description
    let reportHtml = `
      <div class="sonic-guard-warning" style="border-left: 5px solid red; background: #ffebee; padding: 15px; margin-bottom: 20px; border-radius: 4px;">
        <h3 style="color: #d32f2f; margin-top: 0;">🚨 Sonic-Guard AI Detected ${findings.length} Critical Issues</h3>
        <ul>
    `;
    
    findings.forEach(f => {
        reportHtml += `<li style="margin-bottom: 10px;"><b>Line ${f.line || 'general'}</b>: ${f.issue}<br><span style="color: #1565c0;">💡 Fix: ${f.fix}</span></li>`;
    });
    reportHtml += `</ul></div>`;
    
    // Insert into DOM
    const commentBody = document.querySelector(".comment-body");
    if (commentBody) {
        commentBody.innerHTML = reportHtml + commentBody.innerHTML;
    }
}

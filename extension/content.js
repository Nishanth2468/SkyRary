// content.js - Runs naturally on GitHub Pull Request pages

console.log("🛡️ Sonic-Guard Chrome Extension loaded!");

function addSonicGuardButton() {
    // Try to find the GitHub discussion header to attach our button to
    const headerActions = document.querySelector(".gh-header-actions");
    if (!headerActions) return;

    if (document.getElementById("sonic-guard-scan-btn")) return; // Prevent duplicates

    // Create the "Scan with Sonic-Guard" button
    const btn = document.createElement("button");
    btn.id = "sonic-guard-scan-btn";
    btn.innerText = "🛡️ Scan with Sonic-Guard";
    btn.className = "btn btn-sm btn-primary m-1";
    btn.style.backgroundColor = "#ff5722";
    btn.style.borderColor = "#e64a19";
    btn.style.color = "white";
    
    // When they click it, grab the screen's code and ask the AI
    btn.onclick = async () => {
        btn.innerText = "⏳ Scanning Code...";
        btn.disabled = true;
        
        try {
            const url = new URL(window.location.href);
            const cleanPrUrl = url.origin + url.pathname + ".diff";
            const response = await fetch(cleanPrUrl);
            const diffText = await response.text();
            
            console.log("Sending diff to background worker...");
            chrome.runtime.sendMessage({
                type: "SCAN_DIFF",
                diff: diffText
            }, (backendResponse) => {
                console.log("Content Script Received AI findings:", backendResponse);
                
                btn.innerText = "🛡️ AI Review Complete";
                setTimeout(() => { 
                    btn.innerText = "🛡️ Scan with Sonic-Guard"; 
                    btn.disabled = false;
                }, 3000);
                
                const findings = backendResponse ? backendResponse.findings || [] : [];
                
                // Show the injected UI globally via the other content scripts
                if (typeof createToast === "function") {
                    createToast(findings);
                }
                if (typeof buildSidebar === "function") {
                    buildSidebar(findings);
                }
            });
        } catch(e) {
            console.error("Error pushing to background", e);
            btn.innerText = "Scan Failed!";
            btn.disabled = false;
        }
    };
    
    // Put our button right at the top of the PR
    headerActions.prepend(btn);
}

// Use MutationObserver instead of setTimeout to handle GitHub's SPA
const observer = new MutationObserver((mutations) => {
    // Only try to add button if we're on a PR page
    if (window.location.href.includes('/pull/')) {
        addSonicGuardButton();
    }
});

// Start observing the document body for changes
observer.observe(document.body, { childList: true, subtree: true });

// Also add a listener for GitHub's custom turbo events
document.addEventListener("turbo:load", () => {
    if (window.location.href.includes('/pull/')) {
        addSonicGuardButton();
    }
});

// Run once on initial load just in case
if (window.location.href.includes('/pull/')) {
    addSonicGuardButton();
}

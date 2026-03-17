// background.js - Autonomous PR Monitor

// Setup Alarms when the extension is installed/started
chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create("prPoll", { periodInMinutes: 1 });
});

// Alarm Listener for polling
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== "prPoll") return;
    await checkActiveRepoPRs();
});

// Helper to parse GitHub repo URL
function parseGitHubUrl(urlStr) {
    try {
        const url = new URL(urlStr);
        if (url.hostname !== 'github.com') return null;
        const parts = url.pathname.split('/').filter(p => p);
        if (parts.length >= 2) {
            return {
                owner: parts[0],
                name: parts[1],
                key: `${parts[0]}/${parts[1]}` // e.g. owner/repo
            };
        }
    } catch {
        return null;
    }
    return null;
}

// Track active tab to know which repo we are looking at
async function updateActiveRepo() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs[0] || !tabs[0].url) return;

    const repo = parseGitHubUrl(tabs[0].url);
    if (repo) {
        await chrome.storage.local.set({ activeRepo: repo });
        console.log("Active repo updated:", repo.key);
        // Immediately check when entering a new repo
        await checkActiveRepoPRs(repo);
    } else {
        await chrome.storage.local.remove('activeRepo');
    }
}

// Listen for tab focus/updates to update active repo context
chrome.tabs.onActivated.addListener(updateActiveRepo);
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.active) {
        updateActiveRepo();
    }
});

// Polling and Detection Logic
async function checkActiveRepoPRs(forceRepo = null) {
    const data = await chrome.storage.local.get(['activeRepo', 'mutedRepos', 'ghToken', 'etags', 'lastState']);
    const activeRepo = forceRepo || data.activeRepo;
    const mutedRepos = data.mutedRepos || {};
    const etags = data.etags || {};
    const lastState = data.lastState || {};
    const ghToken = data.ghToken;

    // Quit if no repo active or if the user muted this specific repo
    if (!activeRepo || mutedRepos[activeRepo.key]) return;

    console.log(`Polling PRs for: ${activeRepo.key}`);

    const headers = { "Accept": "application/vnd.github+json" };
    if (ghToken) headers["Authorization"] = `Bearer ${ghToken}`;
    if (etags[activeRepo.key]) headers["If-None-Match"] = etags[activeRepo.key];

    try {
        // Fetch last 30 recently updated PRs in the current repo
        const url = `https://api.github.com/repos/${activeRepo.owner}/${activeRepo.name}/pulls?state=all&sort=updated&direction=desc&per_page=30`;
        const res = await fetch(url, { headers });

        if (res.status === 304) {
             console.log(`Status 304: No new PR changes for ${activeRepo.key}.`);
             return; // State hasn't changed.
        }
        if (!res.ok) {
            console.error(`GitHub API Error: ${res.status}`);
            return;
        }

        const pulls = await res.json();
        const nextState = {};
        const events = [];
        const prev = lastState[activeRepo.key] || {};

        for (const pr of pulls) {
            const curr = {
                state: pr.state,
                merged_at: pr.merged_at,
                headSha: pr.head?.sha,
                updated_at: pr.updated_at
            };
            nextState[pr.number] = curr;

            // Only evaluate events if we have a previous snapshot
            // (Avoids massive notification storm on first ever run)
            if (Object.keys(prev).length > 0) {
                if (!prev[pr.number]) {
                    // Make sure it is actually 'new' and not an old PR that un-paged into top 30
                    const ageMs = Date.now() - new Date(pr.created_at).getTime();
                    if (ageMs < 10 * 60 * 1000) { // < 10 mins old
                        events.push({ type: 'opened', pr: pr });
                    }
                } else {
                    const p = prev[pr.number];
                    if (p.state === 'closed' && curr.state === 'open') {
                        events.push({ type: 'reopened', pr: pr });
                    }
                    if (p.headSha && curr.headSha && p.headSha !== curr.headSha) {
                        events.push({ type: 'synchronized', pr: pr });
                    }
                    if (!p.merged_at && curr.merged_at) {
                        events.push({ type: 'merged', pr: pr });
                    }
                }
            }
        }

        // Cache the ETags and State mapping for the next poll
        await chrome.storage.local.set({
            etags: { ...etags, [activeRepo.key]: res.headers.get("ETag") || etags[activeRepo.key] },
            lastState: { ...lastState, [activeRepo.key]: nextState }
        });

        // Broadcast non-intrusive notifications
        if (events.length > 0) {
            console.log("Detected New PR Events:", events);
            
            // 1. Badge notification
            await chrome.action.setBadgeText({ text: String(Math.min(events.length, 99)) });
            await chrome.action.setBadgeBackgroundColor({ color: "#2563eb" });

            // 2. System notification (OS specific)
            const eventDescriptions = events.slice(0, 3).map(e => `#${e.pr.number} ${e.type}`).join('\n');
            let remaining = events.length > 3 ? `\n...and ${events.length - 3} more` : '';
            
            chrome.notifications.create({
                type: 'basic',
                iconUrl: 'icons/icon.png', // Fallback to extension default icon if we omit creating this later
                title: `${activeRepo.name}: ${events.length} PR update(s)`,
                message: eventDescriptions + remaining
            });
        }
    } catch (e) {
        console.error("Background PR poll error:", e);
    }
}

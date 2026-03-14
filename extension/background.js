// background.js - Listens to content.js and talks to your Python Server

// Change this to your exact ngrok URL!
const API_URL = "http://localhost:8000/api/extension/review";

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "SCAN_DIFF") {
        
        // This is where we send the code to your Python FastAPI server
        fetch(API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ diff: request.diff })
        })
        .then(res => res.json())
        .then(data => sendResponse({ findings: data }))
        .catch(err => {
            console.error("Sonic-Guard API Error:", err);
            sendResponse({ findings: [] });
        });
        
        // Tells Chrome we will send the response asynchronously (await)
        return true; 
    }
});

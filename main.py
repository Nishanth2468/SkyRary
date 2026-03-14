"""
main.py — FastAPI application
The single entry point for Sonic-Guard.

Endpoints:
  POST /webhook/github  ← receives GitHub PR webhook events
  GET  /health          ← quick health check for demo
"""

import asyncio
import hashlib
import hmac
import os

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, BackgroundTasks
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()

from agents.code_review import run_code_review_agent
from agents.security import run_security_agent
from agents.summary import run_summary_agent
from github_client import get_pr_diff, post_pr_comment, delete_previous_bot_comments

app = FastAPI(title="Sonic-Guard", version="1.0.0")

# Allow requests from the Chrome Extension playing on github.com
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class DiffRequest(BaseModel):
    diff: str

WEBHOOK_SECRET = os.getenv("GITHUB_WEBHOOK_SECRET", "")


# ──────────────────────────────────────────────────────────────────
# Webhook signature verification
# ──────────────────────────────────────────────────────────────────

def verify_github_signature(payload_bytes: bytes, signature_header: str | None) -> bool:
    """
    Verify the X-Hub-Signature-256 header from GitHub.
    This ensures the webhook is actually from GitHub, not a spoofed request.
    Returns True if valid (or if no webhook secret is configured).
    """
    if not WEBHOOK_SECRET:
        # No secret set — skip verification (ok for local dev/demo)
        return True
    if not signature_header or not signature_header.startswith("sha256="):
        return False
    expected = "sha256=" + hmac.new(
        WEBHOOK_SECRET.encode(), payload_bytes, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature_header)


# ──────────────────────────────────────────────────────────────────
# Core review pipeline
# ──────────────────────────────────────────────────────────────────

async def run_review_pipeline(repo_full_name: str, pr_number: int) -> None:
    """
    Full pipeline: fetch diff → run agents in parallel → post comment.
    Runs in background so the webhook endpoint returns 200 immediately.
    """
    print(f"\n[Pipeline] Starting review for {repo_full_name}#{pr_number}")

    try:
        # Step 1: Fetch PR diff from GitHub
        diff, files_changed, pr_title, author = get_pr_diff(repo_full_name, pr_number)
        print(f"[Pipeline] Fetched diff: {len(diff)} chars, {files_changed} files")

        if not diff:
            print("[Pipeline] Empty diff — skipping review")
            return

        # Step 2: Run Code Review + Security agents in PARALLEL
        code_task = asyncio.create_task(
            asyncio.to_thread(run_code_review_agent, diff)
        )
        security_task = asyncio.create_task(
            asyncio.to_thread(run_security_agent, diff)
        )
        code_findings, security_findings = await asyncio.gather(
            code_task, security_task
        )
        print(f"[Pipeline] Code findings: {len(code_findings)}, Security findings: {len(security_findings)}")

        # Step 3: Summary Agent merges everything into one Markdown comment
        comment = run_summary_agent(
            code_findings=code_findings,
            security_findings=security_findings,
            pr_title=pr_title,
            files_changed=files_changed,
            author=author,
        )

        # Step 4: Delete old Sonic-Guard comment (if PR was updated) and post new one
        delete_previous_bot_comments(repo_full_name, pr_number)
        success = post_pr_comment(repo_full_name, pr_number, comment)

        if success:
            print(f"[Pipeline] ✅ Review complete for {repo_full_name}#{pr_number}")
        else:
            print(f"[Pipeline] ❌ Failed to post comment")

    except Exception as e:
        print(f"[Pipeline] ❌ Error: {type(e).__name__}: {e}")


# ──────────────────────────────────────────────────────────────────
# GitHub Webhook endpoint
# ──────────────────────────────────────────────────────────────────

@app.post("/webhook/github")
async def github_webhook(request: Request, background_tasks: BackgroundTasks):
    """
    Receives GitHub pull_request events.
    Responds with 200 immediately, then runs review in the background.
    GitHub requires a response within 10 seconds or it marks the webhook as failed.
    """
    # Read raw body (needed for signature verification before JSON parsing)
    payload_bytes = await request.body()

    # Verify the request is genuinely from GitHub
    signature = request.headers.get("X-Hub-Signature-256")
    if not verify_github_signature(payload_bytes, signature):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    # Only handle pull_request events
    event_type = request.headers.get("X-GitHub-Event", "")
    if event_type != "pull_request":
        return JSONResponse({"status": "ignored", "reason": f"Event type '{event_type}' not handled"})

    # Parse JSON payload
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    action = payload.get("action", "")
    print(f"[Webhook] Received pull_request.{action}")

    # Only analyze on PR open or new commits pushed
    if action not in ("opened", "synchronize", "reopened"):
        return JSONResponse({"status": "ignored", "reason": f"Action '{action}' not analyzed"})

    # Extract PR details
    pr_number = payload["number"]
    repo_full_name = payload["repository"]["full_name"]

    print(f"[Webhook] Queuing review for {repo_full_name}#{pr_number}")

    # Run review in background — return 200 immediately to GitHub
    background_tasks.add_task(run_review_pipeline, repo_full_name, pr_number)

    return JSONResponse({
        "status": "accepted",
        "pr": pr_number,
        "repo": repo_full_name,
        "message": "Review queued"
    })


# ──────────────────────────────────────────────────────────────────
# Chrome Extension API Endpoint
# ──────────────────────────────────────────────────────────────────

@app.post("/api/extension/review")
async def extension_review(request: DiffRequest):
    """
    Receives code diff directly from the Chrome Extension.
    Runs agents and returns JSON immediately (does not post to GitHub).
    """
    diff = request.diff
    if not diff:
        return []
        
    print(f"[Extension] Receiving {len(diff)} chars to scan...")
    
    code_task = asyncio.create_task(asyncio.to_thread(run_code_review_agent, diff))
    security_task = asyncio.create_task(asyncio.to_thread(run_security_agent, diff))
    code_findings, security_findings = await asyncio.gather(code_task, security_task)
    
    all_findings = code_findings + security_findings
    print(f"[Extension] Returning {len(all_findings)} total findings to Chrome")
    
    return all_findings


# ──────────────────────────────────────────────────────────────────
# Health check
# ──────────────────────────────────────────────────────────────────

@app.get("/health")
async def health_check():
    """Quick health check — useful for demo to show the server is alive."""
    provider = os.getenv("LLM_PROVIDER", "gemini")
    return {
        "status": "ok",
        "service": "Sonic-Guard",
        "llm_provider": provider,
        "github_token_set": bool(os.getenv("GITHUB_TOKEN")),
    }


# ──────────────────────────────────────────────────────────────────
# Dev entrypoint
# ──────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    print("🛡️  Starting Sonic-Guard...")
    print(f"   LLM Provider : {os.getenv('LLM_PROVIDER', 'gemini')}")
    print(f"   Webhook URL  : http://localhost:8000/webhook/github")
    print(f"   Health check : http://localhost:8000/health")
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

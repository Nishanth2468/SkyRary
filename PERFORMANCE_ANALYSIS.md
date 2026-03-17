# Performance and Scalability Analysis: Sonic-Guard

This document analyzes the current architecture of Sonic-Guard under high-throughput production load, identifies bottlenecks, and suggests improvements with concrete code examples.

## 1. Bottlenecks and Blocking I/O

### Blocking I/O in the FastAPI Event Loop
The `run_review_pipeline` uses `asyncio.to_thread` for running the agents because the underlying LLM calls and GitHub API calls are completely synchronous. While `asyncio.to_thread` offloads work to the default `ThreadPoolExecutor`, under high load (e.g., hundreds of concurrent PRs), the thread pool will quickly exhaust, causing new requests to queue up indefinitely and delaying responses.

The `get_pr_diff`, `post_pr_comment`, and `delete_previous_bot_comments` functions in `github_client.py` use the synchronous `PyGithub` library. These are executed directly in the main `run_review_pipeline` coroutine, which blocks the asyncio event loop.

### Subprocess Blocking
In `agents/security.py`, `subprocess.run` is used synchronously. This completely blocks the thread executing `run_security_agent`.

### In-Memory Background Tasks
The FastAPI `BackgroundTasks` queue stores tasks entirely in memory. If the server crashes, all queued PR reviews are permanently lost. Additionally, this approach cannot be scaled horizontally; if you spin up 5 instances of the application, there's no way to distribute the webhook payload fairly.

### Slow Functions
The LLM API calls in `llm_client.py` (`_call_gemini`, `_call_anthropic`) are synchronous and often slow (5-15 seconds).
The Semgrep scan in `agents/security.py` can be slow for large diffs.

## 2. Scalability Limitations

*   **Stateless Scaling:** Because tasks are kept in FastAPI memory, deploying behind a load balancer with multiple pods means background tasks cannot be shared.
*   **Rate Limiting:** There is no backoff or retry mechanism for GitHub API rate limits or LLM provider rate limits (e.g., 429 Too Many Requests).
*   **Data Structures:** The current system reads the entire diff into memory. Extremely large PRs could lead to Out Of Memory (OOM) errors.
*   **Missing Caching:** If a PR gets updated, the entire diff is scanned again. There's no caching of unchanged files or previously resolved Semgrep findings.

## 3. Recommended Improvements & Code Examples

### A. Async Processing (Fully Non-Blocking I/O)

Replace synchronous libraries with their async counterparts to avoid thread pool exhaustion.

**1. Async GitHub Client:**
Replace `PyGithub` with an async HTTP client like `httpx` or an async wrapper like `gidgethub`.

```python
# github_client_async.py
import httpx
import os

async def get_pr_diff_async(repo_full_name: str, pr_number: int) -> str:
    token = os.environ.get("GITHUB_TOKEN")
    url = f"https://api.github.com/repos/{repo_full_name}/pulls/{pr_number}"

    async with httpx.AsyncClient() as client:
        # Request diff format from GitHub
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github.v3.diff"
        }
        response = await client.get(url, headers=headers)
        response.raise_for_status()
        return response.text
```

**2. Async LLM Clients:**
Both Anthropic and Google provide native async clients.

```python
# llm_client_async.py
import os
import anthropic

async def _call_anthropic_async(prompt: str, max_tokens: int) -> str:
    client = anthropic.AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    message = await client.messages.create(
        model="claude-3-5-haiku-20241022",
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}],
    )
    return message.content[0].text.strip()
```

**3. Async Subprocess for Semgrep:**
Use `asyncio.create_subprocess_exec` so Semgrep doesn't block the thread.

```python
# agents/security_async.py
import asyncio
import json

async def _run_semgrep_async(tmp_path: str) -> list[dict]:
    process = await asyncio.create_subprocess_exec(
        "semgrep", "--config=p/owasp-top-ten", "--config=p/secrets", "--json", "--quiet", tmp_path,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )

    stdout, stderr = await process.communicate()

    if stdout:
        data = json.loads(stdout.decode())
        return data.get("results", [])
    return []
```

### B. Distributed Queue Systems & Background Workers

Replace FastAPI's `BackgroundTasks` with **Celery** and **Redis** (or RabbitMQ). This provides durability and allows horizontal scaling of workers.

```python
# celery_app.py
from celery import Celery

celery_app = Celery(
    "sonic_guard",
    broker="redis://localhost:6379/0",
    backend="redis://localhost:6379/1"
)

@celery_app.task(bind=True, max_retries=3)
def process_pr_review(self, repo_full_name: str, pr_number: int):
    try:
        # Run the entire pipeline synchronously in the worker process
        # Or use celery.IsolatedAsyncioRunner for async code in celery 4+
        pass
    except Exception as exc:
        # Handles rate limits gracefully
        raise self.retry(exc=exc, countdown=2 ** self.request.retries)
```

**FastAPI integration:**
```python
# main.py
from celery_app import process_pr_review

@app.post("/webhook/github")
async def github_webhook(request: Request):
    # ... validation logic ...

    # Push to Redis queue instead of local memory
    process_pr_review.delay(repo_full_name, pr_number)

    return {"status": "accepted"}
```

### C. Caching Mechanism

Implement Redis caching to avoid re-scanning files that haven't changed between commits in a PR.

```python
# cache.py
import redis
import hashlib

redis_client = redis.Redis(host='localhost', port=6379, db=0)

def hash_file_content(content: str) -> str:
    return hashlib.sha256(content.encode()).hexdigest()

def get_cached_review(file_hash: str):
    result = redis_client.get(f"review:{file_hash}")
    return json.loads(result) if result else None

def set_cached_review(file_hash: str, findings: list):
    # Cache for 7 days
    redis_client.setex(f"review:{file_hash}", 604800, json.dumps(findings))
```

### D. Better Data Structures (Streaming Diffs)

For massive PRs, loading the entire diff string into memory `diff.splitlines()` can cause memory spikes. Instead, process the diff as a stream or chunk it by file.

```python
# Processing diff iteratively by file rather than loading the whole string
def process_diff_by_file(diff_stream):
    current_file = []
    filename = ""

    for line in diff_stream:
        if line.startswith("diff --git"):
            if current_file:
                yield filename, "".join(current_file)
            current_file = []
            filename = extract_filename(line)
        current_file.append(line)

    if current_file:
        yield filename, "".join(current_file)
```

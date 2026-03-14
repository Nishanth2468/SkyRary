# 🛡️ Sonic-Guard Tech Stack Details

Sonic-Guard is designed to be an ultra-lean, powerful, and easy-to-demo **Autonomous AI Agent System** for Code Repository Management. It requires zero complex infrastructure (no databases, no message queues, no containers needed for local dev) and runs entirely via webhook triggers.

Here is a detailed breakdown of the complete technology stack used to build and run this version.

---

## 1. Core Application Framework

*   **Language:** Python 3.11+
    *   *Why:* Python has the most mature ecosystem for AI (Google SDKs, Anthropic SDKs, LangChain) and is extremely fast to build with for hackathons.
*   **Web Framework:** FastAPI (`fastapi`, `uvicorn`)
    *   *Why:* Built-in support for asynchronous programming (`async`/`await`), automatic documentation generation (`/docs`), and extreme performance. We need async to run multiple AI agents simultaneously.
*   **Background Tasks:** FastAPI `BackgroundTasks`
    *   *Why:* GitHub requires webhooks to return a `200 OK` response within 10 seconds, or it marks them as failed. Sonic-Guard returns `200 OK` instantly and processes the PR review asynchronously in the background.

## 2. Artificial Intelligence Layer

*   **Primary LLM Engine:** Google Gemini (`gemini-2.5-flash` model) via `google-generativeai` SDK
    *   *Why:* Google's newest and fastest flash model. It's multi-modal, has huge context windows (meaning it can read massive PR diffs easily), and importantly: **it offers a completely free tier**, which makes it ideal for student hackathons.
*   **Fallback LLM Engine:** Anthropic Claude (`claude-3-5-haiku-20241022` model) via `anthropic` SDK
    *   *Why:* Claude Models are generally the industry standard for reasoning and coding tasks. If Gemini quota is exceeded, the system can instantly switch to Claude via the `LLM_PROVIDER=anthropic` environment variable.
*   **Integration Approach:** Direct SDK calls (No LangChain)
    *   *Why:* For an MVP, bypassing heavy frameworks like LangChain or LangGraph reduces complexity, prevents "prompt abstraction" bugs, and keeps the code incredibly lean (`llm_client.py` is under 50 lines).

## 3. Multi-Agent System (3 Agents)

Sonic-Guard implements a simple but effective multi-agent pattern where agents run in parallel and then combine their results.

*   **🔍 Code Review Agent** (`agents/code_review.py`)
    *   *Role:* LLM-powered static analysis. Reads the unified PR diff and looks for logic bugs, anti-patterns, and bad practices.
*   **🔒 Security Agent** (`agents/security.py`)
    *   *Role:* Hybrid SAST (Static Application Security Testing).
    *   *Operation:* It uses deterministic tools (`semgrep` and regex) *before* the LLM. It only queries the LLM if vulnerabilities actually exist, saving massive amounts of API tokens on clean PRs.
*   **📝 Summary Agent** (`agents/summary.py`)
    *   *Role:* The "Orchestrator". It waits for Code Review and Security agents to finish, then uses the LLM to format their raw JSON findings into a beautiful, human-readable GitHub Markdown comment.

*   **Parallel Execution:** `asyncio.gather()`
    *   *Why:* Instead of running agents sequentially (which would take ~30 seconds), they run at the exact same time, cutting total review latency down to ~12-15 seconds.

## 4. Repository Integration (GitHub)

*   **GitHub API Client:** PyGithub (`PyGithub`)
    *   *Why:* The standard Python library for interacting with the GitHub REST API.
*   **Authentication:** GitHub Personal Access Token (PAT)
    *   *Why:* For an MVP, using a PAT avoids the massive complexity of setting up a full GitHub App with OAuth flows.
*   **Action Trigger:** GitHub Webhooks
    *   *Why:* The instant a pull request is opened or updated, GitHub sends a JSON payload via HTTP POST to our `/webhook/github` endpoint.
*   **Security Validation:** HMAC SHA-256 Signatures
    *   *Why:* Verifies the `X-Hub-Signature-256` header to ensure that the webhook requests are actually coming from GitHub and not a malicious source.

## 5. Security & Static Analysis Tooling

*   **SAST Engine:** Semgrep (`semgrep`)
    *   *Why:* Open-source, insanely fast, rule-based static analysis engine. We run it locally against the diff using OWASP Top 10 rules. This catches standard vulnerabilities instantly without needing an LLM.
*   **Secret Detection:** Python Regular Expressions (`re`)
    *   *Why:* Hardcoded API keys (AWS, GitHub, OpenAI) follow standard formats. Regex catches these perfectly with zero latency and zero LLM cost.

## 6. Local Development & Deployment Tools

*   **Environment Management:** `python-dotenv`
    *   *Why:* Securely loads API keys from `.env` without hardcoding them into the repository.
*   **Local Webhook Tunneling:** Ngrok (`ngrok`)
    *   *Why:* GitHub needs a public URL to send webhooks to. Ngrok creates a secure tunnel from `https://xxxx.ngrok.io` directly to your `localhost:8000`.
*   **Containerization (Optional):** Docker & Docker Compose (`Dockerfile`, `docker-compose.yml`)
    *   *Why:* Ensures the project runs exactly the same on every developer's machine and is ready for remote deployment (e.g., AWS EC2, DigitalOcean, or Render) without dependency hell.

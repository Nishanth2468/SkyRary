# 🛡️ Sonic-Guard: Autonomous AI Agents for Code Repository Management

## 1. PROJECT SUMMARY

**Sonic-Guard** is an advanced, multi-agent AI system that automatically reviews, analyzes, and secures pull requests (PRs) in software repositories. Unlike traditional tools that force developers to switch context to an external dashboard or wait for CI/CD pipelines to finish, Sonic-Guard is delivered partially via a **Chrome Browser Extension**. This allows it to inject rich, intelligent, and context-aware feedback *inline* directly onto the GitHub or GitLab PR interface the moment a developer opens it.

### The Problem It Solves
Modern code reviews are a massive bottleneck. Senior developers spend hours reading diffs just to catch basic logic errors or stylistic issues, while automated static analysis tools (SAST) often produce noisy, context-blind false positives. Security and dependency checks are usually buried in pipeline logs, ignored until the branch is blocked.

### Why Sonic-Guard is Unique
*   **SonarQube / Checkmarx:** Excellent at deterministic rule-matching, but lacks human-like semantic understanding. *Sonic-Guard uses Semgrep for speed, but passes hits to an LLM to filter false positives and generate human-readable explanations.*
*   **Dependabot / Snyk:** Recommends version bumps for vulnerable dependencies but cannot rewrite your internal code to handle breaking API changes. *Sonic-Guard's autonomous agents can suggest exact diffs to fix breaking changes.*
*   **CodeRabbit:** Operates entirely asynchronously via GitHub comments. *Sonic-Guard's Chrome Extension injects its UI directly into the browser DOM, allowing developers to interact with the AI inline, in real-time.*

---

## 2. COMPLETE WORKFLOW

The workflow spans the browser, the backend, and asynchronous worker queues, ensuring massive diffs don't block the UI.

1. **Trigger:** Developer navigates to a GitHub PR page or creates a new one.
2. **Context Extraction:** The Chrome Extension's Content Script detects the PR page, scrapes the current unified diff, file metadata, and base/head commit hashes.
3. **API Submission:** The extension sends a securely authenticated `POST` request to the FastAPI backend at `/api/v1/review/start`.
4. **Orchestration:** The FastAPI backend receives the diff. It uses `LangGraph` to initialize the Orchestrator Agent.
5. **Parallel Analysis:** The Orchestrator pushes the payload to Celery. Celery fans out the workload across Redis to 5 distinct specialized AI Agents running simultaneously.
6. **Synthesis:** Once all 5 sub-agents finish, the Orchestrator Agent aggregates the JSON results, resolves any conflicting advice, and drops duplicate findings.
7. **Delivery:** The backend streams the final JSON payload via WebSockets (or HTTP polling) back to the Chrome Extension.
8. **Inline Injection:** The Extension parses the JSON and manipulates the GitHub DOM, rendering beautiful warning boxes and fix suggestions directly beneath the affected lines of code.

```text
+-----------------------+          +-----------------------+
|  GitHub / GitLab PR   |          |  React Dashboard UX   |
|  (User's Browser)     |          |  (Metrics & Settings) |
+-----------^-----------+          +-----------^-----------+
            |                                  |
    Chrome Extension                           |
   (Content Injection)                         |
            |                                  |
            v                                  v
+----------------------------------------------------------+
|                       FastAPI Gateway                    |
|                (Auth, WebSockets, Rate Limits)           |
+---------------------------+------------------------------+
                            |
+---------------------------v------------------------------+
|                     LangGraph Router                     |
|                   (Orchestrator Agent)                   |
+---------------------------+------------------------------+
                            | (Celery + Redis Fan-out)
    +---------------+-------+-------+---------------+
    |               |               |               |
+---v---+       +---v---+       +---v---+       +---v---+
| Code  |       |  Sec  |       |  Doc  |       | Impr- |
| Agent |       | Agent |       | Agent |       | ove   |
+-------+       +-------+       +-------+       +-------+
    |               |                               |
(Pylint)        (Semgrep)                      (Dependency
                                                 Scanner)
```

---

## 3. MULTI-AGENT ARCHITECTURE

The backend uses a distributed multi-agent framework powered by **LangGraph**, relying on Claude 3.5 Sonnet / Gemini 2.0 Pro for reasoning tasks, and Haiku / Flash for summarization.

### 1. Orchestrator Agent
*   **Responsibility:** Distributes the code diff to specialist agents, tracks their progress, aggregates JSON outputs, and runs the conflict-resolution prompt.
*   **Input:** Raw PR diff, project language.
*   **Output:** Consolidated, deduplicated JSON array of final findings.
*   **Model:** `claude-3-5-sonnet-20241022` (High reasoning needed for conflict resolution).
*   **Conflict Resolution:** If the Security Agent flags a line as "Remove this variable" but the Documentation Agent flags it as "Add a docstring to this variable", the Orchestrator intelligently drops the documentation request because deletion takes precedence.

### 2. Code Review Agent
*   **Responsibility:** Finds logic bugs, off-by-one errors, race conditions, and severe anti-patterns.
*   **Input:** PR diff.
*   **Output:** JSON list of logic vulnerabilities.
*   **Model:** `claude-3-5-sonnet-20241022`.

### 3. Security Agent
*   **Responsibility:** Identifies injection flaws, hardcoded secrets, and insecure cryptographic practices. It uses deterministic tools *before* querying the LLM to save tokens.
*   **Input:** Diff, Semgrep JSON output, Regex secret-scanner output.
*   **Output:** JSON list of normalized security threats.
*   **Model:** `gemini-2.5-flash` (synthesizes Semgrep logs rapidly).

### 4. Documentation Agent
*   **Responsibility:** Checks if complex logic additions lack comments, or if OpenAPI/Swagger docs drift from route definitions.
*   **Input:** PR diff + existing docstrings near changed lines.
*   **Output:** Suggestions for required comments.
*   **Model:** `gemini-2.5-flash`.

### 5. Dependency Agent
*   **Responsibility:** Monitors `package.json`, `requirements.txt`, or `go.mod` files for insecure or deprecated versions. 
*   **Input:** Diff of package manifests + Open Source Vulnerability (OSV) API database.
*   **Output:** Security advisories for new packages.
*   **Model:** Deterministic OSV lookup (No LLM required, pure Python logic).

### 6. Improvement / Style Agent
*   **Responsibility:** Suggests modern language features (e.g., using a list comprehension instead of a loop) and enforces DRY principles.
*   **Input:** PR diff.
*   **Output:** Code snippets demonstrating the suggested refactor.
*   **Model:** `claude-3-haiku` (Fast, highly capable at syntax translation).

---

## 4. COMPLETE TECH STACK

| Layer | Technology | Why We Chose It vs Alternatives |
| :--- | :--- | :--- |
| **LLM Provider** | Anthropic + Gemini SDKs | Direct SDK calls avoid the massive overhead and fragile prompts of heavy frameworks like AutoGen. Claude is best-in-class for code; Gemini Flash is essentially free and vast in context. |
| **Agent Routing** | LangGraph | Better than LangChain's legacy agents or pure Python arrays because it treats agent flows as state machines (Graphs), allowing cycles (e.g., "Agent 1 generated bad code, send back to Agent 1"). |
| **Backend API** | FastAPI (Python 3.11+) | Asynchronous by default. Outperforms Flask/Django for IO-bound tasks like waiting for 5 different LLM API calls and WebSocket streaming. |
| **Task Queue** | Celery + Redis | Handles long-running PR reviews (30s+). Alternative: FastAPI BackgroundTasks. Celery is chosen because it scales horizontally across multiple servers if GitHub traffic spikes. |
| **Extension UI** | React + Vite + Tailwind | React in content scripts allows for complex state management (collapsing/expanding AI comments inline). Vanilla JS gets messy when manipulating GitHub's highly reactive DOM. |
| **Dashboard** | Next.js (React) | Used for the web platform where engineering managers view repo-wide AI metrics. Much better SEO and routing than standard Vite SPA. |
| **Database** | PostgreSQL | Stores user org settings, webhook keys, and historical metrics. Chose over MongoDB because PR data is highly relational (User -> PR -> Reviews -> Agents). |
| **Static Analysis** | Semgrep | Open-source, significantly faster than SonarQube, runs locally without cloud dependencies, and defines rules in readable YAML. |

---

## 5. HOW EACH TECHNOLOGY IS IMPLEMENTED

### LangGraph (Agent Wiring)
We define a State object (a dictionary) containing `{"diff": str, "findings": list}`. Nodes in the graph represent our 5 specialist agents. An entry point pushes the diff to parallel edges reaching all 5 agents. The edges converge back to a `ReducerNode` (Orchestrator) which executes a final prompt to merge the findings.

### FastAPI Endpoints
*   `POST /api/v1/review/diff`: Accepts raw text diffs from the Chrome Extension. Pushes a job to Celery, and returns a `job_id`. 
*   `GET /api/v1/review/status/{job_id}`: Polling endpoint for the extension to retrieve the finished JSON report.
*   `POST /webhook/github`: Optional fallback hook required for the GitHub App integration if the user doesn't have the Extension installed.

### Chrome Extension 
*   **Background.js:** Manages authentication state (JWTs) securely.
*   **Content.js:** Uses `MutationObserver` to watch GitHub's DOM. When the `.js-diff-container` element loads, it reads the text, sends it via `chrome.runtime.sendMessage` to `background.js`, which securely proxies it to the FastAPI backend. It then injects `<div>` warning cards right below the `.blob-code-addition` rows.

### GitHub App Integration
Handles server-to-server auth. Users install the App on their repo to grant permissions. The backend stores the App Installation ID, actively rotates short-lived JWTs, and listens for GitHub's webhook payloads secured via `X-Hub-Signature-256`.

### OSV API + Semgrep
Before invoking LLMs, the backend writes the diff to a temporary file `/tmp/diff_snippet.py`. It executes `semgrep --config=p/owasp-top-ten  /tmp/diff_snippet.py --json`. If the diff changes `requirements.txt`, the backend parses the newly added libraries and executes HTTP GET requests against `https://api.osv.dev/v1/query`. Results are grouped and piped into the LLM prompts as context.

---

## 6. COMPLETE FILE & FOLDER STRUCTURE

```text
sonic-guard/
├── extension/                      # Chrome Browser Extension Source
│   ├── manifest.json               # V3 permissions and host matching rules
│   ├── vite.config.ts              # Bundles React into single files for Chrome
│   ├── src/
│   │   ├── background/index.ts     # Handles secure API calls and auth token storage
│   │   ├── content/index.tsx       # Scrapes GitHub DOM and renders React warning UI
│   │   ├── popup/Popup.tsx         # Quick menu when clicking extension icon
│   └── utils/github-dom.ts         # Helpers targeting specific GitHub CSS selectors
│
├── backend/                        # Python FastAPI & Agent Logic
│   ├── requirements.txt            # Python dependencies (fastapi, celery, google-genai)
│   ├── main.py                     # Web API endpoints, WebSockets, and webhook listeners
│   ├── celery_app.py               # Redis task queue configuration
│   ├── core/
│   │   ├── config.py               # Pydantic BaseSettings loading from .env
│   │   └── security.py             # Webhook HMAC validation and JWT verification
│   ├── agents/                     # The LangGraph Multi-Agent implementation
│   │   ├── orchestrator.py         # Merges, deduplicates, and resolves conflicts
│   │   ├── code_review.py          # LLM prompt logic for logic bugs
│   │   ├── security.py             # Semgrep execution and LLM synthesis
│   │   ├── docs_dep_style.py       # Minor agents combined (OSV checks, linters)
│   │   └── state.py                # TypedDict definitions for graph state
│   └── database/
│       ├── models.py               # SQLAlchemy ORM definitions (Users, Reviews)
│       └── session.py              # Async PostgreSQL connection pooling
│
├── dashboard/                      # Next.js Web App for Managers
│   ├── package.json                
│   ├── src/
│   │   ├── app/page.tsx            # Landing page and login
│   │   ├── app/dashboard/page.tsx  # Metrics overview (vulnerabilities caught over time)
│   │   └── components/charts.tsx   # Recharts.js visualizations
│
├── docker-compose.yml              # Spins up Postgres, Redis, Celery Worker, and FastAPI
└── .env.example                    # Template for all required credentials
```

---

## 7. API KEYS & EXTERNAL SERVICES

| Service | Purpose | Cost/Plan | Where It Lives |
| :--- | :--- | :--- | :--- |
| **Anthropic API** | `claude-3-5-sonnet` for Orchestration/Logic | Paid (via credits) | Backend `.env` ONLY |
| **Google Gemini API** | `gemini-2.5-flash` for Security Synthesis | Free Tier | Backend `.env` ONLY |
| **GitHub App ID & Secret** | Server-side OAuth and Webhook Auth | Free | Backend `.env` ONLY |
| **OSV API** | Checking `package.json` vulnerabilities | Free | No key required |

### `.env.example`

```bash
# --- BACKEND ENVIRONMENT (.env) ---
# NEVER ship these to the Chrome Extension

# Server Config
ENVIRONMENT=development
PORT=8000
FRONTEND_URL=http://localhost:3000

# AI Providers
ANTHROPIC_API_KEY=sk-ant-api03...
GEMINI_API_KEY=AIzaSyA...

# Github Integration
GITHUB_APP_IDENTIFIER=123456
GITHUB_WEBHOOK_SECRET=your_hmac_secret
GITHUB_PRIVATE_KEY_PATH=/certs/github_app.pem

# Databases
DATABASE_URL=postgresql+asyncpg://postgres:password@localhost/sonic
REDIS_URL=redis://localhost:6379/0
```

*Security Constraint:* The Chrome Extension must never contain LLM API keys. The Extension only securely stores an application-specific JWT acquired after the user logs in via GitHub OAuth to our platform. All heavy lifting happens on the backend servers.

---

## 8. IMPLEMENTATION ROADMAP

### Phase 1: MVP & Core "Brain" (Weeks 1-4)
*   **Deliverable:** A functional CLI/FastAPI backend that takes a hardcoded diff string, runs the LangGraph 6-agent system, and outputs an aggregated JSON of findings.
*   **Key Tasks:** Setup FastAPI, write LLM prompts for the agents, implement Semgrep subprocess wrappers, hardcode Gemini/Claude integrations.

### Phase 2: Browser Integration (Weeks 5-10)
*   **Deliverable:** The Chrome Extension fully replacing humans on GitHub.
*   **Key Tasks:** Develop the React content script. Map GitHub DOM selectors to inject specific floating `<div>` elements per line number. Establish secure API proxy via `background.js` to the FastAPI backend. Implement real-time scanning UI states.

### Phase 3: Enterprise Features & Scaling (Weeks 11-16)
*   **Deliverable:** Multi-tenant dashboard and CI/CD resilience.
*   **Key Tasks:** Stand up PostgreSQL and Redis. Integrate Celery to handle hundreds of concurrent developers. Build the Next.js Dashboard for repo-wide insights. Launch the official GitHub App to automatically comment on PRs if a developer forgets to use the Chrome extension.

---

## 9. TEAM ROLE BREAKDOWN

Assuming a squad of 4 software engineers.

**1. Lead AI Architect (Backend/Agents)**
*   *Owns:* `backend/agents/` and LangGraph wiring.
*   *Weeks 1-2:* Optimize the LLM prompts. Handle the context-window logic so large diffs don't crash Anthropic. Write the Orchestrator's conflict resolution logic.

**2. Backend & Integration Engineer (FastAPI/DB)**
*   *Owns:* `backend/main.py`, Database, Celery, and GitHub APIs.
*   *Weeks 1-2:* Stand up FastAPI. Create endpoints for the extension. Write the GitHub webhook parser (`X-Hub-Signature` verification) and handle OAuth token rotation.

**3. Frontend Engineer (Chrome Extension)**
*   *Owns:* `extension/`.
*   *Weeks 1-2:* Setup Vite for Manifest V3. Write the complex DOM parser to extract unified diffs directly from GitHub's React-based HTML without relying on API keys. Build the warning-box UI components.

**4. Full-Stack / DevOps Engineer (Dashboard & Infra)**
*   *Owns:* `dashboard/`, Docker setup, and deployment.
*   *Weeks 1-2:* Set up `docker-compose.yml` with Redis and Postgres. Implement Ngrok tunneling for local webhook testing. Configure local pre-commit hooks and lay the groundwork for the Next.js app.

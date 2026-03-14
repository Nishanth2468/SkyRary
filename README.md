# 🛡️ Sonic-Guard

> Autonomous AI agents that review GitHub pull requests and post feedback inline — automatically.

---

## What It Does

When a pull request is opened on GitHub, Sonic-Guard:
1. Fetches the code diff
2. Runs **3 AI agents in parallel**
3. Posts a single structured review comment directly on the PR

**Three agents:**
- 🔍 **Code Review Agent** — logic errors, anti-patterns, bad practices
- 🔒 **Security Agent** — Semgrep SAST + secret detection + OWASP checks
- 📝 **Summary Agent** — merges findings into one clean GitHub comment

---

## Local Setup (5 minutes)

### Step 1 — Get API Keys (free)

**Option A — Google Gemini (completely free, no credit card):**
1. Go to [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
2. Click "Create API Key" → copy it

**Option B — Anthropic Claude ($5 free credit):**
1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Sign up → API Keys → Create key

**GitHub Personal Access Token:**
1. Go to [github.com/settings/tokens](https://github.com/settings/tokens)
2. "Generate new token (classic)"
3. Select scope: `repo` (full)
4. Generate → copy token

---

### Step 2 — Clone and Configure

```bash
git clone <your-repo-url>
cd sonic-guard

# Create .env from template
cp .env.example .env

# Edit .env with your keys:
# GEMINI_API_KEY=your_key_here      (if using Gemini)
# GITHUB_TOKEN=ghp_your_token_here
# LLM_PROVIDER=gemini
```

---

### Step 3 — Install and Run

**Without Docker:**
```bash
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

**With Docker:**
```bash
docker-compose up --build
```

Server runs at: `http://localhost:8000`

---

### Step 4 — Test Agents Locally (no GitHub needed)

Before setting up webhooks, verify your LLM key works:

```bash
python test_agents.py
```

You should see findings printed for a sample diff with intentional bugs. ✅

---

### Step 5 — Expose to GitHub via ngrok

```bash
# Install ngrok: https://ngrok.com/download
ngrok http 8000
```

Copy the `https://xxxx.ngrok.io` URL — you need it for the webhook.

---

### Step 6 — Register GitHub Webhook

1. Go to your GitHub repo → **Settings → Webhooks → Add webhook**
2. Fill in:
   - **Payload URL:** `https://xxxx.ngrok.io/webhook/github`
   - **Content type:** `application/json`
   - **Secret:** paste the value from `GITHUB_WEBHOOK_SECRET` in your .env
   - **Events:** select "Pull requests" only
3. Click "Add webhook"

---

### Step 7 — Demo

1. Open a PR on your repo with some intentional issues (SQL string concat, hardcoded key)
2. Watch the terminal — you'll see the pipeline log in real-time
3. Refresh the GitHub PR page in ~25 seconds
4. See the Sonic-Guard comment appear automatically 🎉

---

## Project Structure

```
sonic-guard/
├── main.py               ← FastAPI app + webhook endpoint
├── llm_client.py         ← Gemini / Anthropic unified client
├── github_client.py      ← Fetch diffs, post comments
├── agents/
│   ├── code_review.py    ← Code Review Agent
│   ├── security.py       ← Security Agent (Semgrep + LLM)
│   └── summary.py        ← Summary Agent (final comment)
├── test_agents.py        ← Local test without GitHub
├── requirements.txt
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── .gitignore
```

---

## Cost

| Scale | PRs/month | Estimated Cost |
|-------|-----------|---------------|
| Demo | 50 | **$0** (free tiers) |
| Small team | 500 | ~$0.20 (Gemini free) |
| Hackathon | unlimited | **$0** with Gemini |

---

## Health Check

```bash
curl http://localhost:8000/health
```

```json
{
  "status": "ok",
  "service": "Sonic-Guard",
  "llm_provider": "gemini",
  "github_token_set": true
}
```

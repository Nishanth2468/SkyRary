"""
agents/code_review.py — Code Review Agent
Analyzes code diff for logic errors, bad practices, smells.
One LLM call. Returns list of finding dicts.
"""

import json
import re
from llm_client import call_llm


SYSTEM_CONTEXT = """You are a senior software engineer performing a code review.
Analyze the provided code diff and identify real issues only.
Respond ONLY with a valid JSON array — no markdown, no explanation, just JSON.
"""

PROMPT_TEMPLATE = """Review this code diff for issues:

```diff
{diff}
```

Return a JSON array of findings. Each finding must have exactly these fields:
- "severity": "HIGH" | "MEDIUM" | "LOW"
- "line": integer line number (use null if general)
- "file": filename string
- "issue": one clear sentence describing the problem
- "fix": one clear sentence with the recommended solution

Rules:
- Maximum 5 findings
- Only report genuine bugs, anti-patterns, or maintainability issues
- Skip minor style issues like missing spaces
- Skip anything already caught by linters
- If no issues found, return empty array: []

Example format:
[
  {{"severity": "HIGH", "line": 12, "file": "app.py", "issue": "Variable shadowing — local 'id' shadows built-in", "fix": "Rename to 'user_id' to avoid shadowing the built-in id()"}},
  {{"severity": "MEDIUM", "line": 5, "file": "app.py", "issue": "Bare except clause catches all exceptions including KeyboardInterrupt", "fix": "Replace 'except:' with 'except Exception as e:'"}}
]
"""


def _extract_json(text: str) -> list:
    """Robustly extract JSON array from LLM response even if wrapped in markdown."""
    # Try direct parse first
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # Try extracting from markdown code fence
    match = re.search(r"```(?:json)?\s*(\[.*?\])\s*```", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass
    # Try finding first [ ... ] block
    match = re.search(r"\[.*\]", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass
    return []


def run_code_review_agent(diff: str) -> list[dict]:
    """
    Run the Code Review Agent on a unified diff string.

    Args:
        diff: Unified diff string from GitHub (all changed files combined)
    Returns:
        List of finding dicts with keys: severity, line, file, issue, fix
    """
    if not diff or len(diff.strip()) < 20:
        return []

    # Truncate very large diffs to keep token usage low
    # ~200 lines is enough for meaningful review
    diff_lines = diff.splitlines()
    if len(diff_lines) > 200:
        diff = "\n".join(diff_lines[:200])
        diff += "\n\n[... diff truncated for brevity ...]"

    prompt = SYSTEM_CONTEXT + PROMPT_TEMPLATE.format(diff=diff)

    try:
        response = call_llm(prompt, max_tokens=800)
        findings = _extract_json(response)
        # Validate each finding has required fields
        valid = []
        for f in findings:
            if all(k in f for k in ("severity", "issue", "fix")):
                f.setdefault("line", None)
                f.setdefault("file", "unknown")
                valid.append(f)
        return valid
    except Exception as e:
        print(f"[CodeReviewAgent] Error: {e}")
        return []

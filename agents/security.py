"""
agents/security.py — Security Agent
Uses Semgrep (free/open-source) for SAST + regex for secrets.
Only calls LLM if Semgrep or regex finds something — saves tokens on clean PRs.
"""

import json
import os
import re
import subprocess
import tempfile
from llm_client import call_llm


# Regex patterns for common hardcoded secrets in added lines
SECRET_PATTERNS = [
    (r'(?i)(api[_-]?key|apikey)\s*[=:]\s*["\']([A-Za-z0-9+/\-_]{16,})["\']', "Hardcoded API key"),
    (r'(?i)(password|passwd|pwd)\s*[=:]\s*["\'](.{6,})["\']', "Hardcoded password"),
    (r'(?i)(secret|token)\s*[=:]\s*["\']([A-Za-z0-9+/\-_]{16,})["\']', "Hardcoded secret/token"),
    (r'sk-[A-Za-z0-9]{32,}', "Exposed OpenAI API key"),
    (r'sk-ant-[A-Za-z0-9\-_]{90,}', "Exposed Anthropic API key"),
    (r'ghp_[A-Za-z0-9]{36}', "Exposed GitHub Personal Access Token"),
    (r'AKIA[0-9A-Z]{16}', "Exposed AWS Access Key ID"),
]

LLM_SYNTHESIS_PROMPT = """You are a security analyst. Below are raw findings from automated security tools 
scanning a code diff. Summarize and explain each finding clearly for a developer.

SEMGREP FINDINGS:
{semgrep_results}

HARDCODED SECRETS DETECTED:
{secrets}

Respond ONLY with a valid JSON array. Each item must have:
- "severity": "CRITICAL" | "HIGH" | "MEDIUM"
- "line": integer or null
- "file": filename string or "unknown"
- "issue": one sentence describing the vulnerability
- "fix": one sentence with the fix (NEVER suggest disabling security checks)

Maximum 5 items. Remove duplicates. Return [] if no real issues.
"""


def _run_semgrep(diff: str) -> list[dict]:
    """Write diff to temp file and run Semgrep OWASP rules against it."""
    findings = []
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".py", delete=False
        ) as tmp:
            # Write only the added lines (strip the + prefix)
            added_lines = [
                line[1:] for line in diff.splitlines() if line.startswith("+")
            ]
            tmp.write("\n".join(added_lines))
            tmp_path = tmp.name

        result = subprocess.run(
            [
                "semgrep",
                "--config=p/owasp-top-ten",
                "--config=p/secrets",
                "--json",
                "--quiet",
                tmp_path,
            ],
            capture_output=True,
            timeout=30,
            text=True,
        )
        os.unlink(tmp_path)

        if result.stdout:
            data = json.loads(result.stdout)
            for r in data.get("results", []):
                findings.append({
                    "rule": r.get("check_id", "unknown"),
                    "line": r.get("start", {}).get("line"),
                    "message": r.get("extra", {}).get("message", ""),
                    "severity": r.get("extra", {}).get("severity", "WARNING"),
                })
    except subprocess.TimeoutExpired:
        print("[SecurityAgent] Semgrep timed out — skipping")
    except FileNotFoundError:
        print("[SecurityAgent] Semgrep not installed — skipping SAST")
    except Exception as e:
        print(f"[SecurityAgent] Semgrep error: {e}")
    return findings


def _check_secrets(diff: str) -> list[dict]:
    """Scan added lines for hardcoded secrets using regex."""
    secrets = []
    added_lines = [
        (i + 1, line[1:])
        for i, line in enumerate(diff.splitlines())
        if line.startswith("+") and not line.startswith("+++")
    ]
    for line_num, line in added_lines:
        for pattern, label in SECRET_PATTERNS:
            if re.search(pattern, line):
                secrets.append({
                    "line": line_num,
                    "label": label,
                    "snippet": line.strip()[:80],  # truncate for display
                })
                break  # one match per line is enough
    return secrets


def run_security_agent(diff: str) -> list[dict]:
    """
    Run the Security Agent on a PR diff.

    Returns:
        List of security finding dicts.
        Returns [] if no issues found (no LLM call made — saves tokens).
    """
    if not diff or len(diff.strip()) < 10:
        return []

    semgrep_findings = _run_semgrep(diff)
    secret_findings = _check_secrets(diff)

    # ✅ Key optimization: skip LLM entirely if nothing found
    if not semgrep_findings and not secret_findings:
        return []

    # Format for LLM synthesis
    semgrep_text = (
        json.dumps(semgrep_findings, indent=2)
        if semgrep_findings
        else "None detected"
    )
    secrets_text = (
        json.dumps(secret_findings, indent=2)
        if secret_findings
        else "None detected"
    )

    prompt = LLM_SYNTHESIS_PROMPT.format(
        semgrep_results=semgrep_text,
        secrets=secrets_text,
    )

    try:
        response = call_llm(prompt, max_tokens=600)
        # Reuse the same JSON extractor pattern
        import sys
        sys.path.insert(0, os.path.dirname(__file__))
        from code_review import _extract_json
        findings = _extract_json(response)
        valid = []
        for f in findings:
            if all(k in f for k in ("severity", "issue", "fix")):
                f.setdefault("line", None)
                f.setdefault("file", "unknown")
                valid.append(f)
        return valid
    except Exception as e:
        print(f"[SecurityAgent] LLM error: {e}")
        # Fall back to raw regex findings if LLM fails
        return [
            {
                "severity": "CRITICAL",
                "line": s["line"],
                "file": "unknown",
                "issue": f"{s['label']} detected in added code",
                "fix": "Move to environment variable using os.environ.get('KEY_NAME')",
            }
            for s in secret_findings
        ]

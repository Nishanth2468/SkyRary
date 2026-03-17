"""
agents/summary.py — Summary Agent
Merges findings from Code Review + Security agents into
a single polished GitHub PR comment in Markdown.
One LLM call. This is the only visible output of the system.
"""

from llm_client import call_llm

PROMPT_TEMPLATE = """You are a helpful code review assistant called Sonic-Guard.
Write a GitHub pull request review comment in Markdown.

PR TITLE: {pr_title}
FILES CHANGED: {files_changed}
AUTHOR: {author}

SECURITY FINDINGS (from automated scanner):
{security_findings}

CODE REVIEW FINDINGS (from AI analysis):
{code_findings}

Write a Markdown comment following this EXACT structure:

## 🛡️ Sonic-Guard Analysis — {verdict}

> {one_line_summary}

---

{security_section}

{code_section}

---
*🤖 Sonic-Guard · {total_count} finding(s) across {files_changed} file(s)*

Rules:
- verdict: "✅ Looks Good" if no HIGH/CRITICAL, "⚠️ Action Required" if any HIGH, "🚨 Critical Issues" if any CRITICAL
- one_line_summary: one sentence capturing the overall state
- If there are security findings, add a "### 🔴 Security Issues" section with bullet points
- If there are code findings, add a "### 🔍 Code Review" section with bullet points
- Each bullet: `**filename:line** — issue description` then `💡 **Fix:** suggestion`
- If you have suggested code for a fix, ALWAYS add it using a standard python markdown block beneath the fix description, so the user knows exactly what to type. Example:
```python
# Updated Code
def new_func(): ...
```
- Severity icons: 🔴 CRITICAL  🟠 HIGH  🟡 MEDIUM  🔵 LOW
- If a section has no findings, omit it entirely
- Keep total response under 500 words
- Friendly but direct tone — no fluff
"""

SEVERITY_ICON = {
    "CRITICAL": "🔴",
    "HIGH": "🟠",
    "MEDIUM": "🟡",
    "LOW": "🔵",
    "INFO": "⚪",
}


def _format_findings_for_prompt(findings: list[dict]) -> str:
    """Format findings list for inclusion in the LLM prompt."""
    if not findings:
        return "None"
    lines = []
    for f in findings:
        icon = SEVERITY_ICON.get(f.get("severity", "LOW"), "🔵")
        location = f.get('file', 'unknown')
        if f.get('line'):
            location += f":{f['line']}"
        
        finding_text = f"{icon} [{f.get('severity','?')}] {location} — {f.get('issue','?')} | Fix: {f.get('fix','?')}"
        if f.get('suggested_code'):
             finding_text += f"\n\nSuggested Code Replacement:\n```python\n{f['suggested_code']}\n```"
             
        lines.append(finding_text)
    return "\n".join(lines)


def run_summary_agent(
    code_findings: list[dict],
    security_findings: list[dict],
    pr_title: str,
    files_changed: int,
    author: str = "developer",
) -> str:
    """
    Produce the final GitHub PR review comment as a Markdown string.

    Args:
        code_findings: Output from code_review agent
        security_findings: Output from security agent
        pr_title: PR title string from GitHub API
        files_changed: Number of files changed in the PR
        author: PR author's GitHub username
    Returns:
        Markdown string ready to post as a GitHub comment
    """
    total = len(code_findings) + len(security_findings)

    # Determine overall verdict from severity levels
    all_findings = security_findings + code_findings
    severities = {f.get("severity", "LOW") for f in all_findings}
    if "CRITICAL" in severities:
        verdict = "🚨 Critical Issues"
    elif "HIGH" in severities:
        verdict = "⚠️ Action Required"
    else:
        verdict = "✅ Looks Good"

    prompt = PROMPT_TEMPLATE.format(
        pr_title=pr_title,
        files_changed=files_changed,
        author=author,
        security_findings=_format_findings_for_prompt(security_findings),
        code_findings=_format_findings_for_prompt(code_findings),
        verdict=verdict,
        total_count=total,
        security_section="",  # LLM fills this in
        code_section="",      # LLM fills this in
        one_line_summary="",  # LLM fills this in
    )

    # Edge case: no findings at all — skip LLM and return fast
    if total == 0:
        return (
            "## 🛡️ Sonic-Guard Analysis — ✅ Looks Good\n\n"
            "> No issues detected in this PR. Great work!\n\n"
            f"---\n*🤖 Sonic-Guard · 0 findings across {files_changed} file(s)*"
        )

    try:
        return call_llm(prompt, max_tokens=700)
    except Exception as e:
        print(f"[SummaryAgent] LLM error: {e}")
        # Fallback: generate basic comment without LLM
        lines = [f"## 🛡️ Sonic-Guard Analysis — {verdict}\n"]
        if security_findings:
            lines.append("### 🔴 Security Issues")
            for f in security_findings:
                lines.append(f"- **{f.get('file','?')}:{f.get('line','?')}** — {f.get('issue','?')}")
                lines.append(f"  💡 {f.get('fix','?')}")
        if code_findings:
            lines.append("\n### 🔍 Code Review")
            for f in code_findings:
                lines.append(f"- **{f.get('file','?')}:{f.get('line','?')}** — {f.get('issue','?')}")
                lines.append(f"  💡 {f.get('fix','?')}")
        lines.append(f"\n---\n*🤖 Sonic-Guard · {total} finding(s) across {files_changed} file(s)*")
        return "\n".join(lines)

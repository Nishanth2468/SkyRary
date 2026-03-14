"""
test_agents.py — Quick local test to verify agents work without GitHub.
Run:  python test_agents.py
"""

from agents.code_review import run_code_review_agent
from agents.security import run_security_agent
from agents.summary import run_summary_agent

# Sample diff with intentional issues for testing
SAMPLE_DIFF = """\
--- a/app.py
+++ b/app.py
@@ -1,10 +1,20 @@
+import os
+
+# BAD: hardcoded secret
+API_KEY = "sk-abc1234567890abcdef"
+
+def get_user(id):
+    # BAD: SQL injection
+    query = "SELECT * FROM users WHERE id = " + str(id)
+    result = db.execute(query)
+    return result
+
+def process(data):
+    try:
+        result = parse(data)
+    except:
+        pass
+    return None
"""


def run_test():
    print("=" * 60)
    print("🛡️  Sonic-Guard — Local Agent Test")
    print("=" * 60)

    print("\n[1/3] Running Code Review Agent...")
    code_findings = run_code_review_agent(SAMPLE_DIFF)
    print(f"  → Found {len(code_findings)} code issues")
    for f in code_findings:
        print(f"     {f.get('severity')} | line {f.get('line')} — {f.get('issue','')[:60]}")

    print("\n[2/3] Running Security Agent...")
    security_findings = run_security_agent(SAMPLE_DIFF)
    print(f"  → Found {len(security_findings)} security issues")
    for f in security_findings:
        print(f"     {f.get('severity')} | line {f.get('line')} — {f.get('issue','')[:60]}")

    print("\n[3/3] Running Summary Agent...")
    comment = run_summary_agent(
        code_findings=code_findings,
        security_findings=security_findings,
        pr_title="Add user authentication endpoint",
        files_changed=1,
        author="testuser",
    )

    print("\n" + "=" * 60)
    print("FINAL GITHUB COMMENT PREVIEW:")
    print("=" * 60)
    print(comment)
    print("=" * 60)
    print("\n✅ Test complete. If you see findings above, agents are working.")


if __name__ == "__main__":
    run_test()

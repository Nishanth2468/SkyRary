"""
github_client.py — GitHub API helpers using PyGithub.
Handles fetching PR diffs and posting review comments.
"""

import os
from github import Github, GithubException
from dotenv import load_dotenv

load_dotenv()

_github_client = None


def get_github_client() -> Github:
    """Return a shared GitHub client (lazy init)."""
    global _github_client
    if _github_client is None:
        token = os.environ.get("GITHUB_TOKEN")
        if not token:
            raise ValueError("GITHUB_TOKEN not set in environment")
        _github_client = Github(token)
    return _github_client


def get_pr_diff(repo_full_name: str, pr_number: int) -> tuple[str, int, str, str]:
    """
    Fetch the unified diff for a pull request.

    Args:
        repo_full_name: e.g. "owner/repository-name"
        pr_number: PR number (integer)

    Returns:
        Tuple of (diff_text, files_changed_count, pr_title, author_login)
    """
    g = get_github_client()
    repo = g.get_repo(repo_full_name)
    pr = repo.get_pull(pr_number)

    # Collect patches (unified diff) from each changed file
    diff_parts = []
    files = list(pr.get_files())

    for f in files:
        if f.patch:  # Some files (binary, deleted) may have no patch
            diff_parts.append(f"--- a/{f.filename}\n+++ b/{f.filename}")
            diff_parts.append(f.patch)

    diff_text = "\n".join(diff_parts)
    return diff_text, len(files), pr.title, pr.user.login


def post_pr_comment(repo_full_name: str, pr_number: int, comment: str) -> bool:
    """
    Post a comment on a GitHub pull request.

    Args:
        repo_full_name: e.g. "owner/repository-name"
        pr_number: PR number
        comment: Markdown string to post as comment

    Returns:
        True if successful, False otherwise
    """
    try:
        g = get_github_client()
        repo = g.get_repo(repo_full_name)
        pr = repo.get_pull(pr_number)
        pr.create_issue_comment(comment)
        print(f"[GitHub] Comment posted to {repo_full_name}#{pr_number}")
        return True
    except GithubException as e:
        print(f"[GitHub] Failed to post comment: {e.status} — {e.data}")
        return False


def delete_previous_bot_comments(repo_full_name: str, pr_number: int) -> None:
    """
    Delete any previous Sonic-Guard comments on this PR before posting new ones.
    Keeps the PR comments clean on re-runs (e.g. PR updated with new commits).
    """
    try:
        g = get_github_client()
        repo = g.get_repo(repo_full_name)
        pr = repo.get_pull(pr_number)
        for comment in pr.get_issue_comments():
            if "🛡️ Sonic-Guard" in comment.body:
                comment.delete()
                print(f"[GitHub] Deleted previous Sonic-Guard comment #{comment.id}")
    except GithubException as e:
        print(f"[GitHub] Could not clean old comments: {e}")

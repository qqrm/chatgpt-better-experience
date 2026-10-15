"""Verify bot or repository-owner provenance without granting automatic merge."""

import json
import os
import subprocess
from pathlib import Path


def verified_bot_commits(commits, head):
    return bool(commits) and commits[-1].get("sha") == head and all(
        (commit.get("author") or {}).get("login") == "dependabot[bot]"
        and verified_web_commit(commit)
        for commit in commits
    )


def verified_web_commit(commit):
    verification = commit.get("commit", {}).get("verification", {})
    return (
        (commit.get("committer") or {}).get("login") == "web-flow"
        and verification.get("verified") is True
        and verification.get("reason") == "valid"
    )


def verified_dependency_commits(commits, head, owner):
    """Allow an owner to adopt a bot PR; the write controller stays bot-only."""
    if not commits or commits[-1].get("sha") != head:
        return False
    owner_is_user = (
        owner.get("type") == "User"
        and type(owner.get("id")) is int
        and owner["id"] > 0
        and isinstance(owner.get("login"), str)
        and bool(owner["login"])
    )
    for commit in commits:
        if not verified_web_commit(commit):
            return False
        author = commit.get("author") or {}
        if author.get("login") == "dependabot[bot]":
            continue
        if not (
            owner_is_user
            and type(author.get("id")) is int
            and author["id"] == owner["id"]
            and author.get("login") == owner["login"]
        ):
            return False
    return True


def main():
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
    pr = event["pull_request"]
    repository = event["repository"]
    repository_id = repository.get("id")
    if not (
        type(repository_id) is int
        and repository_id > 0
        and (pr.get("head", {}).get("repo") or {}).get("id") == repository_id
        and (pr.get("base", {}).get("repo") or {}).get("id") == repository_id
    ):
        raise SystemExit("Dependency batches must use branches in this repository.")
    repo = repository["full_name"]
    endpoint = f"repos/{repo}/pulls/{pr['number']}/commits?per_page=100"
    pages = json.loads(subprocess.check_output(
        ["gh", "api", endpoint, "--paginate", "--slurp"], text=True
    ))
    commits = [commit for page in pages for commit in page]
    if not verified_dependency_commits(commits, pr["head"]["sha"],
                                       repository.get("owner") or {}):
        raise SystemExit("The checked batch must contain only GitHub-verified "
                         "Dependabot or repository-owner "
                         "commits and still match the event's head commit.")
    print("Dependency provenance verified. Owner-authored changes remain excluded "
          "from the bot-only automatic merge controller.")


if __name__ == "__main__":
    main()

"""Require the actual GitHub-managed JavaScript CodeQL analysis for this commit.

Default setup owns scanning. This read-only gate deliberately has no fallback to
an older commit, another workflow, a check with the same name, or an unsupported
event. It adapts the native-run verification from the shared security policy at
qqrm-labs/.github@e92efba3e5c6602e28860d91aa6d77c8f2c73b7c without running
the other scanners from that reusable workflow a second time.
"""

import json
import os
import re
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener


NATIVE_PATH = "dynamic/github-code-scanning/codeql"
ANALYSIS_JOB = "Analyze (javascript-typescript)"


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class GitHubAPI:
    def __init__(self, token):
        if not token:
            raise RuntimeError("A read-only GitHub token is required")
        self.token = token

    def get_json(self, path):
        request = Request("https://api.github.com" + path, headers={
            "Accept": "application/vnd.github+json",
            "Authorization": "Bearer " + self.token,
            "X-GitHub-Api-Version": "2022-11-28",
        })
        try:
            with build_opener(NoRedirect()).open(request, timeout=20) as response:
                return json.load(response)
        except (HTTPError, URLError) as error:
            code = getattr(error, "code", "network error")
            raise RuntimeError(f"GitHub Actions API failed ({code}); CodeQL is unverified") from None
        except (ValueError, TimeoutError):
            raise RuntimeError("GitHub Actions API did not return valid JSON in time") from None

    def records(self, path, key):
        result = []
        separator = "&" if "?" in path else "?"
        for page in range(1, 11):
            data = self.get_json(f"{path}{separator}per_page=100&page={page}")
            items = data.get(key) if isinstance(data, dict) else None
            if not isinstance(items, list) or any(not isinstance(item, dict) for item in items):
                raise RuntimeError(f"GitHub Actions API did not return valid {key}")
            result.extend(items)
            if len(items) < 100:
                return result
        raise RuntimeError("GitHub Actions API pagination limit exceeded; CodeQL is unverified")


def positive_integer(value):
    return type(value) is int and value > 0


def require_analysis(run, jobs, sha):
    if run.get("status") != "completed" or run.get("conclusion") != "success":
        raise RuntimeError("The current native CodeQL run did not complete successfully")
    matching = [job for job in jobs if job.get("name") == ANALYSIS_JOB]
    if len(matching) != 1:
        raise RuntimeError("Exactly one native JavaScript/TypeScript analysis job is required")
    job = matching[0]
    if (job.get("status") != "completed" or job.get("conclusion") != "success"
            or job.get("head_sha") != sha or job.get("run_id") != run["id"]
            or job.get("run_attempt") != run["run_attempt"]):
        raise RuntimeError("Native JavaScript/TypeScript analysis did not succeed for this commit and attempt")


def verify_native_codeql(api, repository, sha, *, timeout=12 * 60,
                         clock=time.monotonic, sleep=time.sleep):
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        raise RuntimeError("A valid GitHub repository is required")
    if not re.fullmatch(r"[a-f0-9]{40}", sha):
        raise RuntimeError("A full source commit SHA is required")
    repo = "/repos/" + repository
    workflows = api.records(repo + "/actions/workflows", "workflows")
    native = [workflow for workflow in workflows if workflow.get("path") == NATIVE_PATH]
    if (len(native) != 1 or native[0].get("state") != "active"
            or not positive_integer(native[0].get("id"))):
        raise RuntimeError("One active GitHub-managed Default CodeQL workflow is required")
    workflow_id = native[0]["id"]
    path = f"{repo}/actions/workflows/{workflow_id}/runs?head_sha={sha}"
    deadline = clock() + timeout
    while True:
        runs = [run for run in api.records(path, "workflow_runs")
                if run.get("workflow_id") == workflow_id and run.get("path") == NATIVE_PATH
                and run.get("event") == "dynamic" and run.get("head_sha") == sha]
        if any(not positive_integer(run.get("id"))
               or not positive_integer(run.get("run_attempt")) for run in runs):
            raise RuntimeError("The native CodeQL run metadata is invalid")
        run = max(runs, key=lambda item: (item["id"], item["run_attempt"])) if runs else None
        if run and run.get("status") == "completed":
            jobs = api.records(f"{repo}/actions/runs/{run['id']}/jobs?filter=latest", "jobs")
            require_analysis(run, jobs, sha)
            return f"https://github.com/{repository}/actions/runs/{run['id']}"
        if clock() >= deadline:
            raise RuntimeError("No completed native CodeQL analysis for this commit before the timeout")
        print("Waiting for native JavaScript/TypeScript CodeQL on this exact commit...", flush=True)
        sleep(min(15, max(0, deadline - clock())))


def main():
    try:
        repository = os.environ.get("GITHUB_REPOSITORY", "")
        sha = os.environ.get("CODEQL_HEAD_SHA", "")
        url = verify_native_codeql(GitHubAPI(os.environ.get("GH_TOKEN")), repository, sha)
        message = (
            f"Native JavaScript/TypeScript CodeQL completed successfully for `{sha}`: {url}. "
            "The separate CodeQL result check evaluates findings; this gate verifies execution."
        )
        print(message)
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as summary:
            summary.write("## Native CodeQL verification\n\n" + message + "\n")
        return 0
    except RuntimeError as error:
        print("::error::" + str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

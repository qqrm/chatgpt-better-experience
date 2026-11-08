"""Regressions for the native CodeQL boundary, using captured GitHub API data."""

import copy
import io
import json
from pathlib import Path
import re
import subprocess
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

from verify_native_codeql import GitHubAPI, NATIVE_PATH, verify_native_codeql


DIRECTORY = Path(__file__).resolve().parent
FIXTURE = json.loads((DIRECTORY / "fixtures/native_codeql.json").read_text())
REPOSITORY = FIXTURE["repository"]


class Clock:
    def __init__(self):
        self.value = 0

    def now(self):
        return self.value

    def sleep(self, seconds):
        self.value += seconds


class FixtureAPI:
    def __init__(self, case=None):
        case = case or FIXTURE["cases"][0]
        self.sha = case["run"]["head_sha"]
        self.workflows = [copy.deepcopy(FIXTURE["workflow"])]
        self.runs = [copy.deepcopy(case["run"])]
        self.jobs = copy.deepcopy(case["jobs"])
        self.run_batches = []
        self.requests = []

    def records(self, path, key):
        self.requests.append((path, key))
        repo = "/repos/" + REPOSITORY
        if path == repo + "/actions/workflows" and key == "workflows":
            return copy.deepcopy(self.workflows)
        native_id = FIXTURE["workflow"]["id"]
        if path == f"{repo}/actions/workflows/{native_id}/runs?head_sha={self.sha}" and key == "workflow_runs":
            if self.run_batches:
                self.runs = self.run_batches.pop(0)
            return copy.deepcopy(self.runs)
        if re.fullmatch(re.escape(repo) + r"/actions/runs/[0-9]+/jobs\?filter=latest", path) and key == "jobs":
            return copy.deepcopy(self.jobs)
        raise AssertionError(f"Unexpected API request: {path}, {key}")


def verify(api, *, sha=None, repository=REPOSITORY):
    clock = Clock()
    with redirect_stdout(io.StringIO()):
        return verify_native_codeql(api, repository, sha or api.sha, timeout=1,
                                    clock=clock.now, sleep=clock.sleep)


class NativeCodeQLTests(unittest.TestCase):
    def test_captured_main_and_pull_request_runs_pass(self):
        for case in FIXTURE["cases"]:
            with self.subTest(case=case["label"]):
                api = FixtureAPI(case)
                url = verify(api)
                self.assertEqual(url, f"https://github.com/{REPOSITORY}/actions/runs/{case['run']['id']}")
                self.assertTrue(any("head_sha=" + api.sha in path for path, _ in api.requests))

    def test_missing_disabled_or_duplicate_native_workflow_fails(self):
        variants = [[], [dict(FIXTURE["workflow"], state="disabled_manually")],
                    [dict(FIXTURE["workflow"], id=True)],
                    [FIXTURE["workflow"], FIXTURE["workflow"]],
                    [dict(FIXTURE["workflow"], path=".github/workflows/codeql.yml")]]
        for workflows in variants:
            with self.subTest(workflows=workflows):
                api = FixtureAPI()
                api.workflows = workflows
                with self.assertRaisesRegex(RuntimeError, "active GitHub-managed"):
                    verify(api)

    def test_current_native_analysis_is_required_without_an_event_scope_bypass(self):
        api = FixtureAPI()
        api.runs = []
        with self.assertRaisesRegex(RuntimeError, "timeout"):
            verify(api)
        self.assertFalse(any(key == "jobs" for _, key in api.requests))

    def test_old_commit_and_same_name_non_native_workflows_cannot_satisfy_gate(self):
        variants = {"head_sha": "0" * 40, "workflow_id": 1,
                    "path": ".github/workflows/codeql.yml", "event": "pull_request"}
        for key, value in variants.items():
            with self.subTest(field=key):
                api = FixtureAPI()
                api.runs[0][key] = value
                api.runs[0]["name"] = "CodeQL"
                with self.assertRaisesRegex(RuntimeError, "timeout"):
                    verify(api)

    def test_incomplete_run_times_out(self):
        for status in ["queued", "in_progress", "waiting", ""]:
            with self.subTest(status=status):
                api = FixtureAPI()
                api.runs[0].update(status=status, conclusion=None)
                with self.assertRaisesRegex(RuntimeError, "timeout"):
                    verify(api)

    def test_pending_run_can_finish_during_wait(self):
        api = FixtureAPI()
        completed = copy.deepcopy(api.runs)
        pending = copy.deepcopy(api.runs)
        pending[0].update(status="in_progress", conclusion=None)
        api.run_batches = [pending, completed]
        self.assertIn(str(completed[0]["id"]), verify(api))

    def test_failed_cancelled_skipped_neutral_native_run_is_not_success(self):
        for conclusion in ["failure", "cancelled", "skipped", "neutral", "timed_out", None]:
            with self.subTest(conclusion=conclusion):
                api = FixtureAPI()
                api.runs[0]["conclusion"] = conclusion
                with self.assertRaisesRegex(RuntimeError, "run did not complete successfully"):
                    verify(api)

    def test_newer_failed_run_does_not_fall_back_to_older_success(self):
        api = FixtureAPI()
        newer = dict(api.runs[0], id=api.runs[0]["id"] + 1, conclusion="failure")
        api.runs.append(newer)
        with self.assertRaisesRegex(RuntimeError, "run did not complete successfully"):
            verify(api)

    def test_missing_duplicate_or_wrong_language_job_fails(self):
        for jobs in [[], [dict(FIXTURE["cases"][0]["jobs"][0], name="Analyze (rust)")],
                     [FIXTURE["cases"][0]["jobs"][0]] * 2]:
            with self.subTest(jobs=jobs):
                api = FixtureAPI()
                api.jobs = jobs
                with self.assertRaisesRegex(RuntimeError, "Exactly one"):
                    verify(api)

    def test_pending_failed_skipped_neutral_and_stale_jobs_fail(self):
        variants = [{"status": "in_progress"}, {"conclusion": "failure"},
                    {"conclusion": "skipped"}, {"conclusion": "neutral"},
                    {"head_sha": "0" * 40}, {"run_id": 1}, {"run_attempt": 0}]
        for variant in variants:
            with self.subTest(variant=variant):
                api = FixtureAPI()
                api.jobs[0].update(variant)
                with self.assertRaisesRegex(RuntimeError, "this commit and attempt"):
                    verify(api)

    def test_rerun_cannot_reuse_a_passed_job_from_previous_attempt(self):
        api = FixtureAPI()
        api.runs[0]["run_attempt"] += 1
        with self.assertRaisesRegex(RuntimeError, "this commit and attempt"):
            verify(api)

    def test_malformed_run_identity_fails(self):
        for key, value in [("id", "42"), ("id", True), ("run_attempt", 0)]:
            with self.subTest(field=key, value=value):
                api = FixtureAPI()
                api.runs[0][key] = value
                with self.assertRaisesRegex(RuntimeError, "metadata is invalid"):
                    verify(api)

    def test_invalid_repository_and_commit_are_rejected_before_network(self):
        for repository, sha in [("../../other", "a" * 40), (REPOSITORY, "main"),
                                (REPOSITORY, "a" * 39)]:
            with self.subTest(repository=repository, sha=sha):
                api = FixtureAPI()
                with self.assertRaises(RuntimeError):
                    verify(api, repository=repository, sha=sha)
                self.assertEqual(api.requests, [])


class APIResponseTests(unittest.TestCase):
    def test_all_pages_are_read(self):
        api = GitHubAPI("unused-test-token")
        first = [{"id": i} for i in range(100)]
        last = [{"id": 100}]
        with patch.object(api, "get_json", side_effect=[{"jobs": first}, {"jobs": last}]) as fetch:
            self.assertEqual(len(api.records("/jobs?filter=latest", "jobs")), 101)
            self.assertEqual(fetch.call_args.args[0], "/jobs?filter=latest&per_page=100&page=2")

    def test_bad_response_or_truncated_pagination_fails(self):
        api = GitHubAPI("unused-test-token")
        for response in [None, {}, {"jobs": None}, {"jobs": [None]}]:
            with self.subTest(response=response), patch.object(api, "get_json", return_value=response):
                with self.assertRaisesRegex(RuntimeError, "valid jobs"):
                    api.records("/jobs", "jobs")
        with patch.object(api, "get_json", return_value={"jobs": [{}] * 100}):
            with self.assertRaisesRegex(RuntimeError, "pagination limit"):
                api.records("/jobs", "jobs")

    def test_api_error_does_not_become_a_pass(self):
        api = FixtureAPI()
        with patch.object(api, "records", side_effect=RuntimeError("API failed")):
            with self.assertRaisesRegex(RuntimeError, "API failed"):
                verify(api)


class CIGateTests(unittest.TestCase):
    def test_actual_ci_gate_shell_requires_both_successes(self):
        workflow = (DIRECTORY.parent / "workflows/build-validation.yml").read_text()
        gate = workflow.split("\n  ci-gate:\n", 1)[1]
        self.assertIn("needs: [build, codeql-policy]", gate)
        command = re.search(r"        run: \|\n((?:          .*\n)+)", gate).group(1)
        command = "\n".join(line[10:] for line in command.splitlines())
        for build in ["success", "failure", "cancelled", "skipped", "neutral", ""]:
            for codeql in ["success", "failure", "cancelled", "skipped", "neutral", ""]:
                with self.subTest(build=build, codeql=codeql):
                    result = subprocess.run(["bash", "-e", "-c", command], check=False,
                                            env={"BUILD_RESULT": build, "CODEQL_RESULT": codeql})
                    self.assertEqual(result.returncode == 0, build == codeql == "success")


if __name__ == "__main__":
    unittest.main()

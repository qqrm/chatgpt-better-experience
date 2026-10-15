import unittest

from dependency_policy import main, verified_bot_commits, verified_dependency_commits
from unittest.mock import patch
import json
import os
import tempfile
from pathlib import Path


def commit(sha="head", author="dependabot[bot]", verified=True, author_id=49699333,
           committer="web-flow", reason="valid"):
    return {"sha": sha, "author": {"login": author, "id": author_id},
            "committer": {"login": committer},
            "commit": {"verification": {"verified": verified, "reason": reason}}}


OWNER = {"login": "qqrm", "id": 4681325, "type": "User"}


def owner_commit(**kwargs):
    return commit(author="qqrm", author_id=4681325, **kwargs)


class PolicyTests(unittest.TestCase):
    def test_signed_bot_batch_needs_no_version_metadata_or_review(self):
        self.assertTrue(verified_bot_commits([commit("first"), commit()], "head"))

    def test_empty_batch_fails_closed(self):
        self.assertFalse(verified_bot_commits([], "head"))

    def test_changed_head_fails_closed(self):
        self.assertFalse(verified_bot_commits([commit("new")], "head"))

    def test_every_commit_must_be_from_dependabot(self):
        for author in ["contributor", "github-actions[bot]", "dependabot"]:
            with self.subTest(author=author):
                self.assertFalse(verified_bot_commits(
                    [commit("first", author=author), commit()], "head"))

    def test_every_commit_must_have_a_verified_signature(self):
        for verified in [False, None, "true"]:
            with self.subTest(verified=verified):
                self.assertFalse(verified_bot_commits(
                    [commit("first", verified=verified), commit()], "head"))

    def test_missing_provenance_fails_closed(self):
        for incomplete in [{}, {"author": None},
                           {"author": {"login": "dependabot[bot]"}}]:
            self.assertFalse(verified_bot_commits([incomplete, commit()], "head"))

    def test_signed_owner_can_adopt_without_becoming_bot_eligible(self):
        for batch in [[owner_commit()], [commit("first"), owner_commit()]]:
            self.assertTrue(verified_dependency_commits(batch, "head", OWNER))
            self.assertFalse(verified_bot_commits(batch, "head"))

    def test_owner_login_cannot_substitute_for_numeric_identity(self):
        wrong_id = commit(author="qqrm", author_id=123)
        self.assertFalse(verified_dependency_commits([wrong_id], "head", OWNER))
        wrong_login = commit(author="contributor", author_id=4681325)
        self.assertFalse(verified_dependency_commits([wrong_login], "head", OWNER))

    def test_unsigned_or_non_github_owner_commit_is_rejected(self):
        for options in [{"verified": False}, {"verified": "true"},
                        {"reason": "unknown_key"}, {"committer": "qqrm"}]:
            with self.subTest(options=options):
                self.assertFalse(verified_dependency_commits(
                    [owner_commit(**options)], "head", OWNER))

    def test_owner_signature_cannot_cover_an_untrusted_earlier_commit(self):
        self.assertFalse(verified_dependency_commits(
            [commit("first", author="contributor"), owner_commit()], "head", OWNER))
        self.assertFalse(verified_dependency_commits(
            [commit("first", verified=False), owner_commit()], "head", OWNER))

    def test_owner_provenance_requires_exact_nonempty_batch(self):
        self.assertFalse(verified_dependency_commits([], "head", OWNER))
        self.assertFalse(verified_dependency_commits([owner_commit()], "changed", OWNER))

    def test_organization_missing_or_boolean_owner_id_is_not_a_user(self):
        for owner in [{}, dict(OWNER, type="Organization"), dict(OWNER, id=True),
                      dict(OWNER, id=0), dict(OWNER, login="")]:
            self.assertFalse(verified_dependency_commits([owner_commit()], "head", owner))

    def test_entrypoint_rejects_foreign_or_deleted_head_repository_before_api(self):
        for head_repo in [{"id": 2}, None, {}]:
            event = {"repository": {"id": 1, "full_name": "qqrm/repo", "owner": OWNER},
                     "pull_request": {"head": {"repo": head_repo},
                                      "base": {"repo": {"id": 1}}}}
            with tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "event.json"
                path.write_text(json.dumps(event))
                with patch.dict(os.environ, {"GITHUB_EVENT_PATH": str(path)}), \
                     patch("dependency_policy.subprocess.check_output") as api:
                    with self.assertRaises(SystemExit):
                        main()
                    api.assert_not_called()

    def test_entrypoint_checks_every_api_page_against_event_head(self):
        event = {"repository": {"id": 1, "full_name": "qqrm/repo", "owner": OWNER},
                 "pull_request": {"number": 449, "head": {"repo": {"id": 1}, "sha": "head"},
                                  "base": {"repo": {"id": 1}}}}
        pages = [[commit("first", author="contributor")], [owner_commit()]]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "event.json"
            path.write_text(json.dumps(event))
            with patch.dict(os.environ, {"GITHUB_EVENT_PATH": str(path)}), \
                 patch("dependency_policy.subprocess.check_output", return_value=json.dumps(pages)):
                with self.assertRaises(SystemExit):
                    main()

    def test_entrypoint_accepts_the_owner_batch_for_ci_only(self):
        event = {"repository": {"id": 1, "full_name": "qqrm/repo", "owner": OWNER},
                 "pull_request": {"number": 449, "head": {"repo": {"id": 1}, "sha": "head"},
                                  "base": {"repo": {"id": 1}}}}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "event.json"
            path.write_text(json.dumps(event))
            with patch.dict(os.environ, {"GITHUB_EVENT_PATH": str(path)}), \
                 patch("dependency_policy.subprocess.check_output", return_value=json.dumps([[owner_commit()]])), \
                 patch("builtins.print") as output:
                main()
                self.assertIn("excluded", output.call_args.args[0])


if __name__ == "__main__":
    unittest.main()

"""The required CI gate must reject unsuccessful builds and CodeQL analyses."""

from pathlib import Path
import re
import subprocess
import unittest


DIRECTORY = Path(__file__).resolve().parent


class CIGateTests(unittest.TestCase):
    def test_actual_ci_gate_shell_requires_both_successes(self):
        workflow = (DIRECTORY.parent / "workflows/build-validation.yml").read_text()
        gate = workflow.split("\n  ci-gate:\n", 1)[1]
        self.assertIn("needs: [build, codeql]", gate)
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

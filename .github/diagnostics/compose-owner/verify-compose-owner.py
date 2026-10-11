"""Strict evidence gates for the isolated Compose owner diagnostic; no recognition calls."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import re
import subprocess
import xml.etree.ElementTree as ET

SUPPORT = Path(__file__).resolve().parent


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write(path, value):
    Path(path).write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def pins():
    return json.loads((SUPPORT / "source-pins.json").read_text(encoding="utf-8"))


def validate_xml(files, phase, expected):
    """Return a report only for the exact six tests and approved assertion-only red cases."""
    rows = []
    suite_errors = 0
    for file in files:
        root = ET.parse(file).getroot()
        suites = [root] if root.tag == "testsuite" else list(root.iter("testsuite"))
        suite_errors += sum(int(suite.get("errors", "0")) for suite in suites)
        for case in root.iter("testcase"):
            check(case.get("classname") == expected["className"], "Unexpected test class")
            original_name = case.get("name", "")
            name = re.sub(r"\[35\]$", "", original_name)
            errors = case.findall("error")
            failures = case.findall("failure")
            skipped = case.findall("skipped")
            check(not errors, f"Harness/error case rejected: {original_name}")
            check(not skipped, f"Skipped test rejected: {original_name}")
            check(len(failures) <= 1, f"Multiple failures in {original_name}")
            failure = failures[0] if failures else None
            if failure is not None:
                check(failure.get("type") in {"java.lang.AssertionError", "org.junit.ComparisonFailure"},
                      f"Non-assertion failure rejected: {original_name}: {failure.get('type')}")
            rows.append({
                "name": name, "originalName": original_name,
                "status": "failed" if failure is not None else "passed",
                "failureType": None if failure is None else failure.get("type"),
                "failureMessage": None if failure is None else failure.get("message"),
            })
    check(suite_errors == 0, "JUnit suite errors must be zero")
    check(len(rows) == 6, f"Exactly six executed tests required; found {len(rows)}")
    names = [row["name"] for row in rows]
    check(len(set(names)) == 6, "Duplicate test names")
    check(set(names) == set(expected["testNames"]), "Test names do not match frozen six-test plan")
    failed = {row["name"] for row in rows if row["status"] == "failed"}
    wanted = set(expected["expectedBaselineFailures"]) if phase == "baseline" else set()
    check(failed == wanted, f"Wrong {phase} failed-test set: {sorted(failed)}")
    return {"tests": 6, "passed": 6 - len(failed), "failures": len(failed),
            "errors": 0, "skipped": 0, "cases": sorted(rows, key=lambda row: row["name"])}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["preflight", "source", "results", "restored", "summary"])
    parser.add_argument("--repo", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--phase", choices=["baseline", "fixed"])
    parser.add_argument("--exit-code", type=int)
    args = parser.parse_args()
    repo = args.repo.resolve()
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    plan = pins()
    source = repo / plan["composePath"]

    if args.command == "preflight":
        subprocess.run(["git", "-C", str(repo), "merge-base", "--is-ancestor",
                        plan["baseCommit"], "HEAD"], check=True)
        records = []
        for row in plan["baseFiles"]:
            data = subprocess.run(["git", "-C", str(repo), "show", plan["baseCommit"] + ":" + row["path"]],
                                  check=True, stdout=subprocess.PIPE).stdout
            blob_sha = hashlib.sha256(data).hexdigest()
            check(blob_sha == row["sha256"], "Pinned base Git blob mismatch: " + row["path"])
            wanted = plan["harnessGradleSha256"] if row["path"] == plan["gradlePath"] else row["sha256"]
            actual = sha(repo / row["path"])
            check(actual == wanted, "Diagnostic checkout source mismatch: " + row["path"])
            records.append({"path": row["path"], "baseGitBlobSha256": blob_sha,
                            "diagnosticWorkingSha256": actual})
        check(sha(repo / plan["testPath"]) == plan["testSha256"], "Test source mismatch")
        check(sha(SUPPORT / "QRGenScanner.fixed.kt") == plan["fixedComposeSha256"], "Fixed source mismatch")
        write(out / "preflight.json", {
            "baseCommit": plan["baseCommit"],
            "diagnosticCommit": subprocess.check_output(["git", "-C", str(repo), "rev-parse", "HEAD"], text=True).strip(),
            "githubRunId": os.environ.get("GITHUB_RUN_ID"), "githubRunAttempt": os.environ.get("GITHUB_RUN_ATTEMPT"),
            "githubRepository": os.environ.get("GITHUB_REPOSITORY"),
            "sourcePinsSha256": sha(SUPPORT / "source-pins.json"),
            "testSha256": plan["testSha256"], "fixedComposeSha256": plan["fixedComposeSha256"],
            "declaredToolchain": plan["declaredToolchain"], "sourceFiles": records,
            "testOrBuildExecutionInPreflight": False,
        })
    elif args.command == "source":
        check(args.phase is not None, "phase required")
        wanted = plan["baselineComposeSha256"] if args.phase == "baseline" else plan["fixedComposeSha256"]
        actual = sha(source)
        check(actual == wanted, f"{args.phase} source mismatch")
        write(out / args.phase / "source.json", {"phase": args.phase, "path": plan["composePath"], "sha256": actual})
    elif args.command == "results":
        check(args.phase is not None and args.exit_code is not None, "phase and exit code required")
        check((args.exit_code != 0) if args.phase == "baseline" else (args.exit_code == 0),
              "Gradle exit code inconsistent with expected phase")
        files = sorted((out / args.phase / "junit").glob("*.xml"))
        check(bool(files), "No actual JUnit XML; build/dependency failures do not prove the bug")
        result = validate_xml(files, args.phase, plan)
        recorded_source = json.loads((out / args.phase / "source.json").read_text())
        wanted = plan["baselineComposeSha256"] if args.phase == "baseline" else plan["fixedComposeSha256"]
        check(recorded_source["sha256"] == wanted and sha(source) == wanted, "Source changed during test phase")
        result.update({"phase": args.phase, "gradleExitCode": args.exit_code,
                       "sourceSha256": wanted, "testSha256": plan["testSha256"],
                       "junitFiles": [{"name": file.name, "sha256": sha(file)} for file in files],
                       "gradleLogSha256": sha(out / args.phase / "gradle.log")})
        write(out / args.phase / "verified-results.json", result)
    elif args.command == "restored":
        check(sha(source) == plan["baselineComposeSha256"], "Original source was not restored")
        write(out / "restoration.json", {"restored": True, "sourceSha256": sha(source),
                                          "path": plan["composePath"]})
    else:
        before = json.loads((out / "baseline/verified-results.json").read_text())
        after = json.loads((out / "fixed/verified-results.json").read_text())
        check(before["tests"] == 6 and before["failures"] == 4 and before["passed"] == 2, "Invalid baseline totals")
        check(after["tests"] == 6 and after["failures"] == 0 and after["passed"] == 6, "Invalid fixed totals")
        check(json.loads((out / "restoration.json").read_text())["restored"], "Missing restoration evidence")
        write(out / "summary.json", {
            "status": "verified-baseline-assertion-failures-and-fixed-pass", "baseCommit": plan["baseCommit"],
            "baseline": {key: before[key] for key in ["tests", "passed", "failures", "errors", "skipped", "sourceSha256"]},
            "fixed": {key: after[key] for key in ["tests", "passed", "failures", "errors", "skipped", "sourceSha256"]},
            "cameraPermission": "denied before real scanner construction in each test",
            "scope": "real Compose/view/controller ownership; no active CameraX, ML Kit recognition or phone claim",
        })


if __name__ == "__main__":
    main()

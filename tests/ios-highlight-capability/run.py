#!/usr/bin/env python3
"""Run the isolated neutral UIKit capability probe; retain every failure."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import signal
import subprocess
import sys
import time
import uuid

BASE = "978214dcaf20451b72a185e1066cc09eabd0a30f"
REL = Path("tests/ios-highlight-capability")
PROBE_NAME = "actual-uikit-inputless-preview-outline-capability"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def save(path, value):
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args])


def in_tree(path, root):
    return path == root or root in path.parents


def verified_checkout(root, expected):
    assert git(root, "rev-parse", "HEAD").decode().strip() == expected, "Wrong checkout HEAD"
    assert not git(root, "status", "--porcelain=v1", "--untracked-files=all"), "Checkout is dirty"


def verify_representation(canonical, pin):
    raw = pin["frozenWorkingRepresentation"]
    assert raw["loneCRCount"] == 0 and raw["crlfPairs"] in (0, raw["lfCount"]), "Unsupported mixed representation"
    reconstructed = canonical.replace(b"\n", b"\r\n") if raw["crlfPairs"] else canonical
    assert len(reconstructed) == raw["rawBytes"] and sha(reconstructed) == raw["rawSha256"], "Frozen representation mismatch"
    assert len(canonical) == pin["bytes"] and sha(canonical) == pin["sha256"], "Canonical pin mismatch"


def source_closure(root, manifest):
    verified_checkout(root, BASE)
    assert git(root, "rev-parse", "HEAD^{tree}").decode().strip() == manifest["baseTree"]
    recorded = []
    for pin in manifest["sourcePins"]:
        path = root / pin["path"]
        assert in_tree(path.resolve(strict=True), root) and not path.is_symlink()
        blob = git(root, "cat-file", "blob", BASE + ":" + pin["path"])
        assert git(root, "rev-parse", BASE + ":" + pin["path"]).decode().strip() == pin["gitBlobOid"]
        assert path.read_bytes() == blob, "Working source differs from immutable Git blob"
        verify_representation(blob, pin)
        recorded.append({"path": pin["path"], "bytes": len(blob), "sha256": sha(blob), "gitBlobOid": pin["gitBlobOid"]})
    actual = sorted(p.relative_to(root).as_posix() for p in (root / "packages/ios/Sources/QRGenKit").rglob("*.swift"))
    assert actual == sorted(manifest["swiftImplementationPaths"]) and len(actual) == 18, "Swift source inventory mismatch"
    assert len(recorded) == 32
    return recorded


def fixture_closure(root, expected, manifest):
    verified_checkout(root, expected)
    fixture = root / REL
    pins = manifest["executableFixturePins"] + [manifest["neutralReadme"]]
    support = [p["path"] for p in pins] + ["source-manifest.json"]
    actual = sorted(p.relative_to(fixture).as_posix() for p in fixture.rglob("*") if p.is_file())
    assert actual == sorted(support + ["run.py"]), "Unexpected fixture files"
    recorded = []
    for name in support + ["run.py"]:
        path = fixture / name
        assert in_tree(path.resolve(strict=True), fixture) and not path.is_symlink()
        blob = git(root, "cat-file", "blob", expected + ":" + (REL / name).as_posix())
        assert path.read_bytes() == blob, "Fixture working bytes differ from feature Git blob"
        pin = next((p for p in pins if p["path"] == name), None)
        if pin:
            assert len(blob) == pin["bytes"] and sha(blob) == pin["sha256"]
            if "frozenWorkingRepresentation" in pin:
                verify_representation(blob, pin)
        recorded.append({"path": name, "bytes": len(blob), "sha256": sha(blob)})
    return recorded, support


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--feature-root", required=True)
    parser.add_argument("--source-root", required=True)
    parser.add_argument("--feature-sha", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    feature = Path(args.feature_root).resolve(strict=True)
    source = Path(args.source_root).resolve(strict=True)
    requested = Path(args.output)
    output = requested.parent.resolve(strict=True) / requested.name
    assert re.fullmatch(r"[0-9a-f]{40}", args.feature_sha)
    assert requested.name not in ("", ".", "..") and not output.exists()
    for protected in (feature, source, Path(__file__).resolve().parent):
        assert not in_tree(output, protected) and not in_tree(protected, output), "Output overlaps protected tree"
    for parent in (output.parent, *output.parent.parents):
        assert not (parent / ".git").exists(), "Output is inside a checkout"
    runner_temp = Path(os.environ["RUNNER_TEMP"]).resolve(strict=True)
    assert in_tree(output, runner_temp), "Output must be under canonical RUNNER_TEMP"
    output.mkdir(exist_ok=False)
    evidence = output / "evidence"
    evidence.mkdir()
    logs = evidence / "logs"
    logs.mkdir()
    receipt = {"status": "harness_started", "baseSha": BASE, "featureSha": args.feature_sha,
               "commands": [], "publicBugClaim": False, "attachmentReviewRequired": True,
               "runner": {k: os.environ.get(k) for k in ("GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_REF", "ImageOS", "ImageVersion")}}
    save(evidence / "run-receipt.json", receipt)
    owned = None
    manifest = None
    support = None
    copied = output / "probe"
    xcode_exit = None

    def command(name, argv, timeout=90, allow_failure=False):
        path = logs / (str(len(receipt["commands"]) + 1).zfill(2) + "-" + name + ".log")
        item = {"name": name, "argv": [str(a) for a in argv], "log": path.relative_to(evidence).as_posix()}
        receipt["commands"].append(item)
        with path.open("wb") as stream:
            process = subprocess.Popen(item["argv"], stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
            try:
                code = process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                item["timedOut"] = True
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
                code = process.returncode
        item["exitCode"] = code
        text = path.read_text(encoding="utf-8", errors="replace")
        if (code != 0 or item.get("timedOut")) and not allow_failure:
            raise RuntimeError(name + " failed; see " + item["log"])
        return code, text

    try:
        assert platform.system() == "Darwin", "Apple host required"
        manifest = json.loads((feature / REL / "source-manifest.json").read_text())
        assert manifest["baseSha"] == BASE
        receipt["sourceBefore"] = source_closure(source, manifest)
        receipt["fixtureBefore"], support = fixture_closure(feature, args.feature_sha, manifest)
        copied.mkdir()
        for name in support:
            target = copied / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(feature / REL / name, target)
        (copied / "QRGenSource").symlink_to(source, target_is_directory=True)
        assert (copied / "QRGenSource").resolve(strict=True) == source
        assert (copied / "QRGenSource/Package.swift").resolve(strict=True) == source / "Package.swift"
        receipt["copiedBefore"] = [{"path": name, "sha256": sha((copied / name).read_bytes())} for name in support]
        for name, argv in (("os", ["sw_vers"]), ("architecture", ["uname", "-a"]),
                           ("xcode-select", ["xcode-select", "-p"]), ("xcode", ["xcodebuild", "-version"]),
                           ("sdks", ["xcodebuild", "-showsdks"])):
            command(name, argv)
        _, runtime_text = command("runtimes", ["xcrun", "simctl", "list", "runtimes", "--json"])
        _, device_text = command("devices", ["xcrun", "simctl", "list", "devices", "available", "--json"])
        runtimes = json.loads(runtime_text)["runtimes"]
        devices = json.loads(device_text)["devices"]
        choices = []
        for runtime in runtimes:
            if runtime.get("isAvailable") and ".SimRuntime.iOS-" in runtime["identifier"]:
                for device in devices.get(runtime["identifier"], []):
                    kind = device.get("deviceTypeIdentifier", "")
                    if device.get("isAvailable") and ".iPhone-" in kind:
                        choices.append((tuple(int(v) for v in runtime["version"].split(".")), runtime["identifier"], kind))
        assert choices, "No available iPhone/iOS Simulator pair"
        _, runtime_id, device_type = sorted(choices)[-1]
        receipt["selectedSimulator"] = {"runtime": runtime_id, "deviceType": device_type}
        _, created = command("create-owned-simulator", ["xcrun", "simctl", "create", "QRGenCapability-" + uuid.uuid4().hex[:12], device_type, runtime_id])
        owned = str(uuid.UUID(created.strip()))
        receipt["ownedSimulatorUDID"] = owned
        command("boot-owned-simulator", ["xcrun", "simctl", "boot", owned])
        command("bootstatus-owned-simulator", ["xcrun", "simctl", "bootstatus", owned, "-b"], timeout=240)
        xcode_exit, _ = command("xcodebuild-test", ["xcodebuild", "test", "-project", str(copied / "QRGenHighlightProbe.xcodeproj"),
            "-scheme", "QRGenHighlightProbe", "-destination", "platform=iOS Simulator,id=" + owned,
            "-parallel-testing-enabled", "NO", "-only-testing:QRGenHighlightCapabilityTests/HighlightCapabilityTests/testActualUIKitOutlineCapability",
            "-derivedDataPath", str(output / "DerivedData"), "-resultBundlePath", str(evidence / "Capability.xcresult"),
            "CODE_SIGNING_ALLOWED=NO"], timeout=1200, allow_failure=True)
        receipt["xcodebuildExitCode"] = xcode_exit
    except Exception as error:
        receipt["harnessError"] = type(error).__name__ + ": " + str(error)
    finally:
        if owned:
            try:
                command("shutdown-owned-simulator", ["xcrun", "simctl", "shutdown", owned], allow_failure=True)
                code, _ = command("delete-owned-simulator", ["xcrun", "simctl", "delete", owned], allow_failure=True)
                receipt["ownedSimulatorDeleted"] = code == 0
                _, remaining = command("devices-after-cleanup", ["xcrun", "simctl", "list", "devices", "--json"])
                remaining_ids = {str(uuid.UUID(device["udid"]))
                                 for group in json.loads(remaining)["devices"].values() for device in group}
                receipt["ownedSimulatorAbsentAfterCleanup"] = owned not in remaining_ids
                assert owned not in remaining_ids and code == 0, "Owned Simulator cleanup incomplete"
            except Exception as error:
                receipt["cleanupError"] = str(error)
        if manifest is not None:
            try:
                receipt["sourceAfter"] = source_closure(source, manifest)
                receipt["fixtureAfter"], _ = fixture_closure(feature, args.feature_sha, manifest)
                assert receipt["sourceAfter"] == receipt["sourceBefore"]
                assert receipt["fixtureAfter"] == receipt["fixtureBefore"]
                if support and copied.exists():
                    receipt["copiedAfter"] = [{"path": name, "sha256": sha((copied / name).read_bytes())} for name in support]
                    assert receipt["copiedAfter"] == receipt["copiedBefore"]
                    assert (copied / "QRGenSource").resolve(strict=True) == source
            except Exception as error:
                receipt["closureError"] = str(error)

    result = evidence / "Capability.xcresult"
    if result.exists():
        try:
            command("xcresult-help-attachments", ["xcrun", "xcresulttool", "help", "export", "attachments"])
            _, summary = command("xcresult-summary", ["xcrun", "xcresulttool", "get", "test-results", "summary", "--path", str(result), "--compact"])
            receipt["testSummary"] = json.loads(summary)
            command("xcresult-attachments", ["xcrun", "xcresulttool", "export", "attachments", "--path", str(result), "--output-path", str(evidence / "attachments")])
        except Exception as error:
            receipt["collectorError"] = str(error)
    else:
        receipt["collectorError"] = "No xcresult bundle (compile/launch failure or earlier harness error)"

    candidates = {}
    for path in (evidence / "attachments").rglob("*") if (evidence / "attachments").exists() else []:
        if path.is_file() and path.stat().st_size < 2_000_000:
            try:
                value = json.loads(path.read_text())
                if isinstance(value, dict) and value.get("probe") == PROBE_NAME:
                    candidates[json.dumps(value, sort_keys=True)] = value
            except (UnicodeError, ValueError):
                pass
    receipt["attachedCapabilityReceiptCount"] = len(candidates)
    if len(candidates) == 1:
        actual = next(iter(candidates.values()))
        receipt["capabilityReceipt"] = actual
        save(evidence / "capability-receipt.json", actual)
    images = [{"path": p.relative_to(evidence).as_posix(), "bytes": p.stat().st_size, "sha256": sha(p.read_bytes())}
              for p in (evidence / "attachments").rglob("*") if p.is_file() and p.read_bytes().startswith(b"\x89PNG\r\n\x1a\n")] if (evidence / "attachments").exists() else []
    receipt["imageAttachments"] = images
    actual = receipt.get("capabilityReceipt", {})
    summary = receipt.get("testSummary", {})
    receipt["timedOutCommandCount"] = sum(bool(item.get("timedOut")) for item in receipt["commands"])
    failed = any(k in receipt for k in ("harnessError", "cleanupError", "closureError", "collectorError")) \
        or receipt["timedOutCommandCount"] != 0
    common = not failed and xcode_exit == 0 and len(candidates) == 1 and actual.get("baseSha") == BASE \
        and actual.get("regressionAssertions") == 0 and actual.get("cleanup", {}).get("completed") is True \
        and summary.get("totalTestCount") == 1 and summary.get("failedTests") == 0
    if common and actual.get("status") == "supported" and summary.get("passedTests") == 1 and summary.get("skippedTests") == 0 and len(images) >= 3:
        receipt["status"] = "capability_candidate_supported_pending_attachment_review"
    elif common and actual.get("status") == "capability_not_established" and summary.get("skippedTests") == 1 and summary.get("passedTests") == 0:
        receipt["status"] = "capability_not_established"
    else:
        receipt["status"] = "harness_failure"
    receipt["completedAtUTC"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    save(evidence / "run-receipt.json", receipt)
    print(json.dumps({"status": receipt["status"], "evidence": str(evidence), "xcodebuildExitCode": xcode_exit}))
    return 1 if receipt["status"] == "harness_failure" else 0


if __name__ == "__main__":
    sys.exit(main())

"""Run explicit UIKit probes in one owned iOS Simulator."""

import argparse
import json
import os
import pathlib
import plistlib
import re
import signal
import subprocess
import sys
import time
import uuid

from run import git, sha256, tracked_snapshot


BUNDLE_ID = "com.qrgen.ci.iosuikitbuild"
PROBES = {
    "toast": {
        "flag": "--qrgen-toast-lifecycle-probe",
        "file": "qrgen-toast-lifecycle.json",
        "checks": {
            "ordinary_toast_hides": "control",
            "reappearance_clears_old_toast": "target",
            "fresh_toast_hides": "control",
        },
    },
    "batch-overlay": {
        "flag": "--qrgen-batch-overlay-probe",
        "file": "qrgen-batch-overlay.json",
        "checks": {
            "projection_capability": "capability",
            "ordinary_batch_movement": "control",
            "backward_epoch_live_overlay": "target",
            "source_clear_removes_overlays": "control",
        },
    },
    "batch-model-path": {
        "flag": "--qrgen-batch-model-path-probe",
        "file": "qrgen-batch-model-path.json",
        "checks": {
            "model_path_capability": "capability",
            "ordinary_batch_model_path": "control",
            "backward_epoch_batch_model_path": "target",
            "source_clear_detaches_model_paths": "control",
        },
    },
}
UUID = re.compile(r"[0-9A-Fa-f]{8}(?:-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}")


def device_ids(inventory):
    return {item["udid"].lower() for group in inventory["devices"].values() for item in group}


def installed_pair(runtimes, devices):
    available = [
        item for item in runtimes["runtimes"]
        if item.get("isAvailable") and item["identifier"].startswith("com.apple.CoreSimulator.SimRuntime.iOS-")
    ]
    available.sort(key=lambda item: tuple(map(int, re.findall(r"\d+", item["version"]))), reverse=True)
    for runtime in available:
        for device in devices["devices"].get(runtime["identifier"], []):
            kind = device.get("deviceTypeIdentifier", "")
            if device.get("isAvailable") and kind.startswith("com.apple.CoreSimulator.SimDeviceType.iPhone-"):
                return runtime["identifier"], kind
    raise RuntimeError("No installed available iPhone/runtime pair; no UI oracle was executed")


def classify_probe(record):
    """Evaluate only retained input; this never launches or retries a probe."""
    try:
        if record.get("collectionError"):
            raise RuntimeError(record["collectionError"])
        payload = record["appReceipt"]
        name = record["name"]
        if payload.get("schemaVersion") != 1 or payload.get("probeToken") != record["probeToken"]:
            raise RuntimeError("App receipt schema or launch token differs")
        if payload.get("phase") == "harness-error":
            raise RuntimeError("App reported a setup or lifecycle harness error")
        if payload.get("skippedCases") != 0 or payload.get("cameraStarted") is not False or payload.get("startsAutomatically") is not False:
            raise RuntimeError("Probe skipped a case or did not retain the no-camera contract")
        if payload.get("harnessErrors") != []:
            raise RuntimeError("App reported an invalid lifecycle/timing calibration")
        if payload.get("cleanupComplete") is not True:
            raise RuntimeError("App did not complete its real UIKit disappearance cleanup")
        states = payload.get("scannerStates", [])
        if not states or any(state not in ("idle", "stopped") for state in states):
            raise RuntimeError("Probe observed an unexpected scanner state")
        if name == "batch-model-path":
            if (payload.get("visibleOverlayClaim") is not False or payload.get("presentationInspected") is not False
                    or payload.get("nativeSessionExecuted") is not False or payload.get("modelTimesControlled") is not True):
                raise RuntimeError("Model-path receipt must retain its controlled-model-only evidence scope")
        if name in ("batch-overlay", "batch-model-path") and payload.get("phase") == "harness-inconclusive":
            reasons = payload.get("inconclusiveReasons")
            if (payload.get("pass") is not False or type(payload.get("capabilityPassed")) is not bool
                    or not isinstance(reasons, list) or not reasons
                    or any(not isinstance(reason, str) or not reason for reason in reasons)):
                raise RuntimeError("Inconclusive spatial probe needs capability, reasons and a non-pass result")
            if type(payload.get("semanticCasesRun")) is not int or not 0 <= payload["semanticCasesRun"] <= 3:
                raise RuntimeError("Inconclusive receipt needs its actual semantic case count")
            if not isinstance(payload.get("semanticCasesNotRun"), list):
                raise RuntimeError("Inconclusive receipt needs its gated case list")
            return {"status": "harness_inconclusive", "validSemanticEvidence": False}
        if payload.get("phase") != "complete":
            raise RuntimeError("App did not finish a valid probe")
        if name in ("batch-overlay", "batch-model-path"):
            if payload.get("capabilityPassed") is not True:
                raise RuntimeError("Batch semantics require the declared capability")
            if type(payload.get("semanticCasesRun")) is not int or payload["semanticCasesRun"] != 3 or payload.get("semanticCasesNotRun") != [] or payload.get("inconclusiveReasons") != []:
                raise RuntimeError("Complete batch receipt must run all three semantic cases")
        checks = payload.get("checks", [])
        expected = PROBES[name]["checks"]
        if len(checks) != len(expected) or {item.get("name"): item.get("kind") for item in checks} != expected:
            raise RuntimeError("Missing or duplicate named UI oracles")
        if any(type(item.get("passed")) is not bool for item in checks) or type(payload.get("pass")) is not bool:
            raise RuntimeError("UI oracle results must be booleans")
        if payload["pass"] != all(item["passed"] for item in checks):
            raise RuntimeError("App result does not match its named checks")
        if any(not item["passed"] for item in checks if item["kind"] == "capability"):
            return {"status": "harness_inconclusive", "validSemanticEvidence": False}
        if any(not item["passed"] for item in checks if item["kind"] == "control"):
            return {"status": "control_failed", "validSemanticEvidence": False}
        return {
            "status": "passed" if payload["pass"] else "semantic_failed",
            "validSemanticEvidence": True,
        }
    except Exception as error:
        return {"status": "harness_failed", "validSemanticEvidence": False,
                "classificationError": type(error).__name__ + ": " + str(error)}


def combined_status(records):
    failures = {record["status"] for record in records if record["status"] != "passed"}
    return "passed" if not failures else next(iter(failures)) if len(failures) == 1 else "mixed_failures"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build-output", required=True)
    parser.add_argument("--probe", action="append", choices=tuple(PROBES), help="Explicit probe; defaults to toast only")
    args = parser.parse_args()
    requested = args.probe or ["toast"]
    if len(requested) != len(set(requested)):
        parser.error("Each probe may be requested only once")
    root = pathlib.Path(__file__).resolve().parents[2]
    temporary = pathlib.Path(os.environ["RUNNER_TEMP"]).resolve()
    build_output = pathlib.Path(args.build_output).resolve(strict=True)
    if build_output == temporary or not build_output.is_relative_to(temporary) or build_output.is_relative_to(root):
        raise RuntimeError("Build output must be a child of RUNNER_TEMP outside the checkout")
    evidence = build_output / "evidence/ui-runtime"
    evidence.mkdir(exist_ok=False)
    receipt = {
        "schemaVersion": 1, "status": "harness_failed",
        "scope": "Actual iOS Simulator UIKit state with controlled public callbacks; no camera or decoder execution",
        "physicalCameraClaim": False, "runID": os.environ.get("GITHUB_RUN_ID"),
        "runAttempt": os.environ.get("GITHUB_RUN_ATTEMPT"), "commands": [],
        "probeToken": str(uuid.uuid4()), "requestedProbes": requested, "probes": [],
        "ownedDevice": None, "cleanupVerified": False,
    }
    owned = None
    source_paths = ["Package.swift", "packages/ios/Sources/QRGenKit"]
    fixture_paths = [".github/workflows/ci.yml", "tests/ios-uikit-build"]

    def run(name, command, timeout=60, check=True):
        record = {"name": name, "command": list(map(str, command)), "log": name + ".log"}
        receipt["commands"].append(record)
        log = evidence / record["log"]
        with log.open("wb") as stream:
            process = subprocess.Popen(command, stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
            try:
                process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                record["timedOut"] = True
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait(timeout=30)
                raise
        record["exitCode"] = process.returncode
        if check and process.returncode:
            raise RuntimeError(name + " exited " + str(process.returncode))
        return log.read_text(errors="replace").strip()

    def sim(name, action, *arguments, timeout=60, check=True, before_device=()):
        if owned is None or UUID.fullmatch(owned) is None:
            raise RuntimeError("Refusing a device operation without the exact created UUID")
        return run(name, ["xcrun", "simctl", action, *before_device, owned, *arguments], timeout, check)

    def collect_probe(name, index, container):
        spec = PROBES[name]
        token = receipt["probeToken"] if index == 0 else str(uuid.uuid4())
        record = {"name": name, "probeToken": token, "receiptFilename": spec["file"]}
        last_bytes = None
        payload = None
        try:
            if index:
                # Terminate only this app on the owned device, never another Simulator.
                sim("terminate-before-" + name, "terminate", BUNDLE_ID, check=False)
            sim("launch" if index == 0 else "launch-" + name, "launch", BUNDLE_ID,
                spec["flag"], "--qrgen-probe-token", token,
                before_device=("--terminate-running-process",) if index else ())
            path = container / "Documents" / spec["file"]
            deadline = time.monotonic() + 45
            while time.monotonic() < deadline:
                if path.is_file():
                    last_bytes = path.read_bytes()
                    try:
                        candidate = json.loads(last_bytes)
                        if isinstance(candidate, dict):
                            payload = candidate
                            if candidate.get("phase") in ("complete", "harness-error", "harness-inconclusive"):
                                break
                    except (json.JSONDecodeError, UnicodeDecodeError):
                        pass
                time.sleep(0.25)
            else:
                record["collectionError"] = "No terminal app receipt within 45s; UI oracle is inconclusive"
        except Exception as error:
            record["collectionError"] = type(error).__name__ + ": " + str(error)
        # Preserve terminal or partial bytes before any schema or semantic classification.
        if last_bytes is not None:
            name_on_disk = name + "-app-receipt.json"
            (evidence / name_on_disk).write_bytes(last_bytes)
            record["rawReceipt"] = name_on_disk
            record["appReceiptSha256"] = sha256(last_bytes)
            if name == "toast":
                (evidence / "app-receipt.json").write_bytes(last_bytes)
                receipt["appReceiptSha256"] = record["appReceiptSha256"]
        if payload is not None:
            record["appReceipt"] = payload
            if name == "toast":
                receipt["appReceipt"] = payload
        elif not record.get("collectionError"):
            record["collectionError"] = "No JSON app receipt was retained"
        return record

    try:
        if sys.platform != "darwin":
            raise RuntimeError("This runtime probe requires an Apple Simulator host")
        receipt["head"] = git(root, "rev-parse", "HEAD").decode().strip()
        receipt["tree"] = git(root, "rev-parse", "HEAD^{tree}").decode().strip()
        if receipt["head"] != os.environ["GITHUB_SHA"]:
            raise RuntimeError("Checkout does not match this event's exact commit")
        if git(root, "status", "--porcelain", "--untracked-files=no").strip():
            raise RuntimeError("Tracked checkout is dirty")
        build_receipt_path = build_output / "evidence/build-receipt.json"
        build_bytes = build_receipt_path.read_bytes()
        build = json.loads(build_bytes)
        receipt["buildReceiptSha256"] = sha256(build_bytes)
        if build["status"] != "compiled_and_linked" or build["head"] != receipt["head"] or build["tree"] != receipt["tree"]:
            raise RuntimeError("A passing build receipt for this exact checkout is required")
        receipt["sourceBefore"] = tracked_snapshot(root, source_paths)
        receipt["fixtureBefore"] = tracked_snapshot(root, fixture_paths)
        if receipt["sourceBefore"] != build["sourceAfter"] or receipt["fixtureBefore"] != build["fixtureAfter"]:
            raise RuntimeError("Source or fixture differs from the compiled product")
        app = build_output / "DerivedData/Build/Products/Debug-iphonesimulator/IOSUIKitBuild.app"
        info = plistlib.loads((app / "Info.plist").read_bytes())
        if info["CFBundleIdentifier"] != BUNDLE_ID or info["CFBundleExecutable"] != "IOSUIKitBuild":
            raise RuntimeError("Unexpected compiled host bundle")
        binary = app / "IOSUIKitBuild"
        receipt["appSha256"] = sha256(binary.read_bytes())
        if receipt["appSha256"] != build["products"]["UIKitHost"]["sha256"]:
            raise RuntimeError("Compiled app executable differs from the build receipt")
        devices = json.loads(run("devices-before", ["xcrun", "simctl", "list", "devices", "available", "--json"]))
        runtimes = json.loads(run("runtimes", ["xcrun", "simctl", "list", "runtimes", "--json"]))
        runtime, kind = installed_pair(runtimes, devices)
        name = "QRGen-UI-" + receipt["runID"] + "-" + receipt["runAttempt"] + "-" + receipt["probeToken"][:8]
        created = run("create", ["xcrun", "simctl", "create", name, kind, runtime])
        if UUID.fullmatch(created) is None or created.lower() in device_ids(devices):
            raise RuntimeError("Create did not return a unique owned simulator UUID")
        owned = created
        receipt["ownedDevice"] = {"udid": owned, "name": name, "runtime": runtime, "deviceType": kind}
        sim("boot", "boot")
        sim("boot-ready", "bootstatus", "-b", timeout=300)
        sim("install", "install", str(app))
        container = pathlib.Path(sim("container", "get_app_container", BUNDLE_ID, "data"))
        if not container.is_absolute():
            raise RuntimeError("Simulator returned a non-absolute app container")
        container = container.resolve(strict=True)
        if owned.lower() not in {part.lower() for part in container.parts}:
            raise RuntimeError("App data container is not bound to the created simulator")
        # Every requested launch is collected before classification, including after a
        # previous semantic/control/harness result. An inconclusive probe never passes.
        for index, name in enumerate(requested):
            receipt["probes"].append(collect_probe(name, index, container))
        for record in receipt["probes"]:
            record.update(classify_probe(record))
        receipt["status"] = combined_status(receipt["probes"])
    except Exception as error:
        receipt["error"] = type(error).__name__ + ": " + str(error)
    finally:
        if owned is not None:
            for label, action, arguments in [
                ("terminate", "terminate", [BUNDLE_ID]), ("shutdown", "shutdown", []), ("delete", "delete", [])
            ]:
                try:
                    sim(label, action, *arguments, check=False)
                except Exception as error:
                    receipt.setdefault("cleanupErrors", []).append(label + ": " + str(error))
            try:
                after = json.loads(run("devices-after", ["xcrun", "simctl", "list", "devices", "--json"]))
                receipt["cleanupVerified"] = owned.lower() not in device_ids(after)
                if not receipt["cleanupVerified"]:
                    raise RuntimeError("Created simulator still exists after exact-UUID deletion")
            except Exception as error:
                receipt["status"] = "cleanup_failed"
                receipt.setdefault("cleanupErrors", []).append(str(error))
        try:
            receipt["headAfter"] = git(root, "rev-parse", "HEAD").decode().strip()
            receipt["treeAfter"] = git(root, "rev-parse", "HEAD^{tree}").decode().strip()
            receipt["sourceAfter"] = tracked_snapshot(root, source_paths)
            receipt["fixtureAfter"] = tracked_snapshot(root, fixture_paths)
            receipt["appSha256After"] = sha256(binary.read_bytes()) if "binary" in locals() else None
            if (receipt.get("head") != receipt["headAfter"] or receipt.get("tree") != receipt["treeAfter"]
                    or receipt.get("sourceBefore") != receipt["sourceAfter"] or receipt.get("fixtureBefore") != receipt["fixtureAfter"]
                    or receipt.get("appSha256") != receipt["appSha256After"]):
                raise RuntimeError("Source, fixture or compiled executable changed during the probe")
            if git(root, "status", "--porcelain", "--untracked-files=no").strip():
                raise RuntimeError("Tracked checkout changed during the probe")
        except Exception as error:
            receipt["status"] = "source_check_failed"
            receipt["closureError"] = type(error).__name__ + ": " + str(error)
        (evidence / "runtime-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps({"status": receipt["status"], "head": receipt.get("head"),
                      "probes": [{key: item.get(key) for key in ("name", "status")} for item in receipt["probes"]],
                      "cleanupVerified": receipt["cleanupVerified"]}))
    return 0 if receipt["status"] == "passed" and receipt["cleanupVerified"] else 1


if __name__ == "__main__":
    sys.exit(main())

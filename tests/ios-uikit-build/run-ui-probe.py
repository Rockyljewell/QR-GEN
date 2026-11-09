"""Run the opt-in UIKit lifecycle probe in one owned iOS Simulator."""

import argparse
import json
import os
import pathlib
import plistlib
import re
import shutil
import signal
import subprocess
import sys
import time
import uuid

from run import git, sha256, tracked_snapshot


BUNDLE_ID = "com.qrgen.ci.iosuikitbuild"
APP_RECEIPT = "qrgen-toast-lifecycle.json"
EXPECTED_CHECKS = {
    "ordinary_toast_hides": "control",
    "reappearance_clears_old_toast": "target",
    "fresh_toast_hides": "control",
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build-output", required=True)
    args = parser.parse_args()
    root = pathlib.Path(__file__).resolve().parents[2]
    temporary = pathlib.Path(os.environ["RUNNER_TEMP"]).resolve()
    build_output = pathlib.Path(args.build_output).resolve(strict=True)
    if build_output == temporary or not build_output.is_relative_to(temporary) or build_output.is_relative_to(root):
        raise RuntimeError("Build output must be a child of RUNNER_TEMP outside the checkout")
    evidence = build_output / "evidence/ui-runtime"
    evidence.mkdir(exist_ok=False)
    receipt = {
        "schemaVersion": 1, "status": "harness_failed",
        "scope": "Actual iOS Simulator UIKit lifecycle state with controlled scan callbacks; no camera or decoder execution",
        "physicalCameraClaim": False, "runID": os.environ.get("GITHUB_RUN_ID"),
        "runAttempt": os.environ.get("GITHUB_RUN_ATTEMPT"), "commands": [],
        "probeToken": str(uuid.uuid4()), "ownedDevice": None, "cleanupVerified": False,
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

    def sim(name, action, *arguments, timeout=60, check=True):
        if owned is None or UUID.fullmatch(owned) is None:
            raise RuntimeError("Refusing a device operation without the exact created UUID")
        return run(name, ["xcrun", "simctl", action, owned, *arguments], timeout, check)

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
        app_receipt_path = container / "Documents" / APP_RECEIPT
        sim("launch", "launch", BUNDLE_ID, "--qrgen-toast-lifecycle-probe", "--qrgen-probe-token", receipt["probeToken"])
        deadline = time.monotonic() + 45
        last_bytes = None
        payload = None
        while time.monotonic() < deadline:
            if app_receipt_path.is_file():
                last_bytes = app_receipt_path.read_bytes()
                try:
                    candidate = json.loads(last_bytes)
                    if candidate.get("phase") in ("complete", "harness-error"):
                        payload = candidate
                        break
                except (json.JSONDecodeError, UnicodeDecodeError):
                    pass
            time.sleep(0.25)
        if last_bytes is not None:
            (evidence / "app-receipt.json").write_bytes(last_bytes)
            receipt["appReceiptSha256"] = sha256(last_bytes)
        if payload is None:
            raise RuntimeError("No terminal app receipt within45s; UI oracle is inconclusive")
        receipt["appReceipt"] = payload
        if payload.get("schemaVersion") != 1 or payload.get("probeToken") != receipt["probeToken"]:
            raise RuntimeError("App receipt schema or launch token differs")
        if payload.get("phase") == "harness-error":
            raise RuntimeError("App timing/lifecycle calibration failed; no semantic conclusion")
        if payload.get("skippedCases") != 0 or payload.get("cameraStarted") is not False or payload.get("startsAutomatically") is not False:
            raise RuntimeError("Probe skipped a case or did not retain the no-camera contract")
        if payload.get("harnessErrors") != []:
            raise RuntimeError("App reported an invalid lifecycle/timing calibration")
        if payload.get("cleanupComplete") is not True:
            raise RuntimeError("App did not complete its real UIKit disappearance cleanup")
        states = payload.get("scannerStates", [])
        if not states or any(state not in ("idle", "stopped") for state in states):
            raise RuntimeError("Probe observed an unexpected scanner state")
        checks = payload.get("checks", [])
        if len(checks) != len(EXPECTED_CHECKS) or {item.get("name"): item.get("kind") for item in checks} != EXPECTED_CHECKS:
            raise RuntimeError("Missing or duplicate named UI oracles")
        if any(type(item.get("passed")) is not bool for item in checks) or type(payload.get("pass")) is not bool:
            raise RuntimeError("UI oracle results must be booleans")
        if payload["pass"] != all(item["passed"] for item in checks):
            raise RuntimeError("App result does not match its named checks")
        receipt["status"] = "passed" if payload["pass"] else "semantic_failed"
        if any(not item["passed"] for item in checks if item["kind"] == "control"):
            receipt["status"] = "control_failed"
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
    print(json.dumps({"status": receipt["status"], "head": receipt.get("head"), "cleanupVerified": receipt["cleanupVerified"]}))
    return 0 if receipt["status"] == "passed" and receipt["cleanupVerified"] else 1


if __name__ == "__main__":
    sys.exit(main())

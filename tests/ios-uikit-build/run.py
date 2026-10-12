"""Compile the current checkout's real iOS implementation and linked UIKit host."""

import argparse
import hashlib
import json
import os
import pathlib
import platform
import re
import shlex
import shutil
import signal
import subprocess
import sys


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def git(root, *arguments):
    return subprocess.check_output(["git", "-C", str(root), *arguments])


def tracked_snapshot(root, paths):
    names = git(root, "ls-files", "-z", "--", *paths).decode().split("\0")
    result = {}
    for name in sorted(filter(None, names)):
        data = (root / name).read_bytes()
        committed = git(root, "show", "HEAD:" + name)
        if data != committed:
            raise RuntimeError("Checkout differs from committed bytes: " + name)
        result[name] = {
            "gitBlob": git(root, "rev-parse", "HEAD:" + name).decode().strip(),
            "sha256": sha256(data),
        }
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    arguments = parser.parse_args()
    root = pathlib.Path(__file__).resolve().parents[2]
    temporary = pathlib.Path(os.environ["RUNNER_TEMP"]).resolve()
    output = pathlib.Path(arguments.output).resolve()
    if output == temporary or not output.is_relative_to(temporary) or output.is_relative_to(root):
        raise RuntimeError("Output must be a fresh child of RUNNER_TEMP outside the checkout")
    if output.exists():
        raise RuntimeError("Refusing to reuse an existing build output")
    output.mkdir(parents=True)
    evidence = output / "evidence"
    evidence.mkdir()
    receipt = {
        "schemaVersion": 1, "status": "started", "scope": "iOS Simulator compilation and linking only",
        "physicalCameraClaim": False, "renderingClaim": False, "commands": [],
        "runID": os.environ.get("GITHUB_RUN_ID"), "runAttempt": os.environ.get("GITHUB_RUN_ATTEMPT"),
        "machine": platform.machine(), "platform": platform.platform(),
    }
    source_paths = ["Package.swift", "packages/ios/Sources/QRGenKit"]
    fixture_paths = [".github/workflows/ci.yml", "tests/ios-uikit-build"]

    def run(name, command, timeout=60):
        log = evidence / (name + ".log")
        record = {"name": name, "command": list(map(str, command)), "log": log.name}
        receipt["commands"].append(record)
        try:
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
                    record["processGroupCleanupAttempted"] = True
                    raise
            record["exitCode"] = process.returncode
            if process.returncode:
                raise RuntimeError(name + " exited " + str(process.returncode))
        except subprocess.TimeoutExpired:
            record["timedOut"] = True
            raise
        return log.read_text(errors="replace")

    try:
        if sys.platform != "darwin" or receipt["machine"] not in ("arm64", "x86_64"):
            raise RuntimeError("An Apple host with a supported Simulator architecture is required")
        receipt["head"] = git(root, "rev-parse", "HEAD").decode().strip()
        receipt["tree"] = git(root, "rev-parse", "HEAD^{tree}").decode().strip()
        if receipt["head"] != os.environ["GITHUB_SHA"]:
            raise RuntimeError("Checkout does not match this event's exact commit")
        if git(root, "status", "--porcelain", "--untracked-files=no").strip():
            raise RuntimeError("Tracked checkout is dirty before the build")
        receipt["sourceBefore"] = tracked_snapshot(root, source_paths)
        receipt["fixtureBefore"] = tracked_snapshot(root, fixture_paths)
        if "Package.swift" not in receipt["sourceBefore"]:
            raise RuntimeError("Current checkout's package manifest is missing")
        swift_paths = {name for name in receipt["sourceBefore"] if name.endswith(".swift") and name != "Package.swift"}
        disk_swift_paths = {path.relative_to(root).as_posix() for path in (root / "packages/ios/Sources/QRGenKit").rglob("*.swift")}
        if disk_swift_paths != swift_paths:
            raise RuntimeError("Working Swift source inventory differs from tracked source")
        controller = "packages/ios/Sources/QRGenKit/QRGenScannerViewController.swift"
        if controller not in swift_paths:
            raise RuntimeError("Actual iOS scanner source is missing")
        receipt["expectedSwiftSources"] = sorted(swift_paths)
        host = output / "host"
        host.mkdir()
        copied = {}
        for name, binding in receipt["fixtureBefore"].items():
            relative = pathlib.PurePosixPath(name).relative_to("tests/ios-uikit-build") if name.startswith("tests/ios-uikit-build/") else None
            if relative is None or relative.as_posix() in ("README.md", "run.py"):
                continue
            target = host / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(root / name, target)
            copied[relative.as_posix()] = binding["sha256"]
        receipt["copiedBefore"] = copied
        (host / "QRGenSource").symlink_to(root, target_is_directory=True)
        if (host / "QRGenSource").resolve(strict=True) != root:
            raise RuntimeError("Build host's package reference does not resolve to this checkout")
        receipt["packageReferenceBefore"] = str((host / "QRGenSource").resolve(strict=True))
        run("xcode-version", ["xcodebuild", "-version"])
        run("simulator-sdk-version", ["xcrun", "--sdk", "iphonesimulator", "--show-sdk-version"])
        architecture = receipt["machine"]
        derived = output / "DerivedData"
        build_log = run("xcodebuild", [
            "xcodebuild", "build", "-project", str(host / "IOSUIKitBuild.xcodeproj"),
            "-scheme", "IOSUIKitBuild", "-configuration", "Debug",
            "-destination", "generic/platform=iOS Simulator", "-derivedDataPath", str(derived),
            "-resultBundlePath", str(evidence / "Build.xcresult"),
            "ARCHS=" + architecture, "ONLY_ACTIVE_ARCH=YES", "CODE_SIGNING_ALLOWED=NO",
        ], timeout=900)
        compiled = set()
        unexpected = []
        for line in build_log.splitlines():
            match = re.match(r"^SwiftCompile normal (\S+) (/.+\.swift) \(in target 'QRGenKit' from project 'QRGenKit'\)$", line)
            if not match:
                continue
            path = pathlib.Path(match[2].replace("\\ ", " ")).resolve()
            if match[1] != architecture or not path.is_relative_to(root):
                unexpected.append(line)
            else:
                compiled.add(path.relative_to(root).as_posix())
        receipt["compiledSwiftSources"] = sorted(compiled)
        receipt["unexpectedSwiftCompileLines"] = unexpected
        if compiled != swift_paths or unexpected:
            raise RuntimeError("Actual compiler source/architecture inventory differs from the checkout")
        target = architecture + "-apple-ios"
        if target not in build_log or "-simulator" not in build_log:
            raise RuntimeError("Missing actual iOS Simulator compiler target")
        products = derived / "Build/Products/Debug-iphonesimulator"
        binaries = {"QRGenKitObject": products / "QRGenKit.o", "UIKitHost": products / "IOSUIKitBuild.app/IOSUIKitBuild"}
        receipt["products"] = {}
        for name, path in binaries.items():
            if not path.is_file() or path.stat().st_size == 0:
                raise RuntimeError("Missing actual build product: " + name)
            arches = run("architecture-" + name, ["xcrun", "lipo", "-archs", str(path)]).strip().split()
            receipt["products"][name] = {"architecture": arches, "sha256": sha256(path.read_bytes()), "bytes": path.stat().st_size}
            if arches != [architecture]:
                raise RuntimeError("Build product architecture mismatch: " + name)
        link_lists = list(derived.rglob("IOSUIKitBuild.LinkFileList"))
        bound_link_lists = []
        for index, path in enumerate(link_lists):
            contents = path.read_text()
            (evidence / ("host-link-inputs-" + str(index) + ".txt")).write_text(contents)
            inputs = {pathlib.Path(entry).resolve() for entry in shlex.split(contents)}
            if binaries["QRGenKitObject"].resolve() in inputs:
                if str(path) not in build_log:
                    raise RuntimeError("Host link input list is not present in the actual build log")
                bound_link_lists.append(str(path.relative_to(derived)))
        receipt["hostLinkListsContainingQRGenKit"] = bound_link_lists
        if not bound_link_lists:
            raise RuntimeError("Host link inputs do not contain the actual QRGenKit object")
        receipt["status"] = "compiled_and_linked"
    except Exception as error:
        receipt["status"] = "build_check_failed"
        receipt["error"] = type(error).__name__ + ": " + str(error)
    finally:
        try:
            receipt["headAfter"] = git(root, "rev-parse", "HEAD").decode().strip()
            receipt["treeAfter"] = git(root, "rev-parse", "HEAD^{tree}").decode().strip()
            if receipt.get("head") != receipt["headAfter"] or receipt.get("tree") != receipt["treeAfter"]:
                raise RuntimeError("Checkout commit or tree changed during the build")
            receipt["sourceAfter"] = tracked_snapshot(root, source_paths)
            receipt["fixtureAfter"] = tracked_snapshot(root, fixture_paths)
            if receipt.get("sourceBefore") != receipt["sourceAfter"] or receipt.get("fixtureBefore") != receipt["fixtureAfter"]:
                raise RuntimeError("Source or fixture changed during the build")
            if "copiedBefore" in receipt:
                receipt["packageReferenceAfter"] = str((output / "host/QRGenSource").resolve(strict=True))
                if receipt.get("packageReferenceBefore") != receipt["packageReferenceAfter"] or receipt["packageReferenceAfter"] != str(root):
                    raise RuntimeError("Build host's package reference changed")
                receipt["copiedAfter"] = {name: sha256((output / "host" / name).read_bytes()) for name in receipt["copiedBefore"]}
                if receipt["copiedBefore"] != receipt["copiedAfter"]:
                    raise RuntimeError("Copied build host changed")
            if git(root, "status", "--porcelain", "--untracked-files=no").strip():
                raise RuntimeError("Tracked checkout changed during the build")
        except Exception as error:
            receipt["status"] = "build_check_failed"
            receipt["closureError"] = type(error).__name__ + ": " + str(error)
        (evidence / "build-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps({"status": receipt["status"], "head": receipt.get("head"), "sourceCount": len(receipt.get("compiledSwiftSources", []))}))
    return 0 if receipt["status"] == "compiled_and_linked" else 1


if __name__ == "__main__":
    sys.exit(main())

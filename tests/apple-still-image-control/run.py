"""Record SDK and direct Apple Vision observations; no accuracy or camera claim."""

import argparse
import hashlib
import json
import os
import pathlib
import platform
import shlex
import shutil
import signal
import subprocess
import sys

INPUT_HASH = "bdb3352f06392328c5c5f69369fbed5c2ebe06d4e3d37b0f39bae7672791c01c"
PAYLOAD = "qrgen-ios-native-highlight-capability-978214d"
FIXTURE = "tests/apple-still-image-control"
WORKFLOW = ".github/workflows/apple-still-image-control.yml"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args])


def snapshot(root, paths):
    names = sorted(filter(None, git(root, "ls-files", "-z", "--", *paths).decode().split("\0")))
    result = {}
    for name in names:
        data = (root / name).read_bytes()
        if data != git(root, "cat-file", "blob", "HEAD:" + name):
            raise RuntimeError("Tracked bytes differ: " + name)
        result[name] = {"sha256": hashlib.sha256(data).hexdigest(), "gitBlob": git(root, "rev-parse", "HEAD:" + name).decode().strip()}
    return result


def validate_observations(observations, results):
    if observations.get("schemaVersion") != 1 or observations.get("status") != "observations_recorded" or observations.get("protocol") != "two_inputs_two_arms_single_pass_sdk_then_vision_v1":
        raise RuntimeError("Missing exact observation protocol")
    inputs = observations.get("inputs")
    ids = ["immutable_saved_png", "new_generated_control_png"]
    if not isinstance(inputs, list) or len(inputs) != 2 or [item.get("id") for item in inputs] != ids or inputs[0].get("available") is not True:
        raise RuntimeError("Missing mandatory immutable input or distinct ordered input records")
    available = [item for item in inputs if item.get("available") is True]
    if observations.get("availableInputs") != [item["id"] for item in available] or observations.get("availableInputCount") != len(available) or len(available) not in (1, 2):
        raise RuntimeError("Available input inventory is inconsistent")
    if observations.get("decodeCallLimit") != 4 or observations.get("decodeCallCount") != 2 * len(available):
        raise RuntimeError("Partial or excessive decode call inventory")
    if inputs[0].get("sha256") != INPUT_HASH or (inputs[0].get("width"), inputs[0].get("height")) != (720, 1280):
        raise RuntimeError("Immutable input observation binding differs")
    call_index = 1
    for item in inputs:
        if item.get("available") is False:
            if not item.get("status") or not isinstance(item.get("error"), dict) or item.get("arms"):
                raise RuntimeError("Unavailable generated input has no explicit preparation error")
            if item["status"] == "generated_png_image_preparation_failed":
                if item.get("fileName") != "generated-control.png" or digest(results / "generated-control.png") != item.get("sha256"):
                    raise RuntimeError("Undecodable generated PNG observation binding differs")
            continue
        if item.get("available") is not True:
            raise RuntimeError("Input availability must be explicit")
        arms = item.get("arms")
        if not isinstance(arms, list) or len(arms) != 2 or [arm.get("arm") for arm in arms] != ["public_QRGen_scan", "direct_Apple_Vision"]:
            raise RuntimeError("Missing ordered SDK and direct Vision arms")
        for arm in arms:
            if arm.get("decodeCallIndex") != call_index or arm.get("status") not in ("returned", "threw"):
                raise RuntimeError("Decode call order or status is inconsistent")
            call_index += 1
            values = arm.get("orderedResults")
            if arm["status"] == "threw" and not isinstance(arm.get("error"), dict):
                raise RuntimeError("Throwing arm lost its error")
            if arm["status"] == "returned" and arm.get("error") is not None:
                raise RuntimeError("Returning arm has an inconsistent error")
            if arm["arm"] == "public_QRGen_scan":
                if arm["status"] == "returned" and (not isinstance(values, list) or arm.get("resultCount") != len(values)):
                    raise RuntimeError("SDK result multiplicity is inconsistent")
                if arm["status"] == "threw" and (values is not None or arm.get("resultCount") is not None):
                    raise RuntimeError("Throwing SDK arm fabricated results")
            else:
                if arm.get("resultsWereNil") is True:
                    if values is not None or arm.get("resultCount") is not None:
                        raise RuntimeError("Nil Vision results were replaced")
                elif arm.get("resultsWereNil") is False:
                    if not isinstance(values, list) or arm.get("resultCount") != len(values):
                        raise RuntimeError("Vision result multiplicity is inconsistent")
                else:
                    raise RuntimeError("Missing nil versus empty Vision result distinction")
        if item["id"] == "new_generated_control_png":
            if item.get("fileName") != "generated-control.png" or digest(results / "generated-control.png") != item.get("sha256"):
                raise RuntimeError("Generated PNG observation binding differs")
    if call_index - 1 != observations["decodeCallCount"]:
        raise RuntimeError("Decode call inventory did not close")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work", required=True)
    args = parser.parse_args()
    root = pathlib.Path(__file__).resolve().parents[2]
    temporary = pathlib.Path(os.environ["RUNNER_TEMP"]).resolve(strict=True)
    work = pathlib.Path(args.work).resolve()
    if work == temporary or not work.is_relative_to(temporary) or work.is_relative_to(root) or root.is_relative_to(work):
        raise RuntimeError("Work must be a fresh RUNNER_TEMP child outside the source checkout")
    if work.exists():
        raise RuntimeError("Refusing existing output")
    work.mkdir()
    evidence = work / "evidence"
    evidence.mkdir()
    logs = evidence / "logs"
    logs.mkdir()
    receipt = {
        "schemaVersion": 1, "status": "started", "commands": [],
        "scope": "Two still images, public SDK versus direct Apple Vision; observations only",
        "physicalCameraClaim": False, "previewMappingClaim": False, "ScanditComparisonClaim": False,
        "runner": {name: os.environ.get(name) for name in ("GITHUB_SHA", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "RUNNER_OS", "RUNNER_ARCH", "ImageOS", "ImageVersion")},
        "machine": platform.machine(), "platform": platform.platform(),
    }
    source_paths = ["Package.swift", "packages/ios/Sources/QRGenKit"]
    fixture_paths = [WORKFLOW, FIXTURE]

    def run(name, command, timeout=60):
        record = {"name": name, "command": list(map(str, command)), "log": "logs/" + name + ".log"}
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
                record["processGroupCleanupAttempted"] = True
                raise
        record["exitCode"] = process.returncode
        if process.returncode:
            raise RuntimeError(name + " exited " + str(process.returncode))
        return log.read_text(errors="replace")

    try:
        if sys.platform != "darwin" or receipt["machine"] not in ("arm64", "x86_64"):
            raise RuntimeError("An Apple host is required")
        receipt["head"] = git(root, "rev-parse", "HEAD").decode().strip()
        receipt["tree"] = git(root, "rev-parse", "HEAD^{tree}").decode().strip()
        if receipt["head"] != os.environ["GITHUB_SHA"]:
            raise RuntimeError("Checkout does not match the exact event commit")
        if git(root, "status", "--porcelain=v1").strip():
            raise RuntimeError("Checkout is dirty before execution")
        receipt["sourceBefore"] = snapshot(root, source_paths)
        receipt["fixtureBefore"] = snapshot(root, fixture_paths)
        swift_names = {name for name in receipt["sourceBefore"] if name.endswith(".swift") and name != "Package.swift"}
        disk_names = {path.relative_to(root).as_posix() for path in (root / source_paths[1]).rglob("*.swift")}
        if swift_names != disk_names or "Package.swift" not in receipt["sourceBefore"]:
            raise RuntimeError("Swift source inventory differs from tracked inputs")
        receipt["expectedSwiftSources"] = sorted(swift_names)
        consumer = work / "consumer"
        consumer.mkdir()
        copied = {}
        for name in ("Package.swift", "Sources/AppleStillImageProbe/Probe.swift"):
            source = root / FIXTURE / "consumer" / name
            target = consumer / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
            copied[name] = digest(target)
            if copied[name] != receipt["fixtureBefore"][FIXTURE + "/consumer/" + name]["sha256"]:
                raise RuntimeError("Copied consumer differs from current event's committed fixture: " + name)
        receipt["copiedBefore"] = copied
        reference = consumer / "QRGenSource"
        reference.symlink_to(root, target_is_directory=True)
        if reference.resolve(strict=True) != root:
            raise RuntimeError("Consumer dependency is not this checkout")
        receipt["packageReferenceBefore"] = str(reference.resolve(strict=True))
        inputs = work / "inputs"
        inputs.mkdir()
        input_image = inputs / "simulator-generated-input.png"
        shutil.copyfile(root / FIXTURE / "fixtures/simulator-generated-input.png", input_image)
        receipt["inputBefore"] = digest(input_image)
        if receipt["inputBefore"] != INPUT_HASH:
            raise RuntimeError("Saved Simulator PNG hash mismatch")
        shutil.copyfile(input_image, evidence / "simulator-generated-input.png")
        run("os-version", ["sw_vers"])
        run("xcode-version", ["xcodebuild", "-version"])
        run("swift-version", ["swift", "--version"])
        run("sdk-version", ["xcrun", "--sdk", "macosx", "--show-sdk-version"])
        scratch = work / "build"
        command = ["swift", "build", "--package-path", str(consumer), "--scratch-path", str(scratch)]
        build_log = run("swift-build", [*command, "--product", "AppleStillImageProbe", "-v"], timeout=600)
        compiler_inputs = set()
        for line in build_log.splitlines():
            if "-module-name QRGenKit" not in line or ("swift-frontend" not in line and "swiftc" not in line):
                continue
            for token in shlex.split(line):
                path = pathlib.Path(token)
                if path.is_absolute() and path.suffix == ".swift" and path.resolve().is_relative_to(root):
                    compiler_inputs.add(path.resolve().relative_to(root).as_posix())
        receipt["compilerInputSwiftSources"] = sorted(compiler_inputs)
        if compiler_inputs != swift_names:
            raise RuntimeError("Verbose compiler inputs do not cover the exact SDK source inventory")
        bin_output = run("swift-bin-path", [*command, "--show-bin-path"]).strip().splitlines()
        binary = pathlib.Path(bin_output[-1]) / "AppleStillImageProbe"
        if not binary.resolve(strict=True).is_relative_to(scratch) or binary.stat().st_size == 0:
            raise RuntimeError("Executable is not a nonempty product of this fresh build")
        receipt["binary"] = {"path": str(binary.relative_to(work)), "sha256": digest(binary), "bytes": binary.stat().st_size}
        arches = run("binary-architectures", ["xcrun", "lipo", "-archs", str(binary)]).strip().split()
        receipt["binary"]["architectures"] = arches
        if arches != [receipt["machine"]]:
            raise RuntimeError("Executable architecture differs from this host")
        run("binary-frameworks", ["xcrun", "otool", "-L", str(binary)])
        run("decode-observations", [str(binary), "--input", str(input_image), "--input-sha256", INPUT_HASH, "--expected-payload", PAYLOAD, "--output", str(evidence / "observations")], timeout=120)
        observation_file = evidence / "observations/observations.json"
        observations = json.loads(observation_file.read_text())
        validate_observations(observations, evidence / "observations")
        receipt["observations"] = {"path": "observations/observations.json", "sha256": digest(observation_file), "decodeCallCount": observations["decodeCallCount"]}
        receipt["status"] = "observations_recorded"
    except Exception as error:
        receipt["status"] = "harness_failure"
        receipt["error"] = type(error).__name__ + ": " + str(error)
    finally:
        try:
            receipt["headAfter"] = git(root, "rev-parse", "HEAD").decode().strip()
            receipt["treeAfter"] = git(root, "rev-parse", "HEAD^{tree}").decode().strip()
            receipt["sourceAfter"] = snapshot(root, source_paths)
            receipt["fixtureAfter"] = snapshot(root, fixture_paths)
            if receipt.get("head") != receipt["headAfter"] or receipt.get("tree") != receipt["treeAfter"] or receipt.get("sourceBefore") != receipt["sourceAfter"] or receipt.get("fixtureBefore") != receipt["fixtureAfter"]:
                raise RuntimeError("Source or fixture changed during execution")
            if "copiedBefore" in receipt:
                receipt["copiedAfter"] = {name: digest(work / "consumer" / name) for name in receipt["copiedBefore"]}
                receipt["packageReferenceAfter"] = str((work / "consumer/QRGenSource").resolve(strict=True))
                if receipt["copiedBefore"] != receipt["copiedAfter"] or receipt["packageReferenceBefore"] != receipt["packageReferenceAfter"] or receipt["packageReferenceAfter"] != str(root):
                    raise RuntimeError("Copied consumer or dependency binding changed")
            if "inputBefore" in receipt:
                receipt["inputAfter"] = digest(work / "inputs/simulator-generated-input.png")
                if receipt["inputBefore"] != receipt["inputAfter"] or receipt["inputAfter"] != INPUT_HASH:
                    raise RuntimeError("Immutable input changed")
                if digest(evidence / "simulator-generated-input.png") != INPUT_HASH:
                    raise RuntimeError("Evidence copy of immutable input changed")
            if "binary" in receipt and digest(work / receipt["binary"]["path"]) != receipt["binary"]["sha256"]:
                raise RuntimeError("Executable changed during execution")
            if git(root, "status", "--porcelain=v1").strip():
                raise RuntimeError("Checkout changed during execution")
        except Exception as error:
            receipt["status"] = "harness_failure"
            receipt["closureError"] = type(error).__name__ + ": " + str(error)
        receipt["timedOutCommandCount"] = sum(bool(command.get("timedOut")) for command in receipt["commands"])
        (evidence / "run-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps({"status": receipt["status"], "head": receipt.get("head"), "sourceCount": len(receipt.get("compilerInputSwiftSources", []))}))
    return 0 if receipt["status"] == "observations_recorded" else 1


if __name__ == "__main__":
    sys.exit(main())

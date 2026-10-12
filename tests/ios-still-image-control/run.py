"""Retain current-checkout iOS Simulator SDK/direct-Vision observations only."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shlex
import shutil
import signal
import struct
import subprocess
import sys
import time
import uuid

REL = Path("tests/ios-still-image-control")
WORKFLOW = ".github/workflows/ios-still-image-control.yml"
PROTOCOL = "two_inputs_two_arms_single_pass_sdk_then_vision_ios_simulator_v1"
MARKER = "QRGEN_IOS_STILL_IMAGE_JSON:"
TEST = "QRGenStillImageTests/StillImageControlTests/testPairedStillImageObservations"
INPUT = "bdb3352f06392328c5c5f69369fbed5c2ebe06d4e3d37b0f39bae7672791c01c"
PAYLOAD = "qrgen-ios-native-highlight-capability-978214d"
RUNTIME = {
    "App/Info.plist": "a9dd97fd760bd3f86e09a1820ed27b7500487e30178d21a7d3012dbcb321eee1",
    "App/StillImageApp.swift": "90c807706ee20bef46bfd6130b38832e556157dd0dc07d13cc686d3a5a344940",
    "QRGenStillImageControl.xcodeproj/project.pbxproj": "725149d7546dd676c8a962a9562305c6a6fbea5c73acd817e6572a7f1a9e0527",
    "QRGenStillImageControl.xcodeproj/xcshareddata/xcschemes/QRGenStillImageControl.xcscheme": "3e9486fa45b28e37dcbfccdc5b29ca9083b92920378becb272bb75d274b28b36",
    "Tests/StillImageControlTests.swift": "c1db09cb98c932e7c9a54c09090d75d86fa10340ec9519d161328a19ca01ab5a",
    "Tests/Resources/simulator-generated-input.png": INPUT,
}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(path, value):
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def stop_group(process):
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        pass
    # The parent exiting does not prove descendants exited: always fence its group.
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait(timeout=10)


def git(root, *args):
    process = subprocess.Popen(["git", "-C", str(root), *args], stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, start_new_session=True)
    try:
        out, err = process.communicate(timeout=30)
    except subprocess.TimeoutExpired:
        stop_group(process)
        raise
    require(process.returncode == 0, "Git read failed: " + err.decode(errors="replace"))
    return out


def snapshot(root, paths):
    names = sorted(filter(None, git(root, "ls-files", "-z", "--", *paths).decode().split("\0")))
    result = {}
    for name in names:
        path = root / name
        require(not path.is_symlink() and path.resolve(strict=True).is_relative_to(root), "Unexpected source symlink")
        data = path.read_bytes()
        require(data == git(root, "cat-file", "blob", "HEAD:" + name), "Working bytes differ: " + name)
        result[name] = {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data),
                        "gitBlob": git(root, "rev-parse", "HEAD:" + name).decode().strip()}
    return result


def validate(value, architecture, images):
    require(value.get("schemaVersion") == 1 and value.get("status") == "observations_recorded"
            and value.get("protocol") == PROTOCOL, "Wrong observation protocol/status")
    require(value.get("immutableInputSHA256") == INPUT and value.get("expectedPayload") == PAYLOAD
            and value.get("expectedSymbology") == "qr", "Wrong input/payload contract")
    environment = value.get("environment", {})
    require(environment.get("simulatorBuild") is True and environment.get("compiledArchitecture") == architecture,
            "Not this architecture's Simulator test")
    inputs = value.get("inputs")
    require(isinstance(inputs, list) and len(inputs) == 2
            and [item.get("id") for item in inputs] == ["immutable_saved_png", "new_generated_control_png"], "Wrong input inventory")
    require(inputs[0].get("available") is True and inputs[0].get("sha256") == INPUT
            and (inputs[0].get("width"), inputs[0].get("height")) == (720, 1280), "Wrong mandatory PNG")
    require(value.get("observedBundledInput") == {"fileName": "simulator-generated-input.png", "sha256": INPUT, "byteCount": 28646},
            "Missing actual bundled input binding")
    available = [item for item in inputs if item.get("available") is True]
    require(value.get("availableInputs") == [item["id"] for item in available]
            and value.get("availableInputCount") == len(available), "Wrong availability inventory")
    require(value.get("decodeCallLimit") == 4 and value.get("decodeCallCount") == 2 * len(available), "Wrong call count")
    by_role = {image["role"]: image for image in images}
    require(len(by_role) == len(images) and "immutable_saved_png" in by_role, "Missing/duplicate input attachment role")
    saved = by_role["immutable_saved_png"]
    require(saved["sha256"] == INPUT and saved["bytes"] == 28646 and saved["dimensions"] == [720, 1280],
            "Wrong immutable PNG attachment bytes/dimensions")
    calls = []
    for item in inputs:
        if item.get("available") is False:
            require(item["id"] == "new_generated_control_png" and item.get("status") in
                    ("generation_failed", "generated_png_image_preparation_failed")
                    and isinstance(item.get("error"), dict) and not item.get("arms"), "Missing generated-input error")
            if item["status"] == "generated_png_image_preparation_failed":
                image = by_role.get("new_generated_control_png", {})
                require(item.get("stage") == "ImageIO_preparation" and item.get("generationStatus") == "returned"
                        and item.get("fileName") == "generated-control.png" and image.get("sha256") == item.get("sha256")
                        and image.get("bytes") == item.get("byteCount") and type(item.get("byteCount")) is int and item["byteCount"] > 0,
                        "Missing exact undecodable generated PNG binding")
            else:
                require("new_generated_control_png" not in by_role and item.get("generationArguments") ==
                        {"data": PAYLOAD, "symbology": "qr", "scale": 8, "ecLevel": "M"}, "Wrong generation-failure binding")
            continue
        require(item.get("available") is True, "Availability must be explicit")
        require(item.get("orientation") == {"name": "up", "rawValue": 1}
                and item.get("handlerInputKind") == "CGImage decoded once with ImageIO, same object passed to both arms",
                "Wrong same-image/orientation contract")
        image = by_role.get(item["id"], {})
        require(item.get("fileName") == ("simulator-generated-input.png" if item["id"] == "immutable_saved_png" else "generated-control.png")
                and image.get("sha256") == item.get("sha256") and image.get("bytes") == item.get("byteCount")
                and type(item.get("byteCount")) is int and item["byteCount"] > 0
                and type(item.get("width")) is int and item["width"] > 0 and type(item.get("height")) is int and item["height"] > 0
                and image.get("dimensions") == [item["width"], item["height"]], "PNG role/bytes/dimensions differ")
        arms = item.get("arms")
        require(isinstance(arms, list) and len(arms) == 2
                and [arm.get("arm") for arm in arms] == ["public_QRGen_scan", "direct_Apple_Vision"], "Wrong arm order")
        for arm in arms:
            require(arm.get("decodeCallIndex") == len(calls) + 1 and isinstance(arm.get("invocationThreadIsMain"), bool), "Invalid call/thread metadata")
            calls.append({"decodeCallIndex": len(calls) + 1, "inputID": item["id"], "arm": arm["arm"],
                          "invocationThreadIsMain": arm["invocationThreadIsMain"]})
            require(arm.get("status") in ("returned", "threw"), "Missing arm status")
            require({"error", "orderedResults", "resultCount"} <= arm.keys(), "Missing explicit result/error fields")
            require(isinstance(arm.get("error"), dict) if arm["status"] == "threw" else arm.get("error") is None,
                    "Lost/inconsistent arm error")
            values = arm.get("orderedResults")
            if arm["arm"] == "public_QRGen_scan":
                require(arm.get("arguments") == {"orientation": "up", "symbologies": ["qr"]}, "Wrong SDK arguments")
                require((isinstance(values, list) and arm.get("resultCount") == len(values)) if arm["status"] == "returned"
                        else values is None and arm.get("resultCount") is None, "Inconsistent SDK result multiplicity")
            else:
                require(isinstance(arm.get("resultsWereNil"), bool), "Missing raw nil distinction")
                require((values is None and arm.get("resultCount") is None) if arm["resultsWereNil"]
                        else isinstance(values, list) and arm.get("resultCount") == len(values), "Inconsistent raw result multiplicity")
                require(arm.get("handlerInputKind") == "CGImage" and arm.get("orientation") == "up"
                        and arm.get("handlerOptions") == {}, "Wrong raw handler")
                for name in ("requestBeforePerform", "requestAfterPerform"):
                    meta = arm.get(name, {})
                    require(isinstance(meta, dict) and {"runtimeType", "revision", "classDefaultRevision", "classCurrentRevision",
                            "classSupportedRevisions", "symbologies", "regionOfInterest", "revisionOverride", "regionOfInterestOverride",
                            "executionDevicePolicy", "preferBackgroundProcessing", "coalesceCompositeSymbologies"} <= meta.keys(),
                            "Truncated raw request metadata")
                    require(meta.get("revisionOverride") is False and meta.get("regionOfInterestOverride") is False
                            and meta.get("symbologies") == ["VNBarcodeSymbologyQR"]
                            and meta.get("regionOfInterest") == {"x": 0, "y": 0, "width": 1, "height": 1}, "Wrong raw request settings")
                    require(isinstance(meta["runtimeType"], str) and bool(meta["runtimeType"])
                            and all(type(meta[key]) is int and meta[key] > 0 for key in ("revision", "classDefaultRevision", "classCurrentRevision"))
                            and isinstance(meta["classSupportedRevisions"], list) and bool(meta["classSupportedRevisions"])
                            and all(type(revision) is int and revision > 0 for revision in meta["classSupportedRevisions"])
                            and type(meta["preferBackgroundProcessing"]) is bool
                            and meta["executionDevicePolicy"] == "Unchanged request default; no CPU/GPU override."
                            and (type(meta["coalesceCompositeSymbologies"]) is bool or meta["coalesceCompositeSymbologies"] ==
                                 {"available": False, "requires": "iOS 17 / macOS 14"}), "Invalid raw request defaults")
                support = arm.get("supportedSymbologiesQuery", {})
                require(isinstance(support, dict) and {"status", "orderedSymbologies", "error"} <= support.keys()
                        and support["status"] in ("returned", "threw"), "Lost support query")
                if support["status"] == "returned":
                    require(isinstance(support["orderedSymbologies"], list) and all(isinstance(name, str) for name in support["orderedSymbologies"])
                            and type(support.get("containsRequestedQR")) is bool and support["containsRequestedQR"] ==
                            ("VNBarcodeSymbologyQR" in support["orderedSymbologies"]) and support["error"] is None, "Invalid support-query results")
                else:
                    require(support["orderedSymbologies"] is None and isinstance(support["error"], dict), "Invalid support-query error")
        if item["id"] == "new_generated_control_png":
            require(item.get("generation") == {"api": "QRGen.generatePNG(_:symbology:scale:ecLevel:)",
                    "arguments": {"data": PAYLOAD, "symbology": "qr", "scale": 8, "ecLevel": "M"},
                    "status": "returned", "error": None}, "Missing generation observation")
    require(value.get("decodeCalls") == calls and len(calls) in (2, 4), "Ledger does not match attempted calls")
    return "complete_2x2" if len(calls) == 4 else "partial_generated_input_unavailable"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    temp = Path(os.environ["RUNNER_TEMP"]).resolve(strict=True)
    requested = Path(args.output)
    output = requested.parent.resolve(strict=True) / requested.name
    require(requested.name not in ("", ".", "..") and output != temp and output.is_relative_to(temp), "Output must be a fresh canonical RUNNER_TEMP child")
    require(not output.exists() and not output.is_symlink() and not output.is_relative_to(root) and not root.is_relative_to(output), "Output overlaps checkout or exists")
    require(not any((parent / ".git").exists() for parent in (output.parent, *output.parent.parents)), "Output is inside a checkout")
    output.mkdir()
    evidence = output / "evidence"
    evidence.mkdir()
    (evidence / "logs").mkdir()
    host = output / "host"
    derived = output / "DerivedData"
    receipt = {"schemaVersion": 1, "status": "started", "scope": "Current-event iOS Simulator still-image observations only",
               "commands": [], "physicalCameraClaim": False, "previewMappingClaim": False, "ScanditComparisonClaim": False,
               "runner": {key: os.environ.get(key) for key in ("GITHUB_SHA", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "RUNNER_OS", "RUNNER_ARCH", "ImageOS", "ImageVersion")}}
    owned = None
    product_paths = {}
    source_paths = ["Package.swift", "packages/ios/Sources/QRGenKit"]
    fixture_paths = [WORKFLOW, REL.as_posix()]
    result = evidence / "Test.xcresult"
    save(evidence / "run-receipt.json", receipt)

    def command(name, argv, timeout=60, allow_failure=False):
        log = evidence / "logs" / (str(len(receipt["commands"]) + 1).zfill(2) + "-" + name + ".log")
        item = {"name": name, "argv": list(map(str, argv)), "log": log.relative_to(evidence).as_posix()}
        receipt["commands"].append(item)
        with log.open("wb") as stream:
            process = subprocess.Popen(item["argv"], stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
            try:
                process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                item["timedOut"] = True
                stop_group(process)
            item["exitCode"] = process.returncode
        if (item.get("timedOut") or process.returncode != 0) and not allow_failure:
            raise RuntimeError(name + " failed; see " + item["log"])
        return process.returncode, log.read_text(encoding="utf-8", errors="replace")

    try:
        architecture = platform.machine()
        require(sys.platform == "darwin" and architecture in ("arm64", "x86_64"), "Supported Apple host required")
        receipt["architecture"] = architecture
        receipt["head"] = git(root, "rev-parse", "HEAD").decode().strip()
        receipt["tree"] = git(root, "rev-parse", "HEAD^{tree}").decode().strip()
        require(receipt["head"] == os.environ["GITHUB_SHA"] and re.fullmatch(r"[0-9a-f]{40}", receipt["head"]), "Wrong event checkout")
        require(not git(root, "status", "--porcelain=v1", "--untracked-files=all").strip(), "Dirty checkout")
        receipt["sourceBefore"] = snapshot(root, source_paths)
        receipt["fixtureBefore"] = snapshot(root, fixture_paths)
        expected_fixture = {WORKFLOW, (REL / "run.py").as_posix(), (REL / "README.md").as_posix()} | {(REL / name).as_posix() for name in RUNTIME}
        require(set(receipt["fixtureBefore"]) == expected_fixture, "Unexpected fixture files/private metadata")
        require({(REL / path.relative_to(root / REL)).as_posix() for path in (root / REL).rglob("*") if path.is_file()}
                == expected_fixture - {WORKFLOW}, "Unexpected disk fixture files")
        swift = {name for name in receipt["sourceBefore"] if name != "Package.swift" and name.endswith(".swift")}
        require(len(receipt["sourceBefore"]) == 19 and len(swift) == 18 and swift == {path.relative_to(root).as_posix() for path in (root / source_paths[1]).rglob("*.swift")}, "Source inventory differs")
        receipt["expectedSwiftSources"] = sorted(swift)
        host.mkdir()
        copied = {}
        for name, pin in RUNTIME.items():
            source = root / REL / name
            require(digest(source) == pin, "Frozen runtime differs: " + name)
            target = host / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
            require(digest(target) == pin, "Runtime copy differs")
            copied[name] = pin
        receipt["copiedBefore"] = copied
        reference = host / "QRGenSource"
        reference.symlink_to(root, target_is_directory=True)
        require(reference.resolve(strict=True) == root and (reference / "Package.swift").resolve(strict=True) == root / "Package.swift", "Wrong local package root")
        receipt["packageReferenceBefore"] = str(reference.resolve(strict=True))
        shutil.copyfile(host / "Tests/Resources/simulator-generated-input.png", evidence / "simulator-generated-input.png")
        for name, argv in (("os", ["sw_vers"]), ("xcode", ["xcodebuild", "-version"]),
                           ("swift", ["swift", "--version"]), ("sdk", ["xcrun", "--sdk", "iphonesimulator", "--show-sdk-version"])):
            command(name, argv)
        _, runtimes = command("runtimes", ["xcrun", "simctl", "list", "runtimes", "--json"])
        _, devices = command("devices", ["xcrun", "simctl", "list", "devices", "available", "--json"])
        choices = []
        for runtime in json.loads(runtimes)["runtimes"]:
            if runtime.get("isAvailable") and ".SimRuntime.iOS-" in runtime["identifier"]:
                version = tuple(int(part) for part in runtime["version"].split("."))
                if version < (15,):
                    continue
                for device in json.loads(devices)["devices"].get(runtime["identifier"], []):
                    kind = device.get("deviceTypeIdentifier", "")
                    if device.get("isAvailable") and ".iPhone-" in kind:
                        choices.append((version, runtime["identifier"], kind))
        require(choices, "No available iPhone/iOS Simulator pair")
        _, runtime, kind = sorted(choices)[-1]
        receipt["selectedSimulator"] = {"runtime": runtime, "deviceType": kind}
        _, created = command("create-owned", ["xcrun", "simctl", "create", "QRGenStillImage-" + uuid.uuid4().hex[:12], kind, runtime])
        owned = str(uuid.UUID(created.strip())).upper()
        receipt["ownedSimulatorUDID"] = owned
        command("boot-owned", ["xcrun", "simctl", "boot", owned])
        command("bootstatus-owned", ["xcrun", "simctl", "bootstatus", owned, "-b"], timeout=240)
        common = ["-destination", "platform=iOS Simulator,id=" + owned, "-parallel-testing-enabled", "NO",
                  "-only-testing:" + TEST, "ARCHS=" + architecture, "ONLY_ACTIVE_ARCH=YES", "COMPRESS_PNG_FILES=NO", "STRIP_PNG_TEXT=NO", "CODE_SIGNING_ALLOWED=NO"]
        _, build_log = command("build-for-testing", ["xcodebuild", "build-for-testing", "-project", str(host / "QRGenStillImageControl.xcodeproj"),
                "-scheme", "QRGenStillImageControl", "-configuration", "Debug", "-derivedDataPath", str(derived),
                "-resultBundlePath", str(evidence / "Build.xcresult"), *common], timeout=900)
        compiled = set()
        for line in build_log.splitlines():
            match = re.match(r"^SwiftCompile normal (\S+) (/.+\.swift) \(in target 'QRGenKit' from project 'QRGenKit'\)$", line)
            if match:
                path = Path(match[2].replace("\\ ", " ")).resolve(strict=True)
                require(match[1] == architecture and path.is_relative_to(root), "Unexpected compiler source/architecture")
                compiled.add(path.relative_to(root).as_posix())
        receipt["compiledSwiftSources"] = sorted(compiled)
        require(compiled == swift and architecture + "-apple-ios" in build_log and "-simulator" in build_log, "Missing actual18-source Simulator compilation")
        test_compile_lines = [line for line in build_log.splitlines() if re.match(
            r"^SwiftCompile normal " + re.escape(architecture) + " " + re.escape(str(host / "Tests/StillImageControlTests.swift"))
            + r" \(in target 'QRGenStillImageTests' from project 'QRGenStillImageControl'\)$", line)]
        require(test_compile_lines, "Missing actual copied XCTest compilation")
        receipt["testCompileLines"] = test_compile_lines
        products = derived / "Build/Products/Debug-iphonesimulator"
        app = products / "QRGenStillImageHost.app"
        bundle = app / "PlugIns/QRGenStillImageTests.xctest"
        product_paths = {"QRGenKitObject": products / "QRGenKit.o", "hostExecutable": app / "QRGenStillImageHost",
                         "testExecutable": bundle / "QRGenStillImageTests", "bundledPNG": bundle / "simulator-generated-input.png"}
        if (app / "QRGenStillImageHost.debug.dylib").exists():
            product_paths["hostDebugDylib"] = app / "QRGenStillImageHost.debug.dylib"
        xctestruns = list((derived / "Build/Products").glob("*.xctestrun"))
        require(len(xctestruns) == 1, "Expected one fresh xctestrun product")
        product_paths["xctestrun"] = xctestruns[0]
        receipt["productsBefore"] = {}
        for name, path in product_paths.items():
            require(path.is_file() and not path.is_symlink() and path.stat().st_size > 0, "Missing build product: " + name)
            receipt["productsBefore"][name] = {"path": str(path.relative_to(output)), "sha256": digest(path), "bytes": path.stat().st_size}
            if name not in ("bundledPNG", "xctestrun"):
                _, arches = command("architecture-" + name, ["xcrun", "lipo", "-archs", str(path)])
                require(arches.strip().split() == [architecture], "Product architecture mismatch")
        require(digest(product_paths["bundledPNG"]) == INPUT, "Built test bundle PNG bytes changed")
        resource_lines = [line for line in build_log.splitlines() if line.startswith(("CopyPNGFile ", "CpResource "))
                          and str(product_paths["bundledPNG"]) in line and str(host / "Tests/Resources/simulator-generated-input.png") in line]
        require(resource_lines, "Missing actual test resource copy/source binding")
        receipt["resourceBuildLines"] = resource_lines
        shutil.copyfile(product_paths["bundledPNG"], evidence / "built-test-input.png")
        shutil.copyfile(xctestruns[0], evidence / "built-tests.xctestrun")
        receipt["compilerFileLists"] = []
        for target, required in (("QRGenKit", {root / name for name in swift}),
                                 ("QRGenStillImageTests", {host / "Tests/StillImageControlTests.swift"})):
            matches = []
            for path in derived.rglob(target + ".SwiftFileList"):
                if str(path) not in build_log or "/Objects-normal/" + architecture + "/" not in str(path):
                    continue
                contents = path.read_text()
                actual = {Path(item).resolve(strict=True) for item in shlex.split(contents)}
                require(actual == required, "Actual compiler file-list differs: " + target)
                name = "compiler-inputs-" + target + "-" + str(len(matches)) + ".txt"
                (evidence / name).write_text(contents)
                matches.append({"path": str(path.relative_to(derived)), "evidence": name, "sha256": digest(path)})
            require(matches, "Missing invoked compiler file-list: " + target)
            receipt["compilerFileLists"].extend(matches)
        link_commands = [line for line in build_log.splitlines() if "/clang " in line
                         and "-o " + str(product_paths["testExecutable"]) in line]
        require(len(link_commands) == 1 and "Ld " + str(product_paths["testExecutable"]) in build_log,
                "Missing unique actual test link invocation")
        linked_tokens = []
        receipt["invokedLinkInputFiles"] = []
        def expand_link(tokens, depth=0):
            require(depth < 6, "Excessive link response nesting")
            index = 0
            while index < len(tokens):
                token = tokens[index]
                file_list = token == "-filelist"
                if file_list or token.startswith("@/"):
                    if file_list:
                        index += 1
                        require(index < len(tokens), "Missing -filelist argument")
                        response = Path(tokens[index])
                    else:
                        response = Path(token[1:])
                    require(response.resolve(strict=True).is_relative_to(derived) and not response.is_symlink(), "Unbound link response")
                    require(response.stat().st_size < 10_000_000, "Oversized link response")
                    contents = response.read_text()
                    name = "link-inputs-" + str(len(receipt["invokedLinkInputFiles"])) + ".txt"
                    (evidence / name).write_text(contents)
                    receipt["invokedLinkInputFiles"].append({"path": str(response.relative_to(derived)), "evidence": name, "sha256": digest(response)})
                    expand_link(shlex.split(contents), depth + 1)
                else:
                    linked_tokens.append(token)
                index += 1
        expand_link(shlex.split(link_commands[0]))
        linked_paths = {Path(token).resolve() for token in linked_tokens if token.startswith("/")}
        require(product_paths["QRGenKitObject"].resolve() in linked_paths
                and any(path.name in ("StillImageControlTests.o", "StillImageControlTests.swift.o") and path.is_file() for path in linked_paths),
                "Invoked test link arguments do not include SDK object and actual test object")
        receipt["testLinkCommand"] = link_commands[0]
        package_link_commands = [line for line in build_log.splitlines() if "/clang " in line
                                 and "-o " + str(product_paths["QRGenKitObject"]) in line]
        require(len(package_link_commands) == 1 and "Ld " + str(product_paths["QRGenKitObject"]) in build_log,
                "Missing actual SDK aggregate link invocation")
        linked_tokens.clear()
        expand_link(shlex.split(package_link_commands[0]))
        package_objects = {Path(token).resolve(strict=True) for token in linked_tokens if token.startswith("/") and token.endswith(".o")}
        require({Path(name).stem + ".o" for name in swift} <= {path.name for path in package_objects}
                and all(path.is_relative_to(derived) for path in package_objects), "SDK aggregate omits compiled source objects")
        receipt["packageLinkCommand"] = package_link_commands[0]
        receipt["packageLinkedObjects"] = [{"path": str(path.relative_to(derived)), "sha256": digest(path), "bytes": path.stat().st_size}
                                           for path in sorted(package_objects)]
        code, test_log = command("test-without-building", ["xcodebuild", "test-without-building", "-xctestrun", str(xctestruns[0]),
                "-resultBundlePath", str(result), "-test-iterations", "1", "-test-timeouts-enabled", "YES",
                "-maximum-test-execution-time-allowance", "120", *common], timeout=600, allow_failure=True)
        receipt["xcodebuildTestExitCode"] = code
        require(code == 0, "Actual test invocation failed")
    except Exception as error:
        receipt["harnessError"] = type(error).__name__ + ": " + str(error)
    finally:
        if owned:
            try:
                command("shutdown-owned", ["xcrun", "simctl", "shutdown", owned], allow_failure=True)
                code, _ = command("delete-owned", ["xcrun", "simctl", "delete", owned], allow_failure=True)
                _, remaining = command("devices-after-cleanup", ["xcrun", "simctl", "list", "devices", "--json"])
                ids = {uuid.UUID(device["udid"]) for group in json.loads(remaining)["devices"].values() for device in group}
                receipt["ownedSimulatorDeleted"] = code == 0
                receipt["ownedSimulatorAbsentAfterCleanup"] = uuid.UUID(owned) not in ids
                require(code == 0 and uuid.UUID(owned) not in ids, "Owned Simulator cleanup incomplete")
            except Exception as error:
                receipt["cleanupError"] = str(error)

    try:
        require(result.exists(), "No test xcresult bundle")
        _, summary = command("test-summary", ["xcrun", "xcresulttool", "get", "test-results", "summary", "--path", str(result), "--compact"])
        receipt["testSummary"] = json.loads(summary)
        command("export-attachments", ["xcrun", "xcresulttool", "export", "attachments", "--path", str(result), "--output-path", str(evidence / "attachments")])
        logs = [evidence / item["log"] for item in receipt["commands"] if item["name"] == "test-without-building"]
        require(len(logs) == 1, "Expected one actual test command")
        markers = [line.split(MARKER, 1)[1].strip() for line in logs[0].read_text(errors="replace").splitlines() if MARKER in line]
        require(len(markers) == 1, "Expected one compact observation marker")
        value = json.loads(markers[0])
        attachment_root = evidence / "attachments"
        manifest = json.loads((attachment_root / "manifest.json").read_bytes())
        require(isinstance(manifest, list) and len(manifest) == 1, "Expected one actual attachment test group")
        group = manifest[0]
        require(group.get("testIdentifier") == "StillImageControlTests/testPairedStillImageObservations()"
                and isinstance(group.get("testIdentifierURL"), str)
                and group["testIdentifierURL"].endswith("/QRGenStillImageTests/StillImageControlTests/testPairedStillImageObservations"),
                "Attachment test identity differs")
        entries = group.get("attachments")
        require(isinstance(entries, list) and entries, "Missing attachment manifest entries")
        exported_names = set()
        attached = []
        images = []
        roles = {"ios-still-image-observations_": "observations", "simulator-generated-input.png_": "immutable_saved_png",
                 "generated-control.png_": "new_generated_control_png"}
        seen_roles = set()
        receipt["attachmentManifest"] = {"path": "attachments/manifest.json", "sha256": digest(attachment_root / "manifest.json")}
        receipt["attachmentBindings"] = []
        for entry in entries:
            require(uuid.UUID(entry["deviceId"]) == uuid.UUID(owned), "Attachment belongs to another Simulator")
            exported = entry.get("exportedFileName")
            require(isinstance(exported, str) and Path(exported).name == exported and exported not in exported_names,
                    "Duplicate/unsafe exported attachment name")
            exported_names.add(exported)
            path = attachment_root / exported
            require(path.is_file() and not path.is_symlink() and path.resolve(strict=True).is_relative_to(attachment_root), "Unbound exported attachment")
            human_name = entry.get("suggestedHumanReadableName", "")
            matching = [role for prefix, role in roles.items() if human_name.startswith(prefix)]
            require(len(matching) <= 1, "Ambiguous attachment role")
            role = matching[0] if matching else None
            if role:
                require(role not in seen_roles, "Duplicate declared attachment role")
                seen_roles.add(role)
            data = path.read_bytes()
            binding = {"path": path.relative_to(evidence).as_posix(), "sha256": hashlib.sha256(data).hexdigest(),
                       "bytes": len(data), "role": role, "deviceId": entry["deviceId"], "suggestedHumanReadableName": human_name}
            receipt["attachmentBindings"].append(binding)
            if role in ("immutable_saved_png", "new_generated_control_png"):
                dimensions = list(struct.unpack(">II", data[16:24])) if data.startswith(b"\x89PNG\r\n\x1a\n") and len(data) >= 24 else None
                images.append({**binding, "dimensions": dimensions})
            if len(data) < 2_000_000:
                try:
                    candidate = json.loads(data)
                except (UnicodeError, ValueError):
                    continue
                if isinstance(candidate, dict) and candidate.get("protocol") == PROTOCOL:
                    require(role == "observations" and data == markers[0].encode("utf-8"), "Observation role/compact UTF-8 bytes differ")
                    attached.append({**binding, "value": candidate})
        require({path.name for path in attachment_root.iterdir() if path.is_file()} == exported_names | {"manifest.json"},
                "Unmanifested exported attachment")
        receipt["attachedObservationJSONCount"] = len(attached)
        require(len(attached) == 1 and attached[0]["value"] == value, "Compact marker and unique JSON attachment differ")
        receipt["observationAttachment"] = {key: item for key, item in attached[0].items() if key != "value"}
        receipt["imageAttachments"] = images
        receipt["matrixCompleteness"] = validate(value, receipt["architecture"], images)
        summary = receipt["testSummary"]
        require(summary.get("totalTestCount") == 1 and summary.get("passedTests") == 1 and summary.get("failedTests") == 0
                and summary.get("skippedTests") == 0, "Expected exactly one non-skipped passed protocol test")
        save(evidence / "observations.json", value)
    except Exception as error:
        receipt["collectorError"] = type(error).__name__ + ": " + str(error)
    try:
        receipt["headAfter"] = git(root, "rev-parse", "HEAD").decode().strip()
        receipt["treeAfter"] = git(root, "rev-parse", "HEAD^{tree}").decode().strip()
        receipt["sourceAfter"] = snapshot(root, source_paths)
        receipt["fixtureAfter"] = snapshot(root, fixture_paths)
        require(receipt.get("head") == receipt["headAfter"] and receipt.get("tree") == receipt["treeAfter"]
                and receipt.get("sourceBefore") == receipt["sourceAfter"] and receipt.get("fixtureBefore") == receipt["fixtureAfter"], "Event source/fixture closure changed")
        if "copiedBefore" in receipt:
            receipt["copiedAfter"] = {name: digest(host / name) for name in RUNTIME}
            receipt["packageReferenceAfter"] = str((host / "QRGenSource").resolve(strict=True))
            require(receipt["copiedAfter"] == receipt["copiedBefore"] and receipt["packageReferenceAfter"] == str(root), "Host/source binding changed")
        if "productsBefore" in receipt:
            receipt["productsAfter"] = {name: {"path": str(path.relative_to(output)), "sha256": digest(path), "bytes": path.stat().st_size} for name, path in product_paths.items()}
            require(receipt["productsAfter"] == receipt["productsBefore"], "Built executable/resource bytes changed")
        require(not git(root, "status", "--porcelain=v1", "--untracked-files=all").strip(), "Checkout changed")
        require(digest(evidence / "simulator-generated-input.png") == INPUT, "Retained immutable PNG changed")
    except Exception as error:
        receipt["closureError"] = type(error).__name__ + ": " + str(error)
    receipt["timedOutCommandCount"] = sum(bool(item.get("timedOut")) for item in receipt["commands"])
    failed = any(name in receipt for name in ("harnessError", "cleanupError", "collectorError", "closureError")) or receipt["timedOutCommandCount"] != 0
    receipt["status"] = "harness_failure" if failed else "observations_recorded"
    receipt["completedUtc"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    save(evidence / "run-receipt.json", receipt)
    print(json.dumps({"status": receipt["status"], "head": receipt.get("head"), "matrixCompleteness": receipt.get("matrixCompleteness")}))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

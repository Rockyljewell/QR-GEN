#!/usr/bin/env python3
"""Build private, matched EAN13 readers; never instantiate a barcode engine."""
import argparse
import base64
import hashlib
import json
import os
import pathlib
import re
import shutil
import signal
import subprocess
import sys
import tarfile
import time
import urllib.request
import uuid

HERE = pathlib.Path(__file__).resolve().parent
BRANCH = "refs/heads/codex/ean316-reader-rebuild"


def digest(data, algorithm="sha256"):
    return hashlib.new(algorithm, data).hexdigest()


def load_notes():
    data = json.loads((HERE / "additional-source-files.json").read_bytes())
    if data["schemaVersion"] != 1:
        raise ValueError("Unexpected additional source manifest schema")
    for item in data["files"]:
        path = pathlib.PurePosixPath(item["path"])
        if (item["family"] not in ("wasm", "cpp", "zint", "stb")
                or item["role"] not in ("attribution", "build-script")
                or path.is_absolute() or ".." in path.parts):
            raise ValueError("Invalid additional source path or role")
        if re.fullmatch(r"[0-9a-f]{64}", item["sha256"]) is None:
            raise ValueError("Invalid additional source hash")
    return data["files"]


def load_inputs():
    pins = json.loads((HERE / "pins.json").read_bytes())
    if pins["schemaVersion"] != 1 or pins["branch"] != BRANCH:
        raise ValueError("Unexpected diagnostic schema or branch")
    for key in ("wasmCommit", "cppCommit", "zintCommit", "stbCommit"):
        if re.fullmatch(r"[0-9a-f]{40}", pins[key]) is None:
            raise ValueError("Invalid source pin: " + key)
    if re.fullmatch(r"emscripten/emsdk@sha256:[0-9a-f]{64}", pins["container"]) is None:
        raise ValueError("An immutable EMSDK image is required")
    for key in ("nodeVersion", "pnpmVersion"):
        if re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", pins[key]) is None:
            raise ValueError("An exact tool version is required: " + key)
    for name, expected in pins["patches"].items():
        data = (HERE / name).read_bytes()
        if digest(data) != expected:
            raise ValueError("Patch hash differs: " + name)
    for item in pins["sourceFiles"]:
        path = pathlib.PurePosixPath(item["path"])
        if item["family"] not in ("wasm", "cpp") or path.is_absolute() or ".." in path.parts:
            raise ValueError("Invalid protected source path")
    if len(pins["sourceFiles"]) != 23:
        raise ValueError("The selected source receipt must retain all 23 inputs")
    for item in load_notes():
        if item["commit"] != pins[item["family"] + "Commit"]:
            raise ValueError("Additional source commit differs from protected pins")
    return pins


def output_path(value, temporary, checkout):
    path = pathlib.Path(value).resolve()
    if path == temporary or not path.is_relative_to(temporary) or path.is_relative_to(checkout):
        raise ValueError("Output must be a fresh RUNNER_TEMP child outside the checkout")
    if path.exists():
        raise ValueError("Refusing to reuse output")
    return path


def unpack(archive, destination, top):
    destination.mkdir()
    with tarfile.open(archive) as stream:
        members = stream.getmembers()
        if not members or any(pathlib.PurePosixPath(item.name).parts[0] != top for item in members):
            raise ValueError("Unexpected archive root")
        stream.extractall(destination, filter="data")
    return destination / top


def materialize_pnpm(wrapper, native, version, expected_hash):
    package = json.loads((native / "package.json").read_bytes())
    parent = json.loads((wrapper / "package.json").read_bytes())
    if (package["name"] != "@pnpm/exe.linux-x64" or package["version"] != version
            or package["os"] != ["linux"] or package["cpu"] != ["x64"]
            or package["libc"] != ["glibc"]
            or parent["name"] != "pnpm" or parent["version"] != version
            or parent["optionalDependencies"].get(package["name"]) != version):
        raise ValueError("Native pnpm package identity differs")
    binary = (native / "pnpm").read_bytes()
    if (len(binary) < 64 or binary[:6] != b"\x7fELF\x02\x01"
            or int.from_bytes(binary[18:20], "little") != 62
            or digest(binary) != expected_hash):
        raise ValueError("Native pnpm ELF identity or hash differs")
    if not (wrapper / "dist/node_modules/node-gyp/bin/node-gyp.js").is_file():
        raise ValueError("Native pnpm wrapper payload is missing")
    # Match the pinned official install.js Unix layout without running its hooks.
    destination = wrapper / "pnpm"
    shutil.copy2(native / "pnpm", destination)
    destination.chmod(0o755)
    return {"package": package, "binarySHA256": digest(binary), "binaryBytes": len(binary),
            "elf": "ELF64 little-endian x86-64", "entry": "/task/tools/pnpm/pnpm",
            "automaticDownloaderUsed": False}


class Build:
    def __init__(self, pins, variant, output, checkout):
        self.pins, self.variant = pins, variant
        self.notes = load_notes()
        self.output, self.checkout = output, checkout
        self.work = output / "work"
        self.evidence = output / "evidence"
        self.work.mkdir(parents=True)
        self.evidence.mkdir()
        (self.evidence / "logs").mkdir()
        self.containers = []
        self.deadline = time.monotonic() + 45 * 60
        self.closing = False
        self.receipt = {
            "schemaVersion": 1, "status": "failed", "variant": variant,
            "scope": "Private source build and matching asset closure only; no decoder or corpus execution",
            "decoderExecuted": False, "published": False, "commands": [], "containers": [],
            "wasmSHA256": None, "packageFiles": None,
            "runID": os.environ["GITHUB_RUN_ID"], "runAttempt": os.environ["GITHUB_RUN_ATTEMPT"],
            "pinsSHA256": digest((HERE / "pins.json").read_bytes()),
            "additionalSourceManifestSHA256": digest((HERE / "additional-source-files.json").read_bytes()),
        }

    def run(self, name, args, cwd=None, timeout=300, capture=False, check=True):
        if self.closing:
            timeout = min(timeout, 60)
        else:
            remaining = int(self.deadline - time.monotonic())
            if remaining <= 0:
                raise TimeoutError("Overall 45-minute build budget exhausted")
            timeout = min(timeout, remaining)
        number = len(self.receipt["commands"])
        prefix = f"logs/{number:02d}-{name}"
        record = {"name": name, "args": list(map(str, args)), "cwd": str(cwd or self.work),
                  "timeoutSeconds": timeout, "stdout": prefix + ".stdout.log",
                  "stderr": prefix + ".stderr.log", "startedAt": time.time()}
        self.receipt["commands"].append(record)
        with (self.evidence / record["stdout"]).open("wb") as stdout, (self.evidence / record["stderr"]).open("wb") as stderr:
            process = subprocess.Popen(args, cwd=cwd or self.work, stdout=stdout, stderr=stderr, start_new_session=True)
            try:
                process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                record["timedOut"] = True
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=30)
                raise
            finally:
                record["exit"] = process.returncode
                record["endedAt"] = time.time()
        if check and process.returncode:
            raise RuntimeError(name + " exited " + str(process.returncode))
        return (self.evidence / record["stdout"]).read_text().strip() if capture else None

    def git(self, folder, *args):
        return self.run("git-" + args[0], ["git", "-C", str(folder), *args], capture=True)

    def clone(self, name, url, commit):
        folder = self.work / name
        self.run("init-" + name, ["git", "init", str(folder)])
        self.git(folder, "fetch", "--depth=1", "--no-tags", url, commit)
        self.git(folder, "checkout", "--detach", "FETCH_HEAD")
        if self.git(folder, "rev-parse", "HEAD") != commit:
            raise RuntimeError("Source commit differs: " + name)
        return folder

    def download(self, name, url, algorithm, expected):
        path = self.work / name
        hasher = hashlib.new(algorithm)
        with urllib.request.urlopen(url, timeout=60) as response, path.open("wb") as stream:
            while chunk := response.read(1024 * 1024):
                if time.monotonic() >= self.deadline:
                    raise TimeoutError("Overall build budget exhausted during bootstrap")
                hasher.update(chunk)
                stream.write(chunk)
        actual = hasher.digest()
        if actual != expected:
            raise ValueError("Archive integrity differs: " + name)
        self.receipt.setdefault("downloads", []).append({
            "url": url, "file": name, "bytes": path.stat().st_size,
            algorithm: hasher.hexdigest(), "sha256": digest(path.read_bytes()),
        })
        return path

    def snapshot(self):
        result = {}
        for item in self.pins["sourceFiles"]:
            family, relative = item["family"], item["path"]
            folder = self.source if family == "wasm" else self.source / "zxing-cpp"
            data = (folder / relative).read_bytes()
            result[family + "/" + relative] = {
                "sha256": digest(data), "bytes": len(data),
                "gitBlob": digest(b"blob " + str(len(data)).encode() + b"\0" + data, "sha1"),
            }
        return result

    def retain_source_notes(self):
        folders = {"wasm": self.source, "cpp": self.source / "zxing-cpp",
                   "zint": self.source / "zxing-cpp/zint", "stb": self.work / "stb"}
        observed = {}
        for item in self.notes:
            data = (folders[item["family"]] / item["path"]).read_bytes()
            blob = digest(b"blob " + str(len(data)).encode() + b"\0" + data, "sha1")
            if digest(data) != item["sha256"] or blob != item["gitBlob"]:
                raise ValueError("Additional source differs: " + item["path"])
            category = "attribution" if item["role"] == "attribution" else "observed-build-scripts"
            relative = pathlib.Path(category) / item["family"] / item["path"]
            destination = self.evidence / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
            observed[item["family"] + "/" + item["path"]] = {
                "sha256": digest(data), "gitBlob": blob, "bytes": len(data),
                "role": item["role"], "evidence": relative.as_posix(),
            }
        self.receipt["additionalSourceFiles"] = observed

    def verify_snapshot(self, snapshot, candidate=False):
        for item in self.pins["sourceFiles"]:
            key = item["family"] + "/" + item["path"]
            expected = item["sha256"]
            if candidate and key == "cpp/core/src/oned/ODMultiUPCEANReader.cpp":
                expected = self.pins["candidateSourceSHA256"]
            if candidate and key == "wasm/package.json":
                expected = self.pins["candidatePackageSHA256"]
            if snapshot[key]["sha256"] != expected:
                raise ValueError("Protected source changed: " + key)

    def remove_container(self, identifier, phase, force=False):
        command = ["docker", "rm", *(["--force"] if force else []), identifier]
        self.run("remove-" + phase, command, timeout=60)
        remaining = self.run("absence-" + phase, ["docker", "ps", "--all", "--no-trunc",
                            "--filter", "id=" + identifier, "--format", "{{.ID}}"], capture=True)
        if remaining:
            raise RuntimeError("Owned container still exists after removal")
        self.containers.remove(identifier)

    def container(self, phase, network, script, timeout):
        name = "qrgen-ean316-" + uuid.uuid4().hex
        args = ["docker", "create", "--name", name, "--platform", "linux/amd64",
                "--network", network, "--volume", str(self.work) + ":/task",
                "--workdir", "/task/source",
                "--env", "GIT_CONFIG_COUNT=3",
                "--env", "GIT_CONFIG_KEY_0=safe.directory", "--env", "GIT_CONFIG_VALUE_0=/task/source",
                "--env", "GIT_CONFIG_KEY_1=safe.directory", "--env", "GIT_CONFIG_VALUE_1=/task/source/zxing-cpp",
                "--env", "GIT_CONFIG_KEY_2=safe.directory", "--env", "GIT_CONFIG_VALUE_2=/task/source/zxing-cpp/zint",
                self.pins["container"],
                "bash", "-euo", "pipefail", "-c", script]
        identifier = self.run("create-" + phase, args, capture=True)
        if re.fullmatch(r"[0-9a-f]{64}", identifier) is None:
            raise RuntimeError("Docker did not return one exact container ID")
        self.containers.append(identifier)
        info = json.loads(self.run("inspect-" + phase, ["docker", "inspect", identifier], capture=True))[0]
        if info["Name"] != "/" + name or info["HostConfig"]["NetworkMode"] != network:
            raise RuntimeError("Created container ownership or network mode differs")
        self.receipt["containers"].append({"phase": phase, "id": identifier, "name": name,
                                           "network": network, "image": info["Image"]})
        self.run("start-" + phase, ["docker", "start", "--attach", identifier], timeout=timeout)
        state = json.loads(self.run("state-" + phase, ["docker", "inspect", identifier], capture=True))[0]["State"]
        if state["Running"] or state["ExitCode"] != 0:
            raise RuntimeError("Container build command failed")
        self.remove_container(identifier, phase)

    def prepare(self):
        self.receipt["head"] = self.git(self.checkout, "rev-parse", "HEAD")
        self.receipt["tree"] = self.git(self.checkout, "rev-parse", "HEAD^{tree}")
        if self.receipt["head"] != os.environ["GITHUB_SHA"]:
            raise ValueError("Checkout differs from the exact event head")
        if self.git(self.checkout, "status", "--porcelain", "--untracked-files=no"):
            raise ValueError("Tracked checkout must be clean")
        self.source = self.clone("source", "https://github.com/Sec-ant/zxing-wasm.git", self.pins["wasmCommit"])
        self.git(self.source, "submodule", "update", "--init", "zxing-cpp")
        if self.git(self.source / "zxing-cpp", "rev-parse", "HEAD") != self.pins["cppCommit"]:
            raise ValueError("C++ gitlink differs")
        self.git(self.source / "zxing-cpp", "submodule", "update", "--init", "--depth=1", "zint")
        if self.git(self.source / "zxing-cpp/zint", "rev-parse", "HEAD") != self.pins["zintCommit"]:
            raise ValueError("Zint gitlink differs")
        self.clone("stb", "https://github.com/nothings/stb.git", self.pins["stbCommit"])
        self.retain_source_notes()
        before = self.snapshot()
        self.verify_snapshot(before)
        self.receipt["sourceBefore"] = before
        for kind in ("reader", "writer", "full"):
            for suffix in ("js", "wasm"):
                if (self.source / f"src/{kind}/zxing_{kind}.{suffix}").exists():
                    raise ValueError("Generated outputs must not exist before compilation")
        self.run("pull-image", ["docker", "pull", "--platform", "linux/amd64", self.pins["container"]], timeout=600)
        self.receipt["dockerImage"] = json.loads(self.run("image-identity", ["docker", "image", "inspect", self.pins["container"]], capture=True))[0]
        if self.receipt["dockerImage"]["Architecture"] != "amd64" or self.receipt["dockerImage"]["Os"] != "linux":
            raise ValueError("Pinned image platform differs")
        tools = self.work / "tools"
        tools.mkdir()
        node = self.download("node.tar.xz", self.pins["nodeURL"], "sha256", bytes.fromhex(self.pins["nodeSHA256"]))
        node_root = unpack(node, tools / "node-extract", "node-v22.14.0-linux-x64")
        node_root.rename(tools / "node")
        integrity = self.pins["pnpmIntegrity"]
        if not integrity.startswith("sha512-"):
            raise ValueError("Expected a SHA512 pnpm integrity pin")
        pnpm = self.download("pnpm.tgz", self.pins["pnpmURL"], "sha512", base64.b64decode(integrity[7:], validate=True))
        unpack(pnpm, tools / "pnpm-extract", "package").rename(tools / "pnpm")
        native_integrity = self.pins["pnpmNativeIntegrity"]
        if not native_integrity.startswith("sha512-"):
            raise ValueError("Expected a SHA512 native pnpm integrity pin")
        native = self.download("pnpm-native.tgz", self.pins["pnpmNativeURL"], "sha512",
                               base64.b64decode(native_integrity[7:], validate=True))
        native_root = unpack(native, tools / "pnpm-native-extract", "package")
        native_root.rename(tools / "pnpm-native")
        self.receipt["pnpmNativeBootstrap"] = materialize_pnpm(
            tools / "pnpm", tools / "pnpm-native", self.pins["pnpmVersion"],
            self.pins["pnpmNativeBinarySHA256"])
        (tools / "bin").mkdir()
        launcher = tools / "bin/pnpm"
        launcher.write_text('#!/bin/sh\nexec /task/tools/pnpm/pnpm "$@"\n')
        launcher.chmod(0o755)
        versions = ('test "$(node --version)" = "v' + self.pins["nodeVersion"] + '"\n'
                    + 'test "$(pnpm --version)" = "' + self.pins["pnpmVersion"] + '"\n')
        prelude = ('export PATH="/task/tools/node/bin:/task/tools/bin:$PATH"\n'
                   + "export pnpm_config_pm_on_fail=error\nset -x\n" + versions)
        self.version_assertions = versions
        self.container("dependency-fetch", "bridge", prelude + "pnpm fetch --store-dir /task/store\n", 600)
        for repository in (self.source, self.source / "zxing-cpp"):
            if self.git(repository, "diff", "--binary", "HEAD"):
                raise ValueError("Dependency fetch changed tracked upstream source")
        if self.variant == "candidate":
            self.git(self.source / "zxing-cpp", "apply", "--check", str(HERE / "ean13-whole-word-ambiguity.patch"))
            self.git(self.source / "zxing-cpp", "apply", str(HERE / "ean13-whole-word-ambiguity.patch"))
            self.git(self.source, "apply", "--check", str(HERE / "private-package-identity.patch"))
            self.git(self.source, "apply", str(HERE / "private-package-identity.patch"))
        self.verify_snapshot(self.snapshot(), candidate=self.variant == "candidate")
        self.expectedRootDiff = self.git(self.source, "diff", "--binary")
        self.expectedCppDiff = self.git(self.source / "zxing-cpp", "diff", "--binary")
        self.build_prelude = prelude

    def build(self):
        script = self.build_prelude + """emcc --version
cmake --version
make --version
"$(em-config BINARYEN_ROOT)/bin/wasm-opt" --version
pnpm install --offline --frozen-lockfile --store-dir /task/store
pnpm list --depth Infinity --json
for target in READER WRITER FULL; do
  emcmake cmake -S src/cpp -B build/wasm -DTARGET="$target" -DSTB_IMAGE_INCLUDE_DIR=/task/stb -DFETCHCONTENT_FULLY_DISCONNECTED=ON
  cmake --build build/wasm -j2 --verbose
done
pnpm exec vite build
pnpm exec tsc -p ./tsconfig.pkg.json --declarationDir ./dist/es
pnpm exec tsx ./scripts/build-cjs.ts
pnpm exec tsc -p ./tsconfig.pkg.json --declarationDir ./dist/cjs
pnpm exec tsx ./scripts/build-iife.ts
pnpm exec tsx ./scripts/build-miniprogram.ts
pnpm exec copy-files-from-to
"""
        self.container("offline-build", "none", script + self.version_assertions, 2400)

    def retain(self):
        self.retain_source_notes()
        after = self.snapshot()
        self.verify_snapshot(after, candidate=self.variant == "candidate")
        self.receipt["sourceAfter"] = after
        root_diff = self.git(self.source, "diff", "--binary")
        cpp_diff = self.git(self.source / "zxing-cpp", "diff", "--binary")
        if root_diff != self.expectedRootDiff or cpp_diff != self.expectedCppDiff:
            raise ValueError("Build mutated tracked source")
        (self.evidence / "upstream-root.diff").write_text(root_diff)
        (self.evidence / "upstream-cpp.diff").write_text(cpp_diff)
        if self.git(self.source / "zxing-cpp/zint", "status", "--porcelain", "--untracked-files=no"):
            raise ValueError("Build mutated Zint")
        if self.git(self.work / "stb", "status", "--porcelain", "--untracked-files=no"):
            raise ValueError("Build mutated STB")
        package = self.evidence / "package"
        package.mkdir()
        distribution = self.source / "dist"
        if any(not path.resolve().is_relative_to(distribution) for path in distribution.rglob("*")):
            raise ValueError("Package output escapes the isolated distribution")
        shutil.copytree(distribution, package / "dist")
        shutil.copy2(self.source / "package.json", package / "package.json")
        shutil.copy2(self.source / "LICENSE", package / "LICENSE")
        shutil.copy2(self.source / "README.md", package / "README.md")
        for name in ("pnpm-lock.yaml", "pnpm-workspace.yaml"):
            shutil.copy2(self.source / name, self.evidence / name)
        required = ["dist/cjs/package.json", "dist/miniprogram/index.js", "dist/miniprogram/package.json"]
        for kind in ("reader", "writer", "full"):
            required.extend(f"dist/{format}/{kind}/index.js" for format in ("es", "cjs", "iife"))
            required.extend(f"dist/{format}/{kind}/index.d.ts" for format in ("es", "cjs"))
        for format in ("es", "cjs"):
            required.extend(f"dist/{format}/types/{kind}.d.ts" for kind in ("wasm", "imageData"))
        for path in required:
            if not (package / path).is_file():
                raise ValueError("Missing wrapper closure output: " + path)
        if json.loads((package / "package.json").read_bytes())["type"] != "module":
            raise ValueError("ESM package scope missing")
        for scope in ("cjs", "miniprogram"):
            if json.loads((package / f"dist/{scope}/package.json").read_bytes())["type"] != "commonjs":
                raise ValueError("CommonJS package scope missing: " + scope)
        generated = self.evidence / "generated"
        generated.mkdir()
        wasm = {}
        for kind in ("reader", "writer", "full"):
            for suffix in ("js", "wasm"):
                source = self.source / f"src/{kind}/zxing_{kind}.{suffix}"
                if not source.is_file() or not source.stat().st_size:
                    raise ValueError("Missing matching compiler output")
                shutil.copy2(source, generated / source.name)
            built = (generated / f"zxing_{kind}.wasm").read_bytes()
            if not built.startswith(b"\0asm") or (package / f"dist/{kind}/zxing_{kind}.wasm").read_bytes() != built:
                raise ValueError("Packaged WASM differs from compiler output")
            wasm[kind] = digest(built)
        files = {str(path.relative_to(package)): {"sha256": digest(path.read_bytes()), "bytes": path.stat().st_size}
                 for path in sorted(package.rglob("*")) if path.is_file()}
        self.receipt["package"] = json.loads((package / "package.json").read_bytes())
        self.receipt["packageFiles"] = files
        self.receipt["wasmSHA256"] = wasm
        self.receipt["requiresExplicitMatchingWasmConfiguration"] = True
        self.receipt["implicitUpstreamCDNApproved"] = False
        self.receipt["sourcePolicy"] = "share.ts ownership and hardcoded upstream CDN are unchanged; this private artifact requires explicit local assets"
        self.receipt["published316ByteIdentityClaim"] = False
        self.receipt["status"] = "built-not-runtime-validated"

    def close(self):
        self.closing = True
        for identifier in list(self.containers):
            try:
                self.remove_container(identifier, "cleanup", force=True)
            except Exception as error:
                self.receipt.setdefault("cleanupErrors", []).append(str(error))
        self.receipt["ownedContainersRemoved"] = not self.containers
        if self.containers:
            self.receipt["status"] = "cleanup-failed"
        try:
            self.receipt["headAfter"] = self.git(self.checkout, "rev-parse", "HEAD")
            self.receipt["treeAfter"] = self.git(self.checkout, "rev-parse", "HEAD^{tree}")
            if self.receipt.get("head") != self.receipt["headAfter"] or self.receipt.get("tree") != self.receipt["treeAfter"]:
                raise ValueError("Diagnostic checkout identity changed")
            if self.git(self.checkout, "status", "--porcelain", "--untracked-files=no"):
                raise ValueError("Diagnostic checkout was modified")
        except Exception as error:
            self.receipt["status"] = "source-check-failed"
            self.receipt["closureError"] = str(error)
        for name in ("pins.json", "additional-source-files.json", *self.pins["patches"]):
            shutil.copy2(HERE / name, self.evidence / name)
        (self.evidence / "build-receipt.json").write_text(json.dumps(self.receipt, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--variant", choices=("baseline", "candidate"))
    parser.add_argument("--output")
    parser.add_argument("--check-config", action="store_true")
    args = parser.parse_args()
    pins = load_inputs()
    if args.check_config:
        print(json.dumps({"status": "configuration-verified", "sources": len(pins["sourceFiles"]),
                          "additionalSources": len(load_notes()),
                          "buildExecuted": False, "decoderExecuted": False}))
        return 0
    if sys.platform != "linux" or os.environ.get("GITHUB_REF") != BRANCH or os.environ.get("GITHUB_EVENT_NAME") != "push":
        raise ValueError("Build requires this experimental branch's Linux push workflow")
    if not args.variant or not args.output:
        parser.error("--variant and --output are required")
    checkout = HERE.parents[1]
    temporary = pathlib.Path(os.environ["RUNNER_TEMP"]).resolve()
    output = output_path(args.output, temporary, checkout)
    build = Build(pins, args.variant, output, checkout)
    try:
        build.prepare()
        build.build()
        build.retain()
    except Exception as error:
        build.receipt["error"] = type(error).__name__ + ": " + str(error)
    finally:
        build.close()
    print(json.dumps({"status": build.receipt["status"], "variant": args.variant,
                      "decoderExecuted": False, "ownedContainersRemoved": build.receipt["ownedContainersRemoved"]}))
    return 0 if build.receipt["status"] == "built-not-runtime-validated" else 1


if __name__ == "__main__":
    sys.exit(main())

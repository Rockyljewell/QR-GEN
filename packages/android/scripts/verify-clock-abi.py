#!/usr/bin/env python3
"""Compile legacy clients against pinned core, then run their unchanged classes on current core."""
from pathlib import Path
import argparse
import hashlib
import io
import json
import os
import shutil
import subprocess
import tarfile
import tomllib

BASELINE = "ea9df8750df3a7aed2c3abe74ed0266dbee61e6b"
ANDROID = Path(__file__).resolve().parent.parent


def pin(path):
    data = path.read_bytes()
    return {"path": str(path), "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def members(text):
    """Keep access/static invocation kind and descriptors, including synthetic default bridges."""
    found = set()
    declaration = None
    header = None
    for line in text.splitlines():
        line = " ".join(line.split())
        if line.startswith("public ") and line.endswith("{"):
            header = line
        elif line.startswith(("public ", "protected ")) and line.endswith(";"):
            declaration = line
        elif line.startswith("descriptor:") and declaration:
            found.add(declaration + " " + line)
            declaration = None
    return header, found


def jar(directory):
    choices = [p for p in directory.glob("qrgen-core-*.jar") if not p.name.endswith(("-sources.jar", "-javadoc.jar"))]
    if len(choices) != 1:
        raise RuntimeError(f"Expected one core jar in {directory}, got {choices}")
    return choices[0].resolve()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    runner_temp = Path(os.environ["RUNNER_TEMP"]).resolve()
    out = args.output.resolve()
    if not out.is_relative_to(runner_temp) or out == runner_temp:
        raise RuntimeError("Evidence/output must be a child of RUNNER_TEMP")
    out.mkdir(parents=True, exist_ok=False)
    receipt = {"baselineCommit": BASELINE, "scope": "Descriptor and ordinary legacy-client compatibility; explicit legacy MIN is the documented automatic-clock reservation, not an unchanged numeric behavior.", "commands": [], "pass": False}

    def run(name, command, cwd):
        result = subprocess.run(command, cwd=cwd, capture_output=True)
        (out / f"{name}.stdout.log").write_bytes(result.stdout)
        (out / f"{name}.stderr.log").write_bytes(result.stderr)
        receipt["commands"].append({"name": name, "args": list(map(str, command)), "cwd": str(cwd), "exit": result.returncode})
        if result.returncode:
            raise RuntimeError(f"{name} failed ({result.returncode}); see retained logs")
        return result.stdout

    try:
        legacy_repo = out / "legacy-repo"
        legacy_repo.mkdir()
        run("git-init", ["git", "init", "--quiet"], legacy_repo)
        run("git-fetch", ["git", "fetch", "--depth=1", "--no-tags", "https://github.com/Rockyljewell/QR-GEN.git", BASELINE], legacy_repo)
        fetched = run("git-head", ["git", "rev-parse", "FETCH_HEAD"], legacy_repo).decode().strip()
        if fetched != BASELINE:
            raise RuntimeError(f"Wrong baseline commit: {fetched}")
        archive = run("git-archive", ["git", "archive", "--format=tar", "FETCH_HEAD", "packages/android"], legacy_repo)
        legacy_root = out / "legacy-source"
        legacy_root.mkdir()
        with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
            for entry in tar.getmembers():
                if entry.issym() or entry.islnk() or not (legacy_root / entry.name).resolve().is_relative_to(legacy_root):
                    raise RuntimeError(f"Unexpected archive path/link: {entry.name}")
            tar.extractall(legacy_root, filter="data")
        legacy = legacy_root / "packages/android"
        run("baseline-core", [str(legacy / "gradlew"), ":qrgen-core:jar", "-Pqrgen.android=false", "--no-daemon"], legacy)
        old_jar = jar(legacy / "qrgen-core/build/libs")
        current_jar = jar(ANDROID / "qrgen-core/build/libs")
        receipt["baselineJar"] = pin(old_jar)
        receipt["currentJar"] = pin(current_jar)
        for name in ["dev.qrgen.DuplicateFilter", "dev.qrgen.BarcodeTracker"]:
            old = run(f"baseline-javap-{name}", ["javap", "-public", "-s", "-classpath", str(old_jar), name], legacy).decode()
            new = run(f"current-javap-{name}", ["javap", "-public", "-s", "-classpath", str(current_jar), name], ANDROID).decode()
            old_header, old_members = members(old)
            new_header, new_members = members(new)
            if old_header is None or new_header is None or old_header != new_header or not old_members or not old_members.issubset(new_members):
                raise RuntimeError(f"Legacy public ABI changed for {name}: {sorted(old_members - new_members)}")
            if not any("$default" in member for member in old_members) or not any("DefaultConstructorMarker" in member for member in old_members):
                raise RuntimeError(f"Baseline default ABI was not observed for {name}")
        consumer = out / "consumer"
        for language, filename in [("java", "LegacyJavaClockClient.java"), ("kotlin", "LegacyKotlinClockClient.kt")]:
            destination = consumer / f"src/main/{language}/dev/qrgen/abi/{filename}"
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ANDROID / "scripts/clock-abi" / filename, destination)
        versions = tomllib.loads((legacy / "gradle/libs.versions.toml").read_text())["versions"]
        # JSON strings plus escaped $ are valid Kotlin path/version literals; no shell interpolation.
        quote = lambda value: json.dumps(str(value)).replace("$", "\\$")
        (consumer / "settings.gradle.kts").write_text('rootProject.name = "qrgen-legacy-clock-consumer"\n')
        build = f'''plugins {{ kotlin("jvm") version {quote(versions["kotlin"])} }}
repositories {{ mavenCentral() }}
kotlin {{ jvmToolchain(17) }}
tasks.withType<JavaCompile>().configureEach {{ options.release.set(17) }}
dependencies {{
    implementation(files({quote(old_jar)}))
    implementation("com.google.zxing:core:{versions["zxing"]}")
    implementation(kotlin("reflect"))
}}
tasks.register("writePaths") {{
    dependsOn("classes")
    doLast {{
        file("compile-paths.txt").writeText(sourceSets.main.get().compileClasspath.files.joinToString("\\n") {{ it.absolutePath }})
        file("runtime-paths.txt").writeText(sourceSets.main.get().runtimeClasspath.files.joinToString("\\n") {{ it.absolutePath }})
    }}
}}
'''
        (consumer / "build.gradle.kts").write_text(build)
        run("compile-legacy-clients", [str(legacy / "gradlew"), "-p", str(consumer), "classes", "writePaths", "--no-daemon"], consumer)
        compile_paths = [Path(p).resolve() for p in (consumer / "compile-paths.txt").read_text().splitlines()]
        runtime_paths = [Path(p).resolve() for p in (consumer / "runtime-paths.txt").read_text().splitlines()]
        if compile_paths.count(old_jar) != 1 or current_jar in compile_paths or runtime_paths.count(old_jar) != 1:
            raise RuntimeError("Legacy compile classpath was not isolated")
        candidate_paths = [current_jar if p == old_jar else p for p in runtime_paths]
        if old_jar in candidate_paths or candidate_paths.count(current_jar) != 1:
            raise RuntimeError("Candidate runtime classpath was not isolated")
        receipt["legacyCompileClasspath"] = list(map(str, compile_paths))
        receipt["candidateRuntimeClasspath"] = list(map(str, candidate_paths))
        classes = sorted((consumer / "build/classes").rglob("*.class"))
        receipt["legacyClientClassesBefore"] = [pin(path) for path in classes]
        if not classes:
            raise RuntimeError("Legacy client compilation produced no classes")
        receipt["legacyCompilerVersion"] = versions["kotlin"]
        run("legacy-kotlin-bytecode", ["javap", "-c", "-p", "-classpath", os.pathsep.join(map(str, runtime_paths)), "dev.qrgen.abi.LegacyKotlinClockClientKt"], consumer)
        for language, main_class in [("java", "dev.qrgen.abi.LegacyJavaClockClient"), ("kotlin", "dev.qrgen.abi.LegacyKotlinClockClientKt")]:
            output = run(f"run-legacy-{language}", ["java", f"-Dqrgen.expectedCore={current_jar}", "-cp", os.pathsep.join(map(str, candidate_paths)), main_class], consumer).decode()
            if f"CLOCK_ABI_CLIENT {language} passed" not in output:
                raise RuntimeError(f"{language} client did not acknowledge candidate runtime")
        receipt["legacyClientClassesAfter"] = [pin(path) for path in classes]
        if receipt["legacyClientClassesBefore"] != receipt["legacyClientClassesAfter"]:
            raise RuntimeError("Legacy clients changed after compilation")
        receipt["pass"] = True
        print("CLOCK_ABI_VERIFIED pinned legacy Java/Kotlin classes passed on current core; generated defaults, constructors, references and callBy retained.")
    except Exception as error:
        receipt["error"] = str(error)
        raise
    finally:
        (out / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")


if __name__ == "__main__":
    main()
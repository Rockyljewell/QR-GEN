#!/usr/bin/env python3
"""Local harness checks only: no Docker, downloads, build tools or reader execution."""
import importlib.util
import json
import os
import pathlib
import shutil
import tarfile
import tempfile
import unittest
from unittest import mock

HERE = pathlib.Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("ean316_build", HERE / "run.py")
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)


class RunnerBoundaries(unittest.TestCase):
    def test_pinned_configuration(self):
        self.assertEqual(len(runner.load_inputs()["sourceFiles"]), 23)

    def test_source_note_copy_requires_matching_hash(self):
        with tempfile.TemporaryDirectory() as temporary:
            parent = pathlib.Path(temporary)
            with mock.patch.dict(os.environ, {"GITHUB_RUN_ID": "local", "GITHUB_RUN_ATTEMPT": "1"}):
                build = runner.Build(runner.load_inputs(), "baseline", parent / "out", parent)
            build.source = build.work / "source"
            build.source.mkdir()
            data = b"Controlled attribution text; no upstream code execution.\n"
            source = build.source / "LICENSE"
            source.write_bytes(data)
            build.notes = [{"family": "wasm", "path": "LICENSE", "role": "attribution",
                            "sha256": runner.digest(data),
                            "gitBlob": runner.digest(b"blob " + str(len(data)).encode() + b"\0" + data, "sha1")}]
            build.retain_source_notes()
            retained = build.evidence / "attribution/wasm/LICENSE"
            self.assertEqual(retained.read_bytes(), data)
            source.write_bytes(data + b"changed")
            with self.assertRaisesRegex(ValueError, "Additional source differs"):
                build.retain_source_notes()
            self.assertEqual(retained.read_bytes(), data)

    def test_tampered_patch_rejected_before_build(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = pathlib.Path(temporary)
            shutil.copy2(HERE / "pins.json", folder / "pins.json")
            pins = json.loads((folder / "pins.json").read_bytes())
            for name in pins["patches"]:
                shutil.copy2(HERE / name, folder / name)
            patch = folder / "ean13-whole-word-ambiguity.patch"
            patch.write_bytes(patch.read_bytes() + b"changed")
            with mock.patch.object(runner, "HERE", folder):
                with self.assertRaisesRegex(ValueError, "Patch hash"):
                    runner.load_inputs()

    def test_output_must_be_fresh_and_outside_checkout(self):
        with tempfile.TemporaryDirectory() as temporary:
            parent = pathlib.Path(temporary).resolve()
            checkout = parent / "checkout"
            checkout.mkdir()
            stale = parent / "stale"
            stale.mkdir()
            for bad in (parent, checkout / "output", stale):
                with self.assertRaises(ValueError):
                    runner.output_path(bad, parent, checkout)
            self.assertEqual(runner.output_path(parent / "fresh", parent, checkout), parent / "fresh")

    def test_archive_escape_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            parent = pathlib.Path(temporary)
            archive = parent / "unsafe.tar"
            with tarfile.open(archive, "w") as stream:
                stream.addfile(tarfile.TarInfo("node/../../escaped"))
            with self.assertRaises(tarfile.FilterError):
                runner.unpack(archive, parent / "unpack", "node")
            self.assertFalse((parent / "escaped").exists())

    def test_wrong_archive_root_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            parent = pathlib.Path(temporary)
            archive = parent / "wrong.tar"
            with tarfile.open(archive, "w") as stream:
                stream.addfile(tarfile.TarInfo("other/file"))
            with self.assertRaises(ValueError):
                runner.unpack(archive, parent / "unpack", "node")

    def test_network_mismatch_blocks_start(self):
        with tempfile.TemporaryDirectory() as temporary:
            parent = pathlib.Path(temporary)
            with mock.patch.dict(os.environ, {"GITHUB_RUN_ID": "local", "GITHUB_RUN_ATTEMPT": "1"}):
                build = runner.Build(runner.load_inputs(), "baseline", parent / "out", parent)
            calls = []

            def controlled(name, args, **kwargs):
                calls.append(args)
                if args[1] == "create":
                    controlled.name = args[args.index("--name") + 1]
                    return "a" * 64
                return json.dumps([{"Name": "/" + controlled.name,
                                    "HostConfig": {"NetworkMode": "bridge"}}])

            with mock.patch.object(build, "run", side_effect=controlled):
                with self.assertRaisesRegex(RuntimeError, "network mode"):
                    build.container("offline-build", "none", "controlled unused script", 1)
            self.assertEqual([call[1] for call in calls], ["create", "inspect"])

    def test_deadline_stops_before_process(self):
        with tempfile.TemporaryDirectory() as temporary:
            parent = pathlib.Path(temporary)
            with mock.patch.dict(os.environ, {"GITHUB_RUN_ID": "local", "GITHUB_RUN_ATTEMPT": "1"}):
                build = runner.Build(runner.load_inputs(), "baseline", parent / "out", parent)
            build.deadline = 0
            with mock.patch.object(runner.subprocess, "Popen") as process:
                with self.assertRaises(TimeoutError):
                    build.run("controlled", ["never-executed"])
            process.assert_not_called()

    def test_container_absence_is_required(self):
        with tempfile.TemporaryDirectory() as temporary:
            parent = pathlib.Path(temporary)
            with mock.patch.dict(os.environ, {"GITHUB_RUN_ID": "local", "GITHUB_RUN_ATTEMPT": "1"}):
                build = runner.Build(runner.load_inputs(), "baseline", parent / "out", parent)
            build.containers = ["a" * 64]
            with mock.patch.object(build, "run", side_effect=[None, "a" * 64]):
                with self.assertRaisesRegex(RuntimeError, "still exists"):
                    build.remove_container("a" * 64, "controlled")
            self.assertEqual(build.containers, ["a" * 64])


if __name__ == "__main__":
    unittest.main()

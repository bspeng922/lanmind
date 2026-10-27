"""Release checks tested without an Apple certificate or macOS tooling."""

import base64
from contextlib import redirect_stdout
import importlib.util
import io
import os
from pathlib import Path
import plistlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("verify_macos_release", Path(__file__).with_name("verify-macos-release.py"))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)

TEAM = "ABCDE12345"
CONFIG = {"productName": "LanMind", "identifier": "com.zhiyu.collaboration", "version": "0.2.1"}
IDENTITY = f"Developer ID Application: Example ({TEAM})"
SIGNATURE = f"Authority={IDENTITY}\nTeamIdentifier={TEAM}\nCodeDirectory v=20500 flags=0x10000(runtime) hashes=1\n"
CREDENTIALS = {
    "APPLE_CERTIFICATE": base64.b64encode(b"test certificate").decode(),
    "APPLE_CERTIFICATE_PASSWORD": "private-certificate-password",
    "APPLE_SIGNING_IDENTITY": IDENTITY,
    "APPLE_ID": "example@example.com",
    "APPLE_PASSWORD": "private-app-specific-password",
    "APPLE_TEAM_ID": TEAM,
}


class ReleaseChecks(unittest.TestCase):
    def app(self, root):
        app = root / "macos" / "LanMind.app"
        contents = app / "Contents"
        contents.mkdir(parents=True)
        with (contents / "Info.plist").open("wb") as stream:
            plistlib.dump({"CFBundleIdentifier": CONFIG["identifier"], "CFBundleShortVersionString": CONFIG["version"]}, stream)
        return app

    def command(self, *args):
        return subprocess.CompletedProcess(args, 0, "", SIGNATURE if args[0] == "codesign" and "--display" in args else "")

    def test_credentials_never_print_values_and_missing_password_blocks_release(self):
        with patch.dict(os.environ, CREDENTIALS, clear=True), redirect_stdout(io.StringIO()) as output:
            release.check_credentials()
        for value in CREDENTIALS.values():
            self.assertNotIn(value, output.getvalue())
        missing = {key: value for key, value in CREDENTIALS.items() if key != "APPLE_PASSWORD"}
        with patch.dict(os.environ, missing, clear=True), self.assertRaisesRegex(release.VerificationError, "APPLE_PASSWORD"):
            release.check_credentials()

    def test_adhoc_certificate_wrong_team_and_invalid_export_are_rejected(self):
        for name, value in [("APPLE_SIGNING_IDENTITY", "-"), ("APPLE_TEAM_ID", "OTHER12345"), ("APPLE_CERTIFICATE", "not base64!")]:
            with self.subTest(name=name), patch.dict(os.environ, {**CREDENTIALS, name: value}, clear=True):
                with self.assertRaises(release.VerificationError):
                    release.check_credentials()

    def test_notarized_developer_id_app_is_accepted(self):
        with tempfile.TemporaryDirectory() as directory:
            app = self.app(Path(directory))
            with patch.object(release, "run_command", side_effect=self.command):
                release.verify_app(app, CONFIG, TEAM)

    def test_damaged_signature_missing_ticket_and_gatekeeper_rejection_block_release(self):
        with tempfile.TemporaryDirectory() as directory:
            app = self.app(Path(directory))
            for failing_tool in ["codesign", "xcrun", "spctl"]:
                def command(*args):
                    if args[0] == failing_tool:
                        raise release.VerificationError(f"{failing_tool} rejected artifact")
                    return self.command(*args)
                with self.subTest(tool=failing_tool), patch.object(release, "run_command", side_effect=command):
                    with self.assertRaisesRegex(release.VerificationError, "rejected artifact"):
                        release.verify_app(app, CONFIG, TEAM)

    def test_signature_must_belong_to_expected_team_and_enable_hardened_runtime(self):
        with tempfile.TemporaryDirectory() as directory:
            app = self.app(Path(directory))
            for metadata in [SIGNATURE.replace(TEAM, "OTHER12345"), SIGNATURE.replace("(runtime)", "(none)"), "TeamIdentifier=not set\n"]:
                def command(*args):
                    return subprocess.CompletedProcess(args, 0, "", metadata)
                with self.subTest(metadata=metadata), patch.object(release, "run_command", side_effect=command):
                    with self.assertRaises(release.VerificationError):
                        release.verify_app(app, CONFIG, TEAM)

    def test_packaged_app_failure_unmounts_image_and_blocks_release(self):
        with tempfile.TemporaryDirectory() as directory:
            bundle = Path(directory)
            self.app(bundle)
            (bundle / "dmg").mkdir()
            (bundle / "dmg" / "LanMind.dmg").write_bytes(b"test image")
            mount = bundle / "mount"
            mount.mkdir()
            with patch.object(release.tempfile, "mkdtemp", return_value=str(mount)):
                with patch.object(release, "verify_app", side_effect=[None, release.VerificationError("damaged packaged app")]):
                    with patch.object(release, "run_command", side_effect=self.command) as commands:
                        with self.assertRaisesRegex(release.VerificationError, "damaged packaged app"):
                            release.verify_release(bundle, CONFIG, TEAM)
                        self.assertTrue(any(call.args[:2] == ("hdiutil", "detach") for call in commands.call_args_list))
            self.assertFalse(mount.exists())

    def test_incorrect_bundle_version_is_rejected_before_native_commands(self):
        with tempfile.TemporaryDirectory() as directory:
            app = self.app(Path(directory))
            with patch.object(release, "run_command") as command:
                with self.assertRaisesRegex(release.VerificationError, "version"):
                    release.verify_app(app, {**CONFIG, "version": "0.2.2"}, TEAM)
                command.assert_not_called()


if __name__ == "__main__":
    unittest.main()

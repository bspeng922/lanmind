#!/usr/bin/env python3
"""Fail release builds that lack Developer ID signing or a notarized app."""

import argparse
import base64
import binascii
import json
import os
from pathlib import Path
import plistlib
import re
import subprocess
import sys
import tempfile


APPLE_SECRETS = (
    "APPLE_CERTIFICATE",
    "APPLE_CERTIFICATE_PASSWORD",
    "APPLE_SIGNING_IDENTITY",
    "APPLE_ID",
    "APPLE_PASSWORD",
    "APPLE_TEAM_ID",
)


class VerificationError(RuntimeError):
    pass


def check_credentials():
    missing = [name for name in APPLE_SECRETS if not os.environ.get(name, "").strip()]
    if missing:
        raise VerificationError("Missing GitHub Actions secrets: " + ", ".join(missing))
    team = os.environ["APPLE_TEAM_ID"]
    if not re.fullmatch(r"[A-Z0-9]{10}", team):
        raise VerificationError("APPLE_TEAM_ID must be the 10-character Apple Developer Team ID")
    identity = os.environ["APPLE_SIGNING_IDENTITY"]
    if not identity.startswith("Developer ID Application: ") or not identity.endswith(f"({team})"):
        raise VerificationError("APPLE_SIGNING_IDENTITY must be a Developer ID Application identity for APPLE_TEAM_ID")
    try:
        certificate = base64.b64decode("".join(os.environ["APPLE_CERTIFICATE"].split()), validate=True)
    except (ValueError, binascii.Error):
        raise VerificationError("APPLE_CERTIFICATE must contain the base64-encoded .p12 export") from None
    if not certificate:
        raise VerificationError("APPLE_CERTIFICATE is empty")
    print("Apple signing and notarization credentials are configured (values hidden).")


def run_command(*args):
    try:
        result = subprocess.run([str(arg) for arg in args], capture_output=True, text=True, check=False, timeout=180)
    except subprocess.TimeoutExpired:
        raise VerificationError(f"{args[0]} timed out after 180 seconds") from None
    if result.returncode:
        detail = (result.stdout + result.stderr).strip()
        raise VerificationError(f"{args[0]} failed ({result.returncode}): {detail}")
    return result


def verify_signature(path, team, *, hardened):
    options = ["--verify", "--strict", "--verbose=2"]
    if hardened:
        options.append("--deep")
    run_command("codesign", *options, path)
    details = run_command("codesign", "--display", "--verbose=4", path)
    details = details.stdout + details.stderr
    if not re.search(r"^Authority=Developer ID Application: .+$", details, re.MULTILINE):
        raise VerificationError(f"{path.name} is not signed with a Developer ID Application certificate")
    if not re.search(r"^TeamIdentifier=" + re.escape(team) + r"$", details, re.MULTILINE):
        raise VerificationError(f"{path.name} was signed by a different Apple Developer team")
    if hardened and not re.search(r"^CodeDirectory .*flags=.*\([^\n)]*\bruntime\b", details, re.MULTILINE):
        raise VerificationError(f"{path.name} does not have Hardened Runtime enabled")


def verify_app(app, config, team):
    if not app.is_dir():
        raise VerificationError(f"Application bundle is missing: {app}")
    with (app / "Contents" / "Info.plist").open("rb") as stream:
        info = plistlib.load(stream)
    if info.get("CFBundleIdentifier") != config["identifier"]:
        raise VerificationError(f"Unexpected bundle identifier in {app}")
    if info.get("CFBundleShortVersionString") != config["version"]:
        raise VerificationError(f"Unexpected application version in {app}")
    verify_signature(app, team, hardened=True)
    run_command("xcrun", "stapler", "validate", app)
    run_command("spctl", "--assess", "--type", "execute", "--verbose=4", app)


def verify_release(bundle, config, team):
    if not re.fullmatch(r"[A-Z0-9]{10}", team):
        raise VerificationError("Set APPLE_TEAM_ID to the expected 10-character Apple Developer Team ID")
    app_name = config["productName"] + ".app"
    verify_app(bundle / "macos" / app_name, config, team)
    images = sorted((bundle / "dmg").glob("*.dmg"))
    if len(images) != 1:
        raise VerificationError(f"Expected one DMG in {bundle / 'dmg'}, found {len(images)}; use a clean build directory")
    image = images[0]
    verify_signature(image, team, hardened=False)
    run_command("hdiutil", "verify", image)
    mount = Path(tempfile.mkdtemp(prefix="lanmind-release-"))
    mounted = False
    try:
        run_command("hdiutil", "attach", "-readonly", "-nobrowse", "-noautoopen", "-mountpoint", mount, image)
        mounted = True
        # Validate the delivered copy as well as the original build output.
        verify_app(mount / app_name, config, team)
    finally:
        if mounted:
            run_command("hdiutil", "detach", mount)
        # Never recursively clean a volume if detaching it failed.
        mount.rmdir()
    print("Verified Developer ID signatures, Hardened Runtime, app notarization tickets, Gatekeeper, and DMG contents.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("credentials", help="Check required Apple environment variables without exposing them")
    verify = commands.add_parser("verify", help="Verify a finished macOS release on a Mac")
    verify.add_argument("bundle_directory", type=Path)
    verify.add_argument("--config", type=Path, default=Path("src-tauri/tauri.conf.json"))
    args = parser.parse_args()
    try:
        if args.command == "credentials":
            check_credentials()
        else:
            if sys.platform != "darwin":
                raise VerificationError("macOS release verification requires a Mac with Xcode Command Line Tools")
            config = json.loads(args.config.read_text(encoding="utf-8"))
            verify_release(args.bundle_directory, config, os.environ.get("APPLE_TEAM_ID", ""))
    except (VerificationError, OSError, ValueError, plistlib.InvalidFileException) as error:
        print(f"macOS release check failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

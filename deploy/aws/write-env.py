#!/usr/bin/env python3
"""The server's private environment file, as deploy/aws/bootstrap.sh writes it at first boot.

The keys come from the stack's Secrets Manager secrets, the rest from the stack's values in MOUSA_* variables. Each
value is written in single quotes, which Docker Compose takes literally, so a value holding a quote or a line break is
refused. The file is written with mode 600 to MOUSA_ENV_FILE (default /etc/mousa/demo.env); nothing is printed but the
number of settings and the commit.
"""
import json
import os
import re
import subprocess
import sys


def settings(env, read, commit):
    """The settings, by name: `env` holds the MOUSA_* values, `read` returns a secret's string by its ARN."""
    keys = json.loads(read(env["MOUSA_KEYS_SECRET"]))
    url = env.get("MOUSA_REPOSITORY_URL", "")
    return {
        "QLOO_API_KEY": keys["QLOO_API_KEY"], "KIRO_API_KEY": keys["KIRO_API_KEY"], "TRY_ACCESS_CODE": keys["TRY_ACCESS_CODE"], "TRY_ACCESS": "open",
        "SITE_SECRET": read(env["MOUSA_SITE_SECRET"]), "DEMO_ACCESS_TOKEN": read(env["MOUSA_TOKEN_SECRET"]),
        "QLOO_API_BASE_URL": "https://hackathon.api.qloo.com", "KIRO_MODEL": env.get("MOUSA_KIRO_MODEL") or "claude-opus-5.5",
        "KIRO_EFFORT": "medium", "KIRO_RUN_TIMEOUT_MS": "900000", "MAX_JOBS": "60", "PRODUCTION_STAGES": "on",
        "MOUSA_CAPTURE": "auto", "MOUSA_CAPTURE_NO_SANDBOX": "", "MOUSA_CAPTURE_INLINE_SIDE": "",
        "DEMO_BIND": "0.0.0.0", "DEMO_PORT": "8787", "DEMO_PREVIEW_PORT": "8788",
        "PUBLIC_APP_BASE_URL": "https://" + env["MOUSA_APP_DOMAIN"], "PUBLIC_PREVIEW_BASE_URL": "https://" + env["MOUSA_PREVIEW_DOMAIN"],
        "TRUST_PROXY": "1", "KIRO_RELEASE_CHANNEL": "stable", "KIRO_EXPECTED_VERSION": "", "KIRO_EXPECTED_MAJOR": "2",
        "MOUSA_COMMIT": commit, "SITE_REPOSITORY_URL": re.sub(r"\.git$", "", url) if url.startswith("https://") else "",
        "TRY_ARMS_PARALLEL": "on", "TRY_QLOO_BUDGET": "24", "TRY_DAILY_RUNS": "100", "TRY_DAILY_PAIRS": "10", "TRY_DAILY_CREDITS": "0",
        "TRY_PRIVATE_RETENTION_DAYS": "14", "LOG_FORMAT": "json", "REQUEST_LOG": "on", "LEGACY_JOBS": "off",
    }


def write(path, values):
    for name, value in values.items():
        if "'" in value or "\n" in value or "\r" in value:
            raise SystemExit(f"{name} holds a quote or a line break, which the environment file cannot carry.")
    os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w", newline="\n") as out:
        out.write("# Written by deploy/aws/bootstrap.sh from Secrets Manager and the stack's values. Mode 600; never print it.\n")
        for name, value in values.items():
            out.write(f"{name}='{value}'\n")
    os.chmod(path, 0o600)


def main():
    import boto3

    env = os.environ
    client = boto3.client("secretsmanager", region_name=env["MOUSA_REGION"])
    read = lambda arn: client.get_secret_value(SecretId=arn)["SecretString"]
    commit = subprocess.run(["git", "-C", env["MOUSA_REPO_DIR"], "rev-parse", "--short=12", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
    values = settings(env, read, commit)
    write(env.get("MOUSA_ENV_FILE") or "/etc/mousa/demo.env", values)
    print(f"{len(values)} settings written, commit {commit}")


if __name__ == "__main__":
    sys.exit(main())

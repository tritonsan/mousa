#!/usr/bin/env python3
"""What the first boot reports to the stack: the server's deep health check, with no secret in it.

It reads DEMO_ACCESS_TOKEN from the environment file (MOUSA_ENV_FILE, default /etc/mousa/demo.env), asks
/api/health/deep on MOUSA_APP_URL (default http://127.0.0.1:8787) and prints one line of JSON: Kiro's version and key,
the captures, whether the try is open and what it lacks, the gallery's size and the commit.
"""
import json
import os
import urllib.request


def token(path):
    for line in open(path, encoding="utf-8"):
        if line.startswith("DEMO_ACCESS_TOKEN="):
            return line.split("=", 1)[1].strip().strip("'")
    raise SystemExit("The environment file names no DEMO_ACCESS_TOKEN.")


def summary(health):
    return {
        "status": health.get("status"), "kiro": health.get("kiro", {}).get("version"), "kiroKey": health.get("kiro", {}).get("authenticated"),
        "captures": health.get("capture", {}).get("label") or health.get("capture", {}).get("reason"),
        "tryOpen": health.get("try", {}).get("open"), "tryMissing": health.get("try", {}).get("missing", []),
        "gallery": health.get("gallery", {}).get("entries"), "commit": health.get("commit"),
    }


def main():
    app = os.environ.get("MOUSA_APP_URL") or "http://127.0.0.1:8787"
    request = urllib.request.Request(f"{app}/api/health/deep", headers={"X-Demo-Token": token(os.environ.get("MOUSA_ENV_FILE") or "/etc/mousa/demo.env")})
    with urllib.request.urlopen(request, timeout=30) as response:
        print(json.dumps(summary(json.load(response))))


if __name__ == "__main__":
    main()

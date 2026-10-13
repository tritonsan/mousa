---
name: connect
description: Set up Moûsa - connect the person's own Qloo API key, and check the project folder, image generation and captures for review. Use when the person asks to set up, connect, configure or check Moûsa.
disable-model-invocation: true
---

# Set up Moûsa

Moûsa needs the person's own Qloo API key and a project folder. Pictures and captures are optional, and a plan falls back without them.

## 1. Check

Call `mousa_status`. It reports `qloo`, `project`, `images`, `capture` and `setup` lines for anything missing, worded for this host. `status: 'ready'` means Qloo is connected and a project folder is set.

## 2. Connect Qloo

Never ask for the key in the chat, never print it, and never write it into a project file.

| Host | How |
| --- | --- |
| Claude Code | The person runs `/plugin configure mousa@mousa` and enters the key; Claude Code keeps it as a sensitive setting. Or `QLOO_API_KEY` in the environment Claude Code starts from, or the local page below |
| Codex | The local page below. Or the person sets `QLOO_API_KEY` in the environment Codex starts from; the plugin passes it to the server |
| Kiro and other MCP clients | The local page below, or `QLOO_API_KEY` in the server's environment in the client's MCP configuration |

**The local page.** Call `mousa_connect` and give the person the link it returns:
- **Where.** The page opens on `127.0.0.1` behind a one-time path.
- **The key.** The person pastes their key there and chooses the endpoint: the hackathon endpoint for a hackathon key, production for a production key.
- **What it does with it.** Moûsa tests the key with one Qloo search, then saves it for this user. On Windows it is encrypted with DPAPI; elsewhere it goes in a file only the owner can read.
- **When it closes.** After a save, or after ten minutes.

The plugin's own setting comes first, then `QLOO_API_KEY` in the environment, then the key saved on the page.

## 3. Verify

Call `mousa_status({ check: true })`. It tests the key with one Qloo request and reports `check.ok`, or the error to fix.

To cap what a project may send to Qloo, the person sets `MOUSA_QLOO_BUDGET`, such as 24. `mousa_status` then shows `qloo.requests` against `qloo.budget`, and a request past it is refused with `QLOO_BUDGET`. Ask the person before you raise it.

## 4. The project folder

| Host | Folder |
| --- | --- |
| Claude Code | The project Claude Code was opened in |
| Codex | The folder of the Codex session |
| Others | Ask the person which folder to design in, then call `mousa_open_project({ path: 'absolute path' })`. Some hosts ask them to approve the call. Drive roots and the home folder are refused |

Moûsa's file tools read and write only inside that folder. Its records live in the folder's `.mousa/`, and its Qloo cache carries its own `.gitignore`.

## 5. Pictures and captures

- **images.** `host-tool` means the session's own image tool, which Codex always has. Claude Code has one only when an image tool is connected. `codex-cli` is a signed-in Codex CLI on this machine. `off` means the plans draw imagery in SVG or CSS instead.
- **capture.** Captures need a Chromium-based browser such as Edge or Chrome. `MOUSA_BROWSER` names another executable, and `MOUSA_CAPTURE=off` turns captures off.

## 6. Hooks in Codex

When Codex lists Moûsa's hooks as needing review, the person can trust them with `/hooks`. The hooks only stop project writes during the stages before a design's DNA is valid.

Then the `taste-brief` skill takes over for the first design.

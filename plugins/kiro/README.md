# Moûsa 0.7.0 for Kiro

Moûsa grounds design work in measured cultural taste from Qloo: what an audience loves, what those works share, and what that means for palette, type, imagery, motion, voice and structure. This folder is a Kiro power in the Agent Plugins format.

## Install

- **Kiro IDE.** Open the Powers panel, choose **Add Custom Power**, then **Import power from a folder**, and pick this folder. From GitHub, import the repository and choose this folder.
- **Kiro CLI (V3).** `kiro-cli powers install <this folder>`.

Kiro loads the power when a conversation is about an audience's taste or a redesign; its keywords are `qloo`, `taste`, `audience`, `redesign`, `restyle`, `design system`, `brand identity`.

## Your Qloo key

Moûsa uses your own Qloo API key. Set `QLOO_API_KEY` in the environment Kiro starts from, or let the agent open Moûsa's local key page (`mousa_connect`): you paste the key on a page on this computer, and it never passes through the chat. `MOUSA_QLOO_BUDGET` caps the Qloo requests of a project.

## The project folder

Moûsa reads and writes only inside one project folder. It is `MOUSA_PROJECT_DIR` when that is set; otherwise the folder you name when the agent asks (`mousa_open_project`); otherwise the first folder Kiro lists as the workspace's roots.

## A Kiro CLI agent

`agents/mousa-designer.json` runs the same server from a project folder without the power:
1. Copy it to the project's `.kiro/agents/`, and `prompts/mousa-designer.md` to `.kiro/prompts/`.
2. Replace every `MOUSA_PLUGIN_DIR` with the absolute path of this folder, with forward slashes.
3. Run `kiro-cli chat --agent mousa-designer` from the project folder.

The agent may use Moûsa's tools without asking. It may not write `.mousa/`, `.kiro/` or `.env` files, and it has no shell. Its 2.x fields ran on kiro-cli 2.24.0; its `permissions` block, which Kiro's V3 engine requires, follows Kiro's V3 documentation.

## What it holds

- **The `mousa` MCP server**, with thirteen tools: setup (`mousa_status`, `mousa_connect`, `mousa_open_project`), taste (`taste_profile`, `taste_ask`, `qloo_query`) and design (`design_validate`, `design_check`, `design_capture`, `image`, `materials`, `design_compare`, `design_report`).
- **Skills.** `taste-brief` (what to ask Qloo and how to read the answer), `design` (from the Taste Brief to a checked, captured design and its Taste Provenance report), `compare` (a design with Qloo and without) and `connect` (setup).
- **The open-licence font library** (SIL OFL 1.1) that designs load their type from.

Kiro has no write gate for a power, so the skills' order is the agent's to keep. It needs Node.js 22 or newer and, for review captures, a Chromium-based browser such as Chrome or Edge.

## Privacy and support

- [Privacy policy](PRIVACY.md): Moûsa runs on your computer and sends only Qloo requests, with your key.
- **Support.** Open an issue in the Moûsa repository on GitHub, the one this power came from.

Licence: MIT.

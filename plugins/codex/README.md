# Moûsa 0.5.0 for Codex

Moûsa grounds design work in measured cultural taste from Qloo: what an audience loves, what those works share, and what that means for palette, type, imagery, motion, voice and structure.

## Install

```
codex plugin marketplace add <this repository or its folder>
codex plugin add mousa@mousa
```

The `connect` skill opens on install. The agent gives you a link to Moûsa's local key page (`mousa_connect`), or you set `QLOO_API_KEY` in the environment Codex starts from. Trust Moûsa's write gate with `/hooks`. The project folder is the folder of the Codex session.

## What it holds

- **The `mousa` MCP server** has twelve tools: setup (`mousa_status`, `mousa_connect`, `mousa_open_project`), taste (`taste_profile`, `taste_ask`, `qloo_query`) and design (`design_validate`, `design_check`, `design_capture`, `image`, `materials`, `design_compare`).
- **Skills:**
  - `taste-brief`: what to ask Qloo and how to read the answer;
  - `design`: from the Taste Brief to a checked, captured design;
  - `compare`: a design with Qloo and without, on request;
  - `connect`: setup, on request.
- **A write gate.** During a design session, from the frozen prediction until the Design DNA is valid, it holds the design's file writes, and it keeps hand edits out of `.mousa/`.
- **The open-licence font library** (SIL OFL 1.1) that designs load their type from.

## Requirements

- Node.js 22 or newer.
- Your own Qloo API key.
- For review captures, a Chromium-based browser such as Edge or Chrome.

Moûsa keeps its records in the project's `.mousa/` folder, and its Qloo cache carries its own `.gitignore`. Licence: MIT.

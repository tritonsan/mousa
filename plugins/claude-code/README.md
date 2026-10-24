# Moûsa 0.7.0 for Claude Code

Moûsa grounds design work in measured cultural taste from Qloo: what an audience loves, what those works share, and what that means for palette, type, imagery, motion, voice and structure.

## Install

```
/plugin marketplace add <this repository or its folder>
/plugin install mousa@mousa
/plugin configure mousa@mousa
```

Enter your Qloo API key when asked, or leave it empty and let the agent open Moûsa's local key page (`mousa_connect`). The project folder is the one Claude Code was opened in.

## What it holds

- **The `mousa` MCP server** has thirteen tools: setup (`mousa_status`, `mousa_connect`, `mousa_open_project`), taste (`taste_profile`, `taste_ask`, `qloo_query`) and design (`design_validate`, `design_check`, `design_capture`, `image`, `materials`, `design_compare`, `design_report`).
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

Comparisons run as two agents, `mousa:mousa-designer` and `mousa:mousa-baseline`; the second has no Qloo tools.

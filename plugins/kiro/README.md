# Moûsa agent for Kiro

A Kiro CLI agent that runs Moûsa's `mousa` server and attaches its two skills.

1. Copy `mousa-designer.json` into your project's `.kiro/agents/`, and `prompts/mousa-designer.md` into `.kiro/prompts/`.
2. Replace every `MOUSA_PLUGIN_DIR` with the absolute path of a Moûsa package folder that holds `server/`, `skills/` and `library/`, such as this repository's `plugins/codex`. Use forward slashes.
3. Start the agent from the project folder: `kiro-cli chat --agent mousa-designer`. The first call, `mousa_status`, says what is missing.

The agent may use Moûsa's tools without asking, and it may not write `.mousa/`, `.kiro/` or `.env` files. Kiro has no write gate, so the skills' order is the agent's to keep.

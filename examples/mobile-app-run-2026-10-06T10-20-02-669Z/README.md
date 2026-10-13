# Ramble: a mobile app starter for the Moûsa plugin

Ramble is a small self-guided walking app for Port Calder, a fictional city. It is the proof project for the portable plugin outside the Studio: an agent with only the plugin's MCP server and skill runs the whole production protocol on an ordinary project folder. It writes its own prediction, reads the measured taste, compiles a Design DNA, plans how each device is made from the methods this machine offers, builds, checks conformance and reviews captures of the result.

| File | What it holds |
| --- | --- |
| `index.html` | The four screens: `#screen-welcome`, `#screen-walks`, `#screen-detail`, `#screen-walk` |
| `styles.css` | The interface, reading every value through `var()` |
| `tokens/tokens.json` | The design tokens (`color.ink` is `--color-ink`) |
| `tokens/tokens.css` | Each token declared as a custom property |
| `app.js` | Renders the walks, the filters, the chosen walk and the walk in progress |
| `data/walks.json` | The fixed facts: walks, distances, durations, stops and access notes |
| `serve.mjs` | A loopback server for previewing the app |
| `.kiro/agents/mousa-designer.json` | A Kiro CLI agent wired to the plugin |

On a wide screen the page is a board of the four screens in phone frames (the app-ui medium's `board` view, 1440×900); at phone width each screen fills the viewport (`phone`, 390×844), and a capture's `target` scrolls to one screen.

## Preview

The app fetches its data, so open it through the server:

```bash
node serve.mjs
```

## Run it with Kiro CLI

The redesign edits the files in place, so run it in a copy beside this folder; the agent finds the plugin by a path relative to it.

```bash
cp -r ../mobile-app ../mobile-app-run
```

Put your Qloo key in the environment of the shell that starts Kiro, never in a file of this folder; the plugin's MCP server inherits it. Then start the agent from the copy:

```bash
kiro-cli chat --agent mousa-designer --model claude-opus-5.5
```

Ask for a redesign with real references, for example: "Redesign Ramble for visitors who love Studio Ghibli films, Khruangbin and the photographs of Vivian Maier." The agent's prompt names the sequence; the plugin's tools check each stage.

The agent configuration:

- starts the plugin with `node ../../plugin/server/index.mjs` and `MOUSA_PROJECT_DIR=.`, both relative to the folder Kiro is started from. If Kiro reports that the `mousa` server failed to start, replace both with absolute paths;
- attaches the skill and its three policies as resources;
- pre-approves only the plugin's tools. Kiro's `read` and `write` tools are offered for this folder. The agent file denies reads of `.env` files and `.kiro/`, and writes to `data/`, `.kiro/`, `.mousa/` and `serve.mjs`. Kiro rejects a denied path, and asks before a read outside the folder, which a run without prompts (`--no-interactive`) refuses. The read side was checked in short live sessions with kiro-cli 2.24.0; the write settings were not. The plugin itself writes the fonts it fetches to `fonts/`, the pictures it generates to `generated/` and its captures to `.mousa/captures/`, which the agent opens with `read` to review them.

## Run it with Claude Code

Add the same server to the project's MCP configuration, for example a `.mcp.json` in the copy:

```json
{
  "mcpServers": {
    "mousa": {
      "command": "node",
      "args": ["../../plugin/server/index.mjs"],
      "env": { "MOUSA_PROJECT_DIR": "." }
    }
  }
}
```

Make the skill available by copying `plugin/skills/culture-grounded-design/` into the copy's `.claude/skills/`, and give the request together with the sequence in `.kiro/prompts/mousa-designer.md`. Claude Code opens the captures with its own Read tool.

## What the run leaves

The artifacts are `culture-assumption.json`, `culture-taste.json`, `culture-reading.json`, `culture-dna.json`, `culture-production.json` and `culture-review.json` beside the app, and the plugin's own records under `.mousa/`: the captures it issued and the pictures it generated. A review can cite only captures the plugin made in that round. Outside a host that records Kiro's session, nothing confirms which captures the agent opened, and the review says so.

## Usage and limits

`qloo_taste_profile` makes up to 24 Qloo requests, and the model run uses your Kiro credits. `culture_generate_image` works only on a machine where Codex is installed and signed in, and draws on that ChatGPT plan; elsewhere, such as on a hosted server, each planned picture is made by its step's fallback method. `culture_capture` needs a Chromium-based browser (Edge, Chrome or Chromium) that can capture a test page on this machine.

`tests/mobile-app-example.test.mjs` checks this starter without a model or a Qloo request: its tokens agree across files, an app-ui DNA built on it passes conformance, the plugin's standalone tools capture it in a real browser when one is installed, and the agent configuration stays inside the folder. The agent itself has not yet run with a model.

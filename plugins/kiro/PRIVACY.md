# Moûsa privacy policy

Moûsa is a local MCP server and a set of skills. It has no account, no telemetry and no server of its own, and it sends nothing to its authors.

## What leaves your computer

Only requests to the Qloo API, sent with your own key. They carry:
- the audience's signal you or the agent give: names of works, brands, places or audience descriptions;
- a location and age bands, when you give them.

Qloo's own terms and privacy policy apply to those requests.

## What Moûsa keeps, and where

- **Qloo's answers and the design's records.** These are the prediction, the taste profile, the design stages, the captures and the reports. They stay in the project's `.mousa/` folder on your computer, and the Qloo cache there carries its own `.gitignore`.
- **Your Qloo key.** It stays in your environment or in your user's Moûsa connections file. That file is encrypted for your Windows user with DPAPI, and elsewhere only your user can read it.

## Pictures and captures

- **Captures.** A browser on your computer takes them, and it can reach only a local server for the project.
- **Pictures.** Only the image tool of the agent you run makes them, under that tool's own terms.

## Contact

Open an issue in the Moûsa repository on GitHub.

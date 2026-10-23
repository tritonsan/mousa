# Showcase starter

The starter for Moûsa's own showcase page: one page that explains Moûsa to the jury of the Qloo Agentic Hackathon. Moûsa designs it twice in Claude Code from one sealed guess, once with what Qloo measured about the page's audience and once from the guess alone. The site shows both, with the record of how each was made.

`facts.md` holds every fact the page may state. The folder holds no design, so every file a session adds is the design's own.

Run it from the repository's root:

```sh
node scripts/run-claude-code-live.mjs --run --from examples/showcase --brief-file examples/showcase/brief.md
```

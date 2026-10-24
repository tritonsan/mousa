<p align="center"><img src="web/assets/mousa-logo.png" alt="Moûsa" width="180"></p>

# Moûsa

**Design for an audience from what it actually loves.** Moûsa is a plugin for design agents in Claude Code, Codex and Kiro. Before the agent designs anything, it freezes its own guess about the audience. Moûsa then measures the audience with Qloo and binds the design to what the guess missed. Every design ends with a report that sets the guess beside the measurement and shows where each choice came from.

An entry to the [Qloo Agentic Hackathon](https://qloo.devpost.com).

**For the jury:** [Moûsa in one minute](https://d1n6iqgwqs2043.cloudfront.net/judges/) · [the showcase](https://d1n6iqgwqs2043.cloudfront.net/showcase/), a page that explains Moûsa, designed by Moûsa · [the benchmark](https://d1n6iqgwqs2043.cloudfront.net/benchmark/) · [the live try](https://d1n6iqgwqs2043.cloudfront.net/try/), whose access code is in the submission's testing instructions.

## The problem

AI coding agents now build much of the web's new interfaces, and they design for audiences they have never met. Ask one for a record shop's website "for people who love Paterson and Nujabes", and it designs from its own idea of those people: in a live run, Kiro's sealed guess named one of the 69 works Qloo measured for that audience. The site looks plausible and generic, because that idea was never tested.

**How large the gap is, measured.** In a [pre-registered benchmark](docs/benchmark/README.md), three agents froze their own predictions for 20 audiences. Every prediction was committed to this repository before Qloo measured anything. The guesses named this share of the works Qloo then measured:

| Agent | Known share (95% interval) | Guessed works Qloo measured |
| --- | --- | --- |
| Claude Code (claude-opus-5-5) | 6.8% (5.2% to 8.5%) | 16.1% |
| Kiro (claude-opus-5.5) | 6.6% (5.2% to 8.0%) | 15.8% |
| Codex (gpt-6.1-sol, high effort) | 4.7% (3.2% to 6.1%) | 13.9% |

Both pre-registered hypotheses held for every agent. The agents knew music and TV best (about 10%) and films, brands and books least (2% to 6%). Claude Code and Kiro run the same model and differ by 0.2 points, so the blind spot is the model's, not the tool's. [Results](docs/benchmark/results.md), [predictions](docs/benchmark/predictions/).

Designers, brand teams and game studios who work with agents need the agent to know its audience beyond the obvious, and to show its evidence. Moûsa does this inside the agent a team already uses, on the project it already has: a website, an app's design tokens, a game character.

## How it works

1. **Plan.** Moûsa picks the taste questions for the medium: which Qloo domains to measure (films, music, books, TV, brands, places, games) and which tags.
2. **Freeze the guess.** Before any Qloo data, the agent writes its own prediction of what the audience loves, and the design it would make from that alone. The prediction is frozen and sealed with its SHA-256.
3. **Measure.** Moûsa asks Qloo for insights in each domain, for the audience's style and aesthetic tags, and for the qualities its measured works share, ranked by how distinctive each is for this audience against 28 others. A session sends at most 24 requests, and the answers are cached for a week.
4. **Design from the difference.** The agent reads the measurement, names how the audience's works look as a genre (broadcast score bugs, mixtape covers, hand-painted market signs), and writes a Design DNA: concrete devices for palette, type, motion, illustration and voice, each anchored to what Qloo measured, with the palette or type drawn through one of those conventions. Moûsa checks every device in the project's own design system and flags the look models default to (a cream page, a stock display serif, monospace labels, pill buttons and the like; at most two may stay). The agent reviews screenshots of what it built, names its three most generic choices and asks whether a fan of the audience's best-loved works would take the page for theirs.
5. **Report.** The Taste Provenance report sets the guess beside the measurement, marks each measured name as new or predicted, and follows it to each device and to the screenshots reviewed.

So Qloo's contribution is visible as a difference: what was measured, against what the agent would have assumed.

## The evidence

Each kind shows something different, and none shows everything. The [jury page](https://d1n6iqgwqs2043.cloudfront.net/judges/) sets them side by side, each with what it does not show.

1. **The blind spot.** The benchmark above. Separately, in the 17 recorded sessions in the gallery, the guesses named 39 of the 1,151 works Qloo measured. Anyone can recount that from the release's gallery bundle with `node scripts/blind-spot-stats.mjs <folder>`.
2. **The mechanism.** Each comparison builds two designs from one frozen prediction: one with Qloo's measurement, one from the prediction alone.

| Comparison | Agent | Distance between the two designs | Devices resting on what the prediction missed |
| --- | --- | --- | --- |
| Ilo, a game character | Claude Code | 0.53 | 9 of 9 |
| Ilo, a game character | Codex | 0.57 | 7 of 7 |
| Ilo, with painted portraits | Codex | 0.58 | 5 of 5 |
| A record shop's website, from the live try | Kiro | 0.60 | 7 of 7 |

   The distance is a heuristic over palette, type, page structure and CSS, from 0 (alike) to 1 (unrelated). It does not rate quality.
3. **Beyond the model's own variance.** In repeated pairs of one website brief (12 generations), the blind sketches of both arms were alike (p = 0.81). After Qloo, typography, structure, palette and overall distance separated (exact permutation test, p = 0.005 each). For game characters, the finished characters separated (p = 0.0079) and the blind sketches did not. See the [development notes](docs/development-notes.md).
4. **Preference.** The blind vote shows a visitor both designs without saying which one used Qloo, and asks which the audience would rather have.

**The live try** runs Moûsa in Kiro on the server for an audience the juror names. Step one, under a minute, freezes Kiro's prediction and measures the audience. Step two, about five to ten minutes, builds both designs.

## Install the plugin

Each person uses their own Qloo API key. It goes into the host's plugin settings or onto Moûsa's local key page (`mousa_connect`), never into the chat.

```sh
# Claude Code
/plugin marketplace add tritonsan/mousa
/plugin install mousa@mousa

# Codex
codex plugin marketplace add tritonsan/mousa
codex plugin add mousa@mousa

# Kiro, V3 engine, from a clone of this repository
kiro-cli powers install plugins/kiro
```

The plugin brings 13 tools, four skills (`taste-brief`, `design`, `compare` and `connect`) and a library of 55 open-licence font families. In Claude Code and Codex, a write gate also holds the design's files until its Design DNA is valid. See the [plugin README](plugin/README.md).

## How it is built

- **`plugin/server`** is the engine: one MCP server in Node 22, with no dependencies. It plans the taste questions, calls Qloo within a budget and a cache, freezes the prediction and writes the Taste Brief. It validates the Design DNA and checks it through the project's CSS custom properties, token files or Tailwind theme. It captures pages in a headless Chromium that can reach only the page it captures, and it writes the reports.
- **`plugins/`** holds the Claude Code, Codex and Kiro packages, generated byte for byte from `plugin/`.
- **`src/`** is the hosted site: the gallery, the blind vote with sealed ballots, and the live try. The try runs each Kiro session with an agent file of its own: Moûsa's tools, no shell, and write access to the starter's design files only.
- **`deploy/`** holds the Docker image, the Compose file and one CloudFormation stack for AWS. The image runs with a read-only root and no capabilities, under a seccomp profile that keeps Chromium's sandbox.
- **`tests/`** holds 548 tests, with no network or model call, run on Ubuntu and Windows in CI.

## Run it locally

Node.js 22 or later. The live try also needs the Kiro CLI, signed in or with a `KIRO_API_KEY`.

```sh
cp .env.example .env    # then set QLOO_API_KEY
npm test
npm start               # http://127.0.0.1:8787
```

## Deploy

The server is one CloudFormation stack: an instance behind two CloudFront names, the keys in Secrets Manager and a daily snapshot. See [AWS deployment](docs/aws-deployment.md#one-stack-deployawsmousa-stackjson-recommended).

## Limits

- A distance shows that two designs differ, not that one is better. The repeated-pair studies each used one brief and one model.
- The benchmark measures what each agent assumes when Moûsa asks it, with one prompt and one run per audience. Qloo's measurement is aggregate affinity data, not ground truth about any person.
- The vote is self-selected and small.
- The hosted server has no image generator, so designs made there draw their imagery in SVG and CSS. Recorded sessions made with Codex's image tool say so.
- Qloo's answers stay on the machine that asked for them, as Qloo's developer guide asks of a public repository. The site and this repository show the names Qloo measured, never its ids, scores or descriptions: the two recorded runs kept here carry stand-in ids and no scores, through the whole history, and a test keeps it so. Each design choice is the agent's interpretation of the names shown.

## More

- [Verification record](docs/verification.md): every live run, dated, with what it did not show.
- [The benchmark](docs/benchmark/README.md): its protocol and amendment, the sealed predictions and the results.
- [The submission text](docs/submission.md), with one request traced from start to result.
- [Qloo integration](docs/qloo-integration.md) and [creative policy](docs/creative-policy.md).
- [Development notes](docs/development-notes.md): the earlier, detailed README, with the protocol's history and the Studio.

## License

MIT. The fonts, photographs, music and seccomp profile carry their own licences; see the [third-party notices](THIRD_PARTY_NOTICES.md).

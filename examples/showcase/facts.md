# Facts for the page

Every fact the page states is here. Keep each one exactly. Invent no claim, number, quote, testimonial, customer or logo. Copy may be shortened, reordered and given a voice, but a number or a name must not change.

## What Moûsa is

- Name: Moûsa.
- One line: Design for an audience from what it actually loves.
- Moûsa is a plugin for the design agents teams already use: Claude Code, Codex and Kiro.
- It is an entry to the Qloo Agentic Hackathon, 2026.

## The problem

- An AI agent asked to design for an audience designs from its own idea of that audience. That idea is never tested, so the design looks plausible and generic.
- In 11 recorded Moûsa sessions in Claude Code, Codex and Kiro, the agents' sealed guesses named 22 of the 714 works Qloo measured for their audiences. 692 of them (96.9%) were missing from the guesses.
- In a pre-registered benchmark of 20 audiences, the sealed guesses of three agents named 6.8% (Claude Code), 6.6% (Kiro) and 4.7% (Codex) of the works Qloo measured.

## How it works, in five steps

1. **Plan.** Moûsa picks the taste questions for the medium: which Qloo domains to measure (films, music, books, TV, brands, places, games) and which tags.
2. **Freeze the guess.** Before any Qloo data, the agent writes its own prediction of what the audience loves, and the design it would make from that alone. The prediction is frozen and sealed with its SHA-256.
3. **Measure.** Moûsa asks Qloo what the audience loves in each domain, which style and aesthetic tags it carries, and which qualities its measured works share. A session sends at most 24 requests, and the answers are cached for a week.
4. **Design from the difference.** The agent writes a Design DNA: concrete devices for palette, type, motion, illustration and voice, each anchored to what Qloo measured. The surprises must move it away from the frozen sketch. Moûsa checks every device in the project's own design system (CSS custom properties, token files or a Tailwind theme), and the agent reviews screenshots of what it built.
5. **Report.** The Taste Provenance report sets the guess beside the measurement, marks each measured name as new or predicted, and follows it to each device and to the screenshots reviewed.

## The evidence, and what each kind does not show

- **The blind spot.** In 11 sessions, 692 of 714 measured works were not in the guesses, and 22 of the 245 works the agents guessed were measured. It does not show that the design is better.
- **The benchmark.** Twenty audiences and three agents: Claude Code, Codex and Kiro. The protocol and all 60 sealed predictions were committed to the public repository before Qloo measured any audience. The guesses named 6.8% (Claude Code), 6.6% (Kiro) and 4.7% (Codex) of the works Qloo measured, and 14% to 16% of the works they guessed were among those measured. Both pre-registered hypotheses held for every agent. The agents knew music and TV best (about 10%) and films, brands and books least (2% to 6%). It measures what the agents assume, not whether a design is better.
- **The mechanism.** Four recorded pairs were each built twice from one frozen guess, once with Qloo's measurement and once from the guess alone. The distances between the two designs were 0.53, 0.57, 0.58 and 0.60, on a heuristic scale from 0 (alike) to 1 (unrelated). That scale is not a quality score. Every device of each Qloo design rests on a name the guess missed.
- **Beyond the model's own variance.** In repeated pairs of one website brief (12 generations), the blind sketches of both arms were alike (p = 0.81). After Qloo, the typography, structure, palette and overall distance separated (exact permutation test, p = 0.005 each). For game characters, the finished characters separated (p = 0.0079) and the blind sketches did not. It shows difference, not preference.
- **The blind vote.** Visitors see both designs of a pair without knowing which used Qloo, and choose the one the audience would rather have. Voters choose themselves, and there are few.

## Three agents, one engine

- Claude Code: `/plugin marketplace add tritonsan/mousa`, then `/plugin install mousa@mousa`. Comparisons run as two subagents at once.
- Codex: `codex plugin marketplace add tritonsan/mousa`, then `codex plugin add mousa@mousa`. Codex's own image tool can paint the pictures a plan asks for.
- Kiro: `kiro-cli powers install plugins/kiro`, from a clone of the repository.
- Each person uses their own Qloo API key, entered on a local page, never in the chat.

## Try it

- **The live try** runs Moûsa in Kiro on the hosted server for an audience you name.
  - Step one, under a minute, shows Kiro's sealed guess beside Qloo's measurement.
  - Step two, about five to ten minutes, builds both designs.
  - The access code is in the submission's testing instructions.
- **The gallery** holds recorded sessions from all three agents. Each shows the design, its record and how to run it again.
- **The blind vote** asks which design the audience would rather have.

## How it is built

- One MCP server in Node 22, with no dependencies, packaged for Claude Code, Codex and Kiro from one source.
- Four skills (taste-brief, design, compare, connect), 13 tools and 55 open-licence font families.
- A write gate holds a design's files until its Design DNA is valid, in Claude Code and Codex.
- Captures in a headless Chromium that can reach only the page it captures.
- More than 500 tests, with no network or model call, run on Ubuntu and Windows.
- The hosted site runs on one AWS CloudFormation stack: an instance behind CloudFront, with the keys in Secrets Manager.

## Qloo's data

- Qloo's answers stay on the machine that asked for them.
- The site and the public repository show the names Qloo measured, never Qloo's ids, scores or descriptions.

## This page

- This page was designed by Moûsa in Claude Code, twice, from one sealed guess: once with what Qloo measured about its audience, and once from the guess alone.
- Its audience is described to Qloo as people who love This Week in Startups, The Original Kings of Comedy, the Los Angeles Dodgers, Chelsea F.C. and Live Nation: works and names the hackathon's judges are known for.
- That description tells Qloo who the audience is. It is not a claim about any judge's own taste, and no judge endorses this entry.

## Links

- The live site: https://d1n6iqgwqs2043.cloudfront.net
- The source: https://github.com/tritonsan/mousa, under the MIT licence.

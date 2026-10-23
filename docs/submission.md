# Moûsa: the submission text

The text of the Devpost entry, kept here so it can be read beside the code. The jury's access code for the live try is not here: it is in the entry's private testing instructions.

**Tagline:** AI agents design for audiences they have never met. Moûsa makes the agent seal its guess, measures the audience with Qloo, and binds every design choice to what the guess missed.

## The problem

AI coding agents now make a large share of the web's new interfaces, and they design for an audience they have never met.
- In the 2026 Stack Overflow Developer Survey, 65.5% of respondents who use AI tools had used Claude Code in the past year, and 29.5% Codex.
- Anthropic itself wrote that a model asked for a landing page without guidance almost always produces Inter, purple gradients on white and minimal animation. It called the result "immediately recognizable—and dismissible".

The deeper problem is the audience. An agent asked to design "for people who love Paterson and Nujabes" designs from its own idea of those people, and that idea is never tested.
- **In the 17 sessions we recorded** in Claude Code, Codex and Kiro, the agents' sealed guesses named 39 of the 1,151 works Qloo measured for their audiences.
- **In our pre-registered benchmark,** with 20 audiences and three agents, the sealed guesses named 6.8% (Claude Code), 6.6% (Kiro) and 4.7% (Codex) of the works Qloo measured. The predictions were public before Qloo measured anything. Claude Code and Kiro run the same model and differ by 0.2 points, so the blind spot is the model's, not the tool's.

## What it does

Moûsa is a plugin for the design agents teams already use: Claude Code, Codex and Kiro. It works on the project a team already has, whether a website, an app's design tokens or a game character. Every session takes five steps.

1. **Plan.** Moûsa picks the taste questions for the medium: which Qloo domains to measure and which tags.
2. **Freeze the guess.** Before any Qloo data, the agent writes its own prediction of what the audience loves, and the design it would make from that alone. The prediction is frozen and sealed with its SHA-256.
3. **Measure.** Moûsa asks Qloo what the audience loves in each domain, which style and aesthetic tags it carries, and which qualities its works share.
4. **Design from the difference.** The agent writes a Design DNA: concrete devices for palette, type, motion, illustration and voice, each anchored to what Qloo measured. Moûsa checks every device in the project's own design system, and the agent reviews screenshots of its build.
5. **Report.** The Taste Provenance report sets the guess beside the measurement and traces every device to the names it rests on.

Qloo's contribution becomes visible as a difference: what was measured, against what the agent would have assumed.

**It fits the theme as option (c): it integrates Qloo into existing agents.** One MCP server and four skills run in Claude Code, Codex and Kiro. The hosted site also runs it in Kiro as a live agentic tool.

## How it uses Qloo, and why

Moûsa calls the Qloo Insights API at hackathon.api.qloo.com from its own engine. Every call is a GET with query parameters and the key in X-Api-Key; nothing goes through the model. A session measures its audience once, after the guess is sealed: at most 24 requests, cached for a week.

| Request | Why |
| --- | --- |
| `/search` | Resolves the names the audience is described by. A work or creator wins over a same-named place: the search for "Paterson" returned the city before the film. |
| `/v2/tags`, `/v2/audiences` | Resolve genre words and audience descriptions such as "parents with young children" when a brief uses them. |
| `/v2/insights`, one per domain | The works the audience loves: brands, films, artists, books, TV, podcasts, games or places, with the seeds in `signal.interests.entities`, the seeds excluded, and `feature.explainability`. Brands and films are asked again below a popularity cap for lesser-known neighbours. An optional place and age bands weight every request. |
| `/v2/insights`, `filter.type=urn:tag` | Two audience-level rankings, style and aesthetic properties, sent separately. These drive motion and illustration. |
| No request | The typed tags of the measured works, grouped into shared qualities (look, mood and meaning). These anchor palette, type and voice, so one loud keyword cannot become the design. |
| `filter.results.entities` | Ranks a shortlist the agent gives, when a design decision is a choice between named options. |

## One request, from start to result

This is the live try recorded on 14 October: a record shop's website, Wax & Wane in Istanbul, for people who love Paterson and Nujabes. Ids are left out, as everywhere Moûsa publishes.

1. **Resolve.**
   - `GET /search?query=Paterson` returned the city first. Moûsa took the film.
   - `GET /search?query=Nujabes` returned the artist.
2. **Plan.** The medium is web, so Moûsa planned brands, films, music, books and TV, plus style, aesthetic, tone and shared qualities. This step made no request.
3. **The sealed guess.**
   - **Kiro predicted, among others:**
     - brands: Muji, Moleskine, Kinfolk and Aesop;
     - films: Lost in Translation, Perfect Days, Columbus and Coffee and Cigarettes;
     - music: J Dilla, Shing02, Khruangbin and Bonobo;
     - TV: Samurai Champloo, Cowboy Bebop and Midnight Diner.
   - **Its own design:** "a notebook beside a turntable: cream paper, muted brown and dusk-blue accents, a slow-spinning record motif".
4. **Measure.** It took 12 requests, such as `GET /v2/insights?filter.type=urn:entity:movie&signal.interests.entities=<Paterson>,<Nujabes>&filter.exclude.entities=<…>&feature.explainability=true`.
   - **Qloo returned, at the top of each domain:**
     - films: Anomalisa, Frances Ha, The Lobster and Synecdoche, New York;
     - music: Neutral Milk Hotel, Madvillain, the Microphones and Mount Eerie;
     - TV: The 1st Shop of Coffee Prince, My Mister and Welcome to the N.H.K.
   - **Shared qualities:** Atmospheric, Raw, Naturalistic and Intimate (look); Reflective (mood); Identity (meaning).
   - **Overlap:** of the 69 works measured, the guess had named one, J Dilla.
5. **The Design DNA** rests on the difference:
   - palette: "Night ink and one sodium lamp", anchored to Atmospheric and Luminous;
   - type: "Tall civic capitals over a plain grotesque", anchored to Visually Austere and Raw;
   - motion: "A twelve-second lamp breath", anchored to Pensive and Quiet;
   - structure: "The week as the page's spine", anchored to Identity and The 1st Shop of Coffee Prince.
6. **Result.**
   - The design made from the guess alone kept its cream notebook and turning record.
   - The one made with Qloo became "a lit window on a dark Moda street".
   - Distance between the two: 0.60 on a 0 to 1 heuristic.
   - Both are playable on the site, with the record that traces each choice.

## The evidence, and what each kind does not show

1. **The blind spot.** In 17 recorded sessions, 1,112 of 1,151 measured works were not in the guesses. Anyone can recount it from the release's gallery bundle with `node scripts/blind-spot-stats.mjs`. It says nothing about the design.
2. **The pre-registered benchmark.** Twenty audiences and three agents: Claude Code, Codex and Kiro. The protocol and all 60 sealed predictions were committed to the public repository before Qloo measured any audience. The guesses named 6.8% (Claude Code), 6.6% (Kiro) and 4.7% (Codex) of the works Qloo measured, and 14% to 16% of the works they guessed were among those measured. Both pre-registered hypotheses held for every agent. The agents knew music and TV best (about 10%) and films, brands and books least (2% to 6%). It measures what the agents assume, not whether a design is better.
   - The protocol, one amendment and every agent's sealed prediction were committed before Qloo measured any audience.
   - Qloo's measurement is aggregate affinity, not ground truth about any person.
3. **The mechanism.** Four recorded pairs were each built twice from one frozen guess.
   - The distances between the two designs were 0.53 to 0.60.
   - Every device of each Qloo design rests on a name the guess missed.
   - The distance is a heuristic, not a quality score.
4. **Beyond the model's own variance.**
   - In repeated pairs of one website brief (12 generations), the blind sketches of both arms were alike (p = 0.81). After Qloo, typography, structure, palette and overall distance separated (exact permutation test, p = 0.005 each).
   - For game characters, the finished characters separated (p = 0.0079) and the blind sketches did not.
   - Each study used one brief and one model. It shows difference, not preference.
5. **Preference.** The blind vote is open on the site. Its voters choose themselves, and there are few so far.

## How it is built

- **The engine.** One MCP server in Node 22 with no dependencies. It is packaged byte for byte for Claude Code, Codex and Kiro from one source, with four skills, 13 tools and 33 open-licence font families.
- **The write gate.** In Claude Code and Codex, it holds a design's files until its Design DNA is valid.
- **The checks.** Each device is checked through the project's CSS custom properties, token files or Tailwind theme. Captures run in a headless Chromium that can reach only the page it captures.
- **The hosted site.** It runs the live try in Kiro, with one agent file per session: Moûsa's tools, no shell, and write access to the starter's design files only. It is one AWS CloudFormation stack: an instance behind CloudFront, the keys in Secrets Manager, a read-only container root and a seccomp profile that keeps Chromium's sandbox.
- **The tests.** More than 500, with no network or model call, run on Ubuntu and Windows in CI.

## Challenges

- **Qloo's live API taught us things the docs did not:**
  - the city before the film;
  - `video_game` returning 400 where `videogame` works;
  - a style ranking returning HTTP 500 when a genre tag joined the seeds;
  - rate limits at four requests in parallel;
  - one keyword (the hockey team LA Kings' black-and-silver palette) taking over a food shop's design until typed tags were grouped into qualities.

  Each finding changed the engine, and the site's Qloo page lists them.
- **A live coding agent for six jurors.** Running one on a public server needed sessions that can only call Moûsa, write only the design's files and never see a key.
- **Keeping Qloo's data out.** Qloo's answers stay on the machine that asked for them. A test fails the build if a Qloo id or a scored entity is committed.

## What's next

- Count brands apart from works in the look family.
- Add location-led audiences for local businesses.
- Publish the blind vote's result on a date fixed in advance, whatever it shows.

## Try it

- **For the jury:** https://d1n6iqgwqs2043.cloudfront.net/judges/ shows the numbers, a four-minute path through the evidence, and what each kind does and does not show.
- **The live try:** open /try/ with the access code from the testing instructions, then name two or three works you love. In under a minute you see Kiro's sealed guess beside Qloo's measurement. Building both designs takes about five to ten minutes more.
- **The plugin**, with your own Qloo key:
  - Claude Code: `/plugin marketplace add tritonsan/mousa`, then `/plugin install mousa@mousa`.
  - Codex: `codex plugin marketplace add tritonsan/mousa`, then `codex plugin add mousa@mousa`.
- **From a clean clone:** Node 22, then `npm test` (no network) and `npm start`, with `QLOO_API_KEY` in `.env`.

## Known limits

- The distance between two designs shows they differ, not that one is better.
- The blind vote is self-selected and small.
- The benchmark measures what each agent assumes when Moûsa asks it, with one prompt and one run per audience.
- Qloo's measurement is aggregate data, and each design choice is the agent's interpretation of the names measured.
- The hosted server has no image generator, so designs made there draw their imagery in SVG and CSS.

## Built with

Node.js, the Model Context Protocol, the Qloo Insights API, Claude Code, Codex, Kiro, headless Chromium, AWS CloudFormation, Amazon EC2, Amazon CloudFront, AWS Secrets Manager and Docker.

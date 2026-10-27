# Moûsa: the submission text

The text of the Devpost entry, kept here so it can be read beside the code.

**Tagline:** AI agents design for the audience they imagine. Moûsa, a plugin for Claude Code, Codex and Kiro, makes them design for the one Qloo measures.

## In one minute

Ask an AI coding agent for "a small RPG for people who love Stardew Valley" and it builds farming, fishing and friendship: the fans it imagines. Moûsa, a plugin for Claude Code, Codex and Kiro, makes the agent write that guess down first and seals it. Then it measures the audience with Qloo and makes the design use what the guess missed. Of the 60 works Qloo measured for that audience, the guess had named one. Given the measurement, the same agent built a different game: herding puffs into a pen (Slime Rancher), taping the neighbours' stories (a Letterman interview show, 63 Up) and a band rehearsal before the nine o'clock show (Modern Baseball). Both games are playable on the site, with a record that traces every choice to the names it rests on.

We also built a game for this jury's own audience: people who love This Week in Startups, The Original Kings of Comedy, the Dodgers, Chelsea F.C. and Live Nation. The guess made one segment per name: an at-bat, a roast, a pitch room and an encore. The measurement made one stand-up set timed like a competitive game (Rocket League), with crowd work and comebacks.

## The problem

AI coding agents are now where interfaces get made: in the 2026 Stack Overflow Developer Survey, 65.5% of respondents who use AI tools had used Claude Code in the past year, and 29.5% Codex. They design from their own picture of an audience, and no one checks that picture. Anthropic wrote that, without guidance, its model settles on one look, which makes AI-generated interfaces "immediately recognizable—and dismissible".

**The gap, measured.** In a pre-registered benchmark, Claude Code, Codex and Kiro each guessed what 20 audiences love. All 60 guesses were committed to the public repository before the benchmark asked Qloo: GitHub's push log shows them arriving at 14:14 UTC on 23 October, and the analysis is stamped 14:21. The guesses missed 94.0% of the works Qloo then measured. They were shorter lists than Qloo's, which caps that share, so count the other way too: of the 1,592 works the agents guessed, 245 (15%) were among those Qloo measured. Claude Code and Kiro run the same model and differ by 0.2 points, which suggests the blind spot belongs to the model rather than the tool.

**Who it is for.** Teams that ship with AI agents for audiences they are not part of: a venue booking for a scene, a label launching an artist, a club selling to its supporters, a studio making a game for a fandom, an agency pitching to a brand's fans.

## How it works

1. **The agent guesses first.** Before any Qloo data, the agent writes down what it believes the audience loves, and the design it would make from that alone. Moûsa seals the guess with its SHA-256, so it cannot change later.
2. **Qloo measures the audience.** What it loves across films, music, books, TV, brands, podcasts, games and places, and its style and aesthetic tags. Moûsa groups the measured works' own tags into shared qualities and ranks them by how distinctive they are against 28 other measured audiences.
3. **The design must use what the guess missed.** The agent writes a Design DNA: palette, type, motion, illustration and voice choices, each anchored to measured names. The names the guess missed must change the palette, the type and the structure. Moûsa checks every choice in the project's own files and flags twelve habits of the default AI look, such as a cream page or pill buttons; at most two may stay.
4. **The record shows it.** The Taste Provenance report sets the guess beside the measurement and traces each choice to the names it rests on.

It fits the theme as option (c), integrating Qloo into existing agents: one MCP server and four skills run inside Claude Code, Codex and Kiro. The hosted site also runs it in Kiro as a live tool for any visitor.

## How it uses Qloo

Moûsa calls hackathon.api.qloo.com from its own engine, never through the model: GET requests with the key in X-Api-Key, at most 24 a session, cached for a week.

| Request | Why |
| --- | --- |
| `/search` | Resolves the names the audience is described by. A work or creator wins over a same-named place: "Paterson" returns the city before the film. |
| `/v2/tags`, `/v2/audiences` | Genre words and audience descriptions such as "parents with young children", when a brief uses them. |
| `/v2/insights`, one per domain | The works the audience loves, with the seeds in `signal.interests.entities`, the seeds excluded and `feature.explainability`. Brands and films are asked again below a popularity cap for lesser-known neighbours. |
| `/v2/insights`, `filter.type=urn:tag` | Style and aesthetic rankings for the audience as a whole. These drive motion and illustration. |
| `filter.results.entities` | Ranks a shortlist the agent gives, when a design decision is a choice between named options. |

## One request, from start to result

A live try in Kiro on 24 October: a record shop's website, Wax & Wane in Istanbul, for people who love Paterson and Nujabes. Ids are left out, as everywhere Moûsa publishes.

1. **Resolve.** `GET /search?query=Paterson` returns the city before the film, and Moûsa takes the film. Nujabes resolves to the artist.
2. **The sealed guess.** Kiro predicted Muji and Kinfolk, Lost in Translation and Perfect Days, J Dilla and Khruangbin, Samurai Champloo and Cowboy Bebop. Its own design: "cream-on-brown paper, a spinning record in the hero, typewriter details".
3. **Measure.** Twelve requests, such as `GET /v2/insights?filter.type=urn:entity:movie&signal.interests.entities=<Paterson>,<Nujabes>&filter.exclude.entities=<…>&feature.explainability=true`. Qloo returned Anomalisa, Frances Ha and Synecdoche, New York; Neutral Milk Hotel, Madvillain and the Microphones; and qualities such as Raw, Experimental and Reflective. Of the 69 works measured, the guess had named one, J Dilla.
4. **Design.** The palette, "Copier grey, toner black, one riso-blue spot ink", rests on Raw, Lo-Fi and the Microphones. The type, "Pasted-up heavy grotesque over an indie grotesk, typewriter for times", on Experimental and Madvillain. The layout, a repertory cinema's programme week, on Atmospheric, Reflective and Frances Ha.
5. **Result.** From the guess alone came amber light on dark wax, one of the default looks Moûsa flags. With Qloo came a photocopied shop zine. The two are 0.65 apart on a 0 to 1 heuristic, and each of the Qloo design's seven choices rests on at least one name the guess did not contain. Both are on the site, with the record.

## The evidence, and what each kind does not show

1. **The blind spot.** The benchmark above. In the 24 sessions recorded for the gallery, 1,556 of the 1,618 measured works were missing from the guesses. It says nothing yet about the design.
2. **The mechanism.** Sixteen pairs, each built twice from one sealed guess: once with Qloo, once from the guess alone. The two designs are 0.53 to 0.74 apart, on a heuristic that is not a quality score. Four began from one sentence and an empty folder, three games and a phone app, and their arms differ in what they do, not only in how they look.
3. **Beyond the model's own variance.** In 12 repeated generations of one website brief, the blind sketches of both arms showed no detectable difference (p = 0.81); after Qloo, type, structure, palette and overall distance separated (exact permutation test, p = 0.005 each). The protocol asks the Qloo arm to move from its sketch, so this shows that the move is more than noise, not that the moved design is better.
4. **Preference.** A blind vote on the site asks which design the audience would rather have. By 27 October no votes had been cast.

## How it is built

- **The engine.** One MCP server in Node 22 with no dependencies, packaged for Claude Code, Codex and Kiro from one source: 13 tools, four skills and 55 open-licence font families. In Claude Code and Codex a write gate holds the agent's file edits until the Design DNA is valid.
- **The hosted site.** It runs the live try in Kiro with one locked-down agent per session: Moûsa's tools only, no shell, and write access to the design's files only. It is one AWS CloudFormation stack behind CloudFront, with the keys in Secrets Manager.
- **The tests.** More than 550, with no network or model call, on Ubuntu and Windows in CI.

## Challenges

- **Qloo's live API taught us what the docs did not:** "Paterson" resolving to the city, `video_game` failing where `videogame` works, a style ranking failing when a genre tag joined the seeds, rate limits at four requests in parallel, and one keyword (the LA Kings' black and silver) taking over a food shop's design until typed tags were grouped into qualities. Each finding changed the engine; the site's Qloo page lists them.
- **Our own showcase fell into the default AI look:** seven of the twelve habits on one page. Moûsa now ranks qualities by how distinctive they are, draws the look through the works' genre conventions and flags the habits. The rebuilt showcase carries none, and neither does this site.
- **Keeping Qloo's data out of a public repository.** Moûsa publishes the names Qloo measured, never its ids, scores or descriptions, and a test fails the build otherwise.

## Try it

- **For the jury:** https://d1n6iqgwqs2043.cloudfront.net/ tells one pair from the request to the record, with both games at play. https://d1n6iqgwqs2043.cloudfront.net/judges/ gives the numbers and a four-minute path through the evidence.
- **The live try:** https://d1n6iqgwqs2043.cloudfront.net/try/, with no code or sign-in. Name two or three works you love, and in under a minute you see Kiro's sealed guess beside Qloo's measurement. Building both designs takes about five to ten minutes more. It is open to anyone, up to 100 first steps and 10 design pairs a day across all visitors.
- **The plugin**, with your own Qloo key: in Claude Code, `/plugin marketplace add tritonsan/mousa`, then `/plugin install mousa@mousa`; in Codex, `codex plugin marketplace add tritonsan/mousa`, then `codex plugin add mousa@mousa`.
- **From a clean clone:** Node 22, then `npm test` (no network) and `npm start`, with `QLOO_API_KEY` in `.env`.

## Known limits

- A distance shows that two designs differ, not that one is better, and the blind vote has no votes yet.
- The benchmark measures what each agent assumes when Moûsa asks it, with one prompt and one run per audience. Qloo's measurement is aggregate affinity, not ground truth about any person.
- Each design choice and its anchors are the agent's interpretation of the names measured. Moûsa requires and records them, but cannot judge whether a choice truly needs its anchor.
- The hosted server has no image generator, so designs made there draw their imagery in SVG and CSS.

## What's next

- The from-scratch mode in the live try: a game or an app from one sentence.
- The audience swap as a feature: one brief built for several measured audiences, so a venue or a label sees how each crowd changes the design.
- Location-led audiences for local businesses.

## Built with

Node.js, the Model Context Protocol, the Qloo Insights API, Claude Code, Codex, Kiro, headless Chromium, AWS CloudFormation, Amazon EC2, Amazon CloudFront, AWS Secrets Manager and Docker.

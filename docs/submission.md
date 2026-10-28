# Moûsa: the submission text

The text of the Devpost entry, kept here so it can be read beside the code. The entry's links and its built-with list follow the text.

**Tagline:** AI agents design for the audience they imagine. Moûsa, a plugin for Claude Code, Codex and Kiro, seals that guess, measures the audience with Qloo and makes the design use what the guess missed.

## Inspiration

Many interfaces today are made by AI coding agents. Ask one for a design and it falls back on familiar patterns, so its interfaces are, as Anthropic put it, "immediately recognizable—and dismissible". And when people describe what they have in mind, what they say and what the agent understands never quite match, so they often don't get what they wanted.

We thought the agent could catch much more if people simply named what they love: a film, a band or a game carries a whole taste. But an agent reads those names through the same patterns. It needs to know what else their fans love, and that is what Qloo measures, across films, music, books, brands, games and places.

We wanted to give the agent a muse. So we built a system that has the agent draw on Qloo in any design it makes: games, game characters, website interfaces and animations, web apps, mobile apps, etc.

## What it does

Moûsa is a plugin for Claude Code, Codex and Kiro. You ask your agent for a design as usual, in an empty folder or an existing project, and name a few things its audience loves. Moûsa then takes the design through four steps:

1. **The agent guesses first.** Before any Qloo data, it writes down what it thinks the audience loves and the design it would make from that alone. Moûsa seals the guess, so it cannot change later.
2. **Qloo measures the audience.** It returns what those fans also love across films, music, books, TV, brands, games and places, and Moûsa draws out the qualities those works share, such as Raw or Reflective.
3. **The design must use what the guess missed.** The agent writes a Design DNA that anchors each choice of palette, type, motion, illustration and voice to measured names, and the names the guess missed must change the palette, the type and the structure. Moûsa checks every choice in the project's files and flags twelve habits of the default AI look, such as pill buttons.
4. **The record shows why.** A Taste Provenance report sets the guess beside the measurement and traces each choice to the names it rests on.

Asked for "a small RPG for people who love Stardew Valley", the agent guessed farming, fishing and friendship. Of the 60 works Qloo measured for that audience, the guess had named one. With the measurement, the same agent built a different game: herding puffs into a pen (Slime Rancher), taping the neighbours' stories (a Letterman interview show, 63 Up) and a band rehearsal before the nine o'clock show (Modern Baseball). Both games are playable on the site.

Games are one medium among several. For the page that explains Moûsa to this jury, the guess lit a night game under stadium lights; the measurement read the audience through sports-drink packaging and tailoring, and the page became "Made to measure. Not off the rack." For Wax & Wane, a record shop for people who love Paterson and Nujabes, the guess gave amber light on dark wax and the measurement a photocopied shop zine. For a run club whose members love Haruki Murakami and LCD Soundsystem, the guess laid the season's Thursdays out as a streak to complete, and the measurement as an archive to come back to. The gallery also holds a music venue, a stand-up night and restyles of existing projects.

Moûsa is for teams that use AI agents to design for audiences they are not part of: a venue booking for a scene, a label launching an artist, a studio making a game for a fandom. Anyone can try it live in Kiro on the hosted site: name two or three works you love, and within a minute you see the sealed guess beside Qloo's measurement.

## How we built it

Moûsa fits the hackathon's option (c), integrating Qloo into existing agents. One MCP server, written in Node 22 with no dependencies, is packaged from a single source as a Claude Code plugin, a Codex plugin and a Kiro power, with 13 tools and four skills: connect, taste brief, design and compare.

**How Moûsa calls Qloo.** The engine sends every request itself, never through the model, and the key never passes through the chat. Requests are GETs to hackathon.api.qloo.com with X-Api-Key, at most 24 a measurement, two at a time, cached for a week.

| Request | Why |
| --- | --- |
| `/search` | Resolves the audience's names. A work wins over a same-named place: "Paterson" returns the city first. |
| `/v2/tags`, `/v2/audiences` | Genre words and audience descriptions, such as "parents with young children". |
| `/v2/insights`, one per domain | What the audience loves: seeds in `signal.interests.entities`, left out by `filter.exclude.entities`, and `feature.explainability` for which seed each work came from. Brands and films are asked again under `filter.popularity.max` for lesser-known neighbours. |
| `/v2/insights`, `filter.type=urn:tag` | Style, aesthetic and tone tags for the whole audience, which drive motion, illustration and voice. |
| `filter.results.entities` | Ranks a shortlist when a design choice is between named options. |
| `signal.location`, `signal.demographics` | Place-led audiences and age bands. |

**From works to qualities.** Moûsa groups the typed tags on the measured works into look, mood and meaning, and a tag two or more works share becomes a quality, ranked by lift against 28 reference audiences we measured. Without the lift, near-universal tags such as Intimate and Atmospheric set the palette or type for 7 of 11 gallery audiences; with it, Bad Bunny and Narcos fans lead with Gritty, Trap Latino and Urban.

**From request to result.** Every design takes the same path, and the medium decides what Moûsa asks Qloo and what it checks. Ids are left out here, as everywhere Moûsa publishes.

1. **Plan.** Moûsa reads the medium and the design system from the project, Tailwind included, and picks the domains: brands, films, artists, books and TV for a website, podcasts instead of books for an app, games and art styles for a game, places weighted by location for a café or shop. A plan stays within 24 requests.
2. **Seal.** The agent guesses the same domains and sketches its design, and Moûsa seals both with a SHA-256. In Claude Code and Codex, a write hook holds file edits until the Design DNA is valid.
3. **Measure.** `/search` resolves the names, and each domain gets one `GET /v2/insights?filter.type=urn:entity:<domain>&signal.interests.entities=<seeds>&filter.exclude.entities=<seeds>&feature.explainability=true`. Every measured name is marked new or predicted.
4. **Design.** The DNA must use the required anchors, and choices resting on what the guess missed must leave the sketch: colours at least ΔE 20 from every sketch colour, fonts outside it, sections it did not have. Pictures are briefed from a device's look, never from a work's name.
5. **Check and report.** Moûsa finds every declared token in the files: stylesheet values, fonts from its 55 open-licence families and SVG shapes on a website, design tokens in an app, colours, ids and lines in a game's code. The agent reviews browser captures in up to two rounds before the report is written. Comparing two games, Moûsa reads the functions, classes and constants their code names; our three games' two arms share at most 8% of them.

**Showing it at the hackathon.** Moûsa is a plugin that runs on the user's own computer, so to show it to the jury we also put it on a site: one AWS CloudFormation stack, an EC2 server behind two CloudFront distributions, the keys in Secrets Manager. The site plays every recorded design with its report and runs a live try, where a locked-down Kiro agent gets Moûsa's tools only, no shell and its own folder; the guess-only arm gets no Qloo key.

**Data and tests.** Moûsa publishes the names Qloo measured, never its ids, scores or descriptions, and a test fails the build otherwise. More than 550 tests run with no network or model call, on Ubuntu and Windows in CI.

**Run it yourself.** In Claude Code, `/plugin marketplace add tritonsan/mousa`, then `/plugin install mousa@mousa`; in Codex, `codex plugin marketplace add tritonsan/mousa`, then `codex plugin add mousa@mousa`, each with your own Qloo key. From a clean clone, Node 22 runs `npm test` with no network, and `npm start` with `QLOO_API_KEY` in `.env`.

## Challenges we ran into

- **Getting Qloo's data to change the design at all.** In an early version the agent asked Qloo on its own and often found what it already knew, so the designs with and without Qloo differed little; even with Qloo measured first, it kept its own type and layout. Sealing the guess first, and requiring the choices that rest on what it missed to leave its sketch, is what moved them.
- **Getting it to change the design in the right way.** Unclassified, Qloo's results could pull a design somewhere unrelated. Early designs translated single works literally: the LA Kings' tag "Black And Silver Palette" turned a food shop black and silver, and Anomalisa's keyword "Hotel" made it a night hotel. Grouping the typed tags into qualities that several works share, ranked by lift, fixed it: one work's tag can no longer steer the palette, and the palette and type must rest on a quality, never on a work's own logo or colours.
- **Showing a plugin.** Moûsa runs inside the user's own agent, which a jury cannot easily install, so we built the site with a live try on our own Kiro API key. That meant running Kiro headless on a server and freezing its version, locking each session to Moûsa's tools and its own folder (Kiro's allowed paths did not confine reads; denied paths did), keeping Chromium's sandbox in a container with a seccomp profile, and capping the try at 100 first steps and 10 design pairs a day so the budgets last through judging.
- **Qloo's live API taught us what the docs did not.** "Paterson" resolved to the city before the film, `video_game` failed where `videogame` worked, a style ranking failed once a genre tag joined the seeds, and four requests in parallel hit the rate limit. Each finding changed the engine; the site's Qloo page lists them.
- **Our own showcase fell into the default AI look**, with seven of the twelve habits on one page. Ranking by lift, drawing the look through the works' genre conventions and flagging the habits fixed it: the rebuilt showcase carries none, and neither does the site.
- **Proving the two arms stayed apart.** In Claude Code and Codex both arms share one MCP server that holds the key, so a script reads every pair's recorded stream and passes it only if nothing measured reached the guess-only arm. All 16 pairs pass.

## Accomplishments that we're proud of

- **We measured the blind spot before building on it.** In a pre-registered benchmark, Claude Code, Codex and Kiro each guessed what 20 audiences love, and all 60 guesses were committed to the public repository before the benchmark asked Qloo: GitHub's push log shows them at 14:14 UTC on 23 October, and the analysis is stamped 14:21. The guesses missed 94.0% of the works Qloo measured. Their lists were shorter than Qloo's, which caps that share, so count the other way too: of the 1,592 works the agents guessed, 245 (15%) were among those measured. Claude Code and Kiro run the same model and differ by 0.2 points, so the blind spot looks like the model's, not the tool's.
- **Sixteen pairs, each built twice from one sealed guess**, once with Qloo and once from the guess alone, are on the site with their records. The two designs are 0.53 to 0.74 apart on a heuristic that is not a quality score. Four of the pairs, three games and a phone app, began from one sentence and an empty folder, and their arms differ in what they do, not only in how they look.
- **A move beyond the model's own variance.** In 12 repeated generations of one website brief, the blind sketches of both arms showed no detectable difference (p = 0.81); after Qloo, type, structure, palette and overall distance separated (exact permutation test, p = 0.005 each). That shows the move is more than noise, not that the moved design is better.
- **A game for this jury.** For people who love This Week in Startups, The Original Kings of Comedy, the Dodgers, Chelsea F.C. and Live Nation, the guess made one segment per name: an at-bat, a roast, a pitch room and an encore. The measurement made one stand-up set timed like a competitive game (Rocket League), with crowd work and comebacks.
- **One engine in three agents.** The same plugin ran recorded sessions in Claude Code, Codex and Kiro, and anyone can run it live on the site, with no code or sign-in.

## What we learned

- **The sealed guess is the most useful thing the agent writes.** It makes the gap visible, gives both arms of a comparison the same starting point, and shows a juror within a minute what the agent assumed about them.
- **Qloo's typed tags carry more design than its rankings.** The ranked works say who the audience is; the qualities they share say how a design for them should feel, and they now anchor every palette and type choice. A tag on a single work is real data and can still be the wrong reason for a design.
- **Escaping one default can make another.** Two of the four from-scratch Qloo arms printed in two-ink risograph colours, as the record shop's live tries did, and two of the three Qloo games built a three-lane band rehearsal. These may be the next shared look, and the twelve-habit check does not count them yet.
- **What the results do not establish.** A distance shows that two designs differ, not that one is better, and the blind vote on the site had no votes when we wrote this. The benchmark measures what each agent assumes when asked once per audience, with one prompt. Qloo's measurement is aggregate affinity, not ground truth about any person. Each anchor is the agent's interpretation: Moûsa requires and records it, but cannot judge whether a choice truly needs it. The hosted server has no image generator, so designs made there draw their imagery in SVG and CSS.

## What's next for Moûsa

- **Question templates for each design decision.** Moûsa picks its Qloo domains by medium today. Next come templates for single decisions, such as a game's soundtrack, a restaurant's menu or a launch campaign, each naming the Qloo questions it needs: the domains and tags, the shortlist to rank, the place or age to weight, the audiences to compare. They shape the questions, never the look.
- **A profile of each model's blind spot.** The benchmark shows that the blind spot depends on the model and the domain: all three agents knew the most about artists and TV and the least about films, brands and books, and Codex knew 2.2 points less than Claude Code. Every sealed guess samples what a model assumes; pooled, they become its profile, so Moûsa can aim its 24 requests where the host's model is blindest and check that model's own default look.
- **Influence in proportion to evidence.** Moûsa ranks every quality by lift, works and domains, yet every surprise moves the design by the same fixed margins. Next, that weight sets how far a quality moves the design and which layers it leads: the strongest set the palette and structure, the weaker only tint ornament and copy.
- **Preference from the audiences themselves.** Distances show that two designs differ. Blind votes from people who love the seed works will show which one they would rather have.

The goal is a taste layer that every AI agent calls before it designs for anyone.

## Links

- **The video:** https://youtu.be/dR9iKRZI7Bc, 1 minute 47 seconds: Thistledown from the sealed guess to both games at play, then the jury's game, the other kinds of design and the benchmark.
- **The site:** https://d1n6iqgwqs2043.cloudfront.net/ tells one pair from the request to the record, with both games at play.
- **For the jury:** https://d1n6iqgwqs2043.cloudfront.net/judges/ gives the numbers and a four-minute path through the evidence.
- **The live try:** https://d1n6iqgwqs2043.cloudfront.net/try/, with no code or sign-in, up to 100 first steps and 10 design pairs a day across all visitors.
- **The code**, under the MIT licence: https://github.com/tritonsan/mousa

## Built with

Node.js, the Model Context Protocol, the Qloo Insights API, Claude Code, Codex, Kiro, headless Chromium, AWS CloudFormation, Amazon EC2, Amazon CloudFront, AWS Secrets Manager and Docker.

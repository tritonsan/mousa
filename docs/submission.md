# Moûsa: the submission text

The text of the Devpost entry, kept here so it can be read beside the code.

**Tagline:** AI agents design for audiences they have never met. Moûsa makes the agent write down its guess first, measures the real audience with Qloo, and ties every design choice to what the guess missed.

## The problem

Ask an AI coding agent for a record shop's website "for people who love Paterson and Nujabes", and it designs from its own picture of those fans. No one checks that picture. Moûsa makes the agent seal its guess before any data, then measures the audience with Qloo.

**The gap is large.** Three agents guessed what 20 audiences love, and all 60 guesses were published before the benchmark asked Qloo. The guesses missed 94.0% of the works Qloo measured.
- Claude Code's guesses named 6.8% of the measured works, Kiro's 6.6% and Codex's 4.7%. Claude Code and Kiro run the same model and differ by 0.2 points, which suggests the blind spot belongs to the model rather than the tool.
- In the 24 sessions we recorded, the guesses named 62 of the 1,618 works Qloo measured, and 62 of the 597 works they guessed were measured.

**These agents are where interfaces get made, and left alone they converge.** In the 2026 Stack Overflow Developer Survey, 65.5% of respondents who use AI tools had used Claude Code in the past year, and 29.5% Codex. Anthropic itself wrote that a model asked for a landing page without guidance almost always produces Inter, purple gradients on white and minimal animation. It called the result "immediately recognizable—and dismissible".

**Who it is for.** Teams that ship interfaces with AI agents for audiences they are not part of: a venue booking for a scene, a label launching an artist, a club selling to its supporters, an agency pitching to a brand's fans. Today the agent's stereotype of that audience goes into the design unchecked. Moûsa makes the stereotype visible, measures the real audience and shows where each choice came from.

## What it does

Moûsa is a plugin for the coding agents teams already design with: Claude Code, Codex and Kiro. It works on the project a team already has, whether a website, an app's design tokens or a game character. Qloo's contribution becomes visible as a difference: what was measured, against what the agent would have assumed. Every session takes four steps.

1. **The agent guesses first.** Before any Qloo data, the agent writes its own prediction of what the audience loves, and the design it would make from that alone. Moûsa seals the prediction with a SHA-256 fingerprint, so it cannot change later.
2. **Qloo measures the audience.** Moûsa asks Qloo what the audience loves in each domain it plans for the medium (films, music, books, TV, brands, podcasts, games or places) and which style and aesthetic tags it carries. It then groups the measured works' own tags into shared qualities and ranks them by how distinctive each is: how much more often this audience's works carry it than the works of 28 other measured audiences.
3. **The design must rest on what the guess missed.** The agent names how the audience's works look as a genre (broadcast score bugs, mixtape covers, photocopied zines) and writes a Design DNA: specific choices of palette, type, motion, illustration and voice, each anchored to what Qloo measured. Moûsa checks every choice in the project's own design system and flags twelve habits of the look AI models default to, such as a cream page, pill buttons or a near-black page lit by one amber lamp; at most two may stay. The agent reviews screenshots of its build, names its three most generic choices and asks whether a fan of the audience's best-loved works would take the page for theirs.
4. **The record shows it.** The Taste Provenance report sets the guess beside the measurement and traces every choice to the names it rests on.

**It fits the theme as option (c), integrating Qloo into existing agents:** one MCP server and four skills run inside Claude Code, Codex and Kiro. The hosted site also runs it in Kiro as a live agentic tool.

## How it uses Qloo, and why

Moûsa calls the Qloo Insights API at hackathon.api.qloo.com from its own engine. Every call is a GET with query parameters and the key in X-Api-Key; nothing goes through the model. A session measures its audience once, after the guess is sealed: at most 24 requests, cached for a week.

| Request | Why |
| --- | --- |
| `/search` | Resolves the names the audience is described by. A work or creator wins over a same-named place: the search for "Paterson" returned the city before the film. |
| `/v2/tags`, `/v2/audiences` | Resolve genre words and audience descriptions such as "parents with young children" when a brief uses them. |
| `/v2/insights`, one per domain | The works the audience loves: brands, films, artists, books, TV, podcasts, games or places, with the seeds in `signal.interests.entities`, the seeds excluded, and `feature.explainability`. Brands and films are asked again below a popularity cap for lesser-known neighbours. An optional place and age bands weight every request. |
| `/v2/insights`, `filter.type=urn:tag` | Two audience-level rankings, style and aesthetic properties, sent separately. These drive motion and illustration. |
| No request | The typed tags of the measured works, grouped into shared qualities (look, mood and meaning) and ranked against 28 measured audiences. These anchor palette, type and voice, so one loud keyword cannot become the design. |
| `filter.results.entities` | Ranks a shortlist the agent gives, when a design decision is a choice between named options. |

## One request, from start to result

This is a live try recorded on 24 October with the hosted try's own runner in Kiro: a record shop's website, Wax & Wane in Istanbul, for people who love Paterson and Nujabes. Ids are left out, as everywhere Moûsa publishes.

1. **Resolve.**
   - `GET /search?query=Paterson` returns the city before the film. Moûsa takes the film.
   - `GET /search?query=Nujabes` returns the artist.
2. **The sealed guess.**
   - **Kiro predicted, among others:**
     - brands: Muji, Moleskine, Kinfolk and Aesop;
     - films: Lost in Translation, Perfect Days, Coffee and Cigarettes and In the Mood for Love;
     - music: J Dilla, Shing02, Bonobo and Khruangbin;
     - TV: Samurai Champloo, Cowboy Bebop and Midnight Diner.
   - **Its own design:** "a warm, slow one-page shop site like a liner-notes booklet: cream-on-brown paper, a spinning record in the hero, typewriter details".
3. **Measure.** For the web, Moûsa planned brands, films, music, books and TV, plus style and aesthetic tags. It took 12 requests, such as `GET /v2/insights?filter.type=urn:entity:movie&signal.interests.entities=<Paterson>,<Nujabes>&filter.exclude.entities=<…>&feature.explainability=true`. This run found all 12 answers in Moûsa's week-long cache.
   - **Qloo returned, at the top of each domain:**
     - films: Anomalisa, Frances Ha, The Lobster and Synecdoche, New York;
     - music: Neutral Milk Hotel, Madvillain, the Microphones and Mount Eerie;
     - TV: The 1st Shop of Coffee Prince, Melloga Chejil, Welcome to the N.H.K. and My Mister.
   - **Shared qualities**, with how many times more often these works carry each than the works of 28 other audiences do: in the look, Abstract Hip Hop (2.47), Raw (2.15) and Atmospheric (1.69); in the mood, Experimental (2.38) and Reflective (2.03); in the meaning, Identity (1.89).
   - **Overlap:** of the 69 works measured, the guess had named one, J Dilla.
4. **Read as genres.** The agent read the measured works through their conventions, such as "photocopied DIY cassette and zine inlays: grainy black toner on grey copier paper" and "repertory cinema programme sheets: a typewritten grid of days and times".
5. **The Design DNA** rests on the difference:
   - palette: "Copier grey, toner black, one riso-blue spot ink", anchored to Raw, Lo-Fi and the Microphones;
   - type: "Pasted-up heavy grotesque over an indie grotesk, typewriter for times", anchored to Experimental, Abstract Hip Hop and Madvillain;
   - layout: "Repertory programme week and a black Thursday title card", anchored to Atmospheric, Reflective and Frances Ha;
   - structure: "Shelf cards tucked into the bins", anchored to Community-Oriented and Character driven.
6. **Result.**
   - The design made from the guess alone became "a record sleeve read at dusk: amber light on dark wax". That is the near-black page lit by one amber lamp that Moûsa lists among the looks models default to.
   - The one made with Qloo became "a photocopied shop zine: toner on grey copier paper with one riso-blue ink".
   - Distance between the two: 0.65 on a 0 to 1 heuristic. Each of the Qloo design's seven choices is anchored to at least one name the guess did not contain.
   - Both are playable on the site, with the record that traces each choice.

## From one sentence: what it does, not only how it looks

Four pairs began from one sentence and an empty folder in Claude Code: three browser games and a phone app. The guess built what the model assumes the brief means. The measurement changed what the design does.

- **"A small RPG for people who love Stardew Valley."** The guess built farming, fishing and four neighbours to befriend. With Qloo it built one summer day: herding puffs into a pen (Slime Rancher), taping the neighbours' stories with a question choice (a Letterman interview show and 63 Up) and a band rehearsal for the nine o'clock show (Modern Baseball).
- **The same for Wes Anderson's films and Fleetwood Mac, with no game named.** The guess built a pastel town of favours and a centred-photo shutter. With Qloo, a stage manager wins back three bandmates by tuning a radio through static (Oxenfree) and keeping time (Night in the Woods) before high tide.
- **A game for the jury's own audience.** The guess turned each name into a segment: an at-bat, a roast, a pitch room and an encore. With Qloo it is one stand-up set timed like a competitive game (Rocket League), with crowd work and comebacks.
- **A run club app for Murakami and LCD Soundsystem fans.** The guess built a door, a notebook and a sixteen-step loop of Thursdays to complete. With Qloo, the Thursdays became a wall to come back to, with flashbacks to old runs (Lady Dynamite), an oddity file and a pace plan written like a radio rundown (Radiolab).

Each mechanic is in the code, and the distances run from 0.57 to 0.66. Each pair is one run; the Qloo games also repeated some choices, such as a three-lane rehearsal, which the [verification record](https://github.com/tritonsan/mousa/blob/main/docs/verification.md#how-it-plays-not-only-how-it-looks--october-26-and-27-2026) lists.

## The evidence, and what each kind does not show

1. **The blind spot.** In 24 recorded sessions, 1,556 of 1,618 measured works were not in the guesses, and 62 of the 597 guessed works were measured. The sessions share a few audiences, so the counts overlap. Anyone can recount them from the release's gallery bundle with `node scripts/blind-spot-stats.mjs`. They say nothing about the design.
2. **The pre-registered benchmark.** Twenty audiences and three agents: Claude Code, Codex and Kiro. The protocol, one amendment and all 60 sealed predictions were committed to the public repository before the benchmark asked Qloo about any of its audiences. GitHub's push log shows the predictions arriving at 14:14 UTC on 23 October, and the analysis is stamped 14:21. The guesses named 6.8% (Claude Code), 6.6% (Kiro) and 4.7% (Codex) of the works Qloo measured, and 14% to 16% of the works they guessed were among those measured. Both pre-registered thresholds held for every agent: under 15% of the measured works named, and under 25% of the guesses measured. The agents knew music and TV best (about 10%) and films, brands and books least (2% to 6%).
   - It measures what the agents assume, not whether a design is better.
   - Qloo's measurement is aggregate affinity, not ground truth about any person.
3. **The mechanism.** Sixteen recorded pairs were each built twice from one frozen guess.
   - The distances between the two designs were 0.53 to 0.74.
   - In 14 of the 16, every choice of the Qloo design is anchored to at least one name the guess missed; in the other two, 7 of 8 and 9 of 10 are. The agent picks the anchors, and the record shows which were measured and which the guess had named.
   - The distance is a heuristic, not a quality score.
4. **Beyond the model's own variance.**
   - In repeated pairs of one website brief (12 generations), the blind sketches of both arms showed no detectable difference (p = 0.81). After Qloo, typography, structure, palette and overall distance separated (exact permutation test, p = 0.005 each).
   - For game characters, the finished characters separated (p = 0.0079) and the blind sketches did not.
   - Each study used one brief and one model. It shows difference, not preference.
5. **Preference.** The blind vote is open on the site. Its voters choose themselves, and there are few so far.

## How it is built

- **The engine.** One MCP server in Node 22 with no dependencies. It is packaged byte for byte for Claude Code, Codex and Kiro from one source, with four skills, 13 tools and 55 open-licence font families.
- **The write gate.** In Claude Code and Codex, a hook holds the agent's file edits until the Design DNA is valid. Shell commands are not gated.
- **The checks.** Each choice is checked through the project's CSS custom properties, token files or Tailwind theme. Captures run in a headless Chromium that can reach only the page it captures.
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
- **Our own showcase fell into the house style.** The page that explains Moûsa was built for an audience of sports leagues, hip-hop and sports documentaries. It came out as the look models give any page: cream paper, an editorial serif with one italic word, monospace labels, pill buttons, seven such habits on one page. The cause was ours. Ranked by spread, Intimate and Atmospheric turned up for 13 of the 20 benchmark audiences and steered the palette or the type for 9 each, and the model drew those adjectives the way it draws them for anyone. Moûsa now ranks qualities by how distinctive they are, draws the look through the works' genre conventions, finds the default looks in the files and makes the agent critique its own page. The rebuilt showcase keeps none of the habits: "Made to measure. Not off the rack.", in sports-label capitals on cloth grey. The same check then found three of the habits on Moûsa's own site; it now carries none.
- **A live coding agent for six jurors.** Running one on a public server needed sessions that can only call Moûsa, write only the design's files and never see a key.
- **Keeping Qloo's data out.** Moûsa publishes the names Qloo measured, never its ids, scores or descriptions. A test fails the build if a Qloo id or a scored entity is committed.

## What's next

- A from-scratch mode in the Studio and the live try: a game or an app from one sentence.
- Count brands apart from works in the look family.
- Add location-led audiences for local businesses.
- Make the audience swap a feature: one brief built for several measured audiences, so a venue or a label can see how each crowd changes the design.
- Publish the blind vote's result on a date fixed in advance, whatever it shows.

## Try it

- **For the jury:** https://d1n6iqgwqs2043.cloudfront.net/judges/ shows the numbers, a four-minute path through the evidence, and what each kind does and does not show.
- **The live try:** open https://d1n6iqgwqs2043.cloudfront.net/try/ (no code needed), then name two or three works you love. In under a minute you see Kiro's sealed guess beside Qloo's measurement. Building both designs takes about five to ten minutes more. The try is open to anyone, up to 100 first steps and 10 design pairs a day across all visitors.
- **The plugin**, with your own Qloo key:
  - Claude Code: `/plugin marketplace add tritonsan/mousa`, then `/plugin install mousa@mousa`.
  - Codex: `codex plugin marketplace add tritonsan/mousa`, then `codex plugin add mousa@mousa`.
- **From a clean clone:** Node 22, then `npm test` (no network) and `npm start`, with `QLOO_API_KEY` in `.env`.

## Known limits

- The distance between two designs shows they differ, not that one is better.
- The blind vote is self-selected and small.
- The benchmark measures what each agent assumes when Moûsa asks it, with one prompt and one run per audience.
- Qloo's measurement is aggregate data, and each design choice is the agent's interpretation of the names measured.
- The anchors and the critique are the agent's own judgment. Moûsa requires and records them, but cannot judge whether a choice truly needs its anchor.
- The live try builds at most 10 design pairs a day across all visitors, so that strangers cannot spend the Kiro budget the jury needs.
- The hosted server has no image generator, so designs made there draw their imagery in SVG and CSS.

## Built with

Node.js, the Model Context Protocol, the Qloo Insights API, Claude Code, Codex, Kiro, headless Chromium, AWS CloudFormation, Amazon EC2, Amazon CloudFront, AWS Secrets Manager and Docker.

# Qloo findings

For Qloo's team and the jury: what building Moûsa on Qloo's Insights API taught us beyond the [integration guide](qloo-integration.md), what the results say, and what we would ask. No Qloo id, score, popularity or description appears here.

## What we used

A session measures its audience once, from Moûsa's engine, after the agent's guess is sealed: at most 24 requests, 12 per benchmark run ([integration](qloo-integration.md#taste-led-sequence-040-default), [verification](verification.md#the-blind-spot-benchmark-the-showcase-and-five-new-pairs--october-23-2026)).

- **`/search`** resolves the audience's names; **`/v2/tags`** and **`/v2/audiences`**, genre words and audience descriptions ([submission](submission.md#how-it-uses-qloo-and-why)).
- **`/v2/insights`, one per domain:** the works the audience loves, seeds excluded, explainability on. Brands and films again under `filter.popularity.max=0.6`.
- **`filter.type=urn:tag`:** style and aesthetic rankings, for motion and illustration.
- **`filter.results.entities`:** a ranked shortlist of named options.

## What the live API taught us

From recorded requests ([integration](qloo-integration.md), [verification](verification.md)):

- **Request shape.** Insights is a GET with query parameters and the key in `X-Api-Key`.
- **Ambiguous names.** "Paterson" returned the city before the film, and "Studio Ghibli films" matched a music artist; no film entity or tag carries the studio's name.
- **Spelling.** `urn:entity:videogame` returned 200; the guide's `video_game` returned 400.
- **Tag seeds.** A style ranking seeded with one entity returned eight tags; adding a genre tag returned HTTP 500 ([verification](verification.md#live-voice-pair--october-4-2026)). Qloo's parameter reference and Taste Analysis recipe disagree on whether tag results take `signal.interests.tags`.
- **Namespaces.** Style, aesthetic and music tags in one request returned no aesthetic tag in the first twelve.
- **Metadata.** Explainability came with artist and brand insights and a shortlist, not with a tag request asking for it. Locality came back as `localities`, not the documented `locality` ([verification](verification.md#live-qloo-mcp-transports--october-3-2026-local-time)). An unsupported parameter can pass silently with a 200.
- **Pacing.** Four parallel requests hit the rate limit on three of seven, so Moûsa sends two at a time and retries. In one pass, three of four timed-out domains answered a minute later. The guide gives no numeric limit.
- **Typed tags.** An ice hockey team's palette tag once turned a food shop black and silver, until tags were grouped by type into shared qualities. Books in the replayed passes carried no such tag.
- **Data.** Answers stay cached for a week on the machine that asked, as the guide allows ([submission](submission.md#how-it-uses-qloo-and-why)). Example runs with Qloo's answers were purged from this repository's history on 23 October; a test now fails the build on a Qloo id or scored entity ([verification](verification.md#qloos-answers-taken-out-of-the-public-repository--october-23-2026)).

## What the measurements showed

In the [pre-registered benchmark](benchmark/README.md), three agents' 60 sealed predictions for 20 audiences were committed before the benchmark asked Qloo about any of them ([results](benchmark/results.md)):

| Agent | Known share: measured works the guess named | Confirmed share: guessed works Qloo measured |
| --- | --- | --- |
| Claude Code (claude-opus-5-5) | 6.8% (5.2% to 8.5%) | 16.1% (12.3% to 20.0%) |
| Kiro (claude-opus-5.5) | 6.6% (5.2% to 8.0%) | 15.8% (12.4% to 19.3%) |
| Codex (gpt-6.1-sol, high effort) | 4.7% (3.2% to 6.1%) | 13.9% (9.7% to 18.2%) |

Both hypotheses, known share below 15% and confirmed below 25%, were supported for every agent. Pooled over the 60 runs, the guesses named 252 of 4,185 measured works: 94.0% were missing.

By domain ([results.json](benchmark/results.json)), the agents knew music and TV best (9.0% to 11.5%), and books, brands and films least (2.0% to 5.5%). Brands and films, asked twice, hold twice the works.

**Lift.** Ranked by affinity and spread, Intimate and Atmospheric each anchored palette or type in 9 of the 20 benchmark audiences' briefs ([integration](qloo-integration.md#distinctive-qualities-and-required-works-from-the-head)). The showcase, for a sports and hip-hop audience, came out as a cream editorial page. Since 24 October, qualities rank by lift: how much more often this audience's works carry them than those of 28 audiences from Moûsa sessions. Left out one at a time, near-universal tags fell from 58% to 21% of family leaders, and the showcase now leads with Bold Typography, Determined and Resilience. With the rest of 0.7, house-style signatures fell from a mean of 2.75 of 12 on the gallery's 0.6 Qloo pages to 0.2 in five live runs ([verification](verification.md#out-of-the-house-style-07--october-24-2026)).

## What we would ask of the API

1. **Type-aware search:** the best match per entity type.
2. **Tag seeds for tag results,** or a 400 naming the parameter.
3. **Ignored parameters** listed in `warnings`.
4. **Per-namespace takes** in one tag request.
5. **Explainability for tag results**, or a note that it is entity-only.
6. **Base rates for tags:** a population share per typed tag, replacing our 28-audience reference.
7. **Typed taste tags for books.**
8. **Docs that match the wire:** the game type's spelling and `localities`.
9. **Published rate and concurrency limits** for the hackathon key.

## What this does not show

- Qloo's measurement is aggregate affinity, not ground truth about any person.
- Agents name three to six works per domain; Qloo measured 69 or 70 per audience ([protocol](benchmark/README.md#what-it-does-not-show), [results.json](benchmark/results.json)). The liberal name match can only raise the known share.
- One prompt, brief and run per agent and audience: what agents assume, not all a model knows.
- The lift reference is 28 audiences from our own sessions, not a population.
- The 0.7 changes landed together; the guess-only arms, which lift cannot touch, also fell from a mean of 3.1 signatures to 1.0 ([verification](verification.md#out-of-the-house-style-07--october-24-2026)). Each pair is one sample.
- Nothing here shows that a Qloo design is better or preferred.
- The API findings are dated observations in the hackathon environment.

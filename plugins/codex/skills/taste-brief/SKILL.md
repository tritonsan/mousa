---
name: taste-brief
description: Use before you design or restyle anything for a particular audience - a website or landing page, an app screen, a brand identity, packaging or a campaign, a menu, a café, shop or hotel, a game character or game art, a name or a piece of copy - and whenever a brief says who the work is for or what they love ("for people who love...", "fans of...", "our customers are..."). Also use it at a single open taste decision while designing, such as which artist plays, which venues to feature or where two audiences meet. It plans the Qloo questions for the medium, has you freeze your own prediction first, measures the audience with Qloo and returns a Taste Brief - the qualities their favourite works share, their pacing, surfaces and tone, works per domain with Qloo's own tags, what you did not predict, and where each design layer should look. Not for technical fixes, refactors or fully specified changes.
---

# Taste brief

Moûsa measures what an audience loves with Qloo and hands you what that means for a design. Qloo's contribution is the difference between what it measures and what you would have assumed anyway, so you write your own prediction before you see any data. The measurement then marks every result as predicted or new, and the new results are what must change your design.

Qloo returns real works, tags and how strongly they go together for this audience. It never returns colours, fonts or layouts: every design choice you derive is your interpretation, and you label it so.

## When to use it, and how deep to go

| The request | What to do |
| --- | --- |
| A whole design for an audience: a site, an app, a brand, a place, a character | Steps 0-6, then the `design` skill |
| A restyle of an existing design for an audience | Steps 0-6, then the `design` skill; the product's facts and structure stay |
| One open decision in a design this session already measured | `taste_ask` only (step 6) |
| One open decision with nothing measured yet | Steps 0-4 (a second design for the same audience is answered from the cache), then `taste_ask` |
| A technical fix, refactor, proofreading or a fully specified change | Nothing: Qloo would add no decision |

## 0. Check the setup

Call `mousa_status`. When it reports `needs-setup`, follow its `setup` lines:
- Qloo not connected: in Claude Code the person can enter the key with `/plugin configure mousa@mousa`. In any host, you can call `mousa_connect` and give them the link it returns; they enter their own Qloo API key on a page on this computer. Never ask for the key in the chat, and never write it into a file.
- No project folder: ask which folder to design in, then call `mousa_open_project` with its absolute path.

If the person declines Qloo, see [Without Qloo](#without-qloo).

## 1. Collect the audience signal

Qloo needs to know who the design is for, as things they love. Take it from the brief and the conversation:
- **references**: 3-5 films, music artists, books, TV shows, games, brands or places the audience loves, each `{name, role}`.
  - `audience` (the default): what the audience loves. Only these seed the measurement.
  - `creator-inspiration`: the designer's own inspirations. These seed it only when no audience reference is given.
  - `brand`: the client's own brand or its competitors.
  - `world-canon`: fixed facts of a fictional world.

  Brand and canon references are known names, never seeds, so they are not reported back as surprises.
- **segments**: up to three audience descriptions, such as "parents with young children". Moûsa looks them up as Qloo audience segments. They give a broader signal than named works, so add works when you can.
- **location**: a city or neighbourhood. It weights what Qloo measures toward that place, and it is required for a physical place such as a café.
- **ages**: up to three of `24_and_younger`, `25_to_29`, `30_to_34`, `35_to_44`, `45_to_54`, `35_and_younger`, `36_to_55`, `55_and_older`, and only when the brief states them.
- **decisions**: the layers or choices this design must settle, such as palette, motion, voice or music.

When the signal is missing, ask one concise question; the plan's `missing` field words it for you. If the person asks you to choose the references, choose real works transparently, give them `origin: 'agent-selected'`, and never present them as the person's taste.

Never infer taste from nationality, age, gender or identity. A setting's period or a story's location is a fixed creative fact, not a taste signal.

## 2. Plan the questions, with no request

```
taste_profile({ dryRun: true, medium, references, segments, location, ages, decisions })
```

`medium` is one of the following. Each picks the domains Qloo measures, so take the one that matches the artifact.

| medium | for |
| --- | --- |
| `web` | a website or landing page |
| `app-ui` | an app interface |
| `brand` | a brand identity, packaging or a campaign |
| `place` | a café, restaurant, shop or hotel (needs `location`) |
| `game` | a game, a character or game art |
| `writing` | copy, naming or narrative |
| `generic` | anything else |

The plan returns:
- `questions.now`: what the measurement answers, each with the Qloo call behind it, the layers it informs and its caveat.
- `questions.later`: what `taste_ask` can answer while you design.
- `domains`: what will be measured.
- `requests.estimate`: the expected range of requests, as `[fewest, most]`. At most 24 are sent.
- `missing`: what to ask the person. A `needs-input` status means ask, then plan again.
- `prediction`: the domains and the shape your prediction must have.

Planning again with only some fields keeps the rest of the saved plan, so `taste_profile({ dryRun: true, location: 'Istanbul' })` changes only the place. The result lists what it `kept`.

A `needs-restart` status means an earlier session's prediction covers other domains. Write a prediction for this plan and save it with `restart: true`.

[references/taste-questions.md](references/taste-questions.md) explains each question and each recipe.

## 3. Predict before you look

Before any Qloo data, save your own prediction:

```
design_validate({ stage: 'prediction', artifact: {
  schemaVersion: '1.0',
  audienceSummary: 'One or two sentences in your own words.',
  predictions: { <each planned domain>: [ 3-6 entries ] },
  designSketch: { summary: 'The design you would make from this prediction alone, in one sentence.',
    palette: ['3-6 #rrggbb'], fonts: ['1-3 library families'], sections: ['3-8 element ids'], motifs: ['1-5 short phrases'] } } })
```

- For a work domain (`brand`, `movie`, `artist`, `book`, `tv_show`, `videogame`, `podcast`, `place`), give 3-6 real names you expect this audience to love, from your own knowledge. Never invent a name.
- For a quality domain, give 3-6 words or short phrases, not names:
  - `style`: the pacing and look of the films and TV they like.
  - `aesthetic`: the visual and material properties of what they like.
  - `tone`: emotional tones.
  - `qualities`: looks, moods or themes their favourite works share.
  - `art_style`: art styles, such as pixel art.
- `designSketch` is the honest design you would build from this prediction alone, not a placeholder. Its fonts come from the Moûsa font library; `materials({ action: 'find', words: ['warm', 'condensed'] })` lists the families.
- The prediction is frozen once saved. To start again, save a new one with `restart: true`; the old session moves to `.mousa/history/`.

## 4. Measure

```
taste_profile({})
```

The measurement makes at most 24 Qloo requests and keeps every answer in `.mousa/cache/qloo/` for a week, so a second design for the same audience costs nothing. It saves the full records in `.mousa/taste/`; you do not need to read them, because the validators do. It returns the **Taste Brief**.

A status of `insufficient` means too few works came back to govern a design. Add a few named works, plan again, then measure.

## 5. Read the Taste Brief

| Field | What it holds |
| --- | --- |
| `audience` | Each reference as Qloo found it (`found: false` when it did not), the segments, the place and the ages |
| `measured` | The requests made, how many answers came from the cache, how many works were measured, how many of them you predicted, and how many are new |
| `qualities.look`, `.mood`, `.meaning` | Tags that two or more measured works share, with the works and domains that carry them. A `new` quality is one you did not predict |
| `tags.pacing`, `.surfaces`, `.tone`, `.artStyles` | Style, aesthetic, emotional-tone and art-style tags, ranked for this audience as a whole |
| `worlds` | The strongest works per domain, each with its leading tags: what it stands for in Qloo's own words |
| `surprises`, `confirmed` | What you did not predict, and what you did |
| `requiredAnchors` | Entries the design must use or reject with a reason, at most two rejected |
| `cautions` | Weak signals: a look carried mostly by brands, an unresolved reference, an unmatched segment |
| `layers` | Where each design layer should look |

How to weigh it:
- **Qualities first.** What the works share sets the palette and the type, not any one work's colours, logo or packaging. A work is evidence of a quality.
- **The surprises are the signal.** A new quality or work is what Qloo adds to your own expectation; your design must move toward it, away from your sketch.
- **Affinity ranks results for this signal only.** It is not a probability, a score or one person's preference.
- **Tags are Qloo's record.** What else you know about a work is your own knowledge, so say which is which.

[references/reading-taste.md](references/reading-taste.md) covers the noise and the limits. [references/translation.md](references/translation.md) shows how qualities become palette, type, motion, imagery, voice and structure.

## 6. Ask while designing

Ask one question at a time at a real decision, and write your own guess first, so the difference is visible:

```
taste_ask({ question, decision: 'the decision this settles', myGuess: 'your answer without data', ... })
```

| question | answers | cost |
| --- | --- | --- |
| `world`, `shared`, `pacing`, `surfaces`, `tone`, `difference` | From the saved profile | No request |
| `shortlist` | Ranks 2-5 named `candidates` of one `kind`, such as artists for a playlist or brands for a partner wall | A few cached requests |
| `local` | Places this audience loves around a `place` (default: the brief's location) | One cached request |
| `overlap` | Works this audience shares with another one, given as `otherReferences` | A few cached requests |

Each answer is kept in `.mousa/taste/decisions.json` with your guess. For anything no question covers, `qloo_query` searches entities, tags or audience segments, or asks Insights directly; its answers are cached too.

Then continue with the `design` skill. In the reading and the DNA, cite brief entries by the names it lists. A work's tags in the brief are the tags a device anchored to it may name.

## Without Qloo

Design without Qloo only when the person declines to connect it, or as the baseline arm of the `compare` skill. Plan and predict as above, then call `taste_profile({ baseline: true })` instead of measuring. Your prediction becomes the taste input, and no request is made. Follow the same design stages, and say plainly that no measured taste was used.

## Honesty

- Never invent Qloo results, entities, tags, affinities or explanations. Report unresolved names, unmatched segments, empty domains and failed requests as they are.
- Every colour, font, layout, motion and line you derive is your interpretation of an entity or tag. Qloo does not score designs, and a successful request does not make a design good.
- Visitor-facing work never mentions Qloo, agents or APIs. It never copies a work's logo, artwork, stills, lyrics, characters or trade dress.
- Write the saved records in English. The design's own copy follows the brief's language.

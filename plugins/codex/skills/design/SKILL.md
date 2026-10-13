---
name: design
description: Use after a Moûsa Taste Brief, or in a project with a saved .mousa design session, to turn measured taste into a built design - a taste reading, a binding Design DNA of concrete devices, a production plan, fonts and pictures, the build in the project's own design system, a conformance check, captures of the result and a review. Covers websites, app interfaces with design tokens, and any other project such as a game, a native app or a document. Use it whenever you build, restyle or repair a design that rests on a Taste Brief.
---

# Design from a Taste Brief

Moûsa checks each stage of the design against the measured taste and saves it in the project's `.mousa/` folder, so you pass only the artifact of the stage you are on. A stage is frozen once the next one rests on it. Every call takes the same `workspace` when the design lives in one (see [Workspaces](#workspaces)).

| Stage | Call | Result |
| --- | --- | --- |
| 1. Read the taste | `design_validate({ stage: 'reading', artifact })` | Clusters of what belongs together |
| 2. Specify | `design_validate({ stage: 'dna', artifact })` | The binding Design DNA, and the methods this session offers per layer |
| 3. Plan the production | `design_validate({ stage: 'plan', artifact })` | How each device is made, and the review criteria |
| 4. Gather materials | `materials({ action: 'fetch', fonts })`, `image(...)` | Fonts and pictures the plan names |
| 5. Build | your own edits, in the project's design system | The design |
| 6. Check | `design_check({})` | Each device present, partial or missing |
| 7. Capture | `design_capture({})` | Pictures of the result, in the tool result |
| 8. Review | `design_validate({ stage: 'review', artifact })` | Your verdict on each criterion |

The **medium** decides what is checked, and Moûsa detects it from the project:
- `web`: pages and stylesheets. See [references/medium-web.md](references/medium-web.md).
- `app-ui`: screens with a design token file. See [references/medium-app-ui.md](references/medium-app-ui.md).
- `generic`: any other text project, such as a game, a native app or a document. See [references/medium-generic.md](references/medium-generic.md).

An empty folder takes the medium of the taste recipe. `mousa_status` reports the design system it found.

## 1. Read the taste before you specify

Group what the brief measured into what belongs together, before deciding anything:

```
{ schemaVersion: '1.0',
  clusters: [ { id: 'c1', name: 'A short name', refs: ['2-8 entries, named as the brief lists them'], layers: ['1-4 layers'],
                reading: 'One or two sentences: what these share, as a reading of the audience.' } ],
  setAside: [ { ref: 'an entry you judge to be noise', reason: 'why, specifically' } ],
  approach: 'A paragraph: how this medium will carry the clusters.' }
```

- **Clusters.** Make 2-4, and put each entry in only one cluster.
- **Each cluster rests on a quality.** That is a quality, pacing, surface, tone or art-style entry, and a measured one when the brief has measured qualities. The works in the cluster are its evidence.
- **Set aside noise** with a specific reason, such as a brand's catalogue label or a work outside what the audience shares.
- **Required anchors.** Each one sits in a cluster or is set aside. At most two are set aside, and those count as rejected in the DNA.
- **Surprises.** When the brief has them, at least one cluster gathers one.
- **Layers.** Together the clusters carry palette, typography and voice. The layers are palette, typography, layout, imagery, voice, structure, interaction and motion.
- **Naming.** Cite entries by the names the brief lists, such as "Perfect Days", "Atmospheric" or "Quiet". A "(new)" mark may stay. If two entries share a name, Moûsa lists their refs; give the one you mean.

## 2. Write the Design DNA

The DNA is the binding specification: 5-10 named, concrete **devices**, each with literal tokens the check can find in the files. The full schema, an example per layer and the common refusals are in [references/dna.md](references/dna.md).

```
{ schemaVersion: '1.0', thesis: 'One sentence.',
  devices: [ { id: 'dna1', layer: 'palette', device: 'A named, concrete move', anchors: ['1-3 clustered entries'],
               qualities: ['tags of its measured anchors it translates'], translation: 'How, in your words.',
               tokens: { colors: ['#rrggbb'] } } ],
  rejected: [ { ref: 'a required anchor you do not use', reason: 'why, specifically' } ] }
```

The rules Moûsa checks:
- **Layers.** At least four, with palette and typography among them, plus one of layout, structure, interaction or imagery.
- **Anchors.** Each device anchors at least one entry your reading clustered, and never one it set aside.
- **qualities** names tags of the device's measured anchors, exactly as the brief lists them: a quality's or tag's own name, or a work's listed tags. It is required when an anchor is a surprise that has tags.
- **Qualities first.** The palette device and the typography device each anchor to a quality, never to one work's own colours.
- **Motion** anchors to a pacing tag, or to a mood quality when no pacing tags came back, and declares keyframes or an animation or transition value.
- **Illustration** anchors to a surface tag, or to a look quality when none came back. On the web it draws an inline SVG of at least eight shapes, listed in `tokens.svg`.
- **Voice** anchors to a measured entry and declares at least two lines you wrote, in `tokens.copy`.
- **When the brief has surprises**, devices anchored to them move the design away from your frozen sketch:
  - a palette device with two colours at least ΔE 20 from every sketch colour;
  - a typography device with only families outside the sketch's;
  - a layout, structure, interaction or imagery device with a new element id, one that is not a sketch section and not an id already in the project.
- **Required anchors.** Each one anchors a device or is rejected with a reason, at most two.
- **Fonts** come only from the Moûsa library (`materials({ action: 'find', words })`). **Pictures** are only ones made with the `image` tool, named `generated/<device id>-<n>.png`.

A refusal names the field and the fix, so repair it and save again. The result lists the methods this session offers for each layer, how many pictures it can make, and whether captures work.

## 3. Plan the production

```
{ schemaVersion: '1.0',
  steps: [ { device: 'dna1', method: 'css-palette', cluster: 'c1', why: 'Why this method suits this device.' } ],
  review: [ { id: 'r1', device: 'dna5', look: 'What a viewer should see in a capture.', view: 'mobile' } ] }
```

- **One step per device.** Its method comes from the DNA result's list for the device's layer, and the device must declare that method's tokens.
- **Its cluster** is one whose entries the device anchors, and every cluster is realized by at least one step.
- **A `generated-image` step** also states `count`, within the session's picture limit, and a `fallback` method that needs no generator and that the device's tokens already support, such as `inline-svg`. Choose it only when this session can really make pictures (see [references/images.md](references/images.md)).
- **Review criteria.** When captures work, list 2-6. Each names one device and one view, concrete enough to judge met or missed: "the headline reads as one condensed line at 390 pixels wide".

The methods of each medium and the review rules are in [references/production.md](references/production.md).

## 4. Gather only what the plan needs

- **Fonts:** `materials({ action: 'fetch', fonts: ['planned families'] })` copies them into `fonts/` with their licences and returns the `@font-face` rules to paste.
- **Pictures:** for each planned picture, `image({ action: 'prompt', device, subject, aspect })` returns Moûsa's brief and the file to save. Make the picture with your own image tool, save it there, then call `image({ action: 'register', device, path })`. [references/images.md](references/images.md) covers each host and the fallbacks.

## 5. Build to the DNA

- **Every device, with its exact tokens.** Make each one by the method its step names, and do not fall back to a default look where a device says otherwise.
- **In the project's own design system.** On a site with CSS custom properties, each palette colour and font lives in a custom property that the styles use through `var()`. See [references/design-systems.md](references/design-systems.md).
- **Keep the product.** Keep its facts, its protected files and its accessibility. Visitor-facing text never mentions Qloo, agents or APIs, and nothing copies a work's logo, artwork, lyrics, characters or trade dress.

## 6. Check

`design_check({})` reads the project's pages, styles and scripts. It reports each device as present, partial or missing, says which token is missing and why, and on the web adds the motion checks and the custom property behind each value. Repair what is missing and check again before you capture. The check shows presence, not quality.

## 7. Capture, and look at what you made

`design_capture({})` renders the entry page at the medium's views (desktop and mobile for a site, phone and board for an app) and returns the pictures in the result itself. Options:
- `views: ['mobile']` limits the views.
- `target: 'element-id'` scrolls to an element.
- `full: true` takes the whole height.
- `entry: 'about.html'` captures another page.
- `specimen: true` captures the **specimen board**: the DNA drawn on one page with its palette, type, motion, drawings, pictures and lines. It serves a design a browser cannot open, and judging the system itself.

A round holds six captures, and a session has two rounds.

## 8. Review against your plan

```
{ schemaVersion: '1.0', round: 1,
  criteria: [ { id: 'r1', capture: 'r1-mobile', verdict: 'met' | 'partly' | 'missed', observed: 'What the capture shows.', repair: 'For partly or missed: the repair it needs.' } ],
  summary: 'Two or three sentences.' }
```

- Judge every criterion once, on a capture of this round, by what the picture shows rather than what you meant to build.
- Then make the repairs, check again, and capture round 2 with `design_capture({ round: 2 })`.
- The DNA and the plan stay frozen. Repairs change the build, not the specification.

## Changing course

- **Change a saved stage:** pass `revise: true` with the reading, DNA or plan. The stages after it move to `.mousa/history/`.
- **A new design for another audience or brief:** save a new prediction with `restart: true` (see the `taste-brief` skill).
- **A small taste decision mid-build:** `taste_ask`. The DNA does not change for it.

## Workspaces

A `workspace` is a folder inside the project that holds one design and its own `.mousa/` records, such as `compare/with-qloo` or `apps/shop`. Pass the same `workspace` to every Moûsa call of that design, and build its files inside that folder.

## Honesty

- The check shows that the declared tokens are in the files. The review is your own judgment of the captures against your plan. Neither shows that the design is good or that people prefer it.
- Cite only captures of this round, and describe what they show.
- Every design choice is your interpretation of Qloo's entities and tags. Say so when you explain the design.

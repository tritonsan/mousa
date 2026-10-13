# Production: the plan, the materials and the review

The production plan says how each DNA device gets made with what this session offers. It also lists what a viewer should see in the captures, so that the review judges the result against your own intent.

## Methods per medium

The DNA result lists the methods available in this session for each layer. A method marked unavailable says why, such as no image generator on a hosted server. A method that needs tokens can only be chosen for a device that declares them.

### `web`

| Method | Makes | Needs in the device |
| --- | --- | --- |
| `css-palette` | palette | its colours in `tokens.colors` |
| `library-font` | typography | the family it loads in `tokens.fonts` |
| `css-type` | typography | none |
| `css-layout` | layout, structure, interaction | none |
| `interaction-script` | interaction, structure | none |
| `library-photo` | imagery, layout, structure | photos from a photo library. This surface has none, so it is unavailable |
| `generated-image` | imagery | a count and a fallback in the step |
| `inline-svg` | imagery, layout, structure, interaction | the id of each `<svg>` in `tokens.svg` |
| `css-art` | imagery, layout, structure | none |
| `css-motion` | motion, interaction | keyframes in `tokens.keyframes`, or an animation or transition value in `tokens.css` |
| `copy` | voice | lines you wrote in `tokens.copy` |

### `app-ui`

| Method | Makes | Needs in the device |
| --- | --- | --- |
| `design-tokens` | palette, typography, layout | the colours, fonts or CSS values it defines |
| `library-font` | typography | the family in `tokens.fonts` |
| `screen-layout` | layout, structure, interaction | none |
| `inline-svg` | imagery, layout, structure | the id of each `<svg>` in `tokens.svg` |
| `css-art` | imagery, layout | none |
| `generated-image` | imagery | a count and a fallback |
| `css-motion` | motion, interaction | keyframes, or an animation or transition value |
| `copy` | voice | lines in `tokens.copy` |

### `generic`

| Method | Makes | Needs in the device |
| --- | --- | --- |
| `source` | every layer | none; write the tokens literally in the project's own source, styles, assets or text |
| `library-font` | typography | the family in `tokens.fonts` |
| `inline-svg` | imagery, layout, structure | the id of each drawing in `tokens.svg` |
| `generated-image` | imagery | a count and a fallback |
| `copy` | voice | lines in `tokens.copy` |

## The plan's rules

- **One step per device,** and every device has one.
- **Its method** makes the device's layer, is available here, and the device declares what the method needs.
- **Its cluster** is a reading cluster whose entries the device anchors. Every cluster is realized by at least one step.
- **Generated pictures.** A `generated-image` step states `count`, from one to the session's limit across all steps (4 by default). It also states a `fallback` without a generator that the device's tokens already support, such as `inline-svg` when the device declares an SVG id.
- **Review criteria.** With captures available, list 2-6, each `{ id, device, look, view }`:
  - `look` is concrete enough to judge met or missed. Good: "the hero drawing fills the right half of the first screen". Not good: "the page feels calm".
  - `view` is one of the medium's capture views:
    - `web`: `desktop` (1440×900) and `mobile` (390×844).
    - `app-ui`: `phone` (390×844) and `board` (1440×900).
    - `generic`: `desktop` (1280×800) and `mobile` (390×844).

  A criterion for the specimen board leaves out `view` and is judged on a `specimen: true` capture.

## Materials

- **Fonts.** `materials({ action: 'find', words: ['condensed', 'warm'] })` ranks the 33 open-licence families (SIL OFL 1.1) and the system fonts each stands in for. `materials({ action: 'fetch', fonts, stylesheet })` copies only the families the plan uses into `fonts/` (or `directory`), with their licence files, and returns the `@font-face` rules with URLs written from `stylesheet`. Paste them there as they are, and keep the licence files beside the fonts. A `directory` under `public/` or `static/` is served from the site root, so its rules load `/fonts/…`. The check follows each URL from the stylesheet that holds it and reports one that reaches no file.
- **Pictures.** Request them only for devices whose step chose `generated-image`, and no more than the step's count. See [images.md](images.md).

## What freezes when

| Stage | Frozen once | To change it |
| --- | --- | --- |
| Prediction | it is saved | a new session: `restart: true` |
| Reading | a DNA rests on it | `revise: true`; the DNA and the plan move to history |
| DNA | a plan rests on it | `revise: true`; the plan moves to history |
| Plan | a picture was made from it | `revise: true` |

During the review, the DNA and the plan stay as they are: repairs change the build.

## The review

- **Rounds.** Each holds six captures, and a session has two. `design_capture({})` takes round 1; after your repairs, `design_capture({ round: 2 })` starts the next.
- **Seen.** The pictures arrive in the capture's result, so Moûsa records them as seen. Cite only captures of the round you review.
- **The review.** `{ schemaVersion: '1.0', round, criteria: [{ id, capture, verdict, observed, repair? }], summary }`:
  - every criterion of the plan, once;
  - `verdict` is `met`, `partly` or `missed`;
  - `observed` describes what the capture shows;
  - `partly` and `missed` name the `repair`, which you then make in the files.
- **After a round.** The result says whether a round remains. When every criterion is met, finish.

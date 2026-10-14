# The Design DNA

The DNA is the design's binding specification. Each device is one named, concrete move. It says which measured entries it rests on and how it translates them, and it declares literal tokens that `design_check` looks for in the files.

## Schema

```json
{
  "schemaVersion": "1.0",
  "thesis": "One sentence: the design idea, 10-600 characters.",
  "devices": [
    {
      "id": "dna1",
      "layer": "palette | typography | layout | imagery | voice | structure | interaction | motion",
      "device": "A named, concrete move, 3-200 characters",
      "anchors": ["1-3 entries your reading clustered, named as the Taste Brief lists them"],
      "qualities": ["0-4 tags of the measured anchors that this device translates"],
      "translation": "How the qualities become this device; your interpretation, 10-900 characters",
      "tokens": { "colors": [], "fonts": [], "css": [], "keyframes": [], "svg": [], "ids": [], "copy": [], "images": [] }
    }
  ],
  "rejected": [{ "ref": "a required anchor no device uses", "reason": "why, specifically, 10-400 characters" }]
}
```

- **devices:** 5-10, with unique ids such as `dna1`.
- **rejected:** at most six entries, of which at most two may be required anchors. An entry is either anchored or rejected, never both. Required anchors that your reading set aside are added here for you.

## Tokens

Tokens are the literal values the check finds. Leave unused kinds out or empty, but every device declares at least one token.

| Token | Up to | What it is |
| --- | --- | --- |
| `colors` | 6 | `#rrggbb` or `#rgb` colours used in the styles. A palette device needs at least two |
| `fonts` | 4 | Library font families set in `font-family`. A typography device needs one named family |
| `css` | 6 | `{ property, value }` pairs. The value is one literal, without `;`, `{`, `}` or angle brackets: `{ property: 'aspect-ratio', value: '1 / 1' }` |
| `keyframes` | 4 | Names of `@keyframes` rules that the styles define and an animation uses |
| `svg` | 4 | Ids of inline `<svg>` drawings, each with at least eight shapes (path, circle, ellipse, line, polyline, polygon, rect, use) |
| `ids` | 6 | Element ids in the pages, such as the id of a new section |
| `copy` | 3 | Exact visible lines, 3-160 characters each |
| `images` | 4 | Pictures made with the `image` tool: `generated/<device id>-<n>.png`. Declare the planned names up front |
| `literals` | 6 | In the `generic` medium only: exact strings in the source, such as `spring(stiffness: 120)` or `TerraceDrawing.svg` |

## The rules

1. **Coverage.** The devices cover at least four layers. Palette and typography are among them, plus at least one of layout, structure, interaction or imagery. In the `game` medium typography is optional: a game's type belongs to its interface. A typography device you do include follows every rule below.
2. **Reading first.** Each device anchors at least one entry a reading cluster gathers, and never one the reading set aside.
3. **Qualities of measured anchors.** When a device anchors measured entries, each of its `qualities` is one of their tags, exactly as the brief lists them:
   - a quality's or tag's own name, such as `Atmospheric` for the quality Atmospheric;
   - or one of a work's listed tags, such as `Reflective` for Perfect Days.

   A device anchored to a surprise that has tags must name at least one. For your own predicted entries, `qualities` is your assumption.
4. **Qualities first.** When the brief has qualities, the palette device and the typography device each anchor to a quality entry. Pacing, surface and tone tags count too, and so do the qualities. A work may stand beside the quality as evidence, but its own brand or team colours, logo, packaging and trade dress are never the source.
5. **Motion.** When the brief has pacing tags, a motion device anchors to one and declares `keyframes` or an `animation` or `transition` value in `css`. When no pacing tags came back, it anchors to a mood quality instead.
6. **Illustration.** When the brief has surface tags, a device anchored to one draws an original illustration and lists its drawing in `svg`. When no surface tags came back, it anchors to a look quality instead. In the generic and game media the drawing may instead be a picture in `images` or an asset named in `literals`.
7. **Voice.** A voice device anchored to a measured entry declares at least two lines you wrote in its register in `copy`, such as the headline. The voice changes how the facts are said, never which facts there are.
8. **Departure.** When the brief has surprises, devices anchored to surprises move the design away from your frozen sketch:
   - a palette device with at least two colours at CIE76 ΔE 20 or more from every sketch colour;
   - a typography device whose named families are all outside the sketch's fonts, used for headings or body text;
   - a layout, structure, interaction or imagery device with at least one element id that is neither a sketch section nor an id already in the project's pages.

   Devices anchored to your own confirmed predictions may follow the sketch.
9. **Required anchors.** Every one anchors a device or is rejected with a reason, and at most two are rejected.
10. **Materials.** Fonts come from the Moûsa library. This surface has no photo library: pictures come from the `image` tool, or the imagery is drawn in SVG or CSS.

## One device per layer, as examples

```json
{ "id": "dna1", "layer": "palette", "device": "Mist and sea-glass ground",
  "anchors": ["Atmospheric", "Perfect Days"], "qualities": ["Atmospheric"],
  "translation": "An atmospheric look becomes hazy, cool mid-tones with low contrast; the film is evidence of which atmosphere.",
  "tokens": { "colors": ["#3e5c6b", "#8fb0a9", "#dfe6e1"] } }

{ "id": "dna2", "layer": "typography", "device": "Calm geometric sans with wide tracking",
  "anchors": ["Reflective (new)"], "qualities": ["Reflective"],
  "translation": "A reflective mood becomes an even, open sans set light, with generous letter-spacing.",
  "tokens": { "fonts": ["Jost"], "css": [{ "property": "letter-spacing", "value": ".04em" }] } }

{ "id": "dna3", "layer": "motion", "device": "Forty-second mist drift",
  "anchors": ["Pensive"], "qualities": ["Pensive"],
  "translation": "Pensive pacing becomes one slow drift with no overshoot, paused on request.",
  "tokens": { "keyframes": ["mist-drift"], "css": [{ "property": "animation", "value": "mist-drift 40s ease-in-out infinite" }] } }

{ "id": "dna4", "layer": "imagery", "device": "Stepped terrace line drawing",
  "anchors": ["Sculptural"], "qualities": ["Sculptural"],
  "translation": "Sculptural form becomes stepped volumes drawn in single-weight lines.",
  "tokens": { "svg": ["terrace"], "ids": ["terrace-figure"], "images": ["generated/dna4-1.png"] } }

{ "id": "dna5", "layer": "voice", "device": "Short lines with room between them",
  "anchors": ["Thoughtful (new)", "Hiroshi Yoshimura"], "qualities": ["Thoughtful"],
  "translation": "A thoughtful tone becomes short declarative sentences and a pause before each call to action.",
  "tokens": { "copy": ["The street turns blue at six.", "Take your time with the shelf."] } }

{ "id": "dna6", "layer": "structure", "device": "A week of small things",
  "anchors": ["Routine", "Midnight Diner"], "qualities": ["Routine"],
  "translation": "Routine becomes the page's spine: a strip of seven days, each with one item.",
  "tokens": { "ids": ["week-strip"] } }
```

- **layout:** proportions, grids, order or density. For example square 1:1 frames that widen on selection, `{ property: 'aspect-ratio', value: '1 / 1' }` with the grid's id.
- **interaction:** one behaviour that carries a quality, such as a slow reveal or a remix control. Declare its element id and its transition.

## Common refusals and their fix

| The message says | Fix |
| --- | --- |
| `... is not a name in this session's taste input` | Use a name exactly as the brief lists it, or call `taste_ask({ question: 'world' })` to see the works again |
| `... names 2 entries of the taste input: <ref> (<domain>), ...` | Give the ref of the one you mean |
| `Use a tag returned for this device's measured anchors, exactly as listed: ...` | Pick `qualities` from the listed tags |
| `Qualities first: anchor a palette device to at least one measured quality ref ...` | Add a quality from the brief's look qualities to the palette device's anchors |
| `Measured surprises must move the palette away from your frozen sketch ... Too close now: ...` | Replace the listed colours with ones far from the sketch's, on a device anchored to a surprise |
| `... must move the type system away ...` | Use library families the sketch did not name, on a typography device anchored to a surprise |
| `... must change the page structure ...` | Add a new section or component with a new id, on a structural device anchored to a surprise |
| `Every required anchor needs a device or a reasoned rejection. Missing: ...` | Anchor each listed entry, or reject it with a specific reason |
| `Your taste reading set ... aside` | Anchor to a clustered entry instead, or revise the reading |
| `... is not in the Moûsa font library` | Choose a family from `materials({ action: 'find', words })`; the message names the one that stands in for a system font |

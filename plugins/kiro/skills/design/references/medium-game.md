# Medium: game

A game, a character or game art. Its look, its motion and its voice live in the game's own data and code, such as a character file, a level file or a scene script. Plan the taste with the `game` recipe, and the design follows in this medium, even when the game is played in a web page.

Taste changes how the character or world looks, moves and speaks. It never changes the lore, the rules, the fixed facts of the character or the scene's story beats. Read the project's own format guide first; it says which file is yours and what the game checks.

## What the check looks for

`design_check` finds each token in the project's files exactly as written:
- **colors**: `#rrggbb`, `#rgb`, `0xRRGGBB` or `0xAARRGGBB` anywhere in the files, such as a character file's palette.
- **ids**: a part, a prop or a scene element, as a whole word, such as `"id": "lantern-hood"`.
- **copy**: a line in the files, as written. Keep double quotes out of a line that a JSON file holds, since JSON escapes them.
- **literals**: up to six exact strings, 2-120 characters each, written exactly as the file writes them, the space after a colon included: `"cadence": 0.9`, `"preset": "watercolor"`, `"kind": "embers"`.
- **keyframes**, **fonts**, **css**, **svg** and **images** as in the generic medium.

## The layers in a game

| Layer | What it becomes |
| --- | --- |
| palette | the character's and the scene's colours, as hex in the data file |
| structure or layout | silhouette, proportions, garments, props and features as named parts, listed by their ids |
| motion | gait and timing: cadence, bounce, lean, arm swing, how it turns and the timing of its signature move, as `literals` |
| imagery | the art style the frame is drawn in, such as a render preset. The brief's `art_style` entries, such as Pixel Art or Hand-Drawn, name it; anchor the device to one |
| voice | the character's lines in the device's register, never quoting a work |
| typography | optional: only when the design itself sets type, such as a game's title or its own dialogue font |

Palette, motion and voice are required. The sketch you freeze before the measurement may name no font, and a structural device departs from it with a part id it did not name. Never copy a character, costume, logo or trade dress of an anchor work.

**Pictures.** A game's own picture slot, such as a portrait on its title card, can show a picture from the `image` tool. Plan a `generated-image` step for an imagery device, and list its `generated/<device>-<n>.png` in the device's `images`. Name the file in the slot as the game's format asks. The picture shows the same character as the drawing: its palette, its silhouette and its light.

## Review

A game draws its views itself. When the project has a review page, capture it by its views: the page reads the view from the URL fragment, and `target` sets it.

```
design_capture({ entry: 'capture.html', target: 'pose' })
design_capture({ entry: 'capture.html', target: 'walk' })
```

- **When it is captured.** A page that draws after it loads sets `window.captureReady`, and the capture waits for it.
- **An invalid file.** The game's validator stops the page, and the capture fails with its message, which names the field to fix. Fix it, save and capture again.
- **Limits.** A round holds six captures, so choose the views your criteria judge, such as the figure at rest, a walk cycle and the moment in its scene.
- **In the plan.** A review criterion's `view` is the medium's capture view, `frame`. Name the page's own view, such as the walk, in its `look`.
- **Without a page.** A game a browser cannot open is reviewed on the specimen board, `design_capture({ specimen: true })`.

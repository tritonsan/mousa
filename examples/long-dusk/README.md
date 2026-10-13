# The Long Dusk: a game character for the Moûsa plugin

The Long Dusk is a browser-playable moment of a side-view RPG. Generations ago the sun stopped on the horizon, and lamplighters walk the old roads to wake the beacons. On the Vesper Cliffs, Ilo the lamplighter walks the basalt road above a sea of cloud, answers Maren, the keeper, and wakes the cold beacon.

It is the proof project for designing a game character with the plugin. The engine draws Ilo from one data file, and the design lives entirely in that file: the drawing on a fixed rig, the palette, the cloth, the carried light, how Ilo walks, idles and turns, the signature move, four lines, and the moment's scene and render style. Ilo starts as the game's plain grey mannequin.

| File | What it holds | |
| --- | --- | --- |
| `characters/ilo.json` | Ilo: the one file the design changes | yours |
| `FORMAT.md` | The character format: every field, range and rule the game checks | read it first |
| `world/canon.json` | The world, its premise, the scene and Ilo's fixed facts: Ilo carries a light that can be seen in the dusk, and walks the road | fixed |
| `characters/maren.json` | Maren, the keeper | fixed |
| `src/` | The engine: rig, motion, cloth, light, scene, render styles and the story's beats | fixed |
| `index.html`, `styles.css` | The play page and its interface, with its own typefaces in `fonts/` | fixed |
| `capture.html` | The review page: the game draws one view of Ilo for the designer | fixed |
| `serve.mjs` | A loopback server for playing it in a browser | fixed |

The lore, the layout of the road, the keeper and the story's beats stay as they are. The type of the interface belongs to the game, not to the character.

## Play it

The pages load their data, so open them through the server:

```bash
node serve.mjs
```

Then open `http://127.0.0.1:8795/index.html`, press Begin, walk with A and D or the arrow keys, and interact with E.

## Review views

`capture.html` draws one view of Ilo, named in the URL fragment:

| View | What it shows |
| --- | --- |
| `capture.html#pose` | Ilo at rest, large, beside a 60-pixel silhouette in one dark tone and the same figure at 60 pixels in colour |
| `capture.html#walk` | six evenly spaced frames of one walk cycle on one ground line |
| `capture.html#scene` | the moment as a player sees it: Ilo on the cliff road near the keeper and the beacon, under the scene's sky and weather, in its render style |
| `capture.html#kindle` | the signature move as the beacon catches |

The page sets `window.captureReady` once it has drawn. If `characters/ilo.json` is not valid, the page shows the game's message, which names the first field to fix.

With the Moûsa plugin, plan the taste with the `game` medium and capture a view with `design_capture({ entry: 'capture.html', target: 'walk' })`.

## Credits

The typefaces in `fonts/` are EB Garamond and Alegreya Sans, under the SIL Open Font License 1.1; their licences are beside them.

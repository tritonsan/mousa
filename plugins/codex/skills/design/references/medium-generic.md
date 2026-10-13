# Medium: generic

Any text project that is not a plain website, such as a game, a native app, a document, a slide deck or a piece of writing. `design_check` finds each token in the project's files exactly as written, so a device declares its tokens the way the source writes them.

## What the check looks for

- **colors**: `#rrggbb`, `#rgb`, `0xRRGGBB` or `0xAARRGGBB` anywhere in the files. Swift, Kotlin, Dart and Unity colour literals in hex count.
- **fonts**: the family name in the files.
- **css**: the property and the value, as written.
- **keyframes** and **ids**: the name or id as a whole word.
- **svg**: an inline `<svg id="...">` with that id, or a file named `<id>.svg`, drawing at least eight shapes.
- **copy**: the line in the files.
- **images**: the picture's path in the files.
- **literals**: up to six exact strings in the source, 2-120 characters each. They declare motion or drawing in code, such as `withSpring(1.2)`, `duration: 1800` or `TerraceDrawing.svg`.

In this medium, motion may be declared by its code in `literals` as well as by keyframes or CSS. Illustration may be a drawing in `svg`, a picture in `images` or an asset named in `literals`.

## Methods

- **`source`** makes any layer directly in the project's own source, styles, assets or text.
- **`library-font`**, **`inline-svg`**, **`generated-image`** and **`copy`** work as on the web.

## By kind of project

### A game, a character or game art

Taste changes how the character or world looks, moves and speaks. It never changes the lore, the rules, the fixed facts of the character or the scene's story beats.

| Layer | What it becomes in a game |
| --- | --- |
| palette | the character's and the scene's colours, as hex constants in the character or scene file |
| silhouette, costume and form | proportions, garments, props and features as named parts. Use layout or structure devices with the part ids as `ids` |
| motion | gait and timing: cadence, bounce, lean, arm swing, how it turns, the timing of its signature move. Declare the values as `literals` exactly as the code writes them |
| imagery and render | the art style the frame is drawn in. The game's `art_style` entries, such as Pixel Art or Hand-Drawn, name it; anchor the render device to one |
| voice | the character's lines in the voice device's register, never quoting a work |

Never copy a character, costume, logo or trade dress of an anchor work.

### A native app

Put the DNA's values in the app's theme: colour constants, the font family names, and animation durations or springs. Declare them as the source writes them, such as `0xFF3E5C6B` or `Color(hex: "#3e5c6b")`. Keep the app's screens and behaviour.

### A document or slide deck

Put the palette and fonts in the theme or styles part and the structure in the headings. Write the voice in the text itself. Declare the theme values as they appear in the source files.

### Writing, naming and narrative

Voice and structure carry most of the DNA. A palette and a type device still apply to how the text is presented. `copy` holds lines you wrote, and `ids` the section or chapter anchors.

## Review

A project a browser cannot open is reviewed on the **specimen board**: `design_capture({ specimen: true })` draws the DNA on one page and returns it. That page holds the palette, the type in its fonts, the motion, the drawings, the pictures and the lines. Write the plan's review criteria for that board, and leave out `view`. When the project has an HTML page, such as a web build of the game, capture that too.

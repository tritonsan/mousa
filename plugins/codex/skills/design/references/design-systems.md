# Building in the project's design system

The DNA is neutral: it names colours, families and values. The project decides where those values live. Moûsa reads the project when you call `mousa_status` or `design_check` and reports the system it found:

| `designSystem.system` | When | What the check does |
| --- | --- | --- |
| `css-vars` | three or more CSS custom properties are declared | It checks the tokens and, for palette and typography, that each value is held by a custom property the styles use |
| `text` | anything else | It finds each token as written |

`designSystem.medium` is `web` for pages, `app-ui` when a `tokens.json` exists, and `generic` for other sources. Notes name what it saw but does not check structurally, such as a Tailwind configuration or component sources.

## CSS custom properties

When the project uses custom properties, every palette colour and every font family of the DNA lives in one, and the styles use it:

```css
:root {
  --mist: #3e5c6b;
  --glass: #8fb0a9;
  --accent: var(--mist);              /* a chain: --accent holds #3e5c6b */
  --text-font: 'Jost', sans-serif;
}
body { color: var(--accent); background: var(--glass); font-family: var(--text-font); }
```

- **Value forms.** `#abc` and `#aabbcc` are the same colour, and a `var()` chain is followed to its value.
- **Bindings.** The check names the custom property that holds each value, in `bindings`.
- **Declared but unused.** A value held only by a property no style uses is reported as missing, with the property's name.
- **Where to declare.** Use `:root` or a theme selector. A theme override such as `[data-theme="dark"] { --mist: #0e1a20 }` is a value of its own: a DNA colour must still be held by a property the styles use.
- **Names.** Semantic names (`--surface`, `--ink`, `--accent`) suit a theme. Keep the DNA's colours as their values.

A project with only a few custom properties is checked as text. Add the DNA's palette as custom properties when you restyle it, so the next change stays inside the system.

## Other systems

The check does not parse these, so declare the tokens the way the source writes them, and the literal check finds them:

| System | Where the DNA's values go |
| --- | --- |
| Tailwind | `theme.extend.colors` and `fontFamily` in the Tailwind configuration, written as hex and family names, and used through the classes |
| A component library with a theme object | the theme object's colour and font fields |
| CSS-in-JS | the theme or the style objects, as literal hex values |
| Native themes (Swift, Kotlin, Flutter, Unity) | the colour and font constants of the app's theme, such as `0xFF3E5C6B` |
| Design token files outside `tokens.json` | the token values themselves, and their CSS output when the build makes one |

Keep the project's own structure. A restyle changes values and adds devices; it does not move the project to another system.

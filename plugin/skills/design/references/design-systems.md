# Building in the project's design system

The DNA is neutral: it names colours, families and values. The project decides where those values live. Moûsa reads the project when you call `mousa_status` or `design_check` and reports the system it found:

| `designSystem.system` | When | What the check adds to the token check |
| --- | --- | --- |
| `tailwind` | a `tailwind.config.*`, or a stylesheet with `@import "tailwindcss"`, `@tailwind` or `@theme` | each palette colour and family is held by a theme entry that a class names |
| `css-vars` | three or more CSS custom properties, without Tailwind | each palette colour and family is held by a custom property the styles use through `var()` |
| `text` | anything else | nothing more: each token is found as written |

`designSystem.medium` decides the base check:
- `web` for pages;
- `app-ui` for pages with a design token file (`tokens.json`, a `*.tokens.json`, or any JSON with W3C `$value` leaves);
- `generic` for component sources (JSX, Vue, Svelte, Astro) and anything else.

`tokensFile` names the token file it found.

## Colours in any notation

The DNA names colours in hex, and the project may write them in another notation:
- `#rgb` or `#rrggbb`;
- `rgb()` or `hsl()`;
- `oklch()` or `oklab()`, as Tailwind 4 and recent shadcn/ui write them;
- the bare HSL triplets shadcn/ui keeps in its variables (`--primary: 222.2 47.4% 11.2%`, used as `hsl(var(--primary))`).

The check converts each one back to hex and accepts a colour within ΔE 2.5, which no one can tell apart. So keep the project's notation: put the DNA's colour into the project in the form the project already uses.

## CSS custom properties

Every palette colour and family lives in a custom property, and the styles use it:

```css
:root {
  --mist: #3e5c6b;
  --glass: #8fb0a9;
  --accent: var(--mist);              /* a chain: --accent holds #3e5c6b */
  --text-font: 'Jost', sans-serif;
}
body { color: var(--accent); background: var(--glass); font-family: var(--text-font); }
```

- **Chains.** A `var()` chain is followed to its value.
- **Bindings.** The check names the property that holds each value in `bindings`. A value held only by a property no style uses is reported with that property's name.
- **Theme overrides.** An override such as `[data-theme="dark"] { --mist: #0e1a20 }` is a value of its own, and both values count.

## Tailwind

A theme value takes effect only where a class names it, so the check asks for both. The result's `bindings` give the theme name behind each value, or the names that hold it unused.

- **Tailwind 4** keeps the theme in CSS. Add or change entries in `@theme`, and use them through classes:

  ```css
  @import "tailwindcss";
  @theme {
    --color-mist: oklch(43.6% 0.043 230.6);
    --color-ink: #1d2a33;
    --font-display: "Jost", sans-serif;
  }
  ```

  ```html
  <h1 class="font-display text-ink md:hover:text-mist/80">…</h1>
  ```

- **Tailwind 3** keeps it in `tailwind.config.*`. The check reads string values of `theme.colors`, `theme.extend.colors` and `fontFamily`, nested (`mist: { DEFAULT, 500 }` gives `mist` and `mist-500`), through `hsl(var(--x))` to the variable's value. Values written as code, such as `require(...)`, are not read.
- **Classes** count wherever they appear: in pages, JSX `className`, Vue or Svelte markup, scripts, and `@apply` in stylesheets, with variants such as `hover:` and `md:` and opacity such as `/80`.
- **shadcn/ui** keeps its colours as variables, which the theme or the config names (`primary: 'hsl(var(--primary))'`, or `--color-primary: var(--primary)` in `@theme inline`). Change the variables' values to the DNA's colours, keep their names, and the components follow.

## Restyling an existing project

- **Work in the system it has.** Change the values of the existing tokens, variables or theme entries, and keep their names. Add new entries only for values the project did not have, and do not add a parallel stylesheet that overrides it.
- **Keep what it does.** Its content and data, its routes and its scripts' hooks stay: the ids and classes that scripts or tests select.
- **Ids.** Existing element ids are known ids. A structural device must add a new id for the sketch departure.
- **The build.** If the project builds, as a Tailwind or Vite project does, run its own build and capture the output with `design_capture({ root: 'dist' })`, or whatever its output folder is. If it cannot be built here, review on the specimen board.

## Other systems

The check does not parse these, so declare the tokens the way the source writes them, and the literal check finds them:

| System | Where the DNA's values go |
| --- | --- |
| A component library with a theme object | the theme object's colour and font fields |
| CSS-in-JS | the theme or the style objects |
| Native themes (Swift, Kotlin, Flutter, Unity) | the colour and font constants of the app's theme, such as `0xFF3E5C6B` |
| Design token files | the token values themselves, and their CSS output when the build makes one |

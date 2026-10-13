# Lanterna: a Tailwind CSS 4 site for the Moûsa plugin

Lanterna is the website of a fictional 60-seat independent cinema in Lisbon. It is built with Vite and Tailwind CSS 4 and has the look of a common starter template: an indigo brand colour, slate text and the system sans-serif. It is the proof project for restyling an existing Tailwind project with the plugin. Its theme lives in the `@theme` block of `src/style.css`, the page and the script use the theme through utility classes, and the build writes the site to `dist/`.

| File | What it holds |
| --- | --- |
| `index.html` | The page: the week's screenings, membership, the visit details and the footer |
| `src/style.css` | `@import "tailwindcss"` and the site's `@theme` entries (`--color-brand` is `bg-brand`, `--font-display` is `font-display`) |
| `src/main.js` | Renders the screenings and the day filter, and answers the membership form |
| `src/screenings.js` | The fixed facts: this week's films, their directors, years, days and times |
| `vite.config.js` | Vite with the Tailwind plugin |

## Build

```bash
npm ci
npm run build
```

`npm run dev` serves the site while you work, and `npm run preview` serves the build.

## Restyle it with the plugin

The restyle edits the files in place, so run it in a copy. `scripts/run-codex-live.mjs` copies this folder outside the repository, runs `npm ci` there before the session, because the Codex sandbox has no network, and then starts Codex with the packaged plugin:

```bash
node scripts/run-codex-live.mjs --from examples/tailwind-site --install --brief-file scripts/briefs/lanterna.md
```

The script only prints its plan; add `--run` to start the session. The plugin's check reads the theme and the classes from the sources. A palette colour or a family counts as bound when an `@theme` entry holds it and a class names that entry. The review captures the built site with `design_capture({ root: 'dist' })`.

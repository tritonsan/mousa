# Medium: app-ui

An app interface built as HTML and CSS screens whose values live in a **design token file**, such as `tokens/tokens.json`, consumed through CSS custom properties. Moûsa takes this medium when the project has a `tokens.json`.

## The token file

Tokens may be nested W3C-style leaves or a flat map. Both of these name the same token, `--color-ink`:

```json
{ "color": { "ink": { "$value": "#1d2a33" } } }
{ "--color-ink": "#1d2a33" }
```

- **Naming.** A token's custom property name is its path joined with hyphens.
- **Where the values live.** The token file is the source of every palette and typography value. In the CSS, declare each token as its custom property with the same value, usually in `:root` or a generated `tokens.css`, and use it through `var()`.

## What the check looks for

Everything the web check does (see [medium-web.md](medium-web.md)), and also, for each colour and font family of a palette or typography device:
1. a token in the token file has that value;
2. that token is declared as its custom property with the value in the CSS;
3. the styles use it through `var()`.

The result names the token behind each value, or says which part is missing.

## Methods

- **`design-tokens`** for palette, typography and layout values.
- **`screen-layout`** for screens and components: navigation, lists, cards, sheets and their states.
- **`inline-svg`** or **`css-art`** for imagery.
- **`css-motion`** for motion.
- **`copy`** for the interface voice.
- **`library-font`** loads a library family through the tokens.

## Build rules

- **Keep the app's screens, flows and data.** Taste changes their look, motion and voice, not what they do.
- **Write the interface copy in the voice device's register.** That means titles, onboarding, empty states, buttons and descriptions. Keep labels functional: a button still says what it does.
- **Follow the platform's touch conventions.** Hit targets of at least 44×44 px, visible focus, and reduced motion honoured.
- **Everything is local, as on the web.**

## Captures

- **Views.** `phone` (390×844) and `board` (1440×900), from the entry page.
- **Several screens.** A board page that lays out the screens side by side makes the system easy to judge in one capture.

# Medium: web

A static website in HTML, CSS and a little JavaScript. `design_check` reads every page, stylesheet and script of the project, or the files you name with `paths`, and finds each device's tokens in them.

## What the check looks for

- **colors**: in the styles, or held by a CSS custom property that the styles use through `var()` (see [design-systems.md](design-systems.md)).
- **fonts**: in a `font-family`. A library family must also be loaded with an `@font-face` rule that points at its fetched file.
- **css**: the declared property with its value, as written.
- **keyframes**: an `@keyframes` rule that the styles define and an `animation` uses. With animation, it also checks:
  - an `@media (prefers-reduced-motion: reduce)` rule that stops or simplifies it;
  - for an endless loop, a pause control: a button with `data-motion-toggle`.
- **svg**: an inline `<svg id="...">` with at least eight drawn shapes.
- **ids**: an element with that id.
- **copy**: the line in the visible text, or in a JSON data island that the page's script renders.
- **images**: the picture's path, in an `img src`, a CSS `url()` or a script.

## Build rules

- **A complete, responsive site** that opens from its files. Keep the product's purpose, every fact and item, and the working interactions. When a script renders content from a data island, keep its fields and order.
- **Everything is local.**
  - No CDNs, external scripts, remote fonts, trackers, network requests, package installs or external images.
  - Fonts come from `materials` fetch and pictures from `image`.
- **Ids.** Give major sections stable, unique ids, and build the structural devices' new sections as `section` elements with their ids.
- **Accessibility.**
  - Keyboard navigation and readable contrast.
  - Honest `alt` text for every picture, adapted from what it shows.
  - `loading="lazy"` below the first screen.
- **Motion as a small system:**
  - **Entrance.** Sections or cards enter with a staggered entrance. A small script adds a class through `IntersectionObserver`, and the content stays visible without JavaScript.
  - **A signature moment.** At least one animated moment on a drawing or picture, such as a line drawn with `stroke-dashoffset`, a slow drift, a turning element or a parallax layer.
  - **States.** Consistent hover, focus and press transitions.
  - **What moves.** Animate `transform`, `opacity` and SVG properties, not layout.
  - **Reduced motion.** Inside `@media (prefers-reduced-motion: reduce)`, stop or simplify every animation, transition and smooth scroll.
  - **Pausing.** A loop longer than five seconds needs a visible pause control. One way: a button with `data-motion-toggle` and `aria-pressed` that sets `data-motion="paused"` on the html element, and a CSS rule `[data-motion="paused"] * { animation-play-state: paused }`.
- **Voice.** Write the narrative in the voice device's register around the fixed facts: the headline and introduction, section headings and intros, calls to action, list and form titles, and item descriptions.
  - A description keeps what the item is and does, and adds no feature, award, review, quote or claim.
  - Keep a starter line only where it already fits the voice.
- **Code budget.** Spend it on the design, such as drawings and motion, rather than on repetition.
- **Visitor pages** never mention Qloo, agents or APIs, and never name the anchor works unless the brief asks.

## Captures

- **Views.** `desktop` (1440×900) and `mobile` (390×844), from the entry page (`index.html` by default).
- **Options.**
  - `target: 'section-id'` scrolls the views to a section.
  - `full: true` takes the whole page.
  - `entry` names another page.
- **Reach.** The browser reaches only the project's own files, so a page that depends on the network renders without it.

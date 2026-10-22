# Moûsa Studio design QA

Result: passed

## Target and scope

The supplied logo is the brand reference, not a full-screen UI mockup. The implementation carries its navy, violet and warm gradient accents into the existing Studio layout. Source: the supplied brand logo (1254 × 1254), served as `web/assets/mousa-logo.png`.

The served logo is an exact copy with matching SHA-256 `961e1efe0f27018a19e1b1ed260f2d222e157d173c6a1855bbec2da6250477bd`. CSS hides the surrounding white canvas without modifying the image or distorting its proportions. No new model or Qloo calls were needed for this change.

## Visual comparison

The source logo, final desktop screenshot and mobile screenshot were inspected together in one comparison input. Checks passed for these five surfaces:

- **Typography:** the original image wordmark is preserved; Studio titles use a modern sans family, navy text and violet emphasis. Serif headings were removed from the Studio.
- **Spacing:** header, workspace controls and preview cards retain clear alignment; the logo has comfortable padding and no clipping.
- **Colors:** navy `#202139`, violet `#7855cf`, lavender surfaces, and coral/apricot accents follow the supplied brand. Muted text and violet text meet 4.5:1 contrast against lavender surfaces; successful connection states retain a distinct teal.
- **Image placement:** the supplied lockup displays at 190 px wide on desktop and 153 px on mobile. Its white canvas blends into the white header.
- **Copy:** platform title, home link, footer, package display metadata, README headings, contributor labels and downloaded file prefix use Moûsa. Studio copy remains English.

## Browser evidence

Preview: `http://127.0.0.1:8787/`. Tests used the existing Codex in-app browser. Captures preserve the browser's native JPEG output. The viewport override was reset after responsive checks.

| Capture | CSS viewport | Native image size | State |
| --- | --- | --- | --- |
| `output/mousa-brand/desktop.jpg` | 1176 × 884 | 1161 × 873 | Final homepage, ready connections, local food starter |
| `output/mousa-brand/wide.jpg` | 1440 × 1000 | 1425 × 990 | Final wide homepage |
| `output/mousa-brand/mobile.jpg` | 375 × 812 | 360 × 780 | Final mobile homepage |
| `output/mousa-brand/narrow.jpg` | 320 × 740 | 305 × 705 | Final narrow header |
| `output/mousa-brand/mobile-preparation.jpg` | 375 × 812 | 360 × 780 | Saved preparation and variant archive |
| `output/mousa-brand/evidence.jpg` | 1440 × 1000 | 1425 × 990 | Saved actual Qloo records |
| `output/mousa-brand/decisions.jpg` | 1440 × 1000 | 1425 × 990 | Saved creative interpretation cards |
| `output/mousa-brand/access.jpg` | 1176 × 884 | 1161 × 873 | Access dialog |

No document horizontal overflow remained at the checked desktop, wide, 375 px or 320 px widths. The inspection tab strip intentionally scrolls horizontally on mobile.

## Interactions and regressions

- The home logo, Access dialog open/close, template selection and generation mode selection work in the browser.
- Cultural brief expands and collapses. Saved preparation, variants, comparison previews, cultural evidence and design decisions restore successfully from job `60093fb9-1126-4a0c-bb73-6233436dd72e`.
- Starter and generated sites retain their own design; Moûsa styles apply to the Studio shell.
- All 120 HTML IDs remain unique; all 93 literal JavaScript ID lookups resolve.
- The brand stylesheet and logo return HTTP 200 with correct CSS/PNG MIME types. Unlisted asset and plugin paths return 404; the existing local-image CSP and preview isolation are preserved.
- Existing test suite: **110 passed, 0 failed**. Plugin package rebuilt at version **0.3.0**, with 18 verified archive entries and unchanged technical identities.
- Browser console: no warnings or errors in the final check (`output/mousa-brand/console.json`).

## Corrections during QA

Darkened muted text and violet emphasis for contrast. At 320 px, hid the auxiliary STUDIO badge to eliminate header overflow while preserving the complete Moûsa lockup. Added an explicit accessible name to the Access button, whose visible text is hidden on mobile. Final screenshots reflect these corrections.

# Third-party notices

Moûsa's own code is under the MIT licence (`LICENSE`). The repository also carries works by others, each under its own
licence, listed here with where its full terms and credits live.

| What | Where | Licence | Credits and terms |
| --- | --- | --- | --- |
| Fonts: Google Fonts families as Latin-subset WOFF2 files from Fontsource, with their licence files from google/fonts | `library/fonts/` (copied into each plugin package under `plugins/*/library/fonts/`), `examples/long-dusk/fonts/` | SIL Open Font License 1.1 | One `*.OFL.txt` beside each family, and each family's copyright line listed under Font families below; `library/fonts/fonts.json` names the source of every file |
| Photographs: public-domain product photographs found through the Openverse API, resized and re-encoded | `library/local-food/` | CC0 1.0 or Public Domain Mark 1.0, per image | `library/local-food/library.json` lists each image's licence and source |
| Music: 20 Jamendo tracks found through the Openverse API | `library/music/` | CC BY 3.0, each | `library/music/catalog.json` carries each track's licence, source URL and attribution sentence; the pages that play a track show its credit |
| Container seccomp profile, derived from Docker's default profile (moby/profiles) | `deploy/seccomp-chromium.json` | Apache License 2.0 | `deploy/seccomp-chromium.LICENSE` (the licence) and `deploy/seccomp-chromium.NOTICE` (the changes) |

The Docker image installs software that is not in this repository: Debian packages (Chromium among them), Node.js and
the Kiro CLI, each under its own terms. Qloo's data is read through its API under Qloo's terms and is not stored in the
repository; the public gallery publishes names, never Qloo's identifiers, scores or descriptions.

## Font families

The 55 families in `library/fonts/` are works of their own authors, each under the SIL Open Font License 1.1. The copyright line of each is the one in the family's licence file, which travels with its font files; `library/fonts/fonts.json` records it too.

| Family | Copyright | Licence | Licence file |
| --- | --- | --- | --- |
| Alegreya Sans | Copyright 2013 The Alegreya Sans Project Authors (https://github.com/huertatipografica/Alegreya-Sans) | SIL OFL 1.1 | `library/fonts/alegreya-sans.OFL.txt` |
| Anton | Copyright 2020 The Anton Project Authors (https://github.com/googlefonts/AntonFont.git) | SIL OFL 1.1 | `library/fonts/anton.OFL.txt` |
| Archivo Black | Copyright 2017 The Archivo Black Project Authors (https://github.com/Omnibus-Type/ArchivoBlack) | SIL OFL 1.1 | `library/fonts/archivo-black.OFL.txt` |
| Barlow Condensed | Copyright 2017 The Barlow Project Authors (https://github.com/jpt/barlow) | SIL OFL 1.1 | `library/fonts/barlow-condensed.OFL.txt` |
| Baskervville | Copyright 2018 The Baskervville Project Authors (https://github.com/anrt-type/ANRT-Baskervville) | SIL OFL 1.1 | `library/fonts/baskervville.OFL.txt` |
| Bebas Neue | Copyright © 2010 by Dharma Type. | SIL OFL 1.1 | `library/fonts/bebas-neue.OFL.txt` |
| Bevan | Copyright 2016 The Bevan Project Authors (https://github.com/googlefonts/BevanFont) | SIL OFL 1.1 | `library/fonts/bevan.OFL.txt` |
| Big Shoulders Display | Copyright 2019 The Big Shoulders Project Authors (https://github.com/xotypeco/big_shoulders) | SIL OFL 1.1 | `library/fonts/big-shoulders-display.OFL.txt` |
| Big Shoulders Stencil Display | Copyright 2019 The Big Shoulders Project Authors (https://github.com/xotypeco/big_shoulders) | SIL OFL 1.1 | `library/fonts/big-shoulders-stencil-display.OFL.txt` |
| Black Ops One | Copyright 2022 The Black-Ops Project Authors (https://github.com/googlefonts/googlefonts-project-template) | SIL OFL 1.1 | `library/fonts/black-ops-one.OFL.txt` |
| Bodoni Moda | Copyright 2020 The Bodoni Moda Project Authors (https://github.com/indestructible-type/Bodoni) | SIL OFL 1.1 | `library/fonts/bodoni-moda.OFL.txt` |
| Bricolage Grotesque | Copyright 2022 The Bricolage Grotesque Project Authors (https://github.com/ateliertriay/bricolage) | SIL OFL 1.1 | `library/fonts/bricolage-grotesque.OFL.txt` |
| Bungee | Copyright 2023 The Bungee Project Authors (https://github.com/djrrb/Bungee) | SIL OFL 1.1 | `library/fonts/bungee.OFL.txt` |
| Cabin | Copyright 2018 The Cabin Project Authors (https://github.com/impallari/Cabin.git) | SIL OFL 1.1 | `library/fonts/cabin.OFL.txt` |
| Caveat | Copyright 2014 The Caveat Project Authors (https://github.com/googlefonts/caveat) | SIL OFL 1.1 | `library/fonts/caveat.OFL.txt` |
| Chakra Petch | Copyright 2018 The Chakra Petch Project Authors (https://github.com/m4rc1e/Chakra-Petch.git) | SIL OFL 1.1 | `library/fonts/chakra-petch.OFL.txt` |
| Cormorant Garamond | Copyright 2015 the Cormorant Project Authors (github.com/CatharsisFonts/Cormorant) | SIL OFL 1.1 | `library/fonts/cormorant-garamond.OFL.txt` |
| Courier Prime | Copyright 2015 The Courier Prime Project Authors (https://github.com/quoteunquoteapps/CourierPrime). | SIL OFL 1.1 | `library/fonts/courier-prime.OFL.txt` |
| Cutive Mono | Copyright 2012 The Cutive Project Authors (https://github.com/googlefonts/cutivemono) | SIL OFL 1.1 | `library/fonts/cutive-mono.OFL.txt` |
| DM Mono | Copyright 2020 The DM Mono Project Authors (https://www.github.com/googlefonts/dm-mono) | SIL OFL 1.1 | `library/fonts/dm-mono.OFL.txt` |
| DM Serif Display | Copyright 2014-2018 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source'. All Rights Reserved. Source is a trademark of Adobe in the United States and/or other countries. Copyright 2019 Google LLC. | SIL OFL 1.1 | `library/fonts/dm-serif-display.OFL.txt` |
| EB Garamond | Copyright 2017 The EB Garamond Project Authors (https://github.com/octaviopardo/EBGaramond12) | SIL OFL 1.1 | `library/fonts/eb-garamond.OFL.txt` |
| Familjen Grotesk | Copyright 2021 The Familjen Grotesk Project Authors (https://github.com/Familjen-Sthlm/Familjen-Grotesk) | SIL OFL 1.1 | `library/fonts/familjen-grotesk.OFL.txt` |
| Fraunces | Copyright 2018 The Fraunces Project Authors (https://github.com/undercasetype/Fraunces) | SIL OFL 1.1 | `library/fonts/fraunces.OFL.txt` |
| Fredoka | Copyright 2016 The Fredoka Project Authors (https://github.com/hafontia/Fredoka-One) | SIL OFL 1.1 | `library/fonts/fredoka.OFL.txt` |
| Fruktur | Copyright 2022 The Fruktur Project Authors (https://github.com/SorkinType/Fruktur) | SIL OFL 1.1 | `library/fonts/fruktur.OFL.txt` |
| Gelasio | Copyright 2022 The Gelasio Project Authors (https://github.com/SorkinType/Gelasio) | SIL OFL 1.1 | `library/fonts/gelasio.OFL.txt` |
| Grenze Gotisch | Copyright 2020 The Grenze Gotisch Project Authors (https://github.com/Omnibus-Type/Grenze-Gotisch) | SIL OFL 1.1 | `library/fonts/grenze-gotisch.OFL.txt` |
| Holtwood One SC | Copyright 2011 The Holtwood Project Authors (https://github.com/googlefonts/HoltwoodFont) | SIL OFL 1.1 | `library/fonts/holtwood-one-sc.OFL.txt` |
| Instrument Serif | Copyright 2022 The Instrument Serif Project Authors (https://github.com/Instrument/instrument-serif) | SIL OFL 1.1 | `library/fonts/instrument-serif.OFL.txt` |
| Inter | Copyright 2020 The Inter Project Authors (https://github.com/rsms/inter) | SIL OFL 1.1 | `library/fonts/inter.OFL.txt` |
| JetBrains Mono | Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono) | SIL OFL 1.1 | `library/fonts/jetbrains-mono.OFL.txt` |
| Jost | Copyright 2020 The Jost Project Authors (https://github.com/indestructible-type) | SIL OFL 1.1 | `library/fonts/jost.OFL.txt` |
| League Spartan | Copyright 2020 The League Spartan Project Authors (https://github.com/theleagueof/league-spartan) | SIL OFL 1.1 | `library/fonts/league-spartan.OFL.txt` |
| Libre Franklin | Copyright 2020 The Libre Franklin Project Authors (https://github.com/googlefonts/Libre-Franklin) | SIL OFL 1.1 | `library/fonts/libre-franklin.OFL.txt` |
| Literata | Copyright 2017 The Literata Project Authors (https://github.com/googlefonts/literata) | SIL OFL 1.1 | `library/fonts/literata.OFL.txt` |
| Nunito | Copyright 2014 The Nunito Project Authors (https://github.com/googlefonts/nunito) | SIL OFL 1.1 | `library/fonts/nunito.OFL.txt` |
| Oswald | Copyright 2016 The Oswald Project Authors (https://github.com/googlefonts/OswaldFont) | SIL OFL 1.1 | `library/fonts/oswald.OFL.txt` |
| Oxanium | Copyright 2019 The Oxanium Project Authors (https://github.com/sevmeyer/oxanium) | SIL OFL 1.1 | `library/fonts/oxanium.OFL.txt` |
| Pinyon Script | Copyright 2024 The Pinyon Project Authors (https://github.com/SorkinType/Pinyon) | SIL OFL 1.1 | `library/fonts/pinyon-script.OFL.txt` |
| Pixelify Sans | Copyright 2021 The Pixelify Sans Project Authors (https://github.com/eifetx/Pixelify-Sans) | SIL OFL 1.1 | `library/fonts/pixelify-sans.OFL.txt` |
| Poiret One | Copyright 2011 The Poiret One Project Authors (https://github.com/alexeiva/poiretone) | SIL OFL 1.1 | `library/fonts/poiret-one.OFL.txt` |
| Prata | Copyright 2011 The Prata Project Authors (https://github.com/cyrealtype/Prata) | SIL OFL 1.1 | `library/fonts/prata.OFL.txt` |
| Rozha One | Copyright (c) 2014, Indian Type Foundry (info@indiantypefoundry.com). | SIL OFL 1.1 | `library/fonts/rozha-one.OFL.txt` |
| Sancreek | Copyright 2011 The Sancreek Project Authors (https://github.com/googlefonts/sancreek) | SIL OFL 1.1 | `library/fonts/sancreek.OFL.txt` |
| Sedgwick Ave Display | Copyright 2017 The Sedgwick Ave Project Authors (https://github.com/googlefonts/sedgwickave) | SIL OFL 1.1 | `library/fonts/sedgwick-ave-display.OFL.txt` |
| Shrikhand | Copyright (c) 2015 Jonny Pinhorn (jonpinhorn.typedesign@gmail.com) | SIL OFL 1.1 | `library/fonts/shrikhand.OFL.txt` |
| Silkscreen | Copyright 2001 The Silkscreen Project Authors (https://github.com/googlefonts/silkscreen) | SIL OFL 1.1 | `library/fonts/silkscreen.OFL.txt` |
| Space Grotesk | Copyright 2020 The Space Grotesk Project Authors (https://github.com/floriankarsten/space-grotesk) | SIL OFL 1.1 | `library/fonts/space-grotesk.OFL.txt` |
| Space Mono | Copyright 2016 The Space Mono Project Authors (https://github.com/googlefonts/spacemono) | SIL OFL 1.1 | `library/fonts/space-mono.OFL.txt` |
| Syne | Copyright 2017 The Syne Project Authors (https://gitlab.com/bonjour-monde/fonderie/syne-typeface) | SIL OFL 1.1 | `library/fonts/syne.OFL.txt` |
| Unbounded | Copyright 2022 The Unbounded Project Authors (https://github.com/googlefonts/unbounded) | SIL OFL 1.1 | `library/fonts/unbounded.OFL.txt` |
| VT323 | Copyright 2011, The VT323 Project Authors (peter.hull@oikoi.com) | SIL OFL 1.1 | `library/fonts/vt323.OFL.txt` |
| Zen Dots | Copyright 2021 The Dots Project Authors (https://github.com/googlefonts/zen-dots) | SIL OFL 1.1 | `library/fonts/zen-dots.OFL.txt` |
| Zilla Slab | Copyright 2017, The Mozilla Foundation | SIL OFL 1.1 | `library/fonts/zilla-slab.OFL.txt` |

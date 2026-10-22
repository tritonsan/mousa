# Third-party notices

Moûsa's own code is under the MIT licence (`LICENSE`). The repository also carries works by others, each under its own
licence, listed here with where its full terms and credits live.

| What | Where | Licence | Credits and terms |
| --- | --- | --- | --- |
| Fonts: Google Fonts families as Latin-subset WOFF2 files from Fontsource, with their licence files from google/fonts | `library/fonts/` (copied into each plugin package under `plugins/*/library/fonts/`), `examples/long-dusk/fonts/` | SIL Open Font License 1.1 | One `*.OFL.txt` beside each family; `library/fonts/fonts.json` names the source of every file |
| Photographs: public-domain product photographs found through the Openverse API, resized and re-encoded | `library/local-food/` | CC0 1.0 or Public Domain Mark 1.0, per image | `library/local-food/library.json` lists each image's licence and source |
| Music: 20 Jamendo tracks found through the Openverse API | `library/music/` | CC BY 3.0, each | `library/music/catalog.json` carries each track's licence, source URL and attribution sentence; the pages that play a track show its credit |
| Container seccomp profile, derived from Docker's default profile (moby/profiles) | `deploy/seccomp-chromium.json` | Apache License 2.0 | `deploy/seccomp-chromium.LICENSE` (the licence) and `deploy/seccomp-chromium.NOTICE` (the changes) |

The Docker image installs software that is not in this repository: Debian packages (Chromium among them), Node.js and
the Kiro CLI, each under its own terms. Qloo's data is read through its API under Qloo's terms and is not stored in the
repository; the public gallery publishes names, never Qloo's identifiers, scores or descriptions.

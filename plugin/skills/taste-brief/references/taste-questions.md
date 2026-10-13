# Taste questions

A designing agent asks Qloo nine kinds of question. Six are answered by the measurement at the start of a design. Three are asked while designing, at the decision they settle. Each question below gives the Qloo call behind it, what comes back, the design layers it informs and what it does not prove.

## Asked by the measurement

### `world`: What else does this audience love?
- **Qloo call:** Insights in each domain of the medium's recipe (brands, films, music, books, TV, games, places or podcasts). The named works are excluded, and a lesser-known band is added for brands and films.
- **Returns:** works ranked by affinity, each with its typed tags. The brief lists the strongest per domain with their leading tags.
- **Informs:** imagery subjects, references, content and structure.
- **Caveat:** affinity ranks works for this signal. It does not score a design or predict one person.

### `shared`: What do the things they love have in common?
- **Qloo call:** none. The look, mood and meaning tags that two or more measured works carry are ranked by those works' affinity and by how many domains they span.
- **Returns:** qualities by family, with the works that carry them.
- **Informs:** palette, typography, imagery, motion, voice and structure.
- **Caveat:** a quality carried mostly by brands describes their products' design more than this audience.

### `pacing`: How do the films and series they love move?
- **Qloo call:** style tags ranked for the audience, with films and TV as parents.
- **Returns:** tags such as Quiet, Pensive or Visually Austere.
- **Informs:** motion, rhythm and layout density.

### `surfaces`: Which surfaces, materials and forms do they favor?
- **Qloo call:** aesthetic tags ranked for the audience. For a game, it also reads art styles from the measured works' own tags.
- **Returns:** tags such as Sculptural, Textural or Pixel Art.
- **Informs:** illustration, texture, imagery treatment and render style.

### `tone`: What emotional tone runs through what they love?
- **Qloo call:** emotional-tone tags ranked for the audience.
- **Returns:** tags such as Thoughtful, Introspective or Melancholic.
- **Informs:** voice, copy and motion.

### `difference`: What did I not expect?
- **Qloo call:** none. The measured profile is compared with your frozen prediction.
- **Returns:** the surprises, the guesses Qloo confirmed, and the predictions it did not measure.
- **Informs:** what moves the design off its default.

## Asked while designing (`taste_ask`)

### `shortlist`: Which of these would they choose?
- **Qloo call:** Insights limited to a shortlist of 2-5 named candidates of one kind, resolved by search first.
- **Returns:** the candidates ranked by affinity, with any name Qloo could not find.
- **Informs:** music, partners, featured items and references.
- **Example:** `taste_ask({ question: 'shortlist', decision: 'Which artist plays in the shop', myGuess: 'Khruangbin', candidates: ['Khruangbin', 'Tom Misch', 'Nala Sinephro'], kind: 'artist' })`

### `local`: What do they love around here?
- **Qloo call:** place Insights for the audience, weighted by the location.
- **Returns:** places ranked by affinity there.
- **Informs:** local imagery, venues and partners.
- **Caveat:** a location weights the signal; it is not a physical boundary.

### `overlap`: Where do two audiences meet?
- **Qloo call:** the same domain measured for this audience and for another one given as `otherReferences`, then the works both lists share.
- **Returns:** shared works and what is distinct to each audience.
- **Informs:** shared ground, or a deliberate split between two parts of a design.
- **Caveat:** shared works within two bounded result lists are not a measured overlap of people.

## From a design decision to a question

| You are deciding | Ask |
| --- | --- |
| The palette, the type, the overall look | `shared` (look and mood qualities) |
| How things move, the rhythm of a page | `pacing`, then `tone` |
| Illustration, texture, the render style of a game | `surfaces` |
| The voice of headlines and copy | `tone`, then `shared` (mood and meaning) |
| The sections, the story, what the product is organised around | `shared` (meaning), then `world` |
| Which artist, brand, book or film to feature | `shortlist` |
| Which venues, streets or neighbours to show | `local` |
| A design for two audiences at once | `overlap` |
| Whether the data changed anything | `difference` |

## Recipes per medium

The measurement takes the domains of the medium's recipe. The artifact's own medium, such as games for a game or places for a café, takes the first required work place when it has a central work.

| medium | domains |
| --- | --- |
| `web` | brand, movie, artist, book, tv_show, style, aesthetic, tone, qualities |
| `app-ui` | brand, tv_show, movie, artist, podcast, style, aesthetic, tone, qualities |
| `brand` | brand, artist, movie, tv_show, book, aesthetic, style, tone, qualities |
| `place` | place, brand, artist, movie, tv_show, aesthetic, tone, qualities (needs a location) |
| `game` | videogame, movie, tv_show, artist, book, style, aesthetic, tone, qualities, art_style |
| `writing` | book, movie, tv_show, podcast, artist, style, tone, qualities |
| `generic` | brand, movie, artist, book, tv_show, style, aesthetic, tone, qualities |

A location adds `place` to a recipe that lacks it.

## The budget

- **Requests:** a measurement makes at most 24. It needs one search per named reference (two when the first misses), one search per described segment, and one request per measured domain plus the lesser-known bands. With many references, the later domains may stay empty; the plan's notes warn you, and fewer references keep every domain.
- **Cache:** every answer is kept in the project for a week. A second design for the same audience, or a repeated `taste_ask`, sends nothing.
- **When a request fails:** rate limits, timeouts and server errors are retried a few times, and every attempt counts. A domain that still fails is reported, never filled in.

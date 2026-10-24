# Reading what Qloo measured

The Taste Brief gives the result in a few names per question. This file explains where those names come from, how strongly to trust each kind, and what they cannot tell you.

## What a measurement is

- **What goes in.** Moûsa resolves the audience references to Qloo entities, then asks Insights for each domain of the recipe. The resolved works are the signal, and they are excluded from the results.
  - Segments, a location and age bands weight every request.
  - Style, aesthetic and emotional-tone tags are ranked for the same signal.
- **What comes back.** Real works and tags, each with an **affinity**: how strongly it goes with this signal, relative to the other results.
  - Affinity is not a probability, a percentage, a score or the preference of any one person.
  - **Popularity** is a percentile across Qloo's catalogue. The lesser-known band (popularity at most 0.6) shows neighbours beyond the obvious hits.
- **What Moûsa adds.** It groups the works' typed tags into **qualities**. The grouping is Moûsa's; the tags, the works carrying them and their affinities are Qloo's.

## Qualities and their families

Each work Qloo returns carries tags, and each tag has a type. Moûsa sorts the types into three families by what they describe in a design:

| Family | Tag types | Sets |
| --- | --- | --- |
| look | aesthetic property, art style, style | palette, type, imagery, illustration |
| mood | emotional tone, plot, music, artist, character | motion, voice |
| meaning | theme, archetype, audience, core value, interests, lifestyle | voice, structure |
| left out | platform, business model, brand type, age ranges, competitor brand, Wikipedia category, influenced by | nothing: catalogue metadata, not taste |

- **What becomes a quality.** A tag carried by two or more measured works, such as `Atmospheric (look)` carried by 8 works across films, music and TV.
- **How qualities rank.** By how distinctive they are for this audience: a quality's **lift** is how many times more often this audience's works carry it than the works of other audiences Moûsa has measured, weighed by the affinity of its works and the domains they span. Qloo puts some tags, such as Intimate, Atmospheric and Minimalist, on works of almost every audience; they lead only an audience whose works carry them unusually often. The brief keeps the four highest of each family and shows each one's lift.
- **Tags in the brief.** The tags listed after a work lead with its look, mood and meaning tags. Other keyword tags follow and are noisier: a film tagged "The forest" or "Electronic translator" is describing its plot, not its look.

## Surprises and confirmations

- **A surprise** is a measured work, tag or quality that your frozen prediction did not contain and the brief did not already name. Surprises exist only because Qloo was consulted, so they are what must move the design.
- **A confirmation** is a measured result you predicted.
  - Predicted names match measured works.
  - Predicted qualities match measured tags and qualities, never works: a predicted quality "Calm" is not a prediction of a brand called Calm.
  - An aggregated quality also matches a shared stem, so Minimal confirms Minimalist.
- `taste_ask({ question: 'difference' })` lists the surprises, the confirmations and the predictions Qloo did not measure.

## Required anchors

Six entries are required. The design uses each one or rejects it with a specific reason, and at most two may be rejected.
- **With qualities:** three are the most distinctive quality of each family. Three are works, one per domain: in each domain the five works the audience loves most compete, and the one most central to the qualities is taken, where centrality is the summed score of the qualities a work carries. The artifact's own medium comes first: games for a game, places for a café.
- **Without qualities:** the highest-affinity works across domains, surprises first.
- **A work that carries none of the qualities** comes last, whatever its affinity. A brand that is required stands for its genre's look, such as broadcast graphics for a sports league: translate the genre, never its logo, colours or products.

## Noise and weak signals

- **A look carried by brands.** Brands carry look tags that describe their logos and products: Minimalist is often carried by electronics and drinks brands. The brief adds a caution when half or more of a look quality's works are brands. Use such a quality for the product's own surfaces at most, not as the audience's eye.
- **Books** rarely carry typed tags, so they seldom become qualities or required anchors. Several big brands carry none either.
- **An unresolved reference** did not contribute. It stays unresolved, and you report it.
  - **A reference's last word limits what may seed it.** "Studio Ghibli films" accepts only films or their makers, and "ambient music" asks for a music genre tag first.
  - **Same-named works and places.** A work or creator wins over a place of the same name: "Paterson" is the film before the city.
  - **The city of the design** belongs in `location`. A venue the audience loves can be a reference.
- **A segment-only signal** (no named works) is broad. Its brands in particular can drift toward large institutions, so add a few works the audience loves when you can.
- **A location** weights what Qloo measures toward a place. It does not limit results to that place, and it says nothing about each person who lives there.
  - **How strong it is.** In the first live plugin session, "Istanbul" moved all 80 measured works away from the prediction for Paterson and Nujabes, and the style ranking came back empty.
  - **An address Qloo cannot match.** "Moda, Kadıköy, Istanbul" emptied every answer. Moûsa now stops after the first empty answers, and the brief says to try the city or the neighbourhood alone.
- **Age bands** weight the signal too. A request Qloo refuses with an age band is sent again without it, and the brief says so.

## What a measurement cannot tell you

- Why this audience likes a work. Qloo measures relationships, not motives; a reviewer's praise is that reviewer's reaction.
- What a work looks like, beyond its tags. Your memory of a film's colours is your knowledge, not Qloo's record, and a design should translate qualities rather than copy a work.
- Whether a design is good, or whether people will prefer it. Conformance and comparison metrics show that the data changed the specification and the result, not that the result is better.

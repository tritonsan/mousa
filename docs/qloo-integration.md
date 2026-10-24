# Qloo integration

The real hackathon API connection and a complete Opus 5.5 baseline/Qloo website comparison were verified on October 3, 2026 local time. This establishes working entity lookup, selected insights categories, explainability, a real cultural shortlist and production decision traceability. A separate live check exercised HTTP and STDIO source calls, media tags and a returned Tokyo locality match. It does not measure design benefit. See the [live verification record](verification.md). The API diagnostic, transport report and production verification it names are local reports under output/, kept off the public repository because they hold Qloo answers.

## Configuration

Studio reads `QLOO_API_KEY` and `QLOO_API_BASE_URL` from its server environment. The default base URL is `https://hackathon.api.qloo.com`. The standalone plugin reads `QLOO_API_KEY` and optional `QLOO_BASE_URL` from its MCP process environment. Use the host's secret environment facility rather than a credential in a brief, generated artifact or browser setting. Restart the Studio server after changing its environment; the presence of a credential in status is configuration, not a successful request.

The hackathon key uses the hackathon environment. The client sends GET requests to `/search`, `/v2/tags` and `/v2/insights`, with the credential in `X-Api-Key`. It does not use the unsupported legacy `/recs` or `/recommendations` paths. [Official hackathon guide](https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide)

## A decision-led request sequence

1. Use `culture_assess_decision` for the model's declared creative decision and typed context. A technical repair can skip Qloo; missing references can require clarification; sufficient relevant previous evidence can be reused.
2. Resolve the original named references with `qloo_search_entities`. The returned entity IDs belong to real catalog matches. Inspect ambiguity rather than assuming the first match is correct.
3. Select one or two result domains that answer the actual cultural question. Call `qloo_get_insights` using the resolved original seeds. Keep creator inspiration, brand references and audience preferences in their original roles.
4. If a real uncertainty remains, make one focused follow-up. `candidateEntityIds` filters an actual cultural-entity shortlist; it does not evaluate generated websites or characters.
5. Save real source records separately from the model's finding, creative interpretation and changes to the artifact. Reuse applicable evidence during implementation instead of querying for every code or visual detail.

The [creative policy](creative-policy.md) governs this sequence in the `research` protocol. It is not a fixed three-call recipe or an autonomous upstream design service. A Qloo-enabled run that skips research retains its mode while disclosing that it added no new research; availability never implies cultural support.

## Taste-led sequence (0.4.0 default)

With `CREATIVE_PROTOCOL=taste`, Studio's model never calls Qloo. The host runs one bounded taste pass before any model run; other MCP clients get the same pass through `qloo_taste_profile`:

1. Resolve each audience reference with `/search`; accept a match only when the meaningful words of both names agree (score at least 0.75). Among equally good matches, a work or creator wins over a same-named place: the live search for "Paterson" returned the city before the film, and places belong in `location`. A place still seeds when nothing else matches. Otherwise try `/v2/tags` (score at least 0.5). A name that matches neither stays unresolved and is reported. The name match ignores category words such as "films" or "music", so a reference's last word now decides what may seed it. A work word (films, TV, books, games, podcasts, albums, artists, brands) admits only entities of that kind or their makers, such as a person, author, studio brand or artist, and never a place tag. In the live Echo Atlas pass, "Studio Ghibli films" had matched the music artist Studio Ghibli; no film entity or tag carries the studio's name, so it is now reported as unresolved with that reason. A genre word (music, genre) asks `/v2/tags` with `filter.tag.types=urn:tag:genre:music` first. "ambient music" had matched an artist named Ambient Music, and an untyped tag search lists a place-ambience tag of that name before the genre; it now seeds the Ambient genre tag. A [live probe](../scripts/verify-qloo-seeds-live.mjs) through the pass itself confirmed both results, with Outer Wilds, Nujabes and Paterson resolving as before (report).
2. Request `/v2/insights` for each taste domain (brands, film, music artists, books and TV by default, plus `videogame`, `destination` or `place` when the starter or audience calls for them). Each request sends the resolved entity seeds in `signal.interests.entities` and tag seeds in `signal.interests.tags`, excludes the entity seeds with `filter.exclude.entities`, and asks for `feature.explainability`. A request with both kinds of seed that times out or gets a server error twice is sent once more with the entity seeds alone, and the profile reports it.
3. Request two audience-level tag rankings: `style` (`filter.type=urn:tag`, `filter.tag.types=urn:tag:style:qloo`, `filter.parents.types=urn:entity:movie,urn:entity:tv_show`) and `aesthetic` (`filter.tag.types=urn:tag:aesthetic_property:qloo`), eight tags each. Tag requests do not exclude the seeds, because they rank qualities, not works. They use the entity seeds alone when any entity resolved, and the tag seeds only otherwise. During the October 4 voice pair, the style ranking for Outer Wilds returned eight tags, and adding the Ambient genre tag as a second seed returned HTTP 500 with or without explainability. The [parameter reference](https://docs.qloo.com/reference/parameters) lists `signal.interests.tags` for entity result types only, though the [Taste Analysis recipe](https://docs.qloo.com/reference/taste-analysis) names it as a starting context for tag results. A [live check](../scripts/verify-qloo-tag-seeds-live.mjs) of the fixed pass returned the style tags with the genre seed resolved (report), and so did the taste pass of the [next live pair](verification.md#live-voice-pair-with-the-tag-seed-fix--october-4-2026).
4. Repeat brands and film with `filter.popularity.max=0.6` to reach lesser-known neighbors. Then group the typed tags of the returned works into shared qualities, which needs no request ([Typed tags and taste qualities](#typed-tags-and-taste-qualities)).
5. Send requests two at a time. With four in parallel, the first live pass hit `QLOO_RATE_LIMIT` on three of seven insights requests, so a rate-limited request is retried after a short pause (at most twice). Timeouts, network errors and server errors are retried the same way: one live Echo Atlas pass lost four entity domains to `QLOO_TIMEOUT`, and three of them answered a minute later. Its tag rankings had failed with `QLOO_UPSTREAM` because of the tag seed (step 3). Every attempt is recorded and counts toward the budget.
6. Stop at 24 requests. A profile needs at least two entity domains with three or more entities; otherwise it is reported as `insufficient` and no taste-led Qloo run starts. Tags never count toward that minimum, and a failed tag request is reported like any other domain.

An optional place and age band weight every request of the pass. The place goes as `signal.location.query`, or as `signal.location` for a WKT point or a locality ID. One to three of the documented age bands go as `signal.demographics.age`. A request Qloo refuses with the age signal is sent once more without it, and the profile reports that. Studio's game character pairs offer both and state them to both runs; gender is not offered.

The agent sees the profile only after saving its own prediction, so each measured entity, tag and quality can be marked as predicted, named in the brief or a surprise. Predicted qualities are matched only against measured tags and qualities, and predicted names only against measured entities. With shared qualities, three of the six required anchors are the strongest quality of each family and three are the works most central to them; the palette and typography devices anchor to qualities. The tags also direct two DNA devices of their own: a motion device anchored to a style tag and an inline SVG illustration anchored to an aesthetic tag, measured ones whenever the profile has them. When a ranking returned none, motion anchors to a measured mood quality and illustration to a measured look quality. A voice device anchored to a measured entity or tag sets the register of the site's narrative copy over its fixed product facts. Qloo still returns entities, tags and relationships; the Design DNA's colors, fonts, layout and motion are the agent's labeled interpretation of them. See the [taste-led design policy](../plugin/skills/culture-grounded-design/taste-policy.md).

### Style and aesthetic tags

Qloo does not recommend animations. What it measures is which qualities an audience's taste carries, and two tag namespaces describe how things look and move. A three-request probe on October 4, 2026 used the recorded Nujabes and Paterson seeds (probe report, `node scripts/verify-qloo-style-live.mjs --run`):

| Request | Top returned tags |
| --- | --- |
| `style`, parents film and TV | Quiet, Pensive, Visually Austere, Deadpan, Luminous, Somber, Dreamlike, Visually Arresting |
| `aesthetic_property` | Sculptural Designs, Sculptural, Architectural Design, Luxurious Packaging, Textural, Sharp Tailoring, Timeless Elegance, Fluid Silhouettes |
| `style`, `aesthetic_property` and `music` in one request | Calm, Quiet, Controversial, Pensive, Bold, Deep, Revolutionary, Reflective, Visually Austere, Serene, Authentically Raw, Deadpan |

Every returned tag ID was in a requested namespace, so the type filter was honored. The combined request returned no aesthetic tag in its first twelve, which is why the taste pass sends style and aesthetic as separate requests. The affinities rank tags for this seed pair only; they say nothing about another audience, and turning "Pensive" into a slow ease or "Sculptural" into a line drawing is the agent's interpretation.

### Typed tags and taste qualities

Each work Qloo returns carries tags, of which the client keeps up to 16, and each tag ID names its type: `urn:tag:style:qloo:moody`, `urn:tag:theme:qloo:marriage`, `urn:tag:platform:qloo:pc`. The profile used to keep the first eight names and drop the types, so a work's first keyword often became the design: Anomalisa's "Hotel" became a night hotel, and the ice hockey team LA Kings brought "Black And Silver Palette" to a food shop. With the `qualities` domain (a Studio default), the host now reads the types:

| Family | Tag types | Use in the design |
| --- | --- | --- |
| look | `aesthetic_property`, `art_style`, `style` | palette, type, imagery, illustration |
| mood | `emotional_tone`, `plot`, `music`, `artist`, `character` | motion, voice |
| meaning | `theme`, `archetype`, `audience`, `core_value`, `interests`, `lifestyle` | voice, structure |
| left out | `platform`, `business_model`, `brand_type`, `brand_subtype`, `age_ranges`, `competitor_brand`, `wikipedia_category:wikidata`, `influenced_by` | catalogue metadata, not taste |

A work's tags now lead with its look, mood and meaning tags; other types, such as media keywords and genres, follow, and metadata is left out. The evidence record keeps every returned tag. A tag that two or more measured works carry becomes a quality ref such as `quality:look:atmospheric`. It records how many works carry it, their domains, three examples, the mean affinity of those works and the evidence records they came from. Qualities rank by the works' summed affinity times the number of domains they span, so a quality running through film, music and TV outranks one repeated within a single domain. The top six of each family are kept. A name that Qloo types in two families joins the family most of its works give it, and a name the style or aesthetic ranking already returned stays with that ref. The families and the ranking are the host's; the tags, their types, the works carrying them and the affinities are Qloo's.

A replay of the recorded Gather and Echo Atlas passes through this code, answered from their saved responses with no new request (`node scripts/replay-taste-profile.mjs 38f75004 6ba1656f`, report), gave:

| Pass | look | mood | meaning |
| --- | --- | --- | --- |
| Gather (Nujabes, Paterson) | Atmospheric (8 works), Minimalist (7), Raw, Naturalistic, Nostalgic, Intimate | Reflective (8), Character driven, Realistic, Experimental, Melancholic, Complex | Identity (4 works, 3 domains), Emotionally engaged, Love, Empathetic, Analytical, Mortality |
| Echo Atlas (Outer Wilds, Studio Ghibli films, ambient music) | Intimate (15), Minimalist (10), Documentary like, Naturalistic, Observational, Stylized | Emotional (8 works, 4 domains), Atmospheric, Introspective, Character driven, melancholic, Melodic | Reflective (9), Emotionally engaged, Identity, Creativity, Introspection, Love |

With qualities, three of the six required anchors are the strongest quality of each family. The other three are works, one per domain, chosen by centrality: the summed score of the qualities a work carries. A work that carries none, such as LA Kings, comes last whatever its affinity. Films and TV carry more typed tags than games, so the artifact's own medium takes the first work place (games for the game starter, destinations for the hotel starter):

| Pass | Required anchors before | Required anchors now |
| --- | --- | --- |
| Gather | The 1st Shop of Coffee Prince, Anomalisa, Neutral Milk Hotel, Island, LA Kings, The Happy Film | Atmospheric, Reflective, Identity, The Romantic Exiles, the Microphones, The 1st Shop of Coffee Prince |
| Echo Atlas | Unreal Engine, Arnold, Methyl Ethel, ESRB, Mommy, Tacoma | Intimate, Emotional, Reflective, Tacoma, The Master, Mitski |

Limits seen in the replay: no book in either pass carried a typed family tag, so books never become required, and several brands carried none either (Starbucks, Apple Inc, Tesla). Qloo off predicts three to six qualities blind and its first three become required beside three predicted works, so both arms have the same anchor shape. The recorded taste input grows by about 15 KB (86 to 101 KB for Gather), within the 160 KB file limit, and descriptions are dropped from `culture-taste.json` first if a record exceeds it.

A live Gather pass made with this code on October 4, 2026 (11 requests) gave the same 18 qualities, with the same counts and domains, and the same six required anchors as the replay ([verification record](verification.md#live-gather-pair-with-shared-qualities--october-4-2026)).

The [game character](development-notes.md#game-character) pair runs the same pass with the `qualities` domain and with `videogame` as its medium, so games take the first required work place, and its palette and silhouette anchor to quality refs. Its first live pass, on October 5, 2026, ran before it listed `qualities`. For Hollow Knight, Spirited Away, Sigur Rós, Nujabes and Paterson it measured 79 entities, eight style tags and eight aesthetic tags, so a game audience can return aesthetic tags where the Echo Atlas passes returned none. That pass kept no responses, so its qualities cannot be rebuilt without new requests. Pairs now keep every response in `taste.json` as an evidence record, and `scripts/replay-taste-profile.mjs` replays them like a site job.

Five later passes for the same audience, with `qualities`, each made 17 requests and returned the same 79 entities, 16 tags and 18 qualities. The strongest were Atmospheric, Melancholic and Love ([verification record](verification.md#live-character-pairs-with-shared-qualities--october-5-2026)). Brands carry look tags too, and the ranking counts their domain like any work's. For that audience, four of the nine works carrying Minimalist were brands (GoPro, Bose, Otterbox and Pepsi Nitro). For an audience of Jet Set Radio, Persona 5, Spider-Verse, Daft Punk and Kill la Kill, Minimalist became the strongest look quality, and three of its six carriers were brands (Playstation, Pepsi Nitro and Team Liquid Apparel). A brand's look tags describe its logo and products more than the audience's visual taste, so counting brands apart in the look family is an open refinement.

The character pair also lists the derived `art_style` domain. Each `art_style` tag on a measured work, such as Hand-Drawn or Pixel Art, becomes an art-style ref with no request. The ref records the works that carry it (one is enough), their domains, three examples and the evidence records, and ranks like a quality; its name then stays with that ref instead of joining the look family. The game maps an art style to one of its eight frame styles by its words, such as Hand-Drawn to ink, Pixel Art to pixel and Cel-Shaded to cel. The mapping is the host's; the tags and the works carrying them are Qloo's. Profiles recorded before the domain are read again from their saved responses. For Hollow Knight, Spirited Away, Sigur Rós, Nujabes and Paterson, the strongest frame style is pixel art, carried by Hyper Light Drifter, Eastward and Owlboy ([verification record](verification.md#art-direction-music-and-comparison-variants--october-5-2026)).

### Distinctive qualities, and required works from the head

Ranked by affinity times spread, the same few tags led nearly every audience. Over the 20 benchmark audiences, Intimate and Atmospheric were each derived for 13, and the brief pointed the palette or the type at them for 9 each. In the gallery's 11 audiences they set the palette or the type for 7 and 4. The designing model then drew those adjectives the way it draws them for anyone: the showcase, made for an audience of sports leagues, hip-hop and sports documentaries, became a warm cream page with an editorial serif.

Since October 24, 2026 a quality ranks by how distinctive it is for this audience. Its **lift** is how many times more often this audience's tagged works carry the tag than the works of 28 reference audiences measured in Moûsa sessions do (`plugin/server/culture/quality-base-rates.mjs`, built by `scripts/build-quality-base-rates.mjs` from saved profiles, keeping tag names and shares only). The score weighs lift^1.5 by the carriers' summed affinity and the square root of their domains. Left out one audience at a time, the share of family leaders that are near-universal tags fell from 58% to 21%.

| Audience | Leaders before | Leaders now |
| --- | --- | --- |
| The showcase (This Week in Startups, The Original Kings of Comedy, the Dodgers, Chelsea, Live Nation) | Intimate, Emotional, Reflective | Bold Typography ×2.7, Determined ×2.9, Resilience ×3.3 |
| Bad Bunny and Narcos | Gritty, Character driven, Loyal | Gritty ×3.5, Urban ×4.7, Consequences ×3.9 |
| The Lamplight (a live music venue) | Intimate, Character driven, Identity | Alternative R&B ×4.6, Soulful ×3.0, Open-Minded ×2.3 |

The required works change too. In each domain only the five works the audience loves most compete, and the most central of them is taken. The showcase's were a CrossFit documentary, a cable comedy and Jeremih, chosen for carrying Intimate; now Jeremih, the audience's top artist, stands beside Gatorade G2 and Men of a Certain Age. A look quality carried mostly by brands is no longer cautioned as describing the brands rather than the audience: it is the design the audience sees every day, to be translated as a genre (broadcast graphics, packaging type, signage) and never as a brand's marks.

## Supported tool inputs

| Tool | Inputs and purpose |
| --- | --- |
| `qloo_search_entities` | `query`, optional `types`, optional `limit`; resolves names using Search's category list. |
| `qloo_search_tags` | `query`, optional `tagTypes`, optional `limit`; resolves genre and interest names to tag IDs via `/v2/tags`. |
| `qloo_get_insights` | `resultType` and resolved `seedEntityIds`, `seedTagIds` or both; optional `excludeEntityIds`, `popularityMin`/`popularityMax` (0–1 percentile), `location`, `candidateEntityIds`, `limit`, `explainability`, `tagTypes`, `parentTypes`. |
| `qloo_taste_profile` | Named `references`, optional `domains`, `location`, `deepCuts`, `assumption` (the caller's prediction) and `knownNames`; runs the bounded taste pass above and, with a prediction, returns the surprise-marked taste input and required anchors. The default `qualities` domain adds the shared qualities without a request. |
| `qloo_compare_tastes` | Two or three explicit groups with resolved seed IDs, a `resultType`, and optional shared location/result/tag options; makes a separate insights request for each group. |

Search has its own category list, including legacy lookup categories such as actor, album, author, director and locality. Those lookup categories are not added to Insights result types. [Search reference](https://docs.qloo.com/reference/get-search)

The canonical game category is `videogame`, sent as `urn:entity:videogame`. The hackathon guide's conflicting `video_game` spelling was tested directly: the canonical form returned HTTP 200 with game entities, while the underscore form returned HTTP 400 in this hackathon environment. This observed result takes precedence over silently changing the wire value to match that one guide list. [Response schema](https://docs.qloo.com/reference/schema-taxonomy)

For targeted tag analysis, `resultType: 'tag'` sends `filter.type=urn:tag`. Optional `tagTypes` and `parentTypes` map to `filter.tag.types` and `filter.parents.types`; the plugin rejects these options for non-tag result types. For example, using already resolved seed IDs:

```js
const request = {
  seedEntityIds: resolvedSeedIds,
  resultType: 'tag',
  tagTypes: ['urn:tag:keyword:media'],
  parentTypes: ['movie', 'tv_show'],
  limit: 6,
  explainability: true
};
```

This illustrates the documented request mapping. A separate live transport request using the Paterson seed returned six tags consistent with this media namespace and parent-category context; that observation does not measure usefulness for another brief or prove the filter changed a counterfactual result. Tag rows are read from `results.tags`. The [Taste Analysis recipe](https://docs.qloo.com/reference/taste-analysis) documents these tag filters; audience-oriented parent values elsewhere in the docs describe a different query context.

## Returns, limits and geography

Entity results preserve real IDs, names, available category information, tags, descriptions and returned affinity/popularity. Search's actual `types` array is preserved rather than replacing it with an invented category. Optional per-entity and aggregate explainability comes from the API's actual metadata. Bounded `responseQuery` and `warnings` retain safe upstream context, including locality-resolution information when the API supplies it. Missing metadata remains missing.

The first live artist/brand insights and shortlist responses included both per-entity `query.explainability` and top-level `query.explainability`. This establishes feature availability for those requests, not a guarantee for every category or query. Contribution values are not individual probabilities, and a cultural anchor's relation to CSS, layout or narrative remains model interpretation. [Explainability reference](https://docs.qloo.com/reference/insights-api-deep-dive)

The optional insights `location` is a geographic taste signal. A named locality maps to `signal.location.query`; WKT or a locality UUID maps to `signal.location`. WKT uses longitude before latitude. These signals do not impose a physical boundary on recommended places. The client does not currently expose the separate Insights `filter.location` physical filter. The live Tokyo artist request returned a matching named locality under `responseQuery.localities.signal`, while the documentation illustrated a singular `locality` path. This establishes that lookup; it does not measure the signal's effect on ranking or establish broader regional coverage. [Parameter reference](https://docs.qloo.com/reference/parameters)

Current application limits are 20 seed IDs, 10 tag seeds, 50 shortlist IDs, 50 excluded IDs, 20 returned results, four tag namespaces and four parent categories per call, with a 15-second request timeout. These are our bounds, not published vendor quotas. The official Insights result maximum is 50, and Search's documented `take` is below 200. The guide provides no numeric hackathon rate limit.

Some unsupported or inapplicable parameters may be silently ignored. Record what was requested, inspect the returned context and validate against the relevant category before claiming a filter influenced results. HTTP 200 alone does not establish that a tag filter or geographic signal was applied. [Category parameter guide](https://docs.qloo.com/reference/available-parameters-by-entity-type)

## Verification commands and remaining work

```sh
node scripts/verify-qloo-live.mjs
```

Without `--run`, this command prints its plan without making API requests. Adding `--run` uses the locally configured credential and makes at most ten real Qloo requests; it starts no model jobs. Its initial observed run made eight requests. The failed underscore-category probe remains recorded as a failure, not a source record.

For the taste-led host pass only, with no model job:

```sh
node scripts/verify-qloo-taste-live.mjs
```

Add `--run` to send at most 24 real requests for the default seeds (Nujabes, Paterson) or `--reference=Name` overrides. The report lists resolved and unresolved seeds, entities per domain and band, and surprise flags against a script-authored fixture prediction. This standalone script has not been run. The same pass ran live inside the Studio comparisons recorded in the [verification record](verification.md#live-taste-led-comparison--october-3-2026): 9 requests per pass, Nujabes resolved as an artist and Paterson as the film. With the style and aesthetic requests it made 11 requests in the [October 4 pair](verification.md#live-fonts-motion-and-illustration-pair--october-4-2026) and returned the same eight style and eight aesthetic tags as the probe.

For live transport verification without model generation:

```sh
node scripts/verify-qloo-transports-live.mjs
```

Add `--run` to initialize/discover tools and make at most four source calls through the existing local HTTP server and a fresh standalone STDIO process. The observed run passed all four calls: Search, artist Insights, media-tag Insights and Tokyo artist Insights. It recorded actual per-request metadata and the older HTTP handler's missing source IDs separately from the fresh STDIO handler's application-owned record ID.

The complete Kiro/Qloo website production path subsequently passed the production verification: both independent starter copies used the same brief and prepared context, baseline made zero source calls, and Qloo made four calls across reference lookup and two insights domains. Actual insights support three design decisions and the saved creative trace. The runtime stayed byte-identical to the starter, and public records/files contain no server credential.

Broader tag/region coverage, the measured influence of filters and live multi-group comparison still need their own observed results. Integration does not prove cultural correctness, design quality, conversion improvement or the effectiveness of every supported category.

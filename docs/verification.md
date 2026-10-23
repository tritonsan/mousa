# Local verification record

This record describes the tested scope of the local application. It does not establish a working AWS deployment or that Qloo improves the design.

The reports it names under `output/` stay on the machine that made them. Several hold Qloo's answers, which the public repository does not.

## Qloo's answers taken out of the public repository — October 23, 2026

Qloo's developer guide allows private server-side caching, but asks: "Do not store Qloo response data in a public repository". This repository held two recorded runs with Qloo's answers in them, and a few of Qloo's ids in tests and live scripts.

**The whole history was rewritten.** All 42 commits keep their authors, dates and messages.
- The Kiro homes once kept beside the game's first live pair (session transcripts) are gone from every commit.
- In `game/runs/pair-20261004-210303/` and `examples/mobile-app-run-2026-10-06T10-20-02-669Z/`, every entity Qloo scored lost its affinity, popularity and description. Names and tags stay.
- Each of the 133 Qloo entity ids, wherever it appeared, became a synthetic stand-in (`00000000-0000-4000-8000-…`), the same one in every file.
- References to the old commits, in this record and in one commit message, point at their rewritten ids.

**Checked.**
- No blob reachable from `main` holds any of the 644 uppercase ids in this machine's run records.
- No Kiro home is in any commit.
- 42 commits before and after, with the same authors, dates and subjects.
- 511/511 tests on the rewritten tip.

**Kept from coming back.**
- `tests/no-qloo-answers.test.mjs` fails on an uppercase UUID that is not a stand-in, and on a scored entity in tracked JSON outside the replay fixtures.
- `.gitignore` keeps new run folders out.
- The three live scripts that named their seeds by id now resolve them with Search.

**Not changed yet.**
- The gallery bundle of release `data-2026-10-22` holds names only: 505 text files, with no id, URN, affinity or popularity. Its "Run it again" sections name commits of the old history.
- The jury server still runs the old 2d85adb until its next deployment. That commit has the same code as its rewritten 87d8172; only these records differ.
- GitHub may serve the old commits by their ids for a while. GitHub Support can purge them.

## The jury server on AWS — October 22, 2026

The stack `mousa-jury` was created in us-east-1 from `deploy/aws/mousa-stack.json` with the AWS CLI, at ref 87d8172, in the default VPC's us-east-1a subnet, with the gallery bundle of release `data-2026-10-22`. The keys went from `.env` through a temporary parameter file, deleted after the call.
- **Time.** CREATE_COMPLETE after 7 minutes: the two CloudFront distributions in about 2, then the first boot in 4 (Docker, the image build, the bundle and the start).
- **What the first boot reported.** Status ok: kiro-cli 2.33.1 with the key, Chromium's captures, the try open with nothing missing, 11 gallery entries, commit 87d81727ba1f.

**Checked from outside, from this machine,** with a scratch script and `verify-site.mjs`:
- **The site.** The app's CloudFront name answers with HSTS and the site's policy, and no page has a script. Plain HTTP is redirected to HTTPS with a 301. `/gallery/`, `/vote/`, `/try/`, `/studio` and `/api/gallery` answer, and `verify-site.mjs --no-picture` passed all 21 pages.
- **What a jury server closes.** `/mcp` and `/internal/tools` answer 404.
- **The origin.** Ports 8787, 8788 and 22 on the Elastic IP time out from outside: only CloudFront reaches the server.
- **The designs.** They play from the preview name under the sandboxed policy, and the app name answers 404 for a design's files. A gallery page, opened in a browser, played both Long Dusk designs side by side.
- **The deep check,** with the Studio token from Secrets Manager: status ok and 50 GB free. The caller is this machine's own address, an IPv6 /64, with one X-Forwarded-For entry: CloudFront's address is not what the limits count.
- **Step one of a try through CloudFront,** with the jury's code:
  - the access cookie came back Secure, and the request was redirected to the try's page;
  - it finished in 33 seconds: 48 entries frozen, 12 Qloo requests, 1.07 credits and 3.6% of the context;
  - "66 of 69 measured works were not in the prediction."

The page captures of `verify-site.mjs` need a loopback address, by the capture's own rule, so the live site was captured only through the browser pane.

## The try in the container with a Kiro API key, and the server's stack — October 22, 2026

**The key.** The user created a Kiro API key at app.kiro.dev, signing in through "Your organization" with the IAM Identity Center start URL, and put it in `.env` without it passing through the chat.
- A check on this machine would not have tested it: Kiro's authentication documentation puts an active `kiro-cli login` before `KIRO_API_KEY`, and this machine is signed in. The container has no sign-in, as the server will not.

**The image,** built again from the current code: the stable channel installed kiro-cli 2.33.1, and the new guard on the major version let it through. The 14 October image, with 2.31.0, is kept as `qloo-design-demo:2026-10-14`.

**Step one in the container, through the site's own forms** (the access code, then the request for Wax & Wane and Paterson and Nujabes):
- The first attempt failed in one second with `failed to launch kiro-cli-chat`. Kiro's launcher looks for its chat binary on PATH, and `/opt/kiro/bin` was on no PATH in the image. The container path of the try had never run before.
- The image now puts `/opt/kiro/bin` on PATH, and each try session puts Kiro's own folder on its PATH too (`sessionEnvironment`, tested).
- The second attempt finished in 40 seconds:

| Measure | Value |
| --- | --- |
| Kiro | 2.33.1, with the API key |
| Prediction session | 33 s, three Moûsa calls, 47 entries frozen |
| Credits, as Kiro metered them | 1.1 |
| Fullest context | 3.6% |
| Qloo requests | 12 |

- Kiro wrote nothing to stderr; the `Method not found` warning of 2.24 was gone.
- `/api/health/deep` reported Kiro, the key, Chromium's captures and an open try, and the entrypoint had written `app.disableAutoupdates` into Kiro's settings.

**Kiro stays on the version tested.** CLI 3.0, with the V3 engine as the default, is due by the end of October.
- Every Kiro session Moûsa starts (the try, the Studio's runs and the game's pairs) writes `app.disableAutoupdates` into its own `KIRO_HOME`, beside `chat.disableInheritingDefaultResources` (`src/kiro-settings.mjs`).
- The entrypoint sets the same in `HOME`, which the status checks use.
- The image build stops on a Kiro major version other than `KIRO_EXPECTED_MAJOR` (2); an empty value accepts any.

**The server's stack** (`deploy/aws/mousa-stack.json`, written by `scripts/build-aws-stack.mjs`):
- cfn-lint 1.58 passes it, with one check left out at template level: E6101 types a wait condition's `Data` as an object, while AWS's own examples put it in Outputs.
- `tests/aws-stack.test.mjs`, 7 tests: the template is the generator's output; the user data names only stack values, waits for the Elastic IP before it downloads anything and holds no key; the only inbound rule is CloudFront's prefix list on the two ports; IMDSv2 with one hop; the distributions; the bootstrap's order; the environment file sets every variable `deploy/demo.env.example` and the Compose file name, quoted, and refuses a quote; the health summary carries no token.
- The first boot's parts were rehearsed in Docker on Windows:
  - `write-env.py` wrote its 34 settings against a stand-in Secrets Manager;
  - the bundle (`export-hosted-jobs.mjs --gallery --showcase`: 11 gallery entries scanned clean and the showcase, 110 MB packed) passed its SHA-256 check and was imported into `qloo-design-demo_demo-data` with the bootstrap's own commands;
  - the site started, `health-summary.py` reported Kiro 2.33.1, Chromium, an open try and 11 entries, and `verify-site.mjs --no-picture` passed 21 pages, with HSTS and request log lines that hold route patterns only.
- **Not done:** creating the stack on AWS.

**A pair in the container,** step two of the same try, started with the site's own form:

| Measure | 14 October, on this machine (2.24.0, captures at 1568 px) | 22 October, in the container (2.33.1, 1024 px) |
| --- | --- | --- |
| The pair | 6.4 min | 4.5 min |
| Credits, both arms | 86.2 | 47.2 (37.1 with Qloo, 10.1 without) |
| Fullest context, with Qloo | 95.4% | 72.3% |
| Fullest context, without Qloo | 95.9% | 10.9% |
| Qloo requests in the try | 12 | 12 |

- Both arms finished every stage, with six captures each in the container's Chromium, under its own sandbox. No file was put back.
- The distance was 0.53, with the same frozen prediction in both arms; with Qloo, 7 of 7 devices rest on what the prediction did not contain.
- The arm without Qloo had two stream lines over the 1 MB line limit, which were skipped and counted as `dropped`.
- The try stays private in the test volume; it is not in the gallery.

**The repository** went public as [tritonsan/mousa](https://github.com/tritonsan/mousa), and GitHub detects its MIT licence. The gallery bundle is the release asset `data-2026-10-22/mousa-gallery.tar.gz` (11 entries, scanned clean, 101.7 MB), with its SHA-256 in the release notes; the download matched it.

## Engineering pass before the server — October 15, 2026

A read-only review of the repository, with the 14 October try's private records as evidence, and then the changes it
called for in the code. No model, Qloo or Codex request was made; the suite ran with Chrome.

**What the records showed.**
- The pair's two sessions metered 49.2 and 37.1 Kiro credits and the prediction 1.1, about 87 a try; both arms reached
  95% of their context window (`contextUsagePercentage` in the streams' metadata events). The largest stream line was a
  `design_capture` result of 950 KB: four captures at 1568 pixels, inlined as PNG.
- Every session's stderr held `[warn] failed to set model … Method not found`; the read probes of 6 October show
  `CONTENT_FILTERED` endings the try would have reported as "ended without freezing a prediction".

**What changed.**
- **The try's own day.** `TRY_DAILY_RUNS`, `TRY_DAILY_PAIRS` and `TRY_DAILY_CREDITS` can cap the server as a whole,
  whoever asks; all three are off by default, as decided for the jury's six members. `manager.usage()` and
  `/api/health/deep` (`try.day`, `try.limits`) say where the day stands either way. Each session's record keeps
  `credits`, `contextPeak` and `dropped` (stream lines too long to keep), a pair its `credits`, and the try page shows
  them per arm.
- **Smaller captures for the model on a hosted server:** 1024 pixels on the longer side (`MOUSA_CAPTURE_INLINE_SIDE`
  sets either environment's), in the engine, so every host's hosted run gets it.
- **The capture browser reaches only its own server:** `--proxy-bypass-list=<-loopback>;host:port` of the shots, so a
  page the model wrote cannot call another loopback port during its capture.
- **A content-filter ending is named** in `sessionProblem`.
- **`/api/health/deep` names the caller:** the address the limits key on and the `X-Forwarded-For` entries, for the
  check behind a proxy. `/api/status` says whether the Studio's jobs are open.
- **With `LEGACY_JOBS=off`,** `/mcp` and the job bridge answer 404 and workspace changes 403; the records stay readable.
- **A log** (`src/log.mjs`): text or JSON lines with the secrets redacted, a record per request by route pattern, and
  process-level handlers (a rejection is logged, an exception ends the process for Compose).
- **Retention:** `TRY_PRIVATE_RETENTION_DAYS` removes a finished try's Kiro homes and streams at start; a try the
  restart interrupted keeps them. **HSTS** is sent behind an HTTPS address.
- **A finished pair is refused again** even in the moment after its save when its lane still lists it.
- Repository: the Kiro lock file is ignored and untracked, `web/app.js` and `web/index.html` are LF in the working
  tree, `THIRD_PARTY_NOTICES.md` lists the fonts, photographs, music and the seccomp profile, and `.github/workflows/ci.yml`
  runs the suite on Ubuntu and Windows and rebuilds the plugin packages against their source.

**Automated:** `tests/hosted-profile.test.mjs` (capture side, route patterns, the log), two tests in `tests/try-flow.test.mjs`
(the recorded cost and the three daily caps; the retention at start), the deep health and closed routes in
`tests/try.test.mjs`, the bypass list in `tests/production.test.mjs` and dropped lines in `tests/kiro-output.test.mjs`.
The packages were rebuilt with `scripts/build-plugins.mjs`. The suite is 504/504 with Chrome, in 33 seconds.

**Not done here:** a try in the container, the AWS resources themselves, and the Kiro-specific questions (the key in the
agent file, the model warning, 2.31.0's behaviour), which wait for the first container run.

## Live Kiro try in real Kiro (L1–L3) — October 14, 2026

One try ran with `node scripts/run-try.mjs --starter blank-site --references "Paterson; Nujabes" --pair`.
- **Setup.** kiro-cli 2.24.0 with the local sign-in and no API key, `claude-opus-5.5` at medium effort, Chrome for the review captures.
- **The agent file loaded.** It loaded with the V2 tool settings and the V3 `permissions` block side by side, the absolute `file://` skill resources (whose path holds a space) and the MCP server's environment. Kiro's only message was `[warn] failed to set model … Method not found`, which is harmless: the agent file's model was used.
- **Step one: 35 seconds.**
  - The prediction session took 28.6 seconds and made three Moûsa calls: the plan, the font library and the frozen prediction, 48 entries across nine domains. It used no built-in tool.
  - The host then measured with 12 Qloo requests: 68 of the 69 measured works were not in the prediction.
- **Step two: 6.4 minutes.**
  - Both arms ran at once through every stage (reading, DNA, plan, check, captures, review rounds and report), in 25 and 23 calls of about six minutes each.
  - The distance was 0.60 (palette 0.41, type 0.88, sections 0.93, CSS features 0.26), with the same frozen prediction in both arms.
  - With Qloo, 7 of 7 devices rest on what the prediction did not contain. The design without Qloo kept the frozen sketch's notebook look; the one with Qloo left it for a dark, lamp-lit shop.
  - The try sent 12 Qloo requests in all. The arm with Qloo read the measurement again from the cache and asked nothing more.
- **Audit of the private streams.**
  - Every built-in read and write each arm made stayed in its own folder: two reads and five writes with Qloo, two reads and six writes without. Nothing was refused.
  - The streams came to 1.5 and 2.7 MB.

**Not shown:** Kiro 2.31.0, which the image installs, the API-key sign-in, and a try on the server.

**Published.** The operator's consent was recorded with `scripts/run-try.mjs --publish-run`, and the gallery rebuilt with it as its eleventh entry, `try-f8d19b29`. The scan was clean. The pair joins the blind vote, and its page reads "A live try, recorded". `scripts/verify-site.mjs` passed every page, the new entry's and its arms' included, and captured them at 1440 and 390 pixels.

**The container's captures with Chromium's sandbox.**
- `deploy/seccomp-chromium.json` is Docker's default seccomp profile with clone's namespace mask lifted and `unshare` and `chroot` allowed, written by `scripts/build-seccomp.mjs` (tested in `tests/seccomp.test.mjs`).
- Under it, the real Compose file with every capability dropped passed Chromium's test capture with its sandbox, and the image's healthcheck reported healthy.
- Inside the container a user namespace could be made, and a mount in it was still refused.

## Live Kiro try — October 14, 2026

`/try/` runs a juror's request in Kiro on the server, in two steps, behind `TRY_ACCESS_CODE`.
- **Step one.** The server plans the taste questions. A Kiro session with only Moûsa's tools and no Qloo key freezes the prediction. The server measures and writes the measurement report.
- **Step two.** Two arms get the same frozen prediction. One is locked to the measurement, read again from step one's cache, and the other to the prediction alone. A session designs in each, protected files are put back, and the comparison report is written.

**How the runs are kept.**
- A run lives in `DATA_DIR/try/<id>/` in the plugin comparisons' layout, so the reports and the gallery read it unchanged.
- Kiro's homes and the session streams stay in the run's private folders. The run's own record keeps each call by tool and outcome only.
- `scripts/run-try.mjs` runs the same steps without the site, and `build-gallery` adds a finished pair its juror agreed to publish.

**Automated, on a fake Kiro** that reads each agent file the try writes and serves Moûsa from that file's own environment, with the Qloo fixture (`tests/try-flow.test.mjs`, `tests/try.test.mjs`, 12 tests):
- **Step one end to end.** The prediction session has only Moûsa's tools and no Qloo key, in its server or in Kiro's environment. Every Qloo request is counted within the budget, and the report is a measurement's. The run keeps no tool title, key or code.
- **Step two end to end.** Both arms hold the one frozen prediction. The arm with Qloo made no new request and is the only one with the key. A tampered protected file is put back and an added one removed. The comparison has the same prediction in both arms.
- **A meddling prediction session.** One that planned again had the juror's plan put back. One that set the baseline had it set aside. One that froze nothing failed with that reason.
- **The run's limits.**
  - The hourly limit per address, a paused try and a closed try (no code) are refused.
  - Cancelling works both while a step waits and while it works.
  - After a restart, an interrupted step is marked as such.
- **The guard's patterns** for the three starters.
- **The pages and files.**
  - No script on any page, and the access cookie (signed, HttpOnly, SameSite=Lax, twelve hours, ended by a new code, ten wrong codes an hour).
  - Posts from another site are refused.
  - Report files come only from the run's report folders. The designs play only from the preview origin by the run's token, never a hidden file.
  - The API never gives the token.
- **Publishing.** Only a finished pair is published, only with consent. It joins the gallery as a Kiro comparison with its three sessions as lanes. The scan blocks a path to the tries' folder.
- Six parallel runs of both files passed, after the run's saves were made sequential: two arms saving at once had failed a rename on Windows once.

**After an independent review of the try's code**, these were changed and tested:
- **One Qloo budget per try.** A try's Qloo requests are counted in step one's `usage.json` whichever folder or workspace sends them, through the engine's new `MOUSA_QLOO_USAGE_FILE`. A `qloo_query` whose workspace does not resolve, or on a server that caps its requests, is refused. Before, it went to Qloo uncounted.
- **The image's starters.** The image left out Ramble's `data/` (a later `**/data` rule won), so its walks would have been missing on the server. The rule is overridden now. A starter that lacks what it protects is left out of the try, with the reason in `/api/health/deep`.
- **Bounded queues.** At most six first steps and three pairs wait. An address keeps at most two first steps and one pair waiting or working, and new runs stop below 2 GB of free disk.
- **Building the pair.** Two quick posts queue the pair once. A finished pair is not built again, and a failed save puts the run back as it was.
- **Stopping a session.** A stopped session ends its whole process tree: `taskkill /T` on Windows, its process group elsewhere, then SIGKILL. It is let go if it does not end. One arm that fails stops the other.
- **Records.** A record being written reads as missing rather than failing the page. An unreadable `meta.json` is skipped at start, and an agent file a stopped session left, which names the key, is removed.
- **Kiro's rules.** The agent's refusal rules come before its allowances. The arms' file tools are also denied, by absolute path, the run's other folders: step one's records, the other arm, the run's record, homes and streams.
- **Smaller fixes.** The access limiter counts an IPv6 address by its /64 and stays bounded, and a stream file stops at 32 MB.
- The full suite is 496/496 with Chrome.
- The pages were captured at 1440 and 390 pixels through a cookie proxy and read: the request page, step one's measurement, a pair at work (arms first, step one folded) and a finished pair.

**Not shown yet** (L1–L3, each needs approval):
- that real kiro-cli 2.24 loads the try's agent file: the V2 tool settings with their V3 permissions, the absolute `file://` skill resources and the MCP server's environment;
- the time and credits of a real prediction session and of a real pair;
- a container's Kiro and browser (phase E).

## Kiro power package — October 14, 2026

`plugins/kiro` is now a Kiro power in the Agent Plugins 1.0.0 format, where it was a CLI agent template. It holds:
- `plugin.json`, with only the closed schema's fields, `name` `mousa`, version 0.6.0 and seven keywords;
- `mcp.json`: a stdio server, `node ${PLUGIN_ROOT}/server/mousa.mjs`, with `${VAR}` references for the key, the endpoint, the project folder and the budget;
- the server, the four skills, the font library, the licence and a README;
- `PRIVACY.md`, linked from the README beside a support line, as the power registry asks;
- the CLI agent and its prompt.

A power runs no hook, so there is no gate.

**The project folder.** The server starts in the power's own folder, so it could not tell the project.
- **Roots.** It now reads the folders the client opened, over MCP `roots/list`, when the client declares roots. A folder the person names with `mousa_open_project` comes before them.
- **The stdio loop.** It still answers the client's requests in order. It now takes the answers to its own requests at once, since the tool call that asks for the roots waits inside the loop.

**The CLI agent.** It keeps the 2.x fields that ran on kiro-cli 2.24.0. It adds the V3 `permissions` block (MCP allowed; `.env`, `.kiro/` and `.mousa/` writes denied; shell denied), since V3 skips a 2.x agent without one.

**Automated.**
- Two tests in `tests/build-plugins.test.mjs`:
  - the power's manifest and name rule, its MCP server, its skills' names, its privacy and support lines, and the agent's two sets of fields;
  - the power's server started as Kiro would start it, with unset `${VAR}` references. It took its project from the root it was given, asked once and again after `notifications/roots/list_changed`, and gave way to a folder the person named.
- The Kiro package is now compared file by file with its sources like the other two.
- The suite is 478/478 with Chrome.

**Not shown yet** (live check L1, which needs approval):
- that Kiro's IDE or CLI loads the power;
- that either one sends roots;
- that V3 accepts the agent's `permissions` block as written.

## Blind vote — October 14, 2026

The site's `/vote/` page shows the two designs of one comparison as Left and Right, two captures each, and asks one question per medium. The pool is the three Long Dusk comparisons named in `gallery.config.json`.

The local Studio was started on `data/`. Its ballot page asked "Which character would this audience rather play?" for the Hollow Knight, Spirited Away, Sigur Rós, Nujabes and Paterson audience. It showed the pose and walk captures of both arms, with no script.

**Automated.** Four tests in `tests/votes.test.mjs`:
- **Sealing.** An altered token, one sealed under another key and an expired one open nothing. The token holds nothing readable.
- **Counting.**
  - a ballot counts once, also after a restart;
  - an address votes once a day on a pair and 30 times an hour, and draws at most 240 ballots an hour;
  - the least-voted pair comes first;
  - the record keeps no address.
- **Arithmetic.** The address comes from `X-Forwarded-For` only when trusted, and the Wilson interval matches its formula.
- **The pages on a Studio.**
  - a blind page that names no capture file;
  - two pictures by sealed token that differ;
  - a vote from another origin refused;
  - the page after the vote naming the side that was made with Qloo;
  - a second cast refused, and the results counted.

The suite is 477/477 with Chrome.

Limits:
- No vote has been cast by anyone yet.
- Both designs are public in the gallery, so a voter who looks them up first is not blind.
- The results page says so.

## Public site and gallery — October 14, 2026

[`scripts/build-gallery.mjs`](../scripts/build-gallery.mjs) built `data/gallery/` from the ten entries of [`scripts/gallery.config.json`](../scripts/gallery.config.json):
- three Long Dusk comparisons;
- Wax & Wane in Claude Code and in Codex;
- the Ramble and Lanterna restyles;
- the two single Long Dusk sessions;
- the October 6 Kiro Ramble run.

Codex's first Lanterna try, superseded by its second, was left out. The gallery is 89.5 MB, and no request was made.

**The scan.**
- **The first build was refused.** The Kiro run's copy carried its 0.4 records (`culture-dna.json`, `culture-reading.json`, `culture-taste.json`), which hold Qloo ids and tag URNs. The scan found six of them, so `gallery.json` was not written. Those files are now left out of every copy.
- **The second build was clean,** and so was `--check` afterwards.

**A Studio on that data** was started on port 8797. [`scripts/verify-site.mjs`](../scripts/verify-site.mjs) then checked 18 pages: the landing page, the gallery, ten session pages and six arm pages.
- **Every page passed:** status 200, no script tag, a policy with `default-src 'none'` and no `script-src`, and no local path.
- **Pictures.** It captured them at 1440 and 390 pixels with Chrome. It also captured the 13 playable designs from the preview origin: the games with their title cards (the Codex portraits among them), both Wax & Wane sites, both Ramble apps and Lanterna.

**Seen in the captures and fixed:**
- **Lanterna.** It played without its styles or fonts: Vite writes `/assets/…`, and its public fonts sit at `/fonts/…`, which miss when it plays from a gallery folder. Root-relative URLs to a copy's own files are now made relative. Lanterna then played as built.
- **The gallery's cards.** They were lazy-loaded, so the full-page picture showed them blank. They now use a 640-pixel copy of each card, loaded at once.
- **Text.** The install and reproduce commands were cut off, and they now wrap. The commit label showed the hash in capitals.

**The session pages** frame each design from the preview origin. They show the report, and the timeline shows what the agent did, lane by lane. In the Claude Code Long Dusk comparison, the timeline shows:
- the two subagents starting six seconds apart;
- a `design_validate dna` the validator refused (`TASTE_PROTOCOL_INVALID`) and the save that followed;
- the closing `design_compare` at 11:28.

**Automated:**
- Five tests in `tests/gallery.test.mjs`:
  - the timeline keeps no path, command or model text from a Claude Code, Codex or Kiro stream;
  - copies keep web types only, and root URLs are rebased;
  - the scan's patterns;
  - a fixture run built into an entry, and the same run with a local path blocked;
  - gallery URLs that step out.
- Three tests in `tests/site-routes.test.mjs`:
  - the landing page at `/` and the Studio at `/studio`;
  - script-free pages and their policies;
  - report files from the app origin and the design only from the preview origin;
  - the Studio at `/` without a gallery.
- Suite 473/473 with Chrome.

Limits:
- Windows and Chrome only.
- The site was not served through Caddy or on two real domains.
- `/try/` says the live try is not open yet.

## Taste Provenance reports — October 14, 2026

The surface is now 0.6.0, with a thirteenth tool, `design_report`. It writes one page from a design's records, which a reader can follow without the JSON:
- the frozen prediction and sketch, beside what Qloo measured, each measured name marked new or predicted;
- the reading and each DNA device, with its anchors, tokens, method and check;
- the last round's captures, the review's verdicts and repairs, and the limits.

Its other parts:
- **The comparison page** pairs two arms' captures by view and sets their devices side by side, layer by layer.
- **The shared distance.** The distance moved into `design/pair.mjs`, so `design_compare` and the page give the same number.
- **`scripts/build-report.mjs`** writes the page for a recorded run, including the October 6 Kiro session's 0.4 `culture-*.json` files.

No model or Qloo request was made.

**The recorded runs.** Reports were written into `output/reports/` for the ten complete live runs in `D:/mousa-live` and the October 6 Kiro Ramble run. Three of them are comparisons, written as six arm reports and three comparison pages. The run folders were not changed.

| Run | Headline | Page height |
| --- | --- | --- |
| Long Dusk compare, Claude Code | distance 0.53; with Qloo 9 of 9 devices on what the prediction did not contain, without 7 on the prediction | 8,041 px |
| Long Dusk compare, Codex | distance 0.57; 7 of 7 with Qloo; 6 on the prediction without | 7,005 px |
| Long Dusk compare with portraits, Codex | distance 0.58; 5 of 5 with Qloo; each arm's portrait is in its device card | 6,938 px |
| Long Dusk, Claude Code and Codex | 9 of 9 and 6 of 6 | 11,316 and 8,128 px |
| Wax & Wane, Claude Code and Codex | 8 of 8 and 7 of 7 | 12,517 and 10,897 px |
| Ramble restyle, Claude Code | 8 of 8 | 11,020 px |
| Lanterna restyle, Codex (both tries) | 6 of 6 each | 11,785 and 10,973 px |
| Ramble, Kiro, 0.4 surface | 7 of 7, counted again from its taste input | 10,443 px |

Checked by eye, from captures taken with Chrome at 1280 pixels:
- the Claude Code Long Dusk arm and comparison;
- the Kiro Ramble page;
- the Codex Wax & Wane, Ramble, Lanterna and portrait-pair cards.

What the pages showed:
- **The order.** The result comes right after the headline, then the prediction, the measurement in the Taste Brief's own order, the reading, the DNA cards, the departure from the sketch, the `taste_ask` questions with the agent's guess first, the review and the check.
- **Names only.** A scan of each `record.json` and page found no Qloo id, tag URN, affinity, popularity or description. The word "affinity" appears only in the limits.

**Fixed while checking:**
- Lazy-loaded captures came out blank in the full-page picture.
- A comparison written with `--out` removed the arm reports inside its folder.
- A URN or a path swallowed the full stop or comma after it, and a path with a space was cut at the space.
- The page named the report's own Moûsa version as if it were the session's. It now names it only as the writer.

**One engine behaviour the page now shows.** The prediction match is liberal on purpose, which only lowers what counts as new. In the Claude Code Long Dusk arm, the game "Journey" was matched by the series "Kino's Journey". The prediction card now says what each entry matched, such as "Journey: matched Kino's Journey (TV)".

**Automated.**
- Six tests in `tests/mousa-report.test.mjs`:
  - a full session's page and record, with names only, no script and embedded fonts;
  - a comparison with `design_compare`'s distance, and the script's `--out` layout;
  - a measurement before any design;
  - the text scrubbing and the answer lists;
  - the 0.4 records;
  - a real-browser picture past the 3,200-pixel capture height (`maxHeight` on `captureShots`).
- The suite is 465/465 with `MOUSA_BROWSER` set to Chrome, run outside the tool sandbox. Headless Edge 155 exits at once on this machine, so with Edge the three older browser tests fail and four skip.

Limits:
- Windows and Chrome only.
- The pages have not been viewed on a phone.
- No live session has called `design_report` yet; the reports above were written from recorded runs.

## Live game comparisons in both hosts — October 13, 2026

The game test as the Studio ran it: Ilo designed with Qloo and without it, from one frozen prediction. This time it ran through the plugins' `compare` skill, one session per host, both at the same time on copies of `examples/long-dusk`.
- **Invoking the skill.** The skill is explicit-only: `/mousa:compare` on the Claude Code command line, and `$mousa:compare` in the Codex prompt. Codex names a plugin's skills with its namespace, so the Codex prompts of all four skills now say `$mousa:<skill>`.
- **The request.** The Studio's brief (`scripts/briefs/long-dusk-compare-*.md`).
- **Pictures.** On in Codex, as the person allowed for this run, and off in Claude Code. The game gained a place for one: an optional title-card portrait in the character file.
- **The records.** They are in `D:/mousa-live/claude-code-long-dusk-compare-1/` and `D:/mousa-live/codex-long-dusk-compare-1/`, each with `compare/with-qloo` and `compare/without-qloo`.

Built for it, before the runs (commit 83e507c):
- **`design_compare({ prepare: true })`.** It copies the starter into both arms' folders, fonts included. Claude Code had no shell in these runs and cannot copy a binary file.
- **A data distance for game arms.** It compares palettes, part ids and the words of the text, from the files the two arms changed differently. The website distance reads pages and stylesheets, which two game arms share unchanged, so it would have put them close to 0 apart.
- **The play page.** It sets `window.captureReady` before its first await, so a capture waits for the portrait.
- **The Claude Code launcher.** It passes a slash command on the command line before the flags, allows `Agent`, runs in `dontAsk` mode and keeps subagents in the foreground.

What happened:
- **Both hosts followed the skill's order.**
  1. They prepared both folders.
  2. They planned both arms with the same arguments.
  3. They froze one prediction in both arms (`samePrediction: true`).
  4. They locked the baseline arm before any measurement.
  5. They measured once: 16 Qloo requests each.
- **Claude Code** gave the arms to `mousa:mousa-baseline` and `mousa:mousa-designer`. The two subagents started six seconds apart and ran at the same time; the baseline took 8 minutes and the Qloo arm 10.5. The session took 11.9 minutes, at an API-equivalent $5.51 on the person's plan.
  - **Qloo arm.** A grown lamplighter with a readable face and a half-smile, in a mended plum coat and a woven sash, with a felt cap bent back like a snuffed wick. Spare tapers ride on the back, and a rose-gold cup-lamp is held at the chest. The moment is drawn in watercolour, with petals and pagoda towers.
    - The lines speak to Maren: "You have kept this road alone long enough."
    - 9 of 9 devices rest on what the prediction did not contain.
    - Round 2 met 5 of 6 criteria.
  - **Baseline arm.** It stayed close to the frozen sketch: a small indigo hooded figure with a pale mask-like face and a tall hooked pole with an amber lantern, drawn in ink with snow.
    - The lines are terse and mostly to themself.
    - Round 2 met 2 criteria and partly met 3.
    - Its mask face echoes Hollow Knight, which its own prediction named. The Qloo arm moved away from it.
  - **Distance:** 0.526 (palette 0.192, part ids 0.84, words 0.75).
  - **Shell calls.** The subagents tried the shell five times, to run the game's validator. Each was refused in `dontAsk` mode, and they validated through captures instead.
- **Codex** built the baseline arm first, as the skill says, then measured and built the Qloo arm. The session took 6.8 minutes.
  - **Qloo arm.** A round sage-banded cap, a terracotta apron coat with a mended pocket, a sage scarf in the cliff wind and an oval lamp, drawn in cel. 7 of 7 devices rest on surprises, and round 1 met all 3 criteria.
  - **Baseline arm.** An indigo hood with a blunt peak and a brass lamp, drawn in ink. Its lamp merged with the legs in silhouette and was repaired in round 2.
  - **Distance:** 0.566 (palette 0.157, part ids 0.98, words 0.81).
  - **Pictures.** None. Codex's image tool was available to both arms, and neither plan chose a picture or the portrait slot. Each drew its imagery as the game's own render preset.
- **Both hosts.**
  - **Files.** Every arm wrote only its own `characters/ilo.json` inside its folder, and the starter outside the two folders is unchanged.
  - **Checks and facts.** Every check scored 1.0, and every Ilo passes the game's validator and keeps the canon.

Limits: one pair per host. The skill's own report says a single pair shows differences, not quality or preference; repeated pairs would be needed to isolate Qloo's effect.

**The same comparison in Codex, with portraits.** The request also asked each version for a title-card portrait made with Codex's image tool (`scripts/briefs/long-dusk-compare-portrait-codex.md`). It took 8.1 minutes, and the record is in `D:/mousa-live/codex-long-dusk-compare-2/`.
- **The flow.** It went as before:
  1. prepare;
  2. identical plans and one frozen prediction;
  3. the baseline arm locked and built first;
  4. one measurement of 16 requests, then the Qloo arm.
- **Pictures, made in the plugin's flow for the first time.** Each arm planned a `generated-image` step for its portrait. Codex's image tool was not exercised in the plugin before.
  1. Moûsa wrote the brief from the device: the subject, the device's art direction and palette, and no text, logos or copyrighted characters.
  2. Codex made the picture.
  3. The agent copied it from `$CODEX_HOME/generated_images/` into its arm's `generated/`.
  4. `image register` checked it: a 1254×1254 PNG in each arm, whose main colours fit the device's palette (2 of 5, and 3 of 6, within ΔE 22).
  5. The character file names it as `portrait`, and the captures of `index.html` show it on the title card.
  - **Codex's picture budget:** 2 pictures.
- **Baseline arm.** A pointed teal hood, a wind-worn split cape and an amber cage lantern. Its portrait shows the same figure above the cloud sea.
- **Qloo arm.** A low rounded plum hood with an open face, a coral wrap over a patched work coat and an ice-blue lantern. Its portrait shows the same figure on the cliff road under a violet dusk.
  - All 5 devices rest on surprises.
- **Distance:** 0.576 (palette 0.187, part ids 0.936, words 0.843).
- **Reviews.** Both arms met their criteria after repairs.
- **Before the run.** The picture brief in a workspace now names the file from the project root, says where Codex keeps its pictures, and says to register with the same workspace (commit ce34915).

## Live game character sessions in both hosts — October 13, 2026

The Studio's game test ran through the packaged plugins, one session per host. Both sessions started at the same time, each on a copy of the new example, `examples/long-dusk`.
- **The example.** It is built from `game/` by `scripts/build-game-example.mjs`:
  - the playable moment, with Ilo as the plain grey mannequin;
  - the review page, which draws the view the URL fragment names;
  - `FORMAT.md`, the game's format guide;
  - the interface fonts.
- **The request.** The Studio's brief, `scripts/briefs/long-dusk.md`: Hollow Knight, Spirited Away, Sigur Rós, Nujabes and Paterson.
- **The conditions.** `MOUSA_QLOO_BUDGET=24`, and no pictures. The game tools of the Studio, such as painting the figure, are not part of the plugin.
- **The records.** They are in `D:/mousa-live/claude-code-long-dusk-1/` and `D:/mousa-live/codex-long-dusk-1/`.

Built for it, before the runs (commit 461c3e8):
- **A game medium.** Palette, motion and voice are required. Typography is optional in the frozen sketch and in the DNA, because a game's type belongs to its interface. Before this, both would have had to name a font the character file has no field for.
- **Medium choice.** A plan with the game recipe designs in the game medium, though the game is played in a page. Its check reads the character file and does not ask the interface's custom properties for the palette.
- **Captures.** `design_capture` waits for `window.captureReady`, and a rejection fails the capture with the game's own message, such as "The name is a fixed fact". `target` goes into the URL fragment, so `capture.html#walk` draws the walk cycle.

What happened:
- **The same measurement in both hosts.** Each made 14 requests and got 60 works. The required anchors were Atmospheric, Melancholic, Love, RiME, It's Such a Beautiful Day and Elliott Smith, close to the Studio pairs of October 5 (Atmospheric, Melancholic, Love, RiME). The predictions had named 3 and 2 of the 60 works.
- **The plans.** Both planned the game recipe with all five references as audience seeds and no location. Both froze a sketch with no font, made of part ids.
- **Claude Code** (2.1.284, claude-opus-5-5): 8.4 minutes and 47 turns, at an API-equivalent $2.40.
  - **The design.** A slight young lamplighter in a hand-knit moss cardigan, an oat knit cap with a bobbing pompom and a satchel with a notebook. Ilo carries a long brass lamplighter's pole with a peach lantern on its hook. The moment is drawn in ink, at a plum snow dusk with ruined towers.
  - **The DNA.** 9 devices.
  - **The review.** Round 1 met 2 criteria and partly met 2: the lantern swung too far and two coat tails read as extra legs; the ink preset lifted the dusk too pale. Round 2 met 3, and the dusk was still partly met.
- **Codex** (0.162.0-alpha.17.2): 4.4 minutes.
  - **The design.** Ilo in plum workcloth with a folded storm collar, a short apron with one pale repair, a flat wool cap and an enamel lamp. The moment is drawn in ink, with fireflies over a grey dusk.
  - **The DNA.** 6 devices.
  - **Validation.** Codex also checked the file with the game's own validator, through `node` and `src/format.js`.
  - **The review.** One audited round, with all 4 criteria met.
- **Both hosts.**
  - **Files.** Each wrote only `characters/ilo.json`, which passes the game's strict validator. The engine, the world, the keeper and the pages are unchanged.
  - **Check and captures.** The check scored 1.0, and every capture was a view of the review page by its target.
  - **Facts.** The lines keep the canon: the bridge where the last lamplighter turned back, and the three cold winters.
- **One snag in both.** Each first named the page's own views (pose, walk) as plan review views and was refused with "Use a capture view: frame." The refusal now says that such a view is the capture's target and belongs in the criterion's look, and `medium-game.md` says so too.

Limits: one session per host; no Qloo off arm; no painted figure, since painting is a Studio game tool and pictures were off.

## Live restyles of existing projects — October 13, 2026

Two sessions restyled copies of the repository's examples in their own design systems, with the packaged plugins. Both ran outside the repository: the launchers copy the project with `--from` and record which files changed. Both ran with `MOUSA_QLOO_BUDGET=24` and with pictures off (`MOUSA_IMAGES=off`), so no picture was made on the person's plan.

**Ramble in Claude Code.** [`scripts/run-claude-code-live.mjs`](../scripts/run-claude-code-live.mjs) ran Claude Code 2.1.284 (claude-opus-5-5).
- **The project.** A copy of `examples/mobile-app`, an app with design tokens.
- **The request.** The one from the October 6 Kiro run ([`scripts/briefs/ramble.md`](../scripts/briefs/ramble.md)).
- **The run.** It ended normally after 51 turns and 5.1 minutes. The record is in `D:/mousa-live/claude-code-ramble-1/`.

What happened:
- **Plan.** The app-ui recipe with the three references and no location, 9 domains. Port Calder is fictional, and the taste-brief skill now says a fictional place is not a location.
- **Measurement.** 14 requests returned 69 works, and the prediction had named 5 of them.
  - **Required anchors:** Intimate, Atmospheric, Love, Glass Beams, Gururi no koto and Forever.
  - **One caution:** Minimalist is carried mostly by brands.
- **Against the sketch.** The frozen sketch was warm cream with moss and terracotta, set in Fraunces, Cabin and Courier Prime, with drifting clouds. The DNA was valid at the first save, with 8 devices.
  - **New:** five colours (linen grey, lamp black and one dusk blue), three families (Instrument Serif, Alegreya Sans and DM Mono) and four ids.
  - **Kept from the sketch:** its contact-sheet idea, now anchored to Gururi no koto and Forever.
- **In the system it has.**
  - **Tokens.** The session changed the values of the tokens in `tokens/tokens.json` and `tokens/tokens.css` and kept every name. The two files still agree, and it added one token, `font.mono`.
  - **Pages and styles.** It restyled `styles.css`. It added a drawing, a viewfinder and a contact sheet to `index.html`.
  - **Script.** `app.js` gained a `reveal` argument for the stop's develop effect. Every id `app.js` uses, and every id of the original page, is still there.
  - **Unchanged:** `data/walks.json`, `serve.mjs` and the README.
- **Facts.** The copy takes its facts from the data, such as "4 routes of 40 to 70 minutes". The drawing of the city shows places the walks name: the canal, the bell tower, the glasshouse and the harbour light.
- **Check and review.** The check scored 1.0 at the first run. Both reviews were audited, with 3 captures, all returned in the results.
  - **Round 1:** 3 criteria met and 2 partly met. The mono filter chips wrapped onto two lines, and the reveal played on load, so the capture caught the stop blurred. Both were repaired.
  - **Round 2:** all 5 met.
- **Qloo in total:** 14 requests, within the budget of 24. Its one shell command was refused, because the run allowed no shell, and it made the change with Edit.

**Lanterna in Codex.** [`scripts/run-codex-live.mjs`](../scripts/run-codex-live.mjs) ran Codex CLI 0.162.0-alpha.17.2.
- **The project.** A copy of the new Tailwind example, `examples/tailwind-site`: a Vite 8 and Tailwind CSS 4.3 site of a fictional Lisbon cinema in a starter template's look.
- **Before the session.** The launcher ran `npm ci` in the copy, because the sandbox has no network.
- **The request.** [`scripts/briefs/lanterna.md`](../scripts/briefs/lanterna.md): people who love the films of Wong Kar-wai, the music of Cocteau Twins and the photographs of Saul Leiter.
- **The run.** It ended normally after 3.6 minutes, and the plugin was removed afterwards. The record is in `D:/mousa-live/codex-lanterna-1/`.

What happened:
- **Measurement.** The web recipe, with no location. 14 requests returned 70 works, and the prediction had named 3 of them.
  - **Required anchors:** Intimate, Character driven, Thoughtful, Shut Up and Play the Piano, The Path and Hope Sandoval & The Warm Inventions.
  - **Cautions:** Eclectic, Minimalist and Clean Lines are carried mostly by brands.
- **Against the sketch.** The sketch was a dark burgundy page with amber window art in Cormorant Garamond. The DNA has 6 devices:
  - deep blue, ticket yellow, a pale blue and paper white;
  - Instrument Serif and Libre Franklin;
  - an abstract window of light drawn as inline SVG;
  - a numbered programme.
- **The theme.** It kept the theme's names, gave `brand` and `brand-dark` new values, and added `ticket`, `mist` and `paper`. It built with `npm run build` inside the sandbox and captured the build with `design_capture({ root: 'dist' })`.
- **Facts.** `src/screenings.js` is unchanged. Every price, day, time and the address are kept, and the copy adds no fact.
- **Review.** One round, 4 criteria met, audited.
- **Qloo in total:** 14 requests, within the budget of 24.

Findings from the Codex run, and what changed:
- **The font check read paths literally.** The agent fetched the fonts into `public/fonts` and loaded them as `/fonts/…`, which is right for Vite. The check wanted the literal `fonts/<file>` and reported both families missing. Through four checks the agent moved the fonts to `fonts/`, then to `src/fonts/`, and read the plugin's source to find out why. Since fixed:
  - **Matching.** The check matches the file name.
  - **Paths.** The plugin follows each URL from the stylesheet that holds it. A URL from the site root reaches the project, `public/` and `static/`.
  - **Reports.** A URL that reaches no file is reported with the path it tried.
  - **Fetching.** `materials fetch` takes the `stylesheet` and writes the rules' URLs from it.
- **The styling left Tailwind's classes.** The page passed the theme check through a few classes and `var(--color-…)`, but most of its styling became a stylesheet of new class names. Hand-written declarations went from 0 to 312, and class names from 195 to 54. Since fixed:
  - **The record.** The prediction freeze now records how the project styles itself (`.mousa/design/start.json`).
  - **The check.** `design_check` returns `style`. When a Tailwind project gains more than 40 hand-written declarations, it adds a note and a next step to move the styling back into the classes. Replayed on this run's files, the note fires.
  - **The skill.** The design skill says to restyle a Tailwind project through its theme and classes.
- **Files written from the shell.** The agent wrote `index.html`, `src/main.js` and `src/style.css` with PowerShell rather than `apply_patch`, so Moûsa's write gate could not see those writes. They came after the DNA was valid, so nothing early was written. The design skill now asks for the host's editing tools.

Limits: one session per project, both on Windows. No Qloo off arm was run, and Claude Code's gate was again not exercised, because no write came early.

**Lanterna in Codex again, with the fixes.** The same request, launcher and conditions ran again in a new copy, `D:/mousa-live/codex-lanterna-2/`. It ended normally after 5.1 minutes, and the plugin was removed afterwards.
- **Measurement.** 13 requests returned the same 70 works and the same six required anchors as the first run.
- **The design.** A blue-hour page: deep blue, citron and ember on paper, set in Cormorant Garamond and Libre Franklin, with an original window of evening light drawn as inline SVG.
- **Fonts.** The agent fetched them with `directory: "public/fonts"` and `stylesheet: "src/style.css"`, and pasted the rules, which load `/fonts/…`, as they came. The fonts passed at the first check, and every URL reaches its file.
- **In Tailwind's way.**
  - **The theme.** It changed `brand` and `brand-dark` and added `ink`, `paper` and `ember`.
  - **The styling.** Hand-written declarations went from 0 to 4, against 312 in the first run, and the classes from 195 to 346. No style note fired.
- **Files.** It wrote them with `apply_patch`, so Moûsa's gate saw every write.
- **Facts.** It kept every id `main.js` selects and every fact, and `src/screenings.js` is unchanged.
- **Check and review.**
  - **Check.** 0.917 at the first run, then 1.0.
  - **Review.** One round, audited, with every criterion met. The agent also checked the filters and the form with a script of its own.
- **One more gap.** At the first check, the motion device was partly met: "@keyframes light-arrival is defined but no animation uses it". The agent had defined the animation in Tailwind's `@theme` form, which the check did not read, and rewrote it as an `@utility`. Since fixed:
  - **Theme animations.** The Tailwind adapter now reads the theme's animations: `--animate-*` in Tailwind 4, and `animation` and `keyframes` in a Tailwind 3 config.
  - **Classes.** It counts a theme animation that an `animate-*` class or an arbitrary `animate-[…]` names.
  - **Reduced motion.** It counts `motion-reduce:` and `motion-safe:` classes.
  - **Endless loops.** An endless theme animation asks for a pause control.
  - **The replay.** On this run's files, the theme form scores 1.0, and so does the form as built.

## Live Codex sessions with the packaged plugin — October 13, 2026

[`scripts/run-codex-live.mjs`](../scripts/run-codex-live.mjs) ran the Claude Code session's brief in Codex (CLI 0.162.0-alpha.17.2, the default model).
- **The plugin.** It was installed from this repository's marketplace for the run and removed afterwards.
- **The session.** Each run used `codex exec`:
  - with the person's `config.toml` ignored, and only Moûsa's marketplace and plugin named with `-c`;
  - with a workspace-write sandbox, and Moûsa's write gate trusted for that run only;
  - with the Qloo key from `.env` and `MOUSA_QLOO_BUDGET=24`.
- **The records.** They are in `D:/mousa-live/codex-wax-and-wane-1/` to `-3/` and `D:/mousa-live/codex-gate-check/`.

1. **No sandbox.** With the person's config ignored, Codex had no Windows sandbox mode, so it refused every shell command. Codex reads skills with a shell command, so the skills did not load, and the agent stopped and said why. No Qloo request was made. The script now passes the person's sandbox mode by name (`windows.sandbox="elevated"`).
2. **No approval.** Codex asks a person to approve each Moûsa tool that reaches the network, and `codex exec` cannot ask, so `taste_profile` was refused. The agent then asked whether to enable the tool or design without measurement, rather than go on alone. No Qloo request was made. The script now approves Moûsa's tools for the run, and the Codex package's README says how.
3. **The full session,** 5.1 minutes:
   - **Skills and setup.** It read `taste-brief`, `design` and the DNA reference with shell commands, checked the setup, planned, and froze its prediction.
   - **First measurement.** It measured with "Moda, Istanbul". The new early stop held this to 5 requests, and the brief said to try "Istanbul".
   - **A re-plan that lost its references.** It planned again with only the location, the plan lost its references, and the next measurement was refused before any request. Since fixed: a plan made again keeps the fields it is not given.
   - **Second measurement.** With "Istanbul" it made 11 new requests. They returned the same 80 works, 18 qualities and six required anchors as the Claude Code session: Intimate, Emotional, Friendship, Pretty Boys, Leonard Cohen and Fleabag. The prediction had named 1 of the 80 works.
   - **Qloo in total:** 16 requests, within the budget of 24.
   - **Reading and DNA.**
     - The reading was valid at the first save, with 3 clusters.
     - The DNA was valid at the second save: 7 devices, all anchored to surprises and 6 to qualities.
     - Against the sketch it brought 2 new colours, Fraunces and Libre Franklin, and 3 new section ids.
   - **The plan:** 7 steps and no generated picture. The imagery was drawn as inline SVG, so Codex's image tool was not exercised.
   - **The build.** It was written with `apply_patch` after the plan. The check scored 1.0 at the first run.
   - **The review.** 3 captures came back in the result, and all three criteria were met in round 1.
   - **Facts.** All six facts were kept and no claim was invented. This run's skills already had the invent-no-fact rule.
4. **The gate.** A project at stage "measured" was asked to create `index.html` with `apply_patch`. Codex answered "Command blocked by PreToolUse hook: Moûsa: the design in this project is at stage "measured", before a valid Design DNA, so its files wait…", and no file was written. Moûsa's gate runs in Codex and reads the absolute paths a patch names.

**The two hosts.** Both measured the same audience to the same result, and they designed it differently:
- **Claude Code** built a dark, lamp-lit page in a condensed serif, with close-up record crops.
- **Codex** built a light, peach-paper page in plum ink, set in Fraunces, with drawn sleeves.

Both anchor the palette and the type to the measured qualities. With one session per host, this shows that the plugin works in both, not which design is better.

## Live Claude Code session with the packaged plugin — October 13, 2026

[`scripts/run-claude-code-live.mjs`](../scripts/run-claude-code-live.mjs) ran one headless Claude Code session (2.1.284, claude-opus-5-5) with `plugins/claude-code` loaded for that session only, through `--plugin-dir`.
- **Where.** An empty folder outside the repository.
- **Environment.** The Qloo key from `.env`, and Codex pictures off.
- **The brief.** A one-page site for Wax & Wane, a record shop in Moda, Istanbul, for people who love Paterson and Nujabes, with six fixed facts.
- **The run.** It ended normally after 47 turns and 6 minutes, at $1.88.
- **The record.** The brief, the stream, a summary, the project and its captures are kept outside the repository, in `D:/mousa-live/claude-code-wax-and-wane-1/`.

What happened, in order:

- **Setup and trigger.** The agent loaded `mousa:taste-brief` on reading the brief, and `mousa_status` found Qloo connected from the environment.
- **Plan and prediction.** It planned the web recipe with a location (10 domains), looked up fonts, and froze its prediction and sketch.
- **First measurement, empty.** It passed the location as "Moda, Kadıköy, Istanbul", and every one of the 12 Insights answers came back empty. The profile was `insufficient`, after 16 requests. Its attempt to read the evidence through Bash was refused, because the run allowed no shell.
- **Second measurement.** It planned again with "Istanbul", and its frozen prediction still fitted.
  - **Requests.** 12 new requests; 2 searches came from the cache.
  - **What came back.** 80 works in 9 domains, 18 qualities, 8 surface tags and 8 tone tags. The style ranking returned none.
  - **Against the prediction.** None of the 80 works had been predicted.
  - **Cautions.** The brief flagged Minimalist and Clean Lines as carried mostly by brands.
- **Reading and DNA,** each valid at the first save.
  - **The reading:** 4 clusters, with 4 refs set aside.
  - **The DNA:** 8 devices across all eight layers, all anchored to surprises and 6 to qualities. The required anchors were Intimate, Emotional, Friendship, Pretty Boys, Leonard Cohen and Fleabag.
  - **Against the sketch:** 4 new colours, 2 new families (Instrument Serif and Alegreya Sans) and 4 new section ids.
- **Plan and build.**
  - **The plan:** 8 steps (css-palette, library-font, css-art, css-layout, inline-svg, css-motion, copy and interaction-script) and 5 review criteria.
  - **The build:** it fetched the two fonts and wrote `index.html`, `styles.css` and `script.js`.
  - **The gate:** it held nothing, because every write came after the DNA was valid.
- **Check.** Score 1.0 at the third check. Every device was present, and each colour and font was held by a custom property in use.
- **Review.** 11 captures over two rounds, all returned in the tool results, so both reviews were audited.
  - **Round 1:** 3 criteria met and 2 partly met (a tangled still life, and a two-chairs section that did not read as seats). Both were repaired.
  - **Round 2:** 4 met and 1 partly met (a capture crop).

Findings, and what changed:

- **An address Qloo cannot match empties the whole pass.** The first measurement's 16 requests went to it, and with them the run made 28 requests, 4 more than the 24 it was approved for. The plan now warns about a full address. A measurement now stops once the first answers weighted by a place all come back empty, and its caution and next step name the city.
- **The voice invented two facts.** The page kept all six facts, but it added "Free, no sign-up" to the Thursday session and "two pairs of headphones" to the listening corner. The design skill and its references now say: invent no fact.
- **Not shown:** that Claude Code runs the plugin's PreToolUse gate. The stream records only another plugin's SessionStart hook, and the agent never wrote early.

Limits: one session and one brief, on Windows with Claude Code 2.1.284 and the person's other plugins installed. No Qloo off arm was run.

## Showcase for reviewers — October 6, 2026

The [showcase](development-notes.md#showcase) was set with `scripts/build-showcase.mjs --sites=dfc72570-5a8a-4615-9e91-5968da7c8745 --app=2026-10-06T10-20-02-669Z`: the Gather comparison below and the standalone Ramble run. It built `data/showcase/app/ramble-2026-10-06/` from 24 files of the run and the starter and a record of its artifacts. No character pair is showcased yet. No request was made.

- **Automated.** Six tests in `tests/showcase.test.mjs` and one in `tests/export-hosted-jobs.test.mjs`: which entries load and which are left out with a note; with a token set, `/api/showcase`, the showcased records and their diffs open without it, while other records, the pair list, the workspaces, cancellation and new jobs return 401; the preview serves the app run's listed files under its sandboxed policy and 404 for `record.json`, `.kiro`, `..`, unlisted types and other folders; the build copies only the web files, the fonts and the listed captures; the export carries only what the Studio serves. Suite 382/382 (319 + 63).
- **Local Studio**, restarted as "studio-production-runs" and captured with headless Edge at 1440 and 390 pixels. A plain address opened the Gather comparison with its "Showcase · recorded October 6" badge, kept the address plain and left the workspace unopened. The App interface tab played both phones from the preview origin, with the redesign's fonts and its walk list read from `data/walks.json`; the board and the eight review captures loaded. Leaving the tab unloaded both phones, arrow keys moved across the three tabs, and the Game character view was unchanged. The console showed no error from the pages.
- **Hosted-like Studio.** `export-hosted-jobs.mjs --showcase` (82 files, 9.4 MB) served as `DATA_DIR` with `MOUSA_ENVIRONMENT=hosted` and a test token given to that process only. Without the token: the showcase, the comparison, its diff, the app's page, data and captures returned 200; the pair list, the workspace, cancellation and a new job returned 401; the sites view opened the comparison with no error, and the App interface view played. With a painterly pair (cca96cad) added to that copy's showcase, the Game character view opened it without the token, labelled "Showcase · Recorded with local image generation", and played the scene. The copy and the test token were removed.

Limits: Windows and Edge only; the Docker image was not built, and the showcase was not viewed on a phone.

## Live site pair with the production stages — October 6, 2026

The first live website comparison with the stages (job dfc72570) rebuilt Gather, the local-food starter, with the brief and audience of the October 4 pair (Nujabes and the film Paterson). It reused that pair's recorded profile (job 18449ebd), so it made no Qloo request and differs from it only by the stages. Both arms had the same capability list, with Codex pictures (up to 8) and captures by Microsoft Edge, and claude-opus-5.5. The Studio ran with the 15-minute run limit for the stages; the local `.env` pins 10 minutes, and the Qloo on arm needed about 10.6 minutes of model time besides 5 minutes of picture generation, during which the deadline pauses.

| | Qloo off | Qloo on |
| --- | --- | --- |
| Reading | 3 clusters: Lunch-break notebook; Warm loop; Faded plain goods; 2 set aside | 3 clusters: Atmospheric dusk; Reflective, deadpan register; Sculptural identity on the shelf; 4 set aside |
| DNA | 8 devices on predicted qualities | 8 devices, 7 on refs it had not predicted, all translating measured qualities |
| Plan | CSS palette, library fonts, copy, CSS motion, inline SVG, an interaction script, library photos, 6 generated pictures | CSS palette, library fonts, CSS motion, inline SVG, CSS layout, library photos, 6 generated pictures, copy |
| Build | warm paper, a turning record with a fig label, a seven-day route; Literata, Courier Prime and Caveat | a fog-blue night, a line-drawn shopfront with one amber window, numbered shelf cards; Instrument Serif, Alegreya Sans and DM Mono |
| Review | round 1: 2 met, 3 partly; round 2: 5 met | round 1: 2 met, 3 partly; round 2: 4 met, 1 partly, and the site changed again after that review |

- Every capture the reviews cited was opened with the read tool (8 of 8 and 6 of 6). The round-1 repairs were about timing and measure: animations still running when the page settled, a line drawing that did not complete, a headline too long on the phone, a lamp glow that pulsed too bright and product pictures that pushed the price below the first screen.
- Each arm used all 6 of its pictures. Conformance was 1 in both arms.
- The overall distance was 0.499 (palette 0.385, typography 0.75, structure 0.714, features 0.179), against 0.491 for the October 4 pair without the stages. The two sites share 10 of 104 sentences word for word.

Limits: one pair, one profile and one model. The distance is a heuristic and says nothing about which site an audience prefers.

## Standalone plugin run on the mobile app example — October 6, 2026

[`scripts/run-mobile-example-live.mjs`](../scripts/run-mobile-example-live.mjs) ran the example's own Kiro agent once, outside the Studio, in a copy of Ramble (`examples/mobile-app-run-2026-10-06T10-20-02-669Z`). It used kiro-cli 2.24.0 and claude-opus-5.5, and the README's request: "Redesign Ramble for visitors who love Studio Ghibli films, Khruangbin and the photographs of Vivian Maier." The session ended normally after 21 minutes. Its record is in `output/mobile-app-run/2026-10-06T10-20-02-669Z/`.

What the agent did through the plugin's tools:

- **Capabilities.** The app-ui list offered 33 font families, inline SVG, CSS art, motion, copy, Codex pictures (4) and capture, and no photos.
- **Taste.** After its prediction, the Qloo pass returned 46 measured entities, 18 shared qualities and 4 measured tags, none of them predicted.
- **Reading.** 3 clusters (Expressive, bright, romantic warmth; Coastal bohemian, vintage prints, made by hand; Passionate, compassionate journey) and 1 ref set aside.
- **DNA.** 7 devices, valid at the seventh validation: sunset inks, a fat-face type pair, a harbour sun print, ferry-ticket cards, a stamped journey route, stamp motion and a passionate voice.
- **Plan.** Design tokens, two library fonts (Rozha One and Bricolage Grotesque, fetched with their OFL files), inline SVG for the print, screen layout, CSS motion and copy. It planned no generated picture, though Codex was available.
- **Build.** It changed `index.html`, `styles.css`, both token files and `app.js`, and left `data/walks.json` and `serve.mjs` as they were.
- **Review.** Two rounds of four captures, the board and three phone screens. Round 1 had 3 met and 2 partly: the sea was multiplied into a dark field, and a phone capture landed 34 px short while smooth scrolling ran. Both were repaired. Round 2 had 4 met and 1 partly, the visited stamp, which a capture at the first stop cannot show. The session record shows all 8 cited captures opened with the read tool.

Kiro in the folder:

- The MCP server started from the agent's relative path (`node ../../plugin/server/index.mjs` with `MOUSA_PROJECT_DIR=.`), and the skill files loaded from theirs.
- The write tool created and edited files (11 creations, 12 edits) without an approval in a run without prompts, under `allowedPaths: ['./**']`. No write aimed at a denied path, so the write deny list is still untested.
- A read of `.kiro/prompts/mousa-designer.md` was rejected as forbidden by `.kiro/**`, and the agent read the data file again on its own.
- `--model claude-opus-5.5` only warned "failed to set model 'claude-opus-5.5': Method not found". The script names the model in the copy's agent file, and the session record shows claude-opus-5.5.

Limits: one run and one request, on Windows with kiro-cli 2.24.0. No Qloo off baseline was run, and Claude Code was not tried.

## Live character pair with painterly references — October 6, 2026

The earlier pairs reused a profile whose strongest render style was Pixel Art, and that pixel figure looked worse than the other arm's ink figure. Pair cca96cad (pair-20261006-101229-cca96cad) therefore named other references in the default brief's text: Ori and the Blind Forest, GRIS, Okami, Spirited Away and Sigur Rós. A watcher was ready to cancel the pair before its arms ran if the new profile's strongest render style was still pixel. Each arm could paint twice and had no portraits, and a painting froze only the figure.

The fresh taste pass made 17 Qloo requests: 104 measured entities and tags and 18 shared qualities. The measured games were INSIDE, RiME, The Unfinished Swan, Never Alone, Owlboy, ABZU, Eastward, Night in the Woods, LIMBO and Fez. The strongest render style was "minimalist" (flat, score 3.4: The Unfinished Swan, LIMBO, Fez), ahead of Pixel Art (2.54: Owlboy, Eastward, Fez), so the pair ran.

| | Qloo off | Qloo on |
| --- | --- | --- |
| Reading | 3 clusters over 14 refs: Melancholy road; Dreamy painted dusk; Peaceful wanderer; 1 set aside | 3 clusters over 17 refs: Colorful playful whimsy; Minimal, nostalgic atmosphere; Loyal, heartfelt intimacy; 6 set aside |
| DNA | 10 devices on its own predicted qualities | 10 devices, all on measured refs it had not predicted |
| Plan | painted-rig with a count of 2 for the costume, vector rig, rig motion, lines, engine scene, library track | the same methods |
| Painting | after round 1: 12 pieces in the watercolor technique, 63 seconds | after round 1, flat technique: the first came back without one piece, the second painted 11 pieces in 72 seconds |
| Review | round 1: 4 met, 1 partly; round 2, painted: 4 met, 1 partly | round 1: 3 met, 2 partly; round 2, painted: 4 met, 1 partly |
| Moment | watercolor, motes, spire beacons, "Piano Jams" | flat, petals, stone beacons, "Ocean Deep" |

- Both sketches had predicted a watercolor frame. The Qloo off arm kept it, and the Qloo on arm drew the frame flat from the measured style; its character moved 86% from its sketch against 28% for Qloo off.
- The overall distance was 0.569 (character 0.424, moment 0.837).
- Every capture both reviews cited was opened in the session. Neither arm saved the character again after its last review.
- The open criteria after round 2 were both in the figure. The Qloo off scarf hangs short behind the cape, and its length is cloth, frozen with the painting. On the Qloo on figure, light shapes of a shin piece show below the boot; a repaint would fix it, but the failed first painting had used one of the plan's two.

Limits: one pair and one model. The comparison's distance does not measure the painting, and no player judged the two figures.

## Live character pair with the production stages — October 6, 2026

The first live pair to use the [production stages](development-notes.md#universal-production-protocol) ran from the Studio's Game character tab with the default brief, claude-opus-5.5 and the recorded taste profile of pair-20261004-232241 (job 3b9d6e6a), so it made no Qloo request. Both arms were offered the same capability list: one portrait and one painting of the figure, neither required, and reviews captured by Microsoft Edge.

The first attempt (job 54ba8fb4) exposed a host fault. The Qloo off arm opened its four round-one captures in one read, and Kiro echoed their 2.5 MB of PNG bytes on its output as a JSON array, about 9 MB in one line. The game host capped Kiro's whole output at 6 MB and stopped the run there, so the arm left no review and never painted, though it counted as completed because its character had been saved. The Qloo on arm's captures were smaller and it finished two rounds. The Studio's own cap was 4 MB, so a site review would have failed the same way. Both hosts now read Kiro's output through [`src/kiro-output.mjs`](../src/kiro-output.mjs), which skips any line over 1 MB and keeps an overall limit of 256 MB against a runaway session. They also read kiro-cli 2.24's event format, whose updates sit under `data.update`, so tool titles reach the event log for the first time, and a pair now warns when Kiro stops before an arm's session ends.

The second attempt (job ab925e19, pair-20261006-075541-ab925e19) ran every stage in both arms, in 728 and 749 seconds:

| | Qloo off | Qloo on |
| --- | --- | --- |
| Reading | 3 clusters over 15 refs: Melancholy glow at dusk; Dreamy, rounded, hand-drawn wonder; Peaceful everyday ritual | 4 clusters over 17 refs: Somber atmosphere; Plain-spoken love; Drawn-thin figure; Pixel wanderers; 4 refs set aside |
| DNA | 10 devices on its own predicted qualities | 9 of 10 devices on measured refs it had not predicted, after one rejection for keeping its sketched track |
| Plan | vector rig, painting for the costume, rig motion, lines, engine scene, library track | vector rig, rig motion, lines, engine scene, library track; no generator |
| Pictures | one Codex painting of 12 pieces in the ink technique, 69 seconds | none |
| Review | round 1: 3 met, 2 partly; round 2, painted: 4 met, 1 partly | round 1: 2 met, 3 partly; round 2: 4 met, 1 partly |
| Moment | ink and paper, motes, pagoda beacons, "Piano Jams" | pixel art from the measured art style Pixel Art, snow, ruin beacons, "White_beach" |

- The host audit found every capture each review cited among the read tool's calls in the session record, in both arms. Each arm had one review rejected for a repair note that was too short, and saved it again.
- The overall distance was 0.512 (character 0.396, moment 0.727), against 0.475 for the earlier pair on the same profile without the stages (6da85aa8). Against each arm's frozen sketch, the Qloo on character moved 77% and the Qloo off character 34%.
- Neither arm chose a portrait. In both attempts the Qloo off arm chose to paint its costume and the Qloo on arm chose no generator, so the painted look is now part of what separates the two characters; the comparison records it as a production difference.
- Conformance was 1 in both arms. The first attempt's pair stays in the Studio, with its Qloo off arm unreviewed.

Limits: one complete pair, one profile, one model, Windows only. The comparison's distance does not measure the painting.

Why the Qloo on arms did not paint: their session records say so. The first wrote that "painting would freeze the character entirely and block repairs across review rounds, and nothing in the study requires it", and the second skipped it as "risky since repairs can't trigger a second painting within the same run". Both Qloo off arms took the risk, and the second's painting moved the boots above the leg wraps, a defect its last review named but could not repair. The prompt had placed the painting before the first review, and a Studio pair allowed one painting. Now the painting comes between the review rounds, so round 1 repairs the vector drawing, and Studio allows each character a second painting, which the host accepts only after the review of the painted figure. A third pair then ran with this order (job 25c09b41, pair-20261006-090639-25c09b41, same profile, painting up to twice and no portraits). Both arms planned painted-rig with a count of 2 and painted once after round 1: the Qloo off figure in the ink technique (12 pieces, 73 seconds) and the Qloo on figure in the pixel technique (17 pieces, 57 seconds), the first live pixel painting, which came back as pixel art on its grid rather than a mosaic. Both round-2 reviews ended at 3 met and 2 partly, all cited captures opened. Neither arm repainted: their open criteria were the sky's colour, ash that is hard to see in a still and raised arms against a dark pillar, which a painting cannot change, and painting had frozen the scene fields with the drawing. A painting now freezes only the figure, so such criteria stay repairable in `character.json`. The plans now made every layer by the same methods; the overall distance was 0.485 (character 0.347, moment 0.741), and the Qloo on character moved 90% from its sketch against 6% for Qloo off.

## Kiro's read tool in a review session — October 6, 2026

[`scripts/verify-kiro-review-read-live.mjs`](../scripts/verify-kiro-review-read-live.mjs) ran short paid Kiro sessions with claude-opus-5.5 and the read settings the hosts write, outside any Studio or game run. A small MCP server saved two 480×270 screenshots into `review/`, each showing one random word, and the other files held random markers. Nine sessions ran, eight with kiro-cli 2.24.0 (the hosts' `KIRO_CLI_PATH`) and one with 2.27.1; the longest took 37 seconds. The records are in `output/kiro-read-probe/`.

What Kiro did:

- In all five sessions that got past the first turn, both versions opened both screenshots as images, by the relative path a host returns and by an absolute path, and the model named both words correctly.
- The session record names the tool `FileRead`, with `{operations:[{mode:'Image', paths:[…]}]}`. When the next MCP call arrived, the hosts' audit already found both reads, 8 to 15 ms into the call, so its second look after 1.5 seconds is only a margin.
- A file denied by its absolute path, as the hosts deny files, and one denied by a `**/` pattern, as the example agent denies `**/.env`, were rejected as forbidden (one session, 2.24.0).
- A read outside the working folder failed because "tool permission approval is not supported in non-interactive mode" (four sessions, both versions).
- `allowedPaths` did not narrow the tool: a file inside the working folder that no setting named opened (four sessions, both versions). The session state listed the working folder as readable.
- The session went on after each refusal.

What it means: the read tool reaches its working folder minus the denied paths. In a Studio arm every other entry (`site`, `assets`, `kiro-home`, `.kiro`) is denied, so only `review/` opens; the other arm, the job record, `.env` and the credential folders lie outside the folder. A game arm's workspace also holds the arm's own design files, which the tool can open; its host files lie outside. The code comments that said the settings confine the tool to `review/` were corrected.

Kiro's content filter: asking for a list of reads that looked like a test of the tool's limits made Kiro stop the session with `CONTENT_FILTERED` (category CYBER). Four sessions stopped at the first turn, with or without the credential folders among the denied paths, and one stopped after a refused read, as the model went on to the denied files. The hosts' prompts ask only for the captures.

Limits: each behavior was seen in one to five sessions on Windows; Linux and the Docker image were not run. The denied-path result comes from one session.

## Universal production protocol — October 6, 2026

The [production stages](development-notes.md#universal-production-protocol) move the judgment between the taste input and the build to the designing model: a reading, a production plan chosen from the host's capability list and a review of captures. They were built in four steps and verified without a model, Qloo or Codex request.

What was built:

- **Plugin core.** `plugin/server/production/`: medium profiles (`web`, `app-ui`, `generic`, and the game's own), capability lists, validators for the reading, the plan and the review, the font library, capture over the DevTools pipe, project-scoped files and eight standalone MCP tools. The policy text ships as `production-policy.md`.
- **Game host.** The design server gates reading, DNA, plan, pictures, character, check, painting and `game_capture_review`; the capture page draws the pose, walk, scene and kindle views; the runner records each arm's reading, plan, review and audit.
- **Studio site host.** The same gates for taste-led site builds, captures of the saved site under the preview's own policy, the TASTE panel's Reading, Production plan and Self-review blocks, and the study setting "Both designers must generate images".
- **Hosted fallback and proof project.** A hosted server lists no image generator, a browser counts only after a start-up test capture, recorded local work is exported without Kiro homes or work folders, the Docker image carries the game, the libraries and Chromium, and `examples/mobile-app` runs the stages with the plugin alone.

Checks:

- The **360/360 automated tests passed** (299 Studio and plugin, 61 game); with the read probe's own tests the suite is now 364/364.
- Dry runs of a character pair and of a Studio site comparison went through the real design servers and gates with fixture sessions, with captures by the installed Microsoft Edge. The generated agent files point Kiro's read tool at each run's review folder and deny the host's own files.
- The files the Docker image copies were started on Windows as a hosted Studio without Kiro, a Qloo key or `.env`. It reported no image generator with the hosted reason, captured its test page with Edge, and served two exported recorded jobs: a website comparison with 14 Codex pictures and a character pair with 2 portraits, with their previews, pictures and game pages. The site form showed why no pictures are generated, the picture headings read "recorded with local image generation", and the pair was tagged "Recorded with local image generation". The only console errors were the missing favicon and the workspace of a job exported before workspaces were included.
- The previous image allowlist lacked `game/` and `library/`, which the server imports and serves, so the container would not have started. The Compose file validated with placeholder values.
- The mobile app starter rendered at the phone and board views through `culture_capture`, with its walks drawn from `data/walks.json` and its colors from the tokens.

Limits:

- No live run had used the stages when they were built; the first, a character pair, is recorded [above](#live-character-pair-with-the-production-stages--october-6-2026).
- The two Kiro behaviors the review assumed were then checked in [short live sessions](#kiros-read-tool-in-a-review-session--october-6-2026): the session record shows each read before the next tool call, but `toolsSettings.read` does not confine the read tool to `review/`; denied paths and the working folder do.
- Docker was not running, so the image, Chromium in the Linux container, its sandbox failure and the start-up test that detects it were not run. The example agent's relative paths worked in a later [standalone run](#standalone-plugin-run-on-the-mobile-app-example--october-6-2026); the Claude Code configuration was not tried.

## Painted characters — October 5, 2026

The art-direction pairs moved every layer of the design, but each figure was still the engine's rounded vector shapes, and the pixel frame only pixelated them. A spike tested whether Codex could paint a character that the rig can still move, and the [painted-character pipeline](development-notes.md#painted-characters) followed from it. The spike used four Codex images on the ChatGPT plan. Each was a non-interactive `codex exec --ignore-user-config` turn in an empty folder, as the portraits are, with the blueprint attached through `--image`, and each request's session folder was deleted afterwards. It made no Kiro run and no Qloo request. Its subject was the Qloo on character of [pair D](#live-pairs-with-art-direction--october-5-2026): a tall lamplighter in a sage coat with a funnel collar, a flat hat, a dusty-rose sash and a lantern.

| Attempt | What Codex was given | Time | Overlap of each cut piece with its blueprint | Result |
| --- | --- | --- | --- | --- |
| Free paint | A sentence for each of nine parts, and no picture | 68 s | not measured | A realistic head out of scale with the body, fitted to the bones by heuristics |
| Exact paint-over | The blueprint sheet of 15 pieces, painted inside every outline | 62 s | 0.81 to 0.96, median 0.90 | Painted texture on the vector construction |
| Paint-over with figure | The sheet with the standing figure; outlines may change by a fifth while the joints stay | 65 s | 0.39 to 0.93, median 0.79 | A first redesign |
| Redesign | As above, with a design sentence for each of 16 pieces | 56 s | 0.25 to 0.91, median 0.70 | A tailored coat with a cape collar, turned-back cuffs and brass buttons, a knotted sash, laced boots and a copper lantern |

Overlap is the intersection over union of a cut piece with its blueprint shape, so it measures how far the painter moved from the drawing, not how well the result moves. In the redesign the small pieces grew most: the hand and the sash knot came back at about 2.6 times their blueprint area, beyond the fifth the brief allowed, and still sat on their joints. Only the lantern's anchor drifted more than a quarter of its box, and the cut moved it back. On the unchanged rig, the painted character stood, walked and turned, and the sash, coat-tail and hair strips bent along their chains (contact sheet, sheet before and after, close-up, in the scene). The redesign is the approach the tool now uses.

The redesign was also read back on a pixel grid, with no new image. The painting showed no grid (line strength 1.01, where clean pixel art scores above 2), so the host set one from the figure's height: 20 sheet pixels a cell, 32 colours and a figure 47 picture pixels tall. The result was a mosaic that lost the face (close-up). A pixel character is therefore painted on a blueprint that is already drawn on the grid, and read back on that grid.

Records: `game/runs/spike-cutout/` keeps each attempt's prompt or brief, blueprint, layout, painted sheet and cut pieces, and `output/painted-character-spike/` keeps the captures.

What was built:

- **Skins.** `game/harness/skin.mjs` lays out the blueprint, writes the brief and cuts the painted sheet. The cut keys the background (or reads a transparent one), removes the magenta cast from edge pixels and gives each painted region to one piece. `game/harness/pixel.mjs` finds a painter's grid, reads one colour per cell and reduces the palette by median cut.
- **Engine.** The format accepts a `skin` naming pictures under `runs/<pair>/` with their rectangles, chains and tips. The loader preloads them, and the painter draws them on the bones in the drawing order. It shades the far limbs, bends strips along their chains and draws pixel art without smoothing.
- **Design server.** `game_paint_character` takes a style sentence of 20 to 400 characters and descriptions of 8 to 240. It is offered only in a painted arm and only after a check of the latest save. It refuses taste names, tool names and markup. It freezes the figure in `character.json`: the host records a fingerprint of the skeleton, parts, cloth, style and render it painted, and a later save that changes them is refused, while the scene, light, effects, motion, clips, lines and music can still change. The check lists the paintable pieces and the technique, and the prompt and policy add the step.
- **Runner and Studio.** `--paint` publishes `<arm>-skin-<piece>.png` and `<arm>-figure.png` beside the character. The record keeps the style, the descriptions, the host prompt, the time and the provider. The deadline pauses while Codex works. Studio's Pictures section has the paint checkbox, which needs Codex. The preview serves only the painted PNG names, the import script copies them and the record page shows the figure.

Checks:

- The **318/318 automated tests passed**. New: 13 painted-skin tests in `game/tests/skin.test.mjs`, 3 pixel tests in `game/tests/pixel.test.mjs`, a Codex edit test in `tests/image-generator.test.mjs`, and a painted-pair test with two validation cases in `tests/character-jobs.test.mjs`.
- `node game/harness/run-pair.mjs --dry-run --paint=1` played both arms through the real design server and paint tool. A fixture painter handed the blueprint back unpainted, so no request was made. Qloo off painted 14 pieces in its watercolour technique and Qloo on 11 in ink. The game loaded the published pieces, and the record showed each figure with a dry-run caption (record).
- After a Studio restart, the paint checkbox was enabled with Codex signed in, and the run note added one Codex image per character (form). The only console error was the missing favicon.

Limits:

- No live pair has painted yet. The model has not written a style sentence or piece descriptions; the spike's were written by hand from the character's DNA.
- One character was painted in one technique (lit gouache). The other seven technique sentences, and pixel art painted on a grid, have not been tried live.
- The painter keeps the joints by instruction, not by guarantee. The movement was judged by eye.
- The comparison measures still read the vector character file, so the painted look is not part of the design distance.
- Open sprite sets such as the Liberated Pixel Cup collection were not used. Their CC BY-SA and GPL licences keep the artists' rights and carry over to derived art, while the hackathon rules ask for original work solely owned by the entrant.

## Live pairs with art direction — October 5, 2026

Four live pairs ran in the Game character tab with the [moment's art direction](#art-direction-music-and-comparison-variants--october-5-2026), one per condition, after the user approved them. They were queued together through `POST /api/jobs` with the default Long Dusk brief, claude-opus-5.5 at medium effort and one Codex portrait per character. Three reused the recorded Hollow Knight profile of job 3b9d6e6a, read again from its responses, so they made no Qloo request. The fourth ran a new taste pass weighted toward Istanbul and ages 24 and younger (17 requests). All four completed, with eight Kiro runs of 6.3 to 9.3 minutes and eight portraits. All eight characters reached 100% DNA conformance, and every portrait shared at least two main colours with its figure. Four DNA saves were refused before a valid one: three Qloo on arms had kept their sketch's track and had to change it, and one Qloo off costume named more than six parts.

| Pair | Job | Arms and condition | Distance (character, moment) | Moved from sketch, figure · moment | First arm's moment | Second arm's moment |
| --- | --- | --- | --- | --- | --- | --- |
| A | 6da85aa8 | Qloo off · Qloo on, reused profile | 0.475 (0.329, 0.746) | 23% · 20%, then 73% · 86% | ink, fireflies, pagoda, "Piano Jams" | pixel art, ash, ruin, "White_beach" |
| B | 8df731ce | Qloo on · swapped contrast profile | 0.484 (0.384, 0.668) | 71% · 88%, then 84% · 90% | pixel art, motes, ruin, "White_beach" | cinematic, embers, ruin, "Ljosalfheimr IV" |
| C | 58e3c6ac | Qloo off · Qloo on, no departure rule | 0.303 (0.223, 0.451) | 16% · 22%, then 46% · 46% | ink, motes, spire, "Piano Jams" | pixel art, snow, spire, "Piano Jams" |
| D | dd7f8802 | Qloo off · Qloo on, Istanbul, 24 and younger | 0.383 (0.317, 0.506) | 31% · 44%, then 71% · 84% | ink, motes, spire, "Piano Jams" | cinematic, motes, spire, "White_beach" |

The render styles came from the data, as the protocol requires. All three Qloo on arms on the Hollow Knight profile drew in pixel art from its measured Pixel Art (Hyper Light Drifter, Eastward, Owlboy). The swapped arm drew cinematic from the contrast profile's Cinematic (Bayonetta 2, Shadow of the Colossus), and the located arm drew cinematic from Realistic (Death Stranding, Hellblade: Senua's Sacrifice, The Last of Us: Left Behind). All three Qloo off arms drew in ink from their own predicted "hand drawn" and played "Piano Jams" for their predicted "melancholic"; their sketches had named watercolour.

[`scripts/analyze-character-pairs.mjs --matrix`](../scripts/analyze-character-pairs.mjs) compared all eight characters from the saved records, with no request (report):

- **The same profile twice.** Pair A's and pair B's Qloo on arms read the same profile under the same rules and were 0.238 apart (character 0.255, moment 0.208). Both drew a tall figure (188 and 194 units) in pixel art, with ruin beacons and "White_beach".
- **Two profiles under one brief.** Pair B's arms were 0.484 apart, twice that, and their profiles shared 12 of 40 qualities and art styles and 19 of 140 works. The swapped arm drew a figure in a long scarlet coat with a pale half-mask and a cold cyan lantern; Qloo on drew an aubergine mantle under a wide flat hat.
- **Qloo off three times.** The three Qloo off characters were 0.155 to 0.25 apart (character 0.18 to 0.23, moment 0.04 to 0.30), although their prompts differed by the ablation and the audience line.
- **The moment carries the gap.** From Qloo off to Qloo on, the character part stayed near the earlier pairs: 0.329 in pair A, against 0.351 on average before art direction. The moment added the rest. Between the arms it was 0.73 to 0.75 apart, against 0.21 for Qloo on twice and 0.04 to 0.30 for Qloo off.
- **Ablation.** Without the departure rule, Qloo on moved 46% from its sketch, against 71% to 73% with it. It kept the sketch's small hooded figure and Qloo off's track. The measured Pixel Art still drew its frame, because the render rule is not a departure rule. The pair's distance, 0.303, sat within the Qloo off spread on the figure (0.223) and above it on the moment (0.451).
- **Place and age.** The located pass resolved the same five references. It shared only 5 of 154 works, 8 of 28 qualities and 3 of 13 art styles with the unlocated profile. Its games were Death Stranding, Devil May Cry 5, Hellblade, Genshin Impact and Monument Valley, where the unlocated profile had Hades, Death's Door, Shadow of the Colossus, Outer Wilds and INSIDE. Its strongest render style became Realistic, so its frame was cinematic.

The kindling lines followed the earlier pattern. On the Hollow Knight profile all three Qloo on lines hand the light over ("Here. Take it. It stayed warm the whole way up."), and every Qloo off line asks the beacon to wake. The swapped arm's line was "Wake up, Vesper. It's me. It's still me."

Pair D exposed a fault, fixed after the run. Its Qloo on music device rested on the aesthetic tag Classic Lines, which met the catalogue tag "classicalguitar" of "White_beach" on the first five letters alone. A close form must now also be within three letters in length, and a test covers the case. Pair D's track therefore rests on a false match. The other seven rest on Romantic, Melancholic or Epic, or on the arm's own predicted qualities.

Records: the contact sheet with the captures beside it, every pair's comparison page in the tab, and the four job folders. The **300/300 automated tests passed** after the fix.

Limits:

- One pair per condition, one brief and one model. Pairs A to C reused one recorded profile, so their repeats measure model variance under one profile.
- In the swap pair the brief still names the Hollow Knight audience while the second arm's data comes from another, so the comparison isolates the data, not the brief.
- The eight frame styles are treatments of one engine, and the music match reads catalogue words.
- Distance, departure and conformance are heuristics. They do not rate the characters or player preference.

## Art direction, music and comparison variants — October 5, 2026

The [six live pairs](#live-character-pairs-with-shared-qualities--october-5-2026) separated the finished characters, but everything around them stayed fixed: one sky, one weather, one beacon, one render style and no sound. The motion distance was 0.079, and the blind sketches already agreed before any data. Seven changes open more of the moment to the data. All of them are host-side and were first checked with fixtures, scripted sessions and replays of recorded responses; the [live pairs](#live-pairs-with-art-direction--october-5-2026) followed.

- **The moment's art direction.** Each character file now sets the moment too: a dusk sky (its top darker than its horizon), cloud and basalt colours, weather (fireflies, snow, rain, petals, leaves, embers, ash, motes or none), mist and the beacons' style (stone, spire, pagoda or ruin). It also sets the frame's render style and a track. The lore, layout and story beats stay fixed, and the validator refuses a scene that is not dusk or whose rock is not dark basalt. The sketch, frozen before any data, includes its moment. The DNA adds scene, render and music devices, and the scene device must anchor to a quality ref.
- **Render style from art styles.** The taste pass derives `art_style` entities from the works' `art_style` tags, as it derives qualities, with no extra request. An art style that names one of eight presets (lit, ink, watercolour, cel, pixel, neon, flat, cinematic) becomes a render style, ranked by the distinct works that carry it, weighted by affinity and domains. The strongest is a required anchor. The render device draws in the preset its anchor names, unless the DNA rejects that style with a reason; the next one that names a preset then draws. A predicted style that names the same preset counts as predicted.
- **An open music library.** `library/music` holds 20 Jamendo tracks under CC BY 3.0 (42.5 MB), and `catalog.json` keeps each track's title, artist, licence, source page and attribution. Both arms read the listing as `music.json`. A music device's qualities must share a word, or its first five letters, with the track's own genres or tags; catalogue words such as "music" or "films" never match. Like the palette, the device anchors to a quality first, a measured one in Qloo on, so the audience's shared qualities choose the track. Only when no measured quality meets a track may another measured ref's returned tags choose it. The game pages name the track, artist and licence and play it only when asked. The preview origin serves the catalogue and the listed files, in byte ranges.
- **Facts the model cannot guess.** A pair can name the audience's place and one to three age bands. They weight every taste request (`signal.location.query`, `signal.demographics.age`) and are stated to both arms as a fact of the brief. Gender is not offered, to keep a stereotype out of the design.
- **Profile swap.** A swap pair keeps the brief, the prompt and the protocol. The first arm designs from this brief's measured profile, the second from another pair's recorded one, so a difference between them comes from the data. The comparison reports how many qualities, art styles and works the two profiles share.
- **Departure ablation.** With the departure rule off in both arms, no device has to move away from its sketch. The policy, the prompt and the record say so, and the analysis script labels the protocol.
- **Portrait and character bound.** The host reads a portrait's main colours from the generated PNG: the background is set aside from the border, and the rest gathers into Lab clusters. The portrait tool returns them before the figure is drawn, and the conformance check counts the portrait as bound when at least two of them lie within CIE76 22 of a colour the figure shows. The portrait prompt states the figure's height in heads and its garments. Using the portrait itself as the in-game figure was left out: the engine animates a rigged vector figure, and a flat cutout could not walk, turn or kindle, nor pass the conformance checks.

A completed pair's profile can also be reused, with no Qloo request. A profile recorded before art styles is read again from its recorded responses with today's taste pass. Read this way, the Hollow Knight profile's strongest render style is Pixel Art (pixel), carried by Hyper Light Drifter, Eastward and Owlboy. The contrast profile's is Cinematic (1.66), just ahead of Cel (1.646). With art direction, the design distance weights the character at 65% and the moment at 35%; earlier pairs keep the character distance alone.

The checks found faults, which were fixed:

- The preview route returned a listed pair file without awaiting the read. A missing one, such as a swap pair's `qloo-off.json` or a portrait that was never painted, became an unhandled rejection, and the request stayed open. It is now a 404. Studio's close now also ends open connections.
- A pair that reused a profile wrote no `taste.json`, so it could not lend that profile again. It now keeps the profile with its source's responses.
- Profiles recorded before shared qualities, such as the imported first pair, are no longer offered for reuse or swap.
- The music device first only had to anchor to a measured ref. Read against the Hollow Knight profile, the first refs whose tags met a track were LA Kings, Tesla and Bose, through the words energy, electric and electronics: catalogue tags rather than the audience's taste. The device now anchors to a quality first. For that profile Melancholic, Atmospheric, Nostalgic and the aesthetic tag Romantic meet tracks. For the contrast profile, Energetic and Epic do too.
- Every character now sets its own sky, so the title card has a soft scrim, and its music credit sits on a panel.
- The swap message went to the wrong arm's log, and the data headline said "different data" for identical profiles.

Checks:

- The **300/300 automated tests passed**. New: 15 art-direction tests in `game/tests/art-direction.test.mjs`, 5 PNG and palette tests in `tests/image-colors.test.mjs`, 3 Studio tests (music route, swap and reuse, validation), the age bands in the Qloo client, and the portrait's figure line and palette.
- `node game/harness/run-pair.mjs --dry-run` played both arms through the real design server with no request. Qloo on drew in ink from the measured art style Hand-Drawn (five works), with embers, pagoda beacons and "Red Moonlight", whose tags carry the measured quality Energetic. Qloo off drew in watercolour from its own predicted Watercolor, with leaves, ruin beacons and "peaceful night". The distance was 0.601 (character 0.509, moment 0.771). Against their sketches, the characters moved 76% and 4% and the moments 92% and 7%. Both reached 100% conformance. These are hand-made samples, so the numbers show the pipeline, not an effect.
- Dry runs as a swap pair (`--swap-from=dry-run`), as an ablation (`--no-departure`) and with a place and age band (`--location`, `--age`) completed. The located pass sent both on every request.
- In the browser at 1280 by 720 pixels, the comparison page showed both moments and a Music button per arm with `aria-pressed`. Pressing one streamed the track with 206 responses, and the credits linked the track, the artist and the licence. The record showed each moment, where its render style came from, the music credits, separate bars for the character and the moment, and the ablation and audience lines. In Studio, the new fields worked: a reused profile disables place and age, and a swap pair needs a source. A temporary Studio with imported dry-run and dry swap pairs showed their summaries and played them; it and its data were removed afterwards. Screenshots.

Limits:

- These checks used fixtures, scripted sessions or replays; the live pairs are recorded above.
- Music matching reads catalogue words; nothing listens to the tracks.
- The eight render styles are treatments of one engine, not separate art.
- The contrast profile's render styles nearly tie, so a small change in the data could flip its frame from cinematic to cel.

## Live character pairs with shared qualities — October 5, 2026

Six live pairs ran in the [Game character tab](#game-character-tab-with-shared-qualities--october-5-2026) with shared qualities, using claude-opus-5.5 at medium effort and one Codex portrait per character. Two started from the tab's form (jobs 5ab49683 and e2aa0f9f). Four were queued together through `POST /api/jobs` (d0295c39, 45a0d143, 3b9d6e6a and 9abf0777). Five used the default Long Dusk brief, whose audience likes Hollow Knight, Spirited Away, Sigur Rós, Nujabes and the film Paterson. The sixth replaced that sentence with Jet Set Radio, Persona 5, the film Spider-Man: Into the Spider-Verse, Daft Punk and Kill la Kill. In all they made 102 Qloo requests, 12 Kiro runs of 5.2 to 8.4 minutes and 12 portraits, and every pair completed.

Two things changed during the runs:

- **Format guide.** After the first pair, the guide's cloth table names the fields a chain needs, including its fill. Counting the first live pair, three of the four arms before the change had saved a cloth chain without a fill. None of the ten arms after it had a save rejected.
- **Pair IDs.** The four queued pairs got the same pair ID, `pair-20261004-232241`, because the ID was a timestamp in seconds. Their records stayed apart in their job folders, and the preview route names the job, so nothing was overwritten. New pair IDs end in the job's prefix, and a test covers it. The analysis names each pair by its job.

Each Long Dusk taste pass made 17 requests and returned the same profile: 79 entities, eight style and eight aesthetic tags, and 18 qualities. The strongest were Atmospheric (11 works in four domains), Melancholic (14 works in four domains) and Love (five works in three domains). The required anchors were those three, then RiME, Invisible Waves and Sun Kil Moon. Each Qloo on prediction had contained two to four of the 18 qualities and none of the 16 tags.

| Pair | Job | Minutes, off · on | Distance | New against own sketch, off · on | Qloo on devices translating measured qualities |
| --- | --- | --- | --- | --- | --- |
| 1 | 5ab49683 | 6.6 · 6.2 | 0.385 | 10% · 71% | 6 of 8 |
| 2 | e2aa0f9f | 5.2 · 8.4 | 0.322 | 1% · 66% | 6 of 8 |
| 3 | d0295c39 | 5.4 · 6.6 | 0.334 | 8% · 62% | 7 of 8 |
| 4 | 45a0d143 | 6.0 · 6.7 | 0.377 | 14% · 80% | 6 of 8 |
| 5 | 3b9d6e6a | 5.8 · 6.6 | 0.350 | 8% · 71% | 7 of 8 |
| Contrast | 9abf0777 | 5.3 · 6.0 | 0.494 | 21% · 76% | 7 of 8 |

All twelve characters reached 100% DNA conformance. In every pair, all eight Qloo on devices rested on refs the model had not predicted, and all eight Qloo off devices translated its own predicted qualities.

[`scripts/analyze-character-pairs.mjs`](../scripts/analyze-character-pairs.mjs) compared the ten Long Dusk characters from their saved records, with no request (report). Qloo off characters from different pairs give the baseline-to-baseline variance. An exact permutation test over all 252 ways to label five of the ten as Qloo on gives 0.0079 as the smallest possible p.

| Finished characters | Overall | Palette | Silhouette | Motion | Signature | Voice | Light |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Between arms | 0.351 | 0.275 | 0.487 | 0.079 | 0.252 | 0.861 | 0.587 |
| Within Qloo off | 0.202 | 0.126 | 0.220 | 0.018 | 0.257 | 0.795 | 0.110 |
| Within Qloo on | 0.242 | 0.220 | 0.261 | 0.042 | 0.171 | 0.825 | 0.226 |
| p | 0.0079 | 0.0079 | 0.0079 | 0.0079 | 0.087 | 0.024 | 0.0079 |

The blind sketches, frozen before any data, were 0.183 apart between arms against 0.172 and 0.165 within (p = 0.091). They did not separate in palette (p = 0.44), planned elements (0.44) or light (0.68). They did in gait (p = 0.0079): the Qloo on sketches had a little more bounce (0.25–0.3 against 0.2) and arm swing. They also separated in proportions (p = 0.048, the smallest possible here), because all five Qloo on sketches gave 120 units and a head share of 0.32. Every sketch, in both arms, described a small hooded wanderer with a big head and an amber lantern.

- **Qloo off** kept that figure in all five pairs, 119 to 150 units tall, in slate wool with an amber light (#ffb86b to #ffc87a). It walked at speed 50 to 60 and cadence 1.6 to 1.8.
- **Qloo on** became a tall walker in all five, 168 to 172 units with a head share of 0.15 to 0.2. Its palette came from Atmospheric with Melancholic or Love: fog teals and greens, often with a rose accent. All five carried a coral or peach light (#ff9e86 to #ffc2a8), anchored to Love in four.
- **Motion.** The Qloo on walk came from the style tags Somber and Majestic. Its longer, level strides had speed 60 to 80, cadence 1.25 to 1.35, bounce 0.04 to 0.08 and arm swing 4 to 8, against 0.15 to 0.2 bounce and 10 to 18 swing in Qloo off. The motion distance still averages every gait, idle and turn parameter, so it stays small in absolute terms.
- **Kindling lines.** In four of five, the Qloo on line hands the light over: "Here. Take it. It's been warm in my hands the whole way." All five Qloo off lines tell the beacon to wake: "Wake, Vesper. Call the morning, the way you used to."

In the contrast pair, all five references resolved, and the pass returned 80 entities and 18 qualities. The strongest qualities were Minimalist (look), Emotional (mood) and Identity (meaning), and the aesthetic ranking led with Bold Colors and Bright Colors. Both blind sketches drew a skater kid in a red jacket. Qloo off kept it: a cel-shaded street kid in headphones, from its own rebellious youth, stylish swagger, Supreme and Jet Set Radio Future. It walked on the beat (cadence 2.8, bounce 0.75) with a yellow light, and its kindling line was "Three winters is a long nap, Vesper. Wake up and catch!" Qloo on drew a tall (205 units), dark hooded figure with a pale mask and magenta and cobalt accents, from Minimalist and Bold Colors. It walked with long, level steps (cadence 1.7, bounce 0.15) from the style tags Elegantly Composed, Sparse and Nocturnal, with a pink light from Atmospheric and Bright Colors. Its kindling line was "Wake. Remember what you were." Its required works were Shadow of the Colossus, the composer Kensuke Ushio and the film We Are the Strange, none predicted. Six works carry Minimalist: Playstation, Pepsi Nitro and Team Liquid Apparel (brands), Kensuke Ushio, Shadow of the Colossus and Furi.

Every pair played through the scripted moment in the comparison page for both arms without a game error. The stage at the start of the road, the stage while kindling and the walk cycle were captured for all seven live pairs. The records are the contact sheet (HTML), the captures beside it, and the tab's summary and stage for the first pair. The **275/275 automated tests passed** after the pair ID change.

Limits:

- One brief repeated five times, one contrast audience, one model and one world. The five Long Dusk passes returned the same profile, so the repeats measure model variance under one profile, not variance in Qloo's responses.
- Departure from the sketch is required of surprise-anchored devices, so part of the separation is enforced by the protocol. The attribution rests on the blind sketches being alike; they were, overall, but their gaits and proportions differed slightly before any data, where the two prompts differ only in the taste-source paragraph.
- A quality's rank counts every carrier's domain alike. Half the works behind the contrast pair's strongest look quality are brands, whose design tags describe logos and products, so a brand's look helped set that palette.
- Character distance is a token, outline and parameter heuristic. It does not rate the characters, their likeness to the audience's taste or player preference.

## Game character tab with shared qualities — October 5, 2026

The RPG character proof had been built in a separate session under `game/`: a fixed scene (The Long Dusk), an engine, a per-arm design server that enforces the session order, and a command-line pair runner. A review of that flow and its [first live pair](#live-character-pair--october-5-2026) found that the engine, the strict character validation and the order held. Both arms reached full conformance, and the Qloo on character moved away from its sketch. Six things were weak:

- The taste pass left out the `qualities` domain, so the typed tags were dropped. The required anchors were the highest-affinity surprise entities, and the Qloo on palette came from one hockey team's "Black And Silver Palette" tag, an entity collage with a trade-dress risk.
- One required anchor, Brave New World, had to be rejected because its returned tags were catalogue labels.
- `taste.json` kept no responses, so the pass could not be replayed.
- The motion distance between the characters was 0.10.
- The Kiro deadline kept running while Codex painted portraits, and the Kiro tool events never reached the run log.
- The game ran outside Studio, on its own server with absolute font URLs and a command-line runner only.

Changes:

- **Shared qualities.** The pair now lists `qualities` and treats `videogame` as its medium, so games take the first required work place. The character protocol follows the site rules: qualities are predicted blind, the palette and the silhouette anchor to quality refs (measured in Qloo on), and entities are evidence, never a source of their own colours, logo, costume or trade dress. Motion and costume fall back to a measured mood or look quality when a tag ranking returns none. The comparison adds how many devices translate qualities. The RPG harness, which had left `qualities` out ([earlier record](#shared-qualities-from-typed-tags--october-4-2026)), now lists it.
- **Records.** `taste.json` keeps every taste-pass response as an evidence record (Q001 onward), and `scripts/replay-taste-profile.mjs` accepts character jobs. A watcher forwards the design session's progress to the run log. The deadline pauses while a portrait is painted.
- **Studio.** A `character` job kind runs a pair on the single queue and records it under `data/<job>/<pair-id>/`. The preview origin serves `/game/<job>/<token>/` from an allowlist under its own sandbox CSP. A Game character tab beside Websites holds the world, the brief, references, portraits, live activity, qualities and the embedded comparison. `scripts/import-game-pair.mjs` copies a recorded pair into Studio.

Checks:

- The **274/274 automated tests passed**: 251 Studio and plugin tests, four of them new for the tab, and 23 game tests, five of them new. The new Studio tests cover a dry-run pair on the queue, the preview route's allowlist, CSP, token and refusals, request validation, cancellation and restart. The new game tests cover typed tags and anchors, the qualities-first rule and its fallbacks, a dry run with evidence, a cancelled pair, the session watcher and the paused deadline.
- `node game/harness/run-pair.mjs --dry-run` played both arms through the real design server with the fixture Qloo client and made no request. Its 15 fixture responses went through the real taste pass and gave nine qualities. The required anchors were Colorful, Playful and Craftsmanship, then a fixture game, film and brand. All seven Qloo on devices rested on surprises, and five of seven translated measured qualities; Qloo off translated its own predicted qualities in five of seven. The characters were 0.509 apart. Against their own sketches they moved 4% (off) and 76% (on), and both reached 100% conformance. `taste.json` held 15 evidence records.
- `node scripts/import-game-pair.mjs game/runs/pair-20261004-210303` imported the live pair as job `98870bb8`, and Studio was restarted. Its API returned the pair with its headline, metrics and an "Earlier protocol" note.
- In the browser at 1440 and 390 pixels, the tabs switched by click and arrow keys and kept the view in the URL. Leaving the tab unloaded the game frame. The embedded comparison played both characters with the bundled fonts and showed the earlier-protocol notice. Nothing overflowed horizontally at 390 pixels, and the only console error was the missing favicon.
- A temporary Studio on other ports, with the dry-run runner and a temporary data folder, ran a pair from the form. The run went from queued to completed with 16 live events from both sessions, showed nine quality chips in three families with the ranked tags, and the record traced each device to its qualities ("Look quality shared by 5 measured works in 4 domains, not predicted"). Stopping a second pair mid-run cancelled the job and the arm that had not started; the scripted stand-in ignores the stop signal, so the arm already running finished its script. The temporary Studio and its data were removed afterwards.
- The browser check found two display faults, which were fixed: the keeper's role printed as "keeper of the vesper beacon", and a quality chip read "1 domains".

Screenshots: the tab with the imported pair, its stage, 390 pixels, and a fixture pair's qualities and record.

Limits:

- When this check was made, no live character pair had run with shared qualities, so the qualities path was verified with fixtures only. The [live pairs](#live-character-pairs-with-shared-qualities--october-5-2026) followed.
- The standalone game server started earlier on port 8790 still runs the old code. The pages it serves miss their fonts until it is restarted.
- Distance, departure and conformance are heuristics. They do not rate the characters or player preference.

## Live character pair — October 5, 2026

The command-line runner made the first live pair just after midnight local time (`pair-20261004-210303`, named in UTC), before the character used shared qualities. It used claude-opus-5.5 at medium effort and one Codex portrait per character. The audience liked Hollow Knight, Spirited Away, Sigur Rós, Nujabes and the film Paterson, and all five resolved to entities. The taste pass made 17 requests and measured 79 entities, eight style tags and eight aesthetic tags. Of the entities, the Qloo on arm's frozen prediction contained three, and of the tags none.

Qloo off took 8.1 minutes and Qloo on 7.3. Qloo off had three saves rejected and corrected: a device description of the wrong length, an unsupported spring field and a cloth without a fill. Qloo on had one, also a cloth without a fill. Both characters reached 100% DNA conformance.

| | Qloo off | Qloo on |
| --- | --- | --- |
| Required anchors | Its own Muji, My Neighbor Totoro, Jónsi, Kafka on the Shore, Samurai Champloo and Journey | Neutral Milk Hotel, Anomalisa, Brave New World, LA Kings, Kiki's Delivery Service and the series Grimgar, Ashes and Illusions, none predicted; Brave New World rejected for catalogue-only tags |
| Character | A small, plush, bottom-heavy figure in undyed linen and ink-slate wool, raising a paper lantern on a pole | A tall black-and-silver folk wanderer in a pointed soft hat, with an accordion-pleated lantern and a silver-blue flame |
| Palette | From Muji and its own muted ink and ochre | From LA Kings' "Black And Silver Palette", Neutral Milk Hotel and the aesthetic tag Neutral Color Palettes |
| Motion | Its own slow contemplative pacing: cadence 1.6, arm swing 18, lean 4 | The style tags Majestic and Nautical, a slow rolling walk: cadence 1.3, arm swing 30, lean −2, more hip sway |
| Lines | "Wake up, Vesper. I carried this a long way for you." | "Wake now, Vesper. I carried this light the whole long road for you." |
| New against its own sketch | 4% | 68% |

All nine Qloo on devices rested on surprises, and none of the eight Qloo off devices did. The characters were 0.395 apart: palette 0.297, silhouette 0.584, motion 0.10, signature 0.239, voice 0.761 and light 1.0. The walk parameters moved little against their ranges, so the motion distance stays low. The kindling lines are close to each other: both wake Vesper and say Ilo carried the light for it. The pair is in Studio as an imported record.

Limits:

- One pair is an anecdote, not an effect beyond model variance.
- The Qloo on palette is a single entity's own colours, which the shared-qualities rules now forbid.
- The trial makes no quality or preference claim.

## Live Gather pair with shared qualities — October 4, 2026

`scripts/verify-taste-difference.mjs --run --pairs=1 --baseline-pairs=0` ran one Qloo on/off pair with the [shared qualities](#shared-qualities-from-typed-tags--october-4-2026). It used the Gather brief of the earlier trials (an audience that likes Nujabes and the film Paterson) and the same starter, photo and font libraries, Codex image tool and model (claude-opus-5.5, medium effort). The taste pass made 11 Qloo requests and returned 69 entities and 16 style and aesthetic tags. From their typed tags the host derived the same 18 qualities and six required anchors as the replay of the recorded pass: Atmospheric (look, 8 works), Reflective (mood, 8 works) and Identity (meaning, 4 works in three domains), then The Romantic Exiles, the Microphones and The 1st Shop of Coffee Prince. The Qloo on arm's frozen prediction (26 names, 10 style and aesthetic qualities, 5 shared qualities) contained 4 of the entities, 1 of the tags and 3 of the qualities: Minimalist, Nostalgic and Melancholic.

Qloo off took 9.9 minutes and Qloo on 9.6, each with seven generated images; Qloo on also used three library photos. Qloo off had one DNA save rejected for a fourth copy line in its voice device and corrected it; Qloo on had none. Both reached 100% DNA conformance, and no visitor page mentioned Qloo or Kiro. The records are the run report, the contact sheet (HTML), full-page screenshots of Qloo on and Qloo off, and the TASTE panel's qualities row and summary. The generated files were not edited.

| | Qloo off | Qloo on |
| --- | --- | --- |
| Required anchors | Its own melancholic, contemplative and everyday poetry, then Muji, Paterson and Nujabes | Atmospheric, Reflective and Identity, then The Romantic Exiles, the Microphones and The 1st Shop of Coffee Prince, none predicted |
| Concept | A producer's pocket notebook: one quiet week on warm paper, with a record turning on a rainy windowsill | A quiet, misty hillside pantry with three field-note frames and a table portrait |
| Palette | Warm paper, brown-black ink, amber and a slate dusk blue, from its own melancholic and muted earth tones | Mist grey, fog lilac, moss and an ember blush, from the measured qualities Atmospheric and Naturalistic |
| Type | Literata, Courier Prime and Caveat, its three sketch fonts, from its own everyday poetry and notebook paper | Instrument Serif, Alegreya Sans and DM Mono, all outside its sketch, from the measured quality Reflective |
| Motion | From its own "gentle looping cadence" and Nujabes: a record turning every 14 s, rain on a 6 s loop, 1.1 s rises | From the measured style tags Quiet and Pensive: fog drifting on 28 s and 36 s loops, contours drawn once, 0.9 s rises |
| SVG illustration | #svg-sill, 36 shapes: a record on a windowsill, from its own vinyl grain and rain on glass | #terrace-sculpture, 42 shapes: stacked terraces and an arched pergola, from the measured aesthetic tags Sculptural and Architectural Design |
| Voice and headline | From its own everyday poetry, Paterson and melancholic: "The same road every week. Something different ripens." | From the Microphones (Minimalist, Atmospheric, Experimental Folk): "Mist on the hills. Jars on the shelf." |
| Images | Seven generated dusk still lifes in sepia and slate | Seven generated, back-lit through morning mist (Atmospheric, Luminous), and three library photos for the field notes |
| New against its own sketch | 4%: no fonts, one of eight top colors, no sections | 72%: all fonts, half of top colors, four of six sections |

Six of the eight Qloo on devices translate measured qualities or tags, and all eight rest on refs the model did not predict. The other two rest on works through their tags: the field-note frames on The Romantic Exiles (Observational, Lyrical) and the voice on the Microphones. The table portrait, which reads the visitor's list as a sketch of who will sit at the table, rests on The 1st Shop of Coffee Prince (Character driven) and the quality Identity. Seven of the eight Qloo off devices translate qualities the model predicted, so both arms now build from qualities and differ in where those came from. LA Kings, the book Island and Anomalisa, which set the black-and-silver palette, the island and the night hotel of the earlier Gather pairs, were in this profile too, and none anchored a device. The overall token distance was 0.491, with typography 0.75, structure 0.75, palette 0.312 and CSS features 0.22. It is the lowest of the Gather pairs, mainly because both palettes are pale and muted: warm paper and amber against cool mist, lilac and moss.

The two sites share 13 of their 101 distinct sentences (12.9%), mostly interface labels and notices. Each arm rewrote 14 of the 16 starter lines and kept the search placeholder and the form button. Qloo off's voice writes things down ("Write it on the list", "Written down. It is on your sample list.", "Close the notebook"); Qloo on's keeps them ("Keep this one", "Kept. It is on your list now.", "What you kept"). Every product fact stayed as the starter had it. The TASTE panel listed the 18 measured qualities with their family, works and domains, marked the three required ones and Minimalist as predicted, and its summary added "6 of 8 Qloo on devices translate measured qualities; 7 of 8 Qloo off devices translate qualities the model predicted."

In the browser at 1440 pixels, both sites loaded every declared family from the library files and every image, and no text stayed hidden after scrolling. Their SVG illustrations had 36 shapes (Qloo off) and 42 (Qloo on), each with a text label. The pause button set `aria-pressed="true"`, stopped all eleven loops in Qloo off (the record and ten rain lines) and all three in Qloo on, and a second press resumed them. With `prefers-reduced-motion: reduce` at 375 pixels, nothing animated or transitioned and no text stayed hidden after scrolling. At 375 pixels neither site overflowed horizontally while scrolling. Search, category filtering and price sorting kept each product with its image, and the local wishlist worked with each arm's add message. Qloo on's table portrait changed from "Nothing kept yet. The table is still an open question." to "A table set for others. Plates passed hand to hand." after the olive oil and to "A long morning that turns, quietly, into lunch." after the fig jam. Neither site logged a console error or warning.

One correction followed the run. The narrative check counted a starter line as kept wherever its words appeared on the page, so the catalogue title "Products" counted inside the kept placeholder "Search products or ingredients". A line now counts only as whole text or whole sentences, however the markup splits it, and the narrative test covers both cases. The run report, written before the correction, records 13 of 16 rewritten in each arm. The earlier pairs keep their counts. The **247/247 automated tests passed**, and the RPG harness's 18 tests passed unchanged.

Limits:

- This is one pair, so the difference is an anecdote, not an effect beyond model variance.
- Both arms' palette and type must now translate qualities, so the rule shows where each arm's qualities came from, not that measured qualities make a better design. The departure from the sketch is still required of surprise-anchored devices.
- Three devices still rest on single works, although through their tags rather than as objects: the voice, the field-note frames and the table portrait.
- The mist band over Qloo on's hero photo fades only at its left and right ends, so its top and bottom edges show as a lighter strip across the picture.
- The trial makes no quality, preference or conversion claim.

## Shared qualities from typed tags — October 4, 2026

A review of every live run so far found that Qloo changed each design, but often as a literal collage of single entities: the ice hockey team LA Kings' "Black And Silver Palette" for a food shop, Anomalisa's keyword "Hotel" as a night hotel, and Unreal Engine's dark interface for a game site. The rules decided that the design moved; which entity moved it was chance. The recorded responses held more than the profile kept. Every returned work carries typed tags, and the profile had kept the first eight names without their types.

- **Qualities.** The new `qualities` domain, a Studio default, groups each work's typed tags into look, mood and meaning and leaves out catalogue metadata such as platforms and business models. It keeps each tag that two or more works carry as a quality ref, ranked by the summed affinity of those works times the number of domains they span ([details](qloo-integration.md#typed-tags-and-taste-qualities)). It costs no request. A work's own tags now lead with its look, mood and meaning, and the evidence record keeps every returned tag.
- **Prediction.** Both arms predict three to six qualities blind. A measured quality counts as predicted when a predicted quality of any kind shares a five-letter stem with it (Atmosphere and Atmospheric), which only lowers the surprise count. Works and ranked tags keep the stricter match.
- **Required anchors.** With qualities, three of the six are the strongest quality of each family and three are the works most central to the qualities, one domain at a time. A work's centrality is the summed score of the qualities it carries. The artifact's own medium takes the first work place, because films and TV carry more typed tags than games. Qloo off takes its first three predicted qualities and three predicted works. A selected direction's anchors are kept as they are.
- **Qualities first.** The palette and the typography devices each anchor to a quality ref: a shared quality or a style or aesthetic tag, a measured one in Qloo on. The prompt calls entities evidence of the qualities and forbids taking an entity's own colors, logo, packaging or trade dress. When a measured style or aesthetic ranking returns nothing, motion anchors to a measured mood quality and illustration to a measured look quality; all three Echo Atlas passes had returned no aesthetic tag.
- **Records.** `project_get_taste` and the TASTE panel show each quality's family, the number of works carrying it, their domains and three examples. A decision anchored to a quality cites the evidence records of the works behind it, and the comparison says how many devices in each arm translate qualities. Surprise qualities count for the sketch-departure rule like surprise entities.
- **Compatibility.** Callers that do not list `qualities` get the earlier behavior, including the RPG harness under `game/`, whose domains leave it out; its 18 tests pass unchanged. Jobs recorded before the change keep their prompts, anchors and headlines.

The change stays within the hackathon rules as read on October 4: it uses more of Qloo's own data and reduces the use of any single brand's colors or trade dress.

A [replay script](../scripts/replay-taste-profile.mjs) rebuilt the recorded Gather (38f75004) and Echo Atlas (6ba1656f) passes through the new code from their saved responses, with no Qloo request and no model run (report). Gather's required anchors changed from The 1st Shop of Coffee Prince, Anomalisa, Neutral Milk Hotel, Island, LA Kings and The Happy Film to Atmospheric, Reflective, Identity, The Romantic Exiles, the Microphones and The 1st Shop of Coffee Prince. Echo Atlas's changed from Unreal Engine, Arnold, Methyl Ethel, ESRB, Mommy and Tacoma to Intimate, Emotional, Reflective, Tacoma, The Master and Mitski. No book in either pass carried a look, mood or meaning tag, and several brands carried none (Starbucks, Apple Inc, Tesla), so they never become required.

The **247/247 automated tests passed**, six of them new: typed-tag grouping and metadata exclusion, ranking by spread, the anchor selection with and without qualities, the qualities-first and fallback rules in both arms, decisions and comparison headlines, a Studio pair with typed tags and image subjects that name a quality, and the TASTE panel's quality chips. Existing fixtures gained a qualities prediction. The 0.4.0 plugin archive was rebuilt with the regenerated `taste-policy.md`, and the Studio was restarted. The [live Gather pair](#live-gather-pair-with-shared-qualities--october-4-2026) above then ran with these rules.

## Live voice pair with the tag-seed fix — October 4, 2026

The same command ran one more Echo Atlas pair after the [tag-seed fix](#live-voice-pair--october-4-2026), with nothing else changed. The taste pass made 16 Qloo requests, and every domain answered after one retried rate limit and one retried timeout. Outer Wilds and the Ambient genre tag seeded it again, and "Studio Ghibli films" again stayed unresolved. The style ranking, from Outer Wilds alone, returned eight tags: Apocalyptic, Imaginatively Crafted, Otherworldly, Whimsically Chaotic, Empathetic, Visually Inventive, Narratively Bold and Meticulous. The aesthetic ranking returned none. The artist request answered with both seeds, with indie and dream-pop acts such as Methyl Ethel, Mitski and Men I Trust. The profile held 80 entities. The Qloo on arm's frozen prediction (34 names, 10 qualities) contained none of them and none of the tags.

Qloo off took 6.1 minutes with two images and Qloo on 8.3 minutes with three. Each arm had one DNA save rejected and corrected it: Qloo off for a device description over 200 characters, Qloo on again for a fourth copy line in its voice device. Qloo on used all six required anchors. No site file was refused for a changed fact. Both reached 100% DNA conformance, and no visitor page mentioned Qloo or Kiro. The records are the run report, the contact sheet (HTML) and full-page screenshots of Qloo on and Qloo off. The generated files were not edited.

| | Qloo off | Qloo on |
| --- | --- | --- |
| Voice device | "Hushed field-note voice", anchored to its own Brian Eno and Annapurna Interactive: short paired sentences in the second person | "Field interview register", anchored to the measured Methyl Ethel (Introspection, Melodic Dream Pop) and Arnold (Interview driven, Nostalgic), neither predicted: short questions and quiet answers |
| Headline | The city kept its sounds. Come find them. | The city stopped speaking. You can still hear it. |
| Add button and message | Keep this sound · Kept. It waits in your local wishlist. | Keep this recording · Logged. It is waiting in your local wishlist. |
| Starter lines still on the page | 1 of 16: the search placeholder | 2 of 16: the search placeholder and the form button |
| Motion | From its own "slow contemplative pacing" and Brian Eno: echo rings on an 18-second loop, a route that draws itself, long rises | From the measured style tags Otherworldly and Meticulous: a 40-second linear orbit, a nine-second scan line over the image frames, exact decelerating rises |
| Look | A dusk storybook atlas: night blue and lantern amber, Fraunces, Cabin and Caveat, arched golden-hour plates, a frequency dial and numbered, arched halls | A night signal station: near-black, mint and flare orange, Space Grotesk, Inter and DM Mono, a field spec sheet, frames that open from a square to a panorama, and a signal log |
| New against its own sketch | 29%: one of three fonts, 14% of top colors, two of five sections | 72%: all fonts, half of top colors, four of six sections |

The two sites share 11 of their 108 distinct sentences (10%). Ten are interface labels and notices; the eleventh is "A sample area where rhythm and navigation meet.", which both arms wrote for one item. Qloo on's interview voice runs through the page: "Q. What is left when everyone leaves? A. The sound stays behind.", "Q. Where do I begin? A. Anywhere.", and a signal log whose nodes play back fragments such as "A bell rope still swaying. No wind to explain it." Qloo off's item descriptions mostly split the starter's sentences in two; Qloo on rewrote them more freely. Seven of the eight Qloo on devices rest on measured entities or tags the model did not predict. Only the SVG illustration rests on its own predicted qualities, because no aesthetic tag was measured. The overall token distance was 0.572, with typography 0.875, structure 0.778, palette 0.498 and CSS features 0.143.

The two voice pairs share their brief, so together they show which choices moved with the taste source. Both Qloo off headlines begin "The city kept its sounds.", and both of its voices are hushed second-person listening registers. The Qloo on arms got different profiles, the first without music artists, and wrote in different voices: a numbered field log from Tacoma, then an interview from Methyl Ethel and Arnold. From the entities both profiles shared, both Qloo on arms also chose Space Grotesk, Inter and DM Mono (Unreal Engine and ESRB), a frame that widens from a square (Mommy) and a ruled specification panel (ESRB).

In the browser at 1440 pixels, both sites loaded every declared family from the library files. The pause button set `aria-pressed="true"`, stopped all five loops in each site, and a second press resumed them. The SVG atlases had 39 shapes (Qloo off) and 33 (Qloo on), each with a text label. Qloo off's frequency dial revealed its six features at their hidden frequencies and listed them under "Heard so far". Qloo on's frames opened from the central square to the full 2.39:1 frame when selected, and its survey nodes wrote transcript fragments into a polite live region. With `prefers-reduced-motion: reduce` at 375 pixels, nothing animated or transitioned and no text stayed hidden after scrolling. At 375 pixels neither site overflowed horizontally while scrolling, search, category filtering and the local wishlist worked with each arm's add message, and Qloo on's frames were squares that widened to 2.39:1 when selected. Neither site logged a console error or warning.

Limits:

- This is one pair, so the difference is an anecdote, not an effect beyond model variance. With the previous pair it is two Qloo on runs on one brief.
- Three passes with Outer Wilds returned no aesthetic tags, so neither arm's illustration has translated a measured aesthetic for this brief.
- The Ambient genre seed did not bring ambient artists; the artist neighbors were indie and dream-pop acts, and the style ranking no longer uses that seed at all.
- Entities are still translated literally, and the same entities produced the same translations in both Qloo on runs.
- Both Qloo on runs first declared a fourth copy line in their voice device, over the limit of three per device, and corrected it on the next save. No Qloo off run did.
- The trial makes no quality, preference or conversion claim.

## Live voice pair — October 4, 2026

`scripts/verify-taste-difference.mjs --run --pairs=1 --baseline-pairs=0 --brief-file=scripts/briefs/echo-atlas.json` ran one Qloo on/off pair with the [fixed facts, voice device and category-aware seeds](#voice-over-fixed-facts-and-category-aware-seeds--october-4-2026). The brief, starter, font library, Codex image tool and model (claude-opus-5.5, medium effort) were those of the [earlier game pair](#live-game-site-pair--october-4-2026). A first attempt was cancelled three minutes into its Qloo off run, because its taste pass had lost four entity domains to timeouts and both tag rankings to server errors (report). Timeouts and server errors are now retried like rate limits, and the pair was run again.

The taste pass made 22 Qloo requests. Outer Wilds resolved as the game and "ambient music" as the Ambient genre tag. "Studio Ghibli films" was reported as unresolved, because its closest match is a music artist. Seven entity requests returned 70 entities, among them the brands Unreal Engine and ESRB, the films Mommy and Ikigami and the games Tacoma, Stray and Disco Elysium. The artist request timed out on all three attempts and both tag rankings returned HTTP 500 on all three, so the profile had no music artists and no style or aesthetic tags. The Qloo on arm's frozen prediction (33 names, 10 qualities) contained 1 of the 70 entities.

Qloo off took 6.5 minutes with two images and Qloo on 8.6 minutes with three. Qloo on had two DNA saves rejected, for a fourth copy line in its voice device (three is the limit per device) and a rejection reason over 400 characters, and corrected both. It rejected the required anchor Arnold, a docuseries whose tags describe a celebrity biography. No site file was refused for a changed fact in either arm. Both reached 100% DNA conformance, and no visitor page mentioned Qloo or Kiro. The records are the run report, the contact sheet (HTML) and full-page screenshots of Qloo on and Qloo off. The generated files were not edited.

| | Qloo off | Qloo on |
| --- | --- | --- |
| Voice device | "Ambient register", anchored to its own Brian Eno and Invisible Cities: short, spacious second-person lines built on listening verbs | "Field-log voice", anchored to the measured game Tacoma (Narrative-driven, Intriguing, Atmospheric), which it had not predicted: numbered log entries, a fact first and a quiet consequence after |
| Headline | The city kept its sounds. Come and listen. | The city went quiet. Its sounds stayed behind. |
| Add button and message | Keep in my wishlist · Kept in your local wishlist. Listen on. | Log this recording · Logged. It waits in your local list. |
| Starter lines still on the page | 2 of 16: the form button and, as a handwritten sub-label, the list title | 3 of 16: the navigation's "Explore the game", the search placeholder and the form button |
| Look | A dusk travel journal: ink blue, cream and ember, Fraunces, Alegreya Sans and Caveat, watercolor plates and a hand-inked listening map | A night field log: near-black, mint and red, Space Grotesk, DM Mono and Inter, a viewfinder that widens from 1:1 to scope and a survey sheet |
| New against its own sketch | 15%: no fonts, 13% of top colors, two of six sections | 61%: all fonts, 43% of top colors, two of five sections |

The two sites share 13 of their 107 distinct sentences (12%), against 37% in the earlier game pair, where both arms had kept every starter line. Eleven of the 13 are interface labels, notices and the form button. The other two are one item description, "Pin each sound you find to your map. Then draw the lines between them.", which both arms wrote independently. Both voices are quiet and short-lined. They differ in frame and vocabulary: Qloo off invites a listener ("Wander in", "Leave your name by the door"), while Qloo on keeps a recording log ("Recovered recordings", "Begin the survey", "Keep a channel open", log numbers on its sections and cards). Its introduction kept the starter's first sentence and replaced the second. Every product fact stayed as the starter had it.

Six of the eight Qloo on devices rest on entities the model did not predict. Unreal Engine (Clean Interface, Dark Mode) and Ikigami set the palette, and Unreal Engine and ESRB the type. Mommy, tagged Variable aspect ratio, became the widening viewfinder, and ESRB (Standardized, Informative) the survey sheet. With no measured tags, its motion and SVG illustration rest on its own predicted qualities, as Qloo off's do. Both blind sketches again planned a dusk atlas with the same four sections. The overall token distance was 0.545, with typography 0.875, structure 0.625, palette 0.49 and CSS features 0.212.

In the browser at 1440 pixels, both sites loaded every declared family from the library files and drew their SVG illustrations (44 shapes in Qloo off, 25 and 8 in Qloo on), each with a text label. The pause button set `aria-pressed="true"`, stopped every loop, and a second press resumed them. With `prefers-reduced-motion: reduce` at 375 pixels, no animation or transition ran and no text stayed hidden after scrolling. At 375 pixels neither site overflowed horizontally while scrolling, and search, category filtering and the local wishlist worked in both, each with its own add message. Neither site logged a console error or warning. Qloo off's catalogue cards fade in as they enter view, so its full-page screenshot was taken after scrolling.

Two corrections followed the run:

- **Shared sentences.** A fact of several sentences is now left out sentence by sentence. Before, the two sentences of the fixed form description counted as shared. The run report, written before the correction, records 15 of 109 (13.8%). The earlier pairs move from 39% to 37% (Echo Atlas) and from 28% to 27% (Gather).
- **Tag seeds.** This run exposed a defect that the seed fix itself had introduced. Once "ambient music" seeded the Ambient genre tag, every request carried a tag seed next to the entity seed. A four-request probe run by hand while the Qloo off arm was building, with Outer Wilds and the Ambient tag, isolated it. The style ranking with the entity seed alone returned eight tags in about a second. With the tag seed added it returned HTTP 500, with or without explainability, and the artist request with both seeds timed out after 30 seconds. Qloo's parameter reference lists `signal.interests.tags` for entity result types only, while its taste-analysis guide names it as a starting context for tag results (saved pages). Tag rankings now use the entity seeds alone when an entity seed resolved, and the profile says which tag seed did not shape them. An entity request with both kinds of seed is repeated once as sent after a timeout or server error, then sent with the entity seeds alone, and the profile reports that too. A rate limit is still retried as sent. The TASTE panel's evidence cards mark such requests "entity seeds only".

A [live check](../scripts/verify-qloo-tag-seeds-live.mjs) of the whole fixed pass with the Echo Atlas references made 16 Qloo requests and no model call (report). The style ranking returned eight tags: Apocalyptic, Imaginatively Crafted, Otherworldly, Whimsically Chaotic, Empathetic, Visually Inventive, Narratively Bold and Meticulous. The aesthetic ranking returned none, as in the earlier game pair. The artist request answered on its first attempt with both seeds this time, so the fallback was not needed; a brand request was rate-limited, timed out and then answered. The fixture prediction of `verify-qloo-taste-live.mjs` lacked style and aesthetic qualities, so that script would have failed after its requests; it now covers them and is checked before any request.

The **241/241 automated tests passed**, two of them new. One reproduces the live failures with a fixture client, and one checks the evidence-card label; the shared-sentence test now includes a fact of two sentences. The 0.4.0 plugin archive was rebuilt and its 20 entries verified, and the Studio was restarted with the fix.

Limits:

- This is one pair, so the difference is an anecdote, not an effect beyond model variance.
- Rewriting was measured, not judged. Both voices stay close to the brief's quiet, exploratory register, and the shared description shows how near two independent rewrites can land.
- The Qloo on profile was degraded: no music artists and no style or aesthetic tags, so its motion and illustration did not translate measured qualities. The [next pair](#live-voice-pair-with-the-tag-seed-fix--october-4-2026) ran with the tag-seed fix.
- Entities are still translated literally: a game-engine brand set a dark-mode interface palette, and a film's variable aspect ratio became a viewfinder.
- The trial makes no quality, preference or conversion claim.

## Voice over fixed facts and category-aware seeds — October 4, 2026

The two live pairs below differed in type, color, motion and images, but not in their words. Measured afterwards with the new host check, both arms of both pairs kept all 16 of the starter's narrative lines word for word: the headline, introduction, catalogue and list titles, form title and button, search placeholder, add label and message, and every item description. Of the two sites' distinct sentences, 37% were identical in the Echo Atlas pair and 27% in the Gather pair (39% and 28% before the [sentence-level fact correction](#live-voice-pair--october-4-2026)). Both prompts had said to keep the catalogue data intact, and the item descriptions live in that data.

- **Facts stay, narrative moves.** The starter's `site-data` JSON keeps its facts: the brand, `priceSuffix`, `formDescription`, `formSuccess` and each item's ID, name, category, meta, price and price label, with every item in order. The write tool refuses an `index.html` that changes or drops them, and the host checks them again at the end of the run. The four saved sites of the earlier pairs pass the check unchanged, so it would not have refused any of their pages.
- **Voice device.** Every DNA needs a `voice` device that sets the register, rhythm and vocabulary of the copy and declares at least two lines it wrote. In Qloo on it must rest on a measured entity or tag; in Qloo off it rests on the model's own prediction. Both prompts ask for the headline, introduction, headings, calls to action, add label and message, and each item description in that voice. A description keeps what the item is and does and adds no feature, award, review, quote or claim. Keeping a starter line that fits the voice is allowed. The shared policy states the same rule.
- **Checks and measures.** Conformance finds a copy line on the page or in the JSON data island that the page's script renders. `project_check_dna` lists starter lines still on the page word for word. Each run records how many of its starter narrative lines it rewrote. The comparison counts the sentences the two sites share, leaving out product facts, and the TASTE panel and `verify-taste-difference.mjs` report both.
- **Category words in references.** The name match ignores words such as "films" and "music", which is how "Studio Ghibli films" and "ambient music" had seeded music-artist entities. A reference's last word now limits what may seed it. A work word admits only entities of that kind or their makers, and never a place tag. A genre word asks for a `urn:tag:genre:music` tag first. A [live probe](../scripts/verify-qloo-seeds-live.mjs) made six Search and tag Search requests through the taste pass itself and no Insights or model calls (report). Outer Wilds resolved as the game, Nujabes as the artist and Paterson as the film. "ambient music" resolved to the Ambient genre tag. "Studio Ghibli films" stayed unresolved with the reason "The closest match, Studio Ghibli, is a music artist, not films", because no film entity or tag carries the studio's name.

The **239/239 automated tests passed**, four of them new. They cover the category rules, the voice rule in both arms, the fact check and its refusals, data-island copy, the narrative and shared-sentence measures, and the panel lines. The 0.4.0 plugin archive was rebuilt and its 20 entries verified. The [live voice pair](#live-voice-pair--october-4-2026) above then ran with these rules.

## Live game site pair — October 4, 2026

The same rules ran on the `indie-game` starter: `scripts/verify-taste-difference.mjs --run --pairs=1 --baseline-pairs=0 --brief-file=scripts/briefs/echo-atlas.json`. The brief is the starter's default Echo Atlas brief, a fictional exploration game about collecting the sounds of an abandoned city. Its audience references are Outer Wilds, Studio Ghibli films and ambient music, as in the earlier Echo Atlas audit. The model was claude-opus-5.5 at medium effort. The starter has no photo library, so only generated images were available.

The taste pass made 13 Qloo requests: three searches, then ten requests across eight domains, games included, with deep-cut bands for brands and films. Outer Wilds resolved as the game. "Studio Ghibli films" and "ambient music" resolved to music-artist entities named Studio Ghibli and Ambient Music. The pass returned 79 entities and eight style tags: Apocalyptic, Imaginatively Crafted, Otherworldly, Whimsically Chaotic, Empathetic, Visually Inventive, Narratively Bold and Sweeping. The aesthetic request returned no tags, which the profile reported as a limitation. Films were Japanese, from Ghibli's The Wind Rises and The Tale of The Princess Kaguya to other anime and live-action dramas. Games included Hades, Celeste, Return of the Obra Dinn and Spiritfarer. Music artists were mostly Australian indie rock, such as Gang of Youths and Ocean Alley. The Qloo on arm's frozen prediction (33 names, 10 qualities) contained 1 of the entities and none of the tags.

Qloo off took 9 minutes with four images and Qloo on 8 minutes with two. Qloo on had one DNA save rejected because a device description ran over 200 characters, and corrected it on the next save. Both reached 100% DNA conformance, and no visitor page mentioned Qloo or Kiro. The records are the run report, the contact sheet (HTML) and full-page screenshots of Qloo on and Qloo off. The generated files were not edited.

| | Qloo off | Qloo on |
| --- | --- | --- |
| Concept | An explorer's sound journal under a lantern at dusk, with a field guide to the city's districts | A peat-dark, ember-lit field atlas with a stepped trial path and a retro signal tuner |
| Palette | Navy and amber, anchored to its own predictions Spirited Away and "warm lantern glow against deep night" | Cask green and cinnabar, anchored to the whisky brand Hakushu (tags Whiskey, Spirits) and Hades |
| Type | Fraunces and Alegreya Sans from its sketch, plus DM Mono | Big Shoulders Display, Cabin and Space Mono, anchored to Gang of Youths (Anthemic Indie) and Atari |
| Motion | From its own quality "slow contemplative pacing" and Brian Eno: rings breathing on a 9 s cycle, a 40 s hero drift, a 6 s route drawing, 0.9–1.2 s entrances | From the measured style tags Sweeping and Otherworldly: skyline layers panning over 48 s, a 6 s echo pulse, a 7 s ink drawing, 1.1–1.4 s rises |
| SVG illustration | #atlas-map, 35 shapes, from its own "hand-drawn cartography" and "overgrown ruins" | #svg-city-atlas, 44 shapes, anchored to Hades (hand-drawn, stylized, 2D) and its own predicted "hand-drawn maps" |
| Images | Four golden-hour scenes of the abandoned city | Two from The Wind Rises (Technology, Historical drama): rooftops with brass horns and a radio tower, and an archive of wax cylinders |
| New against its own sketch | 22% | 76%: all fonts, 63% of top colors, 67% of sections |

All eight Qloo on devices rest on entities or tags the model did not predict. The overall token distance was 0.545, with typography 0.75, structure 0.778, palette 0.448 and CSS features 0.219. Each site used about 32,800 characters of code.

In the browser at 1440 pixels, both sites loaded every declared family from the library files. The pause button paused every CSS animation and a second press resumed the loops. With `prefers-reduced-motion: reduce`, no animation ran and nothing stayed hidden. Neither site logged a console error. At 375 pixels, search, category filtering and the local wishlist worked in both, and the Qloo on signal tuner updated its readout. While scrolling at 375 pixels, the Qloo on site never overflowed horizontally. On the first scroll after each load, the Qloo off site overflowed by up to 25 pixels in 39 to 54 of 114 samples. Stopping only the breathing rings around its atlas nodes, which scale to 4.2 times their size, removed the overflow; the hero's rings are clipped by the hero.

This run exposed one host defect. With style tags but no aesthetic tags, `project_get_taste` asked for a "measured aesthetic ref" that did not exist; the DNA check was already per domain and accepted the model's own aesthetic ref. The guidance, the reveal event and the shared policy sentence now treat each tag domain separately, and a new test covers a pass without aesthetic tags. The **235/235 automated tests passed**, the 0.4.0 plugin archive was rebuilt and its 20 entries verified, and the Studio was restarted with the fix after the run.

Limits:

- This is one pair, so the difference is an anecdote, not an effect beyond model variance.
- Two of the three references resolved to music-artist entities rather than to Studio Ghibli's films or the ambient genre. The host's name match dropped category words such as "films" and "music", so both scored as exact matches; the taste pass now reads those words ([above](#voice-over-fixed-facts-and-category-aware-seeds--october-4-2026)). The October 3 research run had rejected the same matches and kept only Outer Wilds. The music neighbors therefore came from those artists, and Gang of Youths then shaped the type and the rally-style copy.
- Entities are still translated literally. The deep-cut brand Hakushu, a whisky, set a peat-and-cask palette for a game site.
- With no measured aesthetic tags, neither illustration translated a measured aesthetic. Both arms drew a hand-drawn city atlas; Qloo on anchored its atlas to Hades and its own predicted "hand-drawn maps".
- The trial makes no quality, preference or conversion claim.

## Live fonts, motion and illustration pair — October 4, 2026

`scripts/verify-taste-difference.mjs --run --pairs=1 --baseline-pairs=0` ran one Qloo on/off pair with the [font library and tag-directed motion and illustration](#fonts-motion-and-illustration--october-4-2026). It used the same Gather brief (an audience that likes Nujabes and the film Paterson), starter, photo library, Codex image tool and model (claude-opus-5.5, medium effort) as the earlier trials. The taste pass made 11 Qloo requests and returned 69 entities and 16 tags. The Qloo on arm's frozen prediction (28 names, 12 qualities) contained 3 of the entities and 1 tag, Deadpan. Qloo off took about 9 minutes with seven images and Qloo on about 7 minutes with three. Neither arm had a DNA save rejected. Qloo on found one partial device at its first self-check and repaired it. Both reached 100% DNA conformance, and no visitor page mentioned Qloo or Kiro.

The records are the run report, the contact sheet (HTML), full-page screenshots of Qloo on and Qloo off, and the taste panel's DNA chips and motion lines. The generated files were not edited.

| | Qloo off | Qloo on |
| --- | --- | --- |
| Concept | “A week at the table”: a warm paper notebook with a seven-day routine strip and the catalogue as Side A of a record | A silver-and-midnight hotel larder with an almanac of an imagined island year, a café counter of regulars and a night-shelf corridor |
| Type | Literata, Caveat and DM Mono, its three sketch fonts | Instrument Serif and Jost, both outside its sketch |
| Motion device | Anchored to its own predicted quality “looped rhythmic structure” and to J Dilla | Anchored to the measured style tags Quiet and Pensive, neither predicted |
| Motion in the CSS | A record turning every 14 s, a 0.9 s entrance on an overshooting ease (cubic-bezier(.3,.1,.2,1.15)), 0.3–0.45 s transitions | A moon turning every 40 s, a 6 s line drawing, a 1.2–1.6 s entrance staggered 140 ms per card, 0.6–0.8 s transitions on an ease without overshoot (cubic-bezier(.22,.61,.36,1)) |
| SVG illustration | #loop-record, 37 shapes: a grooved record holding produce, from its own qualities “circular sample-loop forms” and “lo-fi vinyl warmth” | #sculpted-larder (17 shapes) and #island-map (12 shapes): jars and bottles as sculptures on stepped plinths, and a contour-plan island, from the measured aesthetic tags Sculptural Designs and Architectural Design |
| Images | Seven generated (dappled morning light, rust and paper) and two library photos | Three generated, from the measured tags Textural and Luminous, and four library photos chosen by Moody (Anomalisa) |
| New against its own sketch | 15%: no fonts, 25% of top colors, 20% of sections | 65%: all fonts, 29% of top colors, 67% of sections |

All nine Qloo on devices rest on entities or tags the model did not predict. The overall token distance was 0.524, with typography 0.875, structure 0.778, palette 0.337 and CSS features 0.182. The sites used 29,414 and 29,531 characters of code, well under the 45,000 budget.

In the browser at 1440 pixels, both sites loaded every declared family from the library files and drew their SVG illustrations, each with a text label. In both, the pause button set `aria-pressed="true"` and paused every CSS animation; in Qloo on a second press resumed the loop. With `prefers-reduced-motion: reduce`, no animation ran and no section or card stayed hidden after scrolling. At 375 pixels neither site overflowed horizontally, and search, category filtering and price sorting kept each product with its image. The Qloo on counter outlined a regular's two products when chosen. Neither site logged a console error.

Limits:

- This is one pair, so the difference is an anecdote, not an effect beyond model variance.
- The slower, softer motion in Qloo on is consistent with Quiet and Pensive, but one pair cannot show that the tags set the tempo. Qloo off also predicted calm qualities, such as unhurried pacing, and chose a looping swing from another of its own qualities.
- Both arms sketched a notebook with a spinning record before any data, as in the earlier Gather runs with sketches.
- Entities are still translated literally. LA Kings, tagged "Black And Silver Palette", drove the palette again, the device anchored to Anomalisa became a row of hotel-room doors, and the book Island became an island almanac.
- The tags describe the audience, not the right motion for a food shop, and the trial makes no quality, preference or conversion claim.

## Fonts, motion and illustration — October 4, 2026

Two gaps remained after the image trials. Declared fonts depended on the visitor's system: Futura, Gill Sans and Iowan Old Style rendered as Trebuchet MS or Georgia on this Windows machine. Motion and illustration were also left to the model, with nothing from Qloo directing them.

- **Font library.** `library/fonts/` holds 33 families under the SIL Open Font License 1.1: 57 Latin-subset WOFF2 files (1.7 MB) from Fontsource and each family's licence file from google/fonts. `scripts/fetch-font-library.mjs` reads every licence first and refuses a family whose Reserved Font Name is its own name, because a subset or converted copy could not keep it. The first fetch included such families, and they were replaced. It downloads every file before writing any and records a SHA-256 checksum per file. The loader requires the OFL text, a WOFF2 header, at most 200 KiB per file and a matching checksum, and a failed load stops the run before any model call.
- **Same fonts in both arms.** Plans and builds read host-written `culture-fonts.json`: each family's category, character words, the system fonts it stands in for, its weights and the `@font-face` rules to copy. The agent cannot overwrite it. The sketch and the DNA may name only these families plus generic fallbacks, and a system font is refused with its stand-in, for example "Jost stands in for Futura".
- **Serving.** Previews serve only listed font files, as `font/woff2` with `Access-Control-Allow-Origin: *`. The sandboxed preview has the origin `null` and loads fonts in CORS mode. Before the live pair, a FontFace load and a stylesheet `@font-face` rule both loaded inside a sandboxed preview. The Studio serves the same files for type specimens in the TASTE panel, and downloads list the font files a site needs with their licences.
- **Style and aesthetic tags.** The taste pass adds a style request (`urn:tag:style:qloo`, film and TV parents) and an aesthetic request (`urn:tag:aesthetic_property:qloo`), eight tags each, without seed exclusion. A three-request probe chose two requests over one; see [Qloo integration](qloo-integration.md#style-and-aesthetic-tags). Both arms predict three to six qualities per tag domain blind. Qualities are matched only against measured tags and names only against entities. Tags never become required anchors or count toward profile sufficiency, and entity metrics keep their meaning, with tag metrics counted separately.
- **DNA rules.** A motion-layer device must declare keyframes or an animation or transition value. With style refs, the DNA needs a motion device anchored to one; with aesthetic refs, a device anchored to one that lists inline `<svg>` IDs in `tokens.svg`. Both must use measured refs when the profile has them. The prompt text is the same in both arms and asks for a small motion system: a staggered entrance, a signature animated moment, consistent transitions, a reduced-motion fallback and a `data-motion-toggle` pause control for loops longer than five seconds. The code budget rose from 25,000 to 45,000 characters.
- **Checks.** Conformance checks each declared family's `@font-face` file and keyframes that are defined and used. It also checks SVG illustrations with at least eight shapes, and for animated devices the reduced-motion fallback and, for endless loops, the pause control. Families named only inside `@font-face` do not count as used. The host warns about unknown font files, undefined keyframes, missing fallbacks and loops without a pause control. The fingerprint records motion and SVG counts without weighting them in the distance.

The **234/234 automated tests passed**, six of them new. They cover the font loader and its rejections, the culture-fonts.json content, and library-only fonts in the sketch and DNA. They also cover the font-file, keyframes, SVG, reduced-motion and pause-control checks, the motion and illustration rules in both arms, the identical prompt text, and the preview, specimen and download routes. The 0.4.0 plugin archive was rebuilt and its 20 entries verified.

## Live generated images pair — October 4, 2026

`scripts/verify-taste-difference.mjs --run --pairs=1 --baseline-pairs=0` ran one Qloo on/off pair with [Codex images](#codex-generated-images--october-4-2026) required before the site. It used the same Gather brief (an audience that likes Nujabes and the film Paterson), starter, photo library and model (claude-opus-5.5, medium effort) as the earlier trials. The taste pass made 9 Qloo requests and returned 69 entities; the frozen prediction (28 names) contained 3 of them. Each arm took 8 to 9 minutes, about 5 of them for images. Both reached 100% DNA conformance, and no visitor page mentioned Qloo or Kiro. Qloo off had one DNA save rejected for a field limit unrelated to images and corrected it. No image request was rejected or failed.

The records are the run report, the contact sheet (HTML), full-page screenshots of Qloo on and Qloo off, and the taste panel with one recorded host prompt open. The generated files were not edited.

| | Qloo off | Qloo on |
| --- | --- | --- |
| Concept | Kraft-paper notebook of one seasonal day | Night-shift pantry hotel with an imagined island of seasons |
| Image device and anchors | Ink-wash still lifes with a record-groove circle, anchored to its own predictions Samurai Champloo and Norwegian Wood | "Island of seasons", anchored to the book Island, which the model had not predicted |
| Qualities in the prompt | Its own words: ink-wash brushwork, record grooves, seasonal melancholy | Returned tags Utopia and Fantasy |
| Colors in the prompt | #2a2926, #e6dcc8 | #1f4e5a, #7fc4bb |
| Images | Seven: a landscape hero and six square product images, 37–47 s each | Seven: a landscape section image and six square product images, 42–60 s each |
| Placement | The hero, plus an image on every catalogue card through an additive `experience.js` | The island section, plus an image on every catalogue card through an additive `experience.js`. Four library photos chosen by the tag Moody (Anomalisa) form a silver-teal night shelf |
| New against its own sketch | 15% (kept both sketch fonts) | 77% (all fonts, 57% of top colors, 75% of sections) |

Both arms pictured the same six products, and some subjects nearly matched. Qloo off asked for "A jar of creamy tahini with a wooden spoon and scattered sesame seeds"; Qloo on asked for the same with "on a stone ledge in a twilight island garden" added. The art-direction lines differed, and the pictures followed them: sepia ink-wash on paper in Qloo off, saturated teal dusk scenes in Qloo on. Each site uses all seven of its images, each 1536×1024 or 1254×1254 pixels and 309–504 KB. The overall token distance was 0.571, with typography 1, structure 0.818, palette 0.343 and CSS features 0.233. Eight of the nine Qloo on devices rest on entities the model did not predict.

In the browser at 1440 and 375 pixels, both sites loaded every image with alt text describing it and had no console errors. Each kept every product image with its product after sorting by price and filtering by category. The Qloo on site had no horizontal overflow at 375 pixels. The Qloo off site overflowed by 5 pixels there, from the decorative record-groove circle behind the hero.

Limits:

- This is one pair, so the image difference is an anecdote, not an effect beyond model variance.
- Entities are still translated literally. The book Island became an island, Anomalisa's "Hotel" tag became the hotel concept, and LA Kings, tagged "Black And Silver Palette", drove the palette again.
- The recorded Qloo on prompt began its art direction with "of seasons:", left over from removing the name Island. The host now also trims a connective left at the start, and a test covers this device shape.
- Iowan Old Style, Futura and Gill Sans are not installed on this Windows machine. Qloo off rendered in Georgia and Courier New. Qloo on rendered headings and body text in Trebuchet MS, so its pairing of a geometric heading face and a humanist body face did not show here.
- Each image took 37–60 seconds, so seven images added about five minutes to each arm.
- The trial makes no quality, preference or conversion claim.

## Codex generated images — October 4, 2026

The library pictures only the six products, so taste-led builds can now also generate images through Codex, signed in with the user's ChatGPT account. At startup Studio looks for a Codex CLI of version 0.160.0 or later. On this machine it found the CLI the Codex app bundles, 0.160.0, signed in with ChatGPT. The npm CLI (0.116.0) and an older bundled build (0.130.0-alpha.5) could not parse the user's Codex configuration; the selected CLI does not load it.

- **Same tool in both arms.** With a generator available, every taste-led build gets `project_generate_image` and the same prompt text in both arms, and the job records the provider and version. Plans, and Studios without a generator, are unchanged.
- **Images before the site.** The DNA must include an imagery device, and the first site file is refused until the run has made at least one image request. A failed request counts, so a Codex outage cannot block a build. This rule followed the first live pair below, where both arms skipped the then optional tool.
- **Host-written prompts.** The agent passes the ID of an imagery device in its saved DNA, a one-sentence subject and an aspect. The host writes the prompt from the device's name with taste-entity names removed, its colors completed from the DNA palette, and its qualities. It rejects a subject that names a taste entity or brief reference, a request before the DNA, and a device outside the imagery layer. The first request freezes the DNA, and a run may make eight requests, failures included.
- **Isolated Codex turn.** Each image is one `codex exec --ignore-user-config --ephemeral --skip-git-repo-check --disable shell_tool --sandbox read-only` turn in an empty folder. Environment variables whose names contain KEY, TOKEN, SECRET or PASSWORD are removed, and the user's own Codex configuration and MCP servers are not loaded. The host moves the image from the Codex session folder into the run's assets, converts it to JPEG with Windows' System.Drawing and deletes the session folder.
- **Time.** The bridge waits up to 270 seconds for this tool, Kiro's MCP timeout is 600 seconds when images are on, and the run deadline pauses while an image is generated. Generation still running when a run ends is stopped.
- **Records.** Previews serve only recorded images. Each record keeps its host prompt, device, size and duration, and whether the site uses it. `project_check_dna` and the final conformance list used, unused and unknown generated paths. `culture-taste.json` carries the prompts, downloads include the images as base64, and the TASTE panel shows them with their prompts. The Studio page allows thumbnails from the preview origin, and scoped revisions copy their source's images.

One real image through the same generator, outside any Kiro or Qloo run (`scripts/verify-codex-image-live.mjs --run`), took 37 seconds. It produced a 1536×1024 JPEG of 225 KB in the prompt's navy and brass (image), and the Codex session folder was removed afterwards.

A first live pair with the tool available (`--pairs=1 --baseline-pairs=0`, report) completed both arms in under 4 minutes each with 100% DNA conformance and no visitor-page mention of Qloo or Kiro. The Qloo on site was 68% new against its own sketch and the Qloo off site 6%, with an overall token distance of 0.527. Neither arm called `project_generate_image`. The prompt then called images optional, and both arms built their imagery devices from library photos and SVG. Their photos also overlapped (three of seven shared), because Qloo off chose Moody as its own quality and so picked the same dark photos that the returned tag Moody picked in Qloo on. The images-before-the-site rule above was added in response, and the [second live pair](#live-generated-images-pair--october-4-2026) ran with it.

The **228/228 automated tests passed**, ten of them new. They cover prompt writing and the entity checks, CLI discovery and sign-in, the Codex arguments and environment, file handling including a real System.Drawing conversion, and the paused deadline. They also cover the identical tool and prompt in both arms, the request gates, preview serving, records, download, revision copies and the TASTE panel. The 0.4.0 plugin archive was rebuilt and its 20 entries verified.

## Live photo library trial — October 4, 2026

`scripts/verify-taste-difference.mjs --run --pairs=1 --baseline-pairs=0` ran one Qloo on/off pair with the [photo library](#photo-library--october-4-2026), using the same Gather brief, starter and model (claude-opus-5.5, medium effort) as the two studies. The taste pass made 9 requests and returned 69 entities; the frozen prediction (27 names) contained 4 of them. Both generations completed in under 7 minutes with 100% DNA conformance. Each saved its DNA once with no rejection and referenced no photo outside the library. No visitor page mentioned Qloo or Kiro. Both sites loaded every photo with catalog-based alt text, had no console errors and had no horizontal overflow at 375 pixels.

The records are the run report, the contact sheet (HTML), full-page screenshots of Qloo on and Qloo off, and the taste panel. The generated files were not edited.

| | Qloo off | Qloo on |
| --- | --- | --- |
| Concept | Kraft-paper seasonal notebook | Midnight-and-silver night lobby with an island map |
| Photo devices and anchors | Two, anchored to its own predictions (Perfect Days, Norwegian Wood; Samurai Champloo) | One, anchored to Anomalisa, a film it had not predicted |
| Qualities that chose the photos | Its own words: Soft light, Atmospheric, Mellow, Natural light; Overhead, Pattern, Close-up | Returned tags Moody and Hotel; every photo matched through Moody |
| Photos | pasta-2, jam-4, olive-oil-3, lentil-1, tomato-1, tahini-3 | olive-oil-3, jam-1, pasta-1, lentil-2 (three dark, one black-and-white) |
| Placement | Hero, plus a photo on every catalogue card through an additive `experience.js` that keeps each photo with its product after filtering and sorting | A four-photo strip tinted blue; no photos on the catalogue cards |
| New against its own sketch | 13% | 76% (Futura and Optima replaced Georgia and Courier New) |

The two sites share one photo of nine (photo-set distance 0.889). The overall token distance was 0.632, with typography 1, structure 0.8, palette 0.572 and CSS features 0.16. In the Qloo on site a returned tag chose the pictures, as the rule intends: Moody picked the darker shots. The Qloo off site chose its photos by naming photo tags such as Soft light and Overhead as its own qualities, which the rule allows for a model-anchored device.

Limits:

- This is one pair, so the photo difference is an anecdote, not an effect beyond model variance.
- The Qloo on design still translates entities literally. LA Kings, tagged "Black And Silver Palette", drove the palette again, and Anomalisa's "Hotel" tag shaped the lobby concept.
- Futura and Optima are not installed on this Windows machine. Century Gothic, the next font in the heading stack, is not installed either, so they rendered as Trebuchet MS and Candara.
- The trial makes no quality, preference or conversion claim.

## Photo library — October 4, 2026

The sites in both live studies had no real imagery, since the preview is offline. The `local-food` starter now has a host photo library: 21 photographs of its six products. They were found through the Openverse API (`license=cc0,pdm`, `category=photograph`), chosen by hand, resized to at most 1280 pixels and re-encoded as JPEG, 2.1 MB in total. Each catalog entry records alt text, size, tone, tags, license, creator, provider and source page. Some sources served WebP files under .jpg names, so the loader now requires a JPEG header whose pixel size matches the catalog.

- **Same input in both arms.** Build runs read the catalog as host-written `culture-library.json`, which the agent cannot overwrite. Planning runs do not receive it. The two arms' prompts still differ only in the taste-source paragraph.
- **Tags choose photos.** A DNA device may list up to four catalog photos, and each must carry one of the device's qualities as a tag. Measured anchors' qualities must be returned Qloo tags, so in Qloo on the measured tags choose the pictures. The photo tags include 12 tags that Qloo returned in all six earlier Gather taste passes, such as Moody, Atmospheric, Understated framing, Editorial-Style Photography and Vibrant. The other tags only describe the photo.
- **Treatment.** The same device must declare two of its colors and a filter or mix-blend-mode value, so its photos take on the site's palette.
- **Serving.** Previews serve `library/<id>.jpg` only for photos listed for the job's starter; other names fail. The Studio serves the same files as DNA thumbnails, and downloads list the photos a site uses with their repository paths and licenses.
- **Checks.** `project_check_dna` reports photo paths the library does not contain. Conformance counts a photo only when a site file references it, and the design fingerprint records the photos used. The portable `culture_validate_design_dna` and `culture_check_dna_conformance` tools accept the same optional `library`.
- **Analysis.** `scripts/analyze-taste-difference.mjs` adds an exact permutation test of photo-set distance between arms. Rerun on the sketch study, which had no photos, it reproduced the recorded results (overall p = 0.005) and reported no photo section.

The **218/218 automated tests passed**, eight of them new. They cover catalog validity and loader rejections, the photo rules in the DNA, conformance and the unknown-photo report, prompt symmetry and the host-owned file. They also cover the preview and Studio routes, the download list and the DNA thumbnails. The 0.4.0 plugin archive was rebuilt and its 20 entries verified. The first live run with the library is recorded [above](#live-photo-library-trial--october-4-2026).

## Live comparison with frozen sketches — October 3, 2026

The [first live study](#live-taste-led-comparison--october-3-2026) was repeated with the [sketch and departure rules](#frozen-design-sketch-and-departure-rule--october-3-2026) and nothing else changed. `scripts/verify-taste-difference.mjs --run --pairs=3 --baseline-pairs=3` ran the same Gather brief, starter and model (claude-opus-5.5, medium effort) through a restarted Studio. All 12 generations completed in 36 minutes, each with 100% DNA conformance. No visitor page mentioned Qloo or Kiro. All 12 sites loaded without console errors and had no horizontal overflow at 375 pixels. The Kiro session logs show no rejected DNA save: each Qloo on run met the departure rule on its first save.

The records are the run report, the full-matrix analysis, the contact sheet (HTML) and the pair 1 taste panel. The generated files were not edited.

Each taste pass again made 9 requests and returned 69 entities, with Nujabes resolved as an artist and Paterson as the film. The frozen predictions (26–29 names) contained 1–3 of them. In the Qloo on runs, 21 of 23 DNA devices rested on entities the model had not predicted.

Before any taste data, all 12 runs sketched the same kind of site: a notebook on warm paper, with a serif and a typewriter face. Measured against those sketches:

| Share of the saved site new against its own sketch | Qloo on (3 designs) | Qloo off (9 designs) | p |
| --- | --- | --- | --- |
| Overall | 72% (68–76%) | 3% (0–13%) | 0.005 |
| Font families | 100% | 0% | 0.005 |
| Top colors | 52% | 1% | 0.005 |
| Landmark sections | 65% | 9% | 0.005 |

Every Qloo on site replaced the sketch's type with Futura plus Palatino or Gill Sans. Every Qloo off site kept its sketch fonts. The table below compares distances over all 66 design pairs; the exact permutation test again covers all 220 labelings, and p = 0.005 is the smallest possible value.

| Dimension | Qloo on ↔ off | Within Qloo on | Within Qloo off | p | First study p |
| --- | --- | --- | --- | --- | --- |
| Typography | 0.883 | 0.445 | 0.338 | 0.005 | 0.555 |
| Structure (section IDs) | 0.765 | 0.583 | 0.652 | 0.005 | 0.577 |
| Palette | 0.489 | 0.271 | 0.170 | 0.005 | 0.014 |
| Concept (DNA thesis and device names) | 0.907 | 0.762 | 0.783 | 0.005 | 0.005 |
| CSS features | 0.233 | 0.242 | 0.237 | 0.541 | 0.259 |
| Overall token distance | 0.585 | 0.378 | 0.338 | 0.005 | 0.209 |

Each Qloo on design's nearest overall neighbor is another Qloo on design, and each baseline's nearest is a baseline. The script's pairwise summary agrees: Qloo-to-baseline 0.601 against baseline-to-baseline 0.348 (0.354 against 0.321 in the first study). The Qloo on designs became an island almanac or a small night hotel in black and silver. The baselines stayed paper notebooks, most with a turning record.

The departure itself is required by the protocol, so its lead is expected. The attributable part is that the arms started from comparable blind sketches. Their type and section plans did not separate before any data (p = 0.81 and 0.76). Their sketch palettes differed slightly (separation 0.041, p = 0.05), against a site palette separation of 0.311.

Limits remain:

- CSS features still did not separate: both arms use similar properties on the same starter.
- Measured does not mean appropriate. LA Kings, a hockey team tagged "Black And Silver Palette", was again a required anchor and drove the palette.
- This is one brief, one model and three Qloo on designs.
- The study makes no quality, preference or conversion claim.

## Frozen design sketch and departure rule — October 3, 2026

In the [first live study](#live-taste-led-comparison--october-3-2026) concept and palette separated, but both arms kept the model's own serif-and-typewriter type and section plan. The taste-led protocol now adds three rules:

- **Sketch.** With its blind prediction, the agent freezes a `designSketch` of the site it would make from that prediction alone: 3–6 colors, 1–3 fonts, 3–8 landmark section IDs and 1–5 motifs. Studio requires the sketch.
- **Departure.** When the taste input has measured surprises, the host rejects a DNA unless surprise-anchored devices leave the sketch. A palette device needs two colors at least CIE76 ΔE 20 from every sketch color, and a typography device only fonts outside the sketch. A layout, structure, interaction or imagery device needs an element ID that is neither a sketch section nor a starter ID.
- **Qualities.** A device anchored to a surprise with returned tags must name the tags it translates.

After the build, the host records how far each saved site moved from its own sketch: the shares of its font families, eight most frequent colors and landmark sections that are new against it. The taste panel shows each run's sketch and that departure. [`scripts/analyze-taste-difference.mjs`](../scripts/analyze-taste-difference.mjs) adds an exact permutation test of the departure and compares the two arms' blind sketches with each other. Departure is required, so a Qloo on lead is expected. The attributable part is that both arms sketch before any data.

The **210/210 automated tests passed**, including new checks for sketch validation, the departure rule, tag-bound qualities, the departure measure, sketch-to-sketch distance and the panel rendering. A temporary fixture Studio (injected runner, test-only Qloo data, no model or Qloo request) rendered the panel at 1440 and 375 pixels with no horizontal overflow. The rule also rejected that fixture's first DNA: its black-and-silver palette had only one color at least ΔE 20 from the sketch, since its near-black sat close to the sketch's ink. The fixture and its data were deleted afterwards. The 0.4.0 plugin archive was rebuilt and its 20 entries verified.

At this checkpoint no live run under these rules had been recorded. The live results are recorded [above](#live-comparison-with-frozen-sketches--october-3-2026).

## Live taste-led comparison — October 3, 2026

`scripts/verify-taste-difference.mjs --run --pairs=3 --baseline-pairs=3` ran through a fresh Studio process. It used the Gather brief and `local-food` starter (audience references: Nujabes and the film Paterson) with claude-opus-5.5 at medium effort. Each pair ran one host taste pass and two generations whose prompts differed only in the taste-source paragraph. Three more pairs of baseline-only generations measured ordinary model variance. All 12 generations completed in 28 minutes. Each had 100% DNA conformance, and no visitor page mentioned Qloo or Kiro. All 12 sites loaded without console errors and had no horizontal overflow at 375 pixels.

The records are the run report, the full-matrix analysis and the contact sheet (HTML). The Studio taste panel for pair 1 is also saved. The generated files were not edited.

Each taste pass made 9 requests, with no errors or limitations. Nujabes resolved as an artist and Paterson as the film. Each pass returned 69 entities across five domains plus the brand and film deep-cut bands. The frozen predictions (27–29 names each) contained 1–2 of those entities.

| Observed | Qloo on (3 designs) | Qloo off (9 designs) |
| --- | --- | --- |
| DNA devices anchored to entities the model did not predict | 24 of 24 (8, 7 and 9 per run) | 0; every device cites the model's own prediction |
| DNA thesis | An island café with black-and-silver hotel stationery, 3 of 3 | A paper notebook, 9 of 9; a turning record in 7 |
| Hero image | Island horizon, 3 of 3 | Vinyl record in 7; light through leaves in 2 |

The table below compares distances over all 66 design pairs. The exact permutation test covers all 220 ways to label three of the twelve designs as Qloo on.

| Dimension | Qloo on ↔ off | Within Qloo on | Within Qloo off | p |
| --- | --- | --- | --- | --- |
| Concept (DNA thesis and device names) | 0.888 | 0.808 | 0.773 | 0.005 |
| Palette | 0.274 | 0.249 | 0.195 | 0.014 |
| CSS features | 0.223 | 0.261 | 0.206 | 0.259 |
| Typography | 0.259 | 0.361 | 0.266 | 0.555 |
| Structure (section IDs) | 0.512 | 0.433 | 0.543 | 0.577 |
| Overall token distance | 0.320 | 0.320 | 0.298 | 0.209 |

Attribution is complete at the specification level. The concept split was the most separated of all 220 labelings: each Qloo on design's nearest concept neighbor is another Qloo on design, and each baseline's nearest is a baseline. The palette difference also exceeds model variance.

Both arms kept the same serif-and-typewriter type system and similar page structure, so the overall token distance does not exceed model variance. The script's own pairwise summary agrees (Qloo-to-baseline 0.354 against baseline-to-baseline 0.321).

Concept words come from the agent's DNA text. The host checks that text through literal token conformance, not through perception. Measured does not mean appropriate: the profile included neighbors such as LA Kings, a hockey team tagged "Black And Silver Palette", and the agent turned that team into the palette. This is one brief, one model and three Qloo on designs; it makes no quality, preference or conversion claim.

Two earlier attempts failed and exposed four defects. Each is fixed with a regression test, and the suite then passed 205/205:

1. On Windows, Kiro CLI 2.24 did not start an MCP server when both its command and an argument contained spaces. Earlier Studio processes had been launched from a Node path without spaces. Started from `C:\Program Files\nodejs`, with the project in `D:\Qloo Hackathon`, both arms failed before any model turn. Model-free probes with a marker server isolated that combination. In that case the runner now launches bare `node` with the Studio's Node first on PATH. One diagnostic probe accidentally reached the model with a one-word prompt.
2. The search for "Paterson" returned the city before the film, and the city became the seed. A same-named work now wins over a place.
3. With four parallel requests, 3 of 7 insights calls returned `QLOO_RATE_LIMIT`. Requests now run two at a time, with up to two recorded retries within the budget.
4. In the second attempt both arms finished their sites, but the Qloo arm's final `culture-taste.json` exceeded the 160 KB project file limit and failed the run. The file was already 157,757 bytes at reveal. The record now stores profile entities once and drops descriptions if it would still be too large.

The two failed jobs and their reports are kept under output/taste-difference-failed-jobs.

Not yet verified: the standalone `scripts/verify-qloo-taste-live.mjs`, other briefs, starters and models, the `--swap-from` manipulation check, and any perceptual or human evaluation.

## Taste-led protocol 0.4.0 — October 3, 2026

The [researched comparison](#completed-researched-comparison) below showed a visible but moderate difference that could not be attributed to Qloo alone: both arms had the same web tools, and the Qloo arm chose when and what to ask Qloo (four calls). Version 0.4.0 makes the taste-led protocol the default: a host taste pass before any model run, a frozen blind prediction in both arms, required anchors favoring entities the model did not predict, a binding Design DNA with literal tokens, a host conformance check, and no web or direct Qloo tools in either arm. See the [README](development-notes.md#taste-led-protocol--040-default) and [creative policy](creative-policy.md#taste-led-design-040).

The **202/202 automated tests passed**, including 18 new taste-protocol tests and 2 new Studio UI tests. They inject a test-only Qloo client and an agent that follows the protocol through the real bridge, and they check:

- Client parameters for tag search, tag seeds, seed exclusion and popularity bounds, with invalid inputs rejected before any request.
- Seed resolution (entity, tag fallback, unresolved), seed exclusion on every insights request, the lower-popularity band, a capped request budget, and `unresolved` and `insufficient` profiles.
- Blindness: the brief is empty of evidence, `culture-taste.json` is absent and `project_get_taste` withholds data until the prediction is saved; the prediction cannot be rewritten.
- Gates: a DNA before the reveal, site files before a DNA, a DNA after construction, Qloo and web tools, host-owned files and differently cased artifact names are all rejected.
- Symmetry: both arms receive prompts identical except the taste-source paragraph, run with the `taste` protocol and get no web bridge.
- A failed taste pass stops a comparison with zero model runs; baseline-only runs never construct a Qloo client.
- Surprise flags, required anchors, DNA validation and literal conformance across hex, `rgb()` and `hsl()` colors, IDs and copy.
- Comparison metrics, portable brief bounds (`validateCultureBrief` passes), profile reuse without new requests, four scored taste-led directions with `d0`, a build that inherits the plan's frozen prediction, and a scoped research-protocol revision of a taste-led variant.
- The Studio taste panel and direction cards, rendered in the fake DOM used by the other UI tests.

A visual check rendered the taste panel at 1440 and 375 pixels from a temporary fixture Studio (injected runner, test-only Qloo data, no model or Qloo request), with no horizontal overflow. The fixture and its data were deleted afterwards. The 0.4.0 plugin archive was rebuilt and its 20 entries verified.

At this checkpoint no live run had been recorded. Test fixtures establish the mechanics, not that the taste-led designs differ more or are better. The first live runs and their results are recorded [above](#live-taste-led-comparison--october-3-2026).

## Source research and reconsideration implementation — October 3, 2026

New production jobs enforce a provisional plan before external calls, then a separate keep/refine/replace record before artifact construction. Actual native web responses are captured separately from authored interpretation. Both arms have the same web tools and a six-call combined search/fetch budget; preparation has neither. The Studio source tab separates Qloo relationships, search snippets and fetched page excerpts. Checkpoints retain initial alternatives, fixed facts, reconsidered decisions and the linked output trace.

The expanded **182/182 automated tests passed**. New checks exercise default production phase enforcement, private receipt authentication, source literals, failed/empty calls, source budgets, public-looking URL restrictions, source-linked reconsideration, legacy brief compatibility, unverified import/export and literal article-body selection. A real local hook child process and an ephemeral HTTP receipt server test the transport without a model call. These injected tests do not prove compatibility with an installed Kiro engine.

The first real trial, job `bc3fb8d7-9c90-490a-becb-f2dc5e860d7d`, exposed that distinction: Kiro executed web tools, but the configured legacy embedded hooks captured no receipts. Its agent explicitly reported unavailable host citations. We stopped our own trial before the Qloo arm started, preserving the failed report. It is not a completed comparison or evidence that the new researched workflow succeeds.

A separate one-fetch real Opus 5.5 connectivity probe then confirmed that this installed CLI also ignored standalone native web hooks. Both failures are retained. The replacement adapter consumes typed `AssistantMessage.toolUse` requests and actual runtime `ToolResults` from Kiro's private session log, pairing IDs and arguments; it does not parse assistant citations as evidence. Synchronization runs before project tool handling and on process completion. Offline replay of that one actual result produced one matching page source, without another model or page request. The replay record verifies parser compatibility with that observed response; live job integration remains a separate check.

This is observational capture. A detected invalid URL, research-order violation, unsupported result or over-budget request fails the job and interrupts further agent work; it cannot claim that a native network request was prevented. Portable source-rich briefs are bounded at 192 KiB UTF-8, while Studio captures at most 64 KiB of web excerpts/metadata and retains its existing project file limits. The portable source attestation remains caller-provided and unverified after transfer.

### Completed researched comparison

The actual paired build `1d81d241-4e1c-4b86-950e-d41bd64cc18a` reused the same ready preparation `d7d2251d-f28c-4479-8d78-cdc0b0150c61`, original Echo Atlas brief, protected starter and Opus 5.5 model/effort for both arms. The real run report passed its source, phase-order, portable-export, protected-runtime and equal-input checks. Both sides recorded three provisional decisions and reconsidered all three before construction.

After loading the final implementation in a fresh server process, read-only re-verification passed without new model, Qloo or page-read calls. The browser reopened the saved Echo Atlas context and both completed preview arms. The 0.3.0 plugin archive was rebuilt and its 18 entries verified.

| Observed behavior | Qloo off | Qloo on |
| --- | --- | --- |
| Actual Qloo calls | 0 | 4: three Search and one videogame Insights |
| Actual native page reads | 2: Ambient music and Outer Wilds | 3: Night in the Woods, Obra Dinn and INSIDE official sites |
| Primary experience | Free six-place atlas, field notes and onward hints | Assignment-style introduction, four numbered mechanic reveals and separate sample levels |
| Interactive changes | Notes, discovered count, related-place connections, catalogue handoff and reset | Reveals, discovered count, cumulative pins/path, completion note and reveal-all shortcut |
| Preserved data | Six catalogue entries and original app.js | Identical six catalogue entries and original app.js |

The Qloo run changed its provisional all-at-once district map after reading returned neighbors and their actual pages. Two source-linked structure/interaction applications were declared before construction and applied to the saved website. Other works' visual-style tags were explicitly rejected as evidence of audience palette preference; INSIDE's quote/store-heavy page was not applied. Ambient was not found by Insights. Studio Ghibli resolved to an artist-type catalogue proxy rather than a film list. Returned per-entity seed credits are source metadata, not proof of audience motivation or design quality.

Actual browser verification exercised both generated discovery interfaces, keyboard activation, search, selection and local wishlist completion. Qloo's reveal-all reached four of four entries and its SVG path connected four points. At the 375-pixel breakpoint both sites had no horizontal overflow. No JavaScript errors or warnings were observed. Studio's Qloo W001 button opened its own fetched Night in the Woods record rather than baseline W001. The focused comparison lists screenshots and limitations. The generated artifacts were not hand-edited to improve the comparison.

The baseline's historical saved excerpts were navigation-heavy prefixes. A read-only inspection confirmed its quoted body facts existed in actual native tool results, but those passages were outside the public bounded excerpts. The parser now heuristically selects a contiguous literal prose window before bounding, with disclosed truncation/selection limits. A separate offline replay verifies exact original substrings; it made no model/network calls and did not overwrite or retroactively validate the historical run's anchors.

This is a visible but moderate change in visitor organization. Both arms still use reveals, atlas pins, connection lines and paper/ink styling. The Qloo guide has no actual sound, deduction puzzle or enforced sequential unlocking. This pair verifies the researched/replanning workflow and working outputs; it does not establish exclusive Qloo necessity, a superior design, conversion improvement or a hackathon-winning effect.

## Real Kiro baseline run — October 1, 2026

- A baseline job was started through the interface using the local-food starter and a Turkish design brief. This historical run predates the English-only product update.
- Model: the account's configured `claude-opus-5` model for the successful run; effort: `medium`. This historical model remains recorded on those jobs. Other installations must select an available model using `KIRO_MODEL`.
- Generation completed in approximately 3 minutes 57 seconds. Kiro saved `index.html`, `styles.css`, `app.js`, and `culture-decisions.json` with eight decisions through the project tools.
- The generated files were not manually edited to improve the design during this verification. They were subsequently localized to English as described below.
- Browser verification covered six products, product selection, search, and the seasonal filter. JSON file export worked.
- The generated website had no horizontal overflow at widths of 375 and 1440 pixels; no JavaScript errors or external network requests were observed.
- Studio displayed all six starters and was checked at widths of 375, 800, and 1440 pixels.
- The first attempt used a shorter timeout and failed before generation completed. The later successful run does not change that failed result into a success.

## Automated checks

The automated checks passed during the initial baseline verification. They cover Qloo parameters and error behavior, MCP protocol, disabled Qloo access in baseline sessions, file scope, Kiro tool/resource permissions, equivalent starters and models in comparisons, access tokens, and previews on a separate origin. External service responses in these checks are test fixtures only; the application has no simulated Qloo mode. Run `npm test` for the current result. The initial test count does not represent the entire expanded workflow.

Browser checks are in `scripts/verify-browser.mjs` and, for the successful local-food run, `scripts/verify-live-preview.mjs`. The first script does not call a model unless `--generate` is supplied. The second inspects an existing completed job.

## Expanded design workflow — October 2, 2026

Workspaces, audience groups, brand protections, creative direction planning, variant selection, section inspection, scoped revision, and portable JSON context were implemented. Mechanical checks for this workflow are in `tests/design-artifacts.test.mjs`, `tests/workflow.test.mjs`, and `tests/workflow-audit.test.mjs`.

- Schema limits, file paths, protected-file and protected-text violations, and links from directions to actual recorded entity and evidence IDs.
- Rejection of stale plans after a product brief or cultural context changes, and rejection of Qloo-derived plans in a disabled-mode run.
- Application of a model proposal only within the selected unique `#id`, preserving the source variant and `app.js`; rejection of out-of-scope CSS and active HTML proposals.
- Line differences derived from actual file contents, selection between completed variants, and reversion.
- Separation of a selected variant's immutable context from a subsequently edited draft, with preservation of the product brief during JSON export and import.
- Separation of the revision request from the original product brief, and acceptance of Studio artifacts by the portable plugin validator.

These checks use model and service responses injected only for testing. An audit test caught a regression in which omitted revision context could lose the source's brand protections. After fixing source workspace/context inheritance, all six focused audit tests were rerun and passed.

The new real Kiro baseline test recorded three creative directions corresponding to a harvest calendar, a shared table, and a single-column journal. The harvest calendar direction was selected to generate a website for one audience, followed by a real revision of `#intro-section`. The protected `app.js` remained unchanged; HTML outside the revision target was preserved exactly, CSS was extended only with target-scoped rules, and the source variant was not modified. These runs had Qloo disabled. The two taste groups contained user-authored sample references.

`scripts/verify-studio-workflow.mjs` inspects these three completed real jobs without making new model calls. Browser verification covered three direction cards, two audiences, JSON export/plugin compilation/import, an element-linked decision, rejection of a forged iframe message, and actual file differences. The revised website's six products, search, and product selection worked. Selection of the new variant, reversion to the old variant, and re-selection of the new variant were verified as persistent; the main product brief remained separate from the revision request. Studio had no horizontal overflow at widths of 375/800/1440 pixels, and both generated websites had none at 375/1440 pixels; no JavaScript errors were observed.

At this expanded-workflow checkpoint, the automated result was **70/70 passing**. These tests are not evidence of real Qloo access or cultural design benefits. The current 0.3.0 suite result is recorded below.

Imported evidence and provenance fields are caller-provided claims. Structural validation does not authenticate them as real Qloo calls; the model's design notes remain creative interpretation.

## English-only product update — October 2, 2026

Existing demos originated from the real Kiro runs described above. Their English copy and locale settings, including saved directions and decision notes, were then localized manually. Product IDs, prices, styles, and features were preserved. Original files, job metadata, and workspaces were backed up under `data/language-backups/` before editing.

Localization made no new model or Qloo calls and is not a new live generation test. The historical timings, model identifiers, and pre-localization scope checks above describe the original runs. Localized jobs expose a `localization` annotation through the API, and file diffs were recomputed from the actual English files.

Post-localization verification passed: **70/70 automated tests**, English Studio and starter copy at 375/800/1440 pixels, and both saved site variants at 375/1440 pixels. Search, product selection, decision inspection, JSON roundtrip, protected-file equality, scoped revision and accept/revert still worked with no JavaScript errors or new model calls. The earlier season-filter demo also passed search, filtering, selection and download checks. All six template runtimes and both interactive visitor experiences were checked; their IDs, prices and interactions were retained. The English portable plugin package was rebuilt and its 16 archive entries verified.

## Current model and language audit — October 2, 2026

The current generation model was switched to `claude-opus-5.5` on October 2, 2026 and confirmed in the installed Kiro CLI's `chat --list-models --format json --agent-engine v2` response. Existing jobs retain their original model IDs. This configuration check did not generate a new site.

An independent English-language audit covered 57 rendered states: Studio and Access, all six starters and their form/filter/selection states, saved planning/build/revision views and decision notes, and both visitor experiences with all branches. Visible text, accessibility labels, placeholders, titles and brief fields passed the language checks. Both exported JSON artifacts were also checked. There were no JavaScript errors or new generation requests; internal event keys, proper names and preserved historical backups are not visitor copy.

The active server configuration and the browser's generation-model label both reported `claude-opus-5.5`; workspace CLI settings matched. The saved run's original `claude-opus-5` attribution remained available through its metadata and the model-label tooltip.

Remaining fictional Turkish names were subsequently localized: Gather (food brand), Stillwater (hotel), Harbor Quartet and Fieldwork (sample artists), and Threadline (clothing brand). These names were updated in the six starters, saved sites, workspaces, design notes and exports, including HTML/SVG text and accessible labels. Original records were preserved in `data/language-backups/english-names-2026-10-02/`. Visitor choice keys now use English names. Twenty-two historical screenshots were archived under `output/archive/pre-name-localization-2026-10-02/`; current screenshots were recaptured from the updated pages. The saved-site workflow, earlier season-filter demo, Studio responsive checks and visitor interactions passed again with no new model calls.

## Not yet verified

- Real Qloo entity lookup, selected insights and one media-tag request now pass, with a returned Tokyo locality match as recorded below. Qloo-enabled Kiro website generation, broader tag/location coverage, multi-group analysis and the value of cultural design still require their own live verification.
- End-to-end Kiro/Qloo generation coverage has not been established across all six starters.
- Docker Compose configuration and entrypoint shell syntax were checked. The Linux Docker engine was unavailable, so image building and Linux Kiro execution were not tested.
- No AWS resource or public demo has been deployed. A headless API key tied to the same Kiro account has not yet been supplied for the server.

The next live verification should run the same brief in both modes using a real Qloo key and inspect design decisions against the returned entity and insights records. A visual difference alone does not prove Qloo's value.

## Creative policy 0.3.0 — October 2, 2026

The [creative policy](creative-policy.md) describes decision assessment, typed reference roles, a bounded two-domain investigation with one focused follow-up, evidence reuse and the key-free behavior. Its four domain recipes and additional scenarios specify expected actions. They are not observed cultural results or evidence that a model followed the policy.

`scripts/verify-creative-policy-live.mjs` is an opt-in real Kiro harness. Without `--run`, it only prints the planned cases and makes no CLI, model or Qloo call. With `--run`, it uses an isolated temporary Studio data directory and up to three `kind: prepare`, `mode: baseline` jobs with `claude-opus-5.5`:

- An open creative brief without supplied references should request clarification.
- A technical change that preserves the existing appearance should skip cultural research.
- A creative brief with sufficient typed references should be ready to research without asking for the same references again.

The harness forces the Qloo credential empty and checks that no Qloo evidence or Qloo tool-call event was recorded. It also checks that the public run exposes actual assessment tool-call records separately from the preparation artifact. Reports retain job IDs, the real captured model, timings, preparation context and logged calls; missing records or mismatched actions fail the run. It does not generate or revise sites.

The current complete automated suite passed **110/110 tests**, including the preserved 70 checks and the additional general creative-protocol and Studio preparation checks. The additional checks cover declared decision actions, reference roles and origins, reuse identity and query parameters, preparation responses, context matching and the separation of Qloo availability from real source support. They also exercise the actual portable STDIO entrypoint and standalone HTTP MCP assessment without credentials, failed source-call logging without fabricated evidence, and rejection of search-only records as cultural-research reuse. Model and external-service behavior in the automated tests remains injected test data, not live cultural evidence; the transport checks use real local processes and HTTP requests rather than another live model client.

Imported research was checked through normalization, workspace save/reload, export and operational-brief generation. Caller-provided records retain their unverified source IDs and decision links in `importedResearch`, with `complete: false` when a referenced source is absent. Link completeness does not authenticate an API call. A generated job writes that bundle to `culture-imported-context.json` rather than merging it into operational v1 evidence in `culture-brief.json`. The outer Studio export retains the imported bundle separately from its operational `context`; actual run records and their validated authored traces stay distinct from external claims.

The portable [0.3.0 package](../artifacts/culture-grounded-design-0.3.0.tar.gz) was rebuilt and all 18 archive entries were verified. Package checks confirm the manifest/server version and that the packaged shared policy matches the source. This is not evidence of installation in another agent or publication.

Three real Kiro preparation jobs then completed with the captured model `claude-opus-5.5`. Each recorded exactly one actual `culture_assess_decision` call, zero Qloo evidence records and no Qloo request trace. Preparation preserved the starter site files and exposed no website preview.

| Scenario | Observed action and status | Actual job |
| --- | --- | --- |
| Open creative request with no supplied references | `clarify`, `needs_input`; one focused reference question and suggested inspirations | `3b6c374e-adf7-46dd-a9e8-a1c7fb22ef98` |
| Technical navigation change preserving appearance | `skip`, `ready`; no reference question | `f516548e-8a73-4259-9137-5f5b7a5d72bf` |
| Creative request with typed audience and brand references | `research`, `ready`; existing names, roles and origins retained, with no repeated reference question | `ddc6ec9c-53f0-43ab-88ff-9a7baebb1929` |

The actual evaluation report contains the model-authored preparation and independently recorded assessment-call metadata. All three harness cases passed. In the third case, `research` is a decision to request later research; no Qloo research was performed. These jobs assessed briefs only and did not generate or revise websites.

This verifies the selected host model's behavior for the three Studio preparation cases. It does not verify a real Qloo integration, cultural benefits, general RPG/writing execution, another client's skill attachment or website generation under the new protocol. The broader domain recipes remain hypothetical. Browser integration of the new preparation flow is a separate check and is not claimed by these model runs.

## Preparation browser integration — October 2, 2026

[The browser integration script](../scripts/verify-preparation-workflow.mjs) passed against a real local Studio HTTP server, scoped assessment bridge and persisted workspaces, with a test-only injected runner. It used temporary data and ephemeral ports. There were **zero real Kiro model calls and zero real Qloo API calls**; the two cultural-response records were explicitly labeled injected fixtures. The browser report records 10 fixture assessment-bridge calls, nine browser job requests and no JavaScript errors.

The browser checks covered reference questions and options, no preparation preview, reload without automatic production, option selection without an additional runner call, one additional free-text preparation pass, resuming the pending request and rejecting stale answers in the interface and backend. Both comparison runs received equal prepared context and starting files, while baseline evidence remained separate from injected source records. Research decision notes rendered, and the flow was captured at widths of 375 and 1440 pixels.

Import → save → open a new workspace → reopen → save preserved the unverified bundle's provenance, wrapped source record and completeness flag. Context-owned imported sources took precedence over an outer fallback, and normalized imported context retained the preparation link for baseline production. The imported `IMPORT001` record stayed outside the run's evidence and operational v1 context; its original links remained in the sidecar, outer export and workspace draft. These checks verify persistence and source separation, not cultural accuracy or live Qloo integration. The three actual model assessments above remain the separate evidence for host-model behavior.

## Real Qloo API diagnostic — October 3, 2026 local time

The official [hackathon developer guide](https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide), Search, Insights, parameter and taxonomy references were read before testing. The actual API report records eight requests against `https://hackathon.api.qloo.com`, starting October 2 at 21:53 UTC, which is October 3 locally. No Kiro/model job was started by this diagnostic.

- Three real Search requests resolved exact catalog names for Nujabes, Paterson and Muji, using their relevant artist, movie and brand categories.
- Two insights requests using the resolved original references returned six artists and six brands. Both returned real per-entity and aggregate `query.explainability` metadata.
- A follow-up with three actual artist IDs from the returned list used `filter.results.entities` and returned three members of that shortlist.
- A game-category request with `urn:entity:videogame` returned HTTP 200 and two entities with that subtype. The conflicting guide spelling `urn:entity:video_game` returned HTTP 400. That rejected probe remains recorded and is not usable cultural evidence.

The diagnostic report passed its request-count, exact-reference, useful-insights and real-shortlist assertions. These results verify the selected API operations and canonical game spelling in the hackathon environment. They do not verify every category, geographic coverage, tag filters, multi-group comparison, a complete Qloo-enabled Kiro website or a measurable design benefit.

Search and Insights category lists are now separate in the client. Search's returned `types` array is preserved, and bounded upstream `responseQuery`/`warnings` are retained rather than inventing response metadata. Optional `tagTypes` and `parentTypes` map the documented Taste Analysis filters for `resultType: tag`; the later transport verification below records an actual media-tag response. The 20-result, 20-seed and 50-candidate bounds are application limits, not Qloo rate quotas. Unsupported or inapplicable parameters can be silently ignored by the API, so a successful status alone does not prove a requested filter was applied. See the [integration guide](qloo-integration.md).

## Live Qloo MCP transports — October 3, 2026 local time

[The opt-in transport harness](../scripts/verify-qloo-transports-live.mjs) ran once against the existing local Studio HTTP MCP endpoint and a fresh standalone STDIO MCP process. Both negotiated protocol `2025-06-18`, reported plugin version `0.3.0`, and discovered the culture/Qloo tools and tag-filter schemas. It made four source-tool calls, started no model jobs, and produced four usable source responses with no errors or empty results. The sanitized report retains the actual returned data and bounded metadata; no credential or authentication-header value is recorded.

- HTTP Search returned three Nujabes results, including the exact catalog name.
- Standalone STDIO Insights returned three artists using the resolved Paterson seed, with per-entity and aggregate explainability. The fresh standalone handler assigned an application-owned `culture-source:` UUID record ID; the previously running HTTP handler did not yet assign standalone source IDs. This difference is recorded rather than hiding it.
- HTTP tag analysis requested the media namespace and movie/TV parent categories and returned six tags. Every returned tag ID matched the requested namespace, and every row's returned parent metadata included at least one requested category. Those are observed consistencies, not a counterfactual proof that the filters changed the output. No explainability metadata was returned for this tag response despite the requested flag.
- HTTP artist Insights with `location: Tokyo` returned three artists and actual `responseQuery.localities.signal` metadata naming Tokyo with locality ID `00000000-0000-4000-8000-00000000000B`. The observed response used plural `localities`, differing from the documentation's singular example. The diagnostic's locality observation was corrected from the already captured metadata without another API request. The named-place resolution is established; a geographic influence on the artist ranking is not measured.

This verifies live source delivery over the two MCP transports and these specific tag/location requests. It does not verify multi-group inference, all-region coverage, an independently tested host-agent workflow, Qloo-enabled website production or cultural/design quality. The transport script prints a plan without networking by default; `--run` opts into at most four live source calls and remains model-free.

## Actual Kiro/Qloo website production — October 3, 2026 local time

One real Opus 5.5 preparation (`2fe4b0d4-90a4-45c1-a292-0fce8377bd2a`) assessed the fictional Gather food-site brief as `research`/`ready`, retained the typed references, made no Qloo requests and changed no website files. The comparison used audience references Nujabes and Paterson; Muji remained a separate brand reference.

The first comparison produced both sites and real cultural records, but its acceptance harness failed: invalid CSS-property entries and an empty optional reuse key prevented full creative-record validation. The failed report and original job remain intact. Production now validates the two creative-record files at write time and returns actionable errors to the running agent; the prompt explicitly distinguishes CSS property names from selectors and omits unavailable optional keys. A regression check verifies rejection before persistence and successful correction.

Both modes were then run again from independent original starter copies using the **same saved preparation**, same authored brief and same model/effort. Job `60093fb9-1126-4a0c-bb73-6233436dd72e` completed without warnings. The actual production report and read-only final verification passed:

| Check | Baseline | Qloo |
| --- | --- | --- |
| Model | `claude-opus-5.5` | `claude-opus-5.5` |
| Actual Qloo requests | 0 | 4 |
| Actual source records | 0 | 4 |
| Validated design decisions | 7 | 7 |
| Validated research traces | 2 | 5 |
| Design decisions linked to usable insights | 0 | 3 |

The Qloo agent resolved Nujabes and Paterson, then chose tag and movie insights as its two result domains. Returned tags included Calm, Quiet, Routine and Poetry alongside unrelated tags; its trace explicitly reports this mixture and the absent tag explainability. The movie response retained real returned seed-contribution metadata. Muji styling and runtime preservation were recorded as skipped research, preserving the difference between a brand reference and audience taste.

The trace connects these observations to numbered collection verses, the homepage tone and understated copy. Those artifact choices are model interpretation, not Qloo design instructions or a measured quality score. At least one complete research/reuse chain and each claimed insights-linked design target were checked against actual usable source IDs and existing output elements. The protected `app.js` matched the original starter byte-for-byte in both variants. Generated files and public job records were checked for absence of the server credential.

The opt-in [production harness](../scripts/verify-qloo-studio-live.mjs) prints its plan by default. `--run` consumes authenticated model/API usage; `--from-preparation=ID` reuses the matching intake; `--verify-job=ID` makes only read-only local requests. A completed production run verifies delivery and provenance. It does not establish that the Qloo design is better than the baseline or validate general game/RPG/writing outcomes.

## Actual comparison browser verification — October 3, 2026 local time

The [read-only browser harness](../scripts/verify-qloo-comparison-browser.mjs) passed over the completed actual comparison. The report, six screenshots and both downloaded site bundles retain the observed result. It made no new model/Qloo calls or workspace writes.

Both previews passed search, category filtering, alphabetical/price sorting, add/remove selection and native local form submission at widths of 375 and 1440 pixels. Original product IDs, names, prices and units were compared to the neutral starter. The Studio previews also passed embedded local form interactions. English document/copy guards passed, and all six desktop/mobile captures were visually reviewed. JavaScript errors and external/write request attempts were zero.

The browser exposed a preview-shell defect: omitting `allow-forms` blocked the native submit event before the local JavaScript handler could run. All three iframe sandboxes and the generated-content CSP now allow local form events while retaining `form-action 'none'`, `connect-src 'none'` and no `allow-same-origin`. The generated site files were unchanged. Header checks and the actual embedded form flow verify the correction.

GET-only workspace export then exposed a persistence defect: fallback selection used Map insertion order, which can reflect UUID directory order after restart. It now chooses the latest creation timestamp, while an explicitly selected variant still takes precedence. A regression check exercises nonchronological loading; the browser's final export matched this latest comparison and compiled with exactly its recorded source-mode evidence. This was the baseline snapshot because no variant was explicitly selected. Both separately downloaded variant briefs also compiled, keeping transferred source attestation caller-provided and unverified.

Actual evidence cards and decision-to-source links rendered; protected runtime equality, shared input context and source traceability remained intact. Browser verification establishes usable delivery of these two artifacts, not superior design or cultural effectiveness.

## Research application protocol and Echo Atlas audit — October 3, 2026

The focused audit inspected comparison `bfd0f15a-b157-4eb2-a126-a1518b42cd0b` against its real source records. The two pages shared the same typography, palette, city-map imagery and Listen / Map / Restore disclosures. Broad tag findings and post-hoc evidence attribution did not establish a material research contribution.

The upgraded shared policy records literal source anchors and an application plan before construction, then an applied/considered/not-applied disposition. Studio exposes the tentative approach, source finding, authored interpretation, output target, visitor check and tradeoff. Host-owned verification checks source correspondence, declaration timing, target presence and actual file/fragment changes. It is kept outside portable records. All project writes are serialized; a late revision declaration or a script linked after construction cannot retroactively gain a before-write check. JS-only interaction changes without a changed HTML target are explicitly unchecked for semantic effect. Old optional-field-free records and unverified imports remain compatible.

The complete automated suite passed **142/142 tests**, preserving the earlier checks. Added regressions cover literal-source rejection, portable trust boundaries, baseline implementation parity, prewrite timing, concurrency, additive scripts, revision-artifact ordering and Studio context retention/source navigation. Test service/model responses remain injected fixtures.

One real shared preparation (`76945765-1909-46c9-b8eb-1bc4d407a35d`) and paired build (`fe99f71e-806f-4939-be20-1f52e2bfe520`) then completed using `claude-opus-5.5`. They used the original Echo Atlas starter brief, with Outer Wilds, Studio Ghibli films and ambient music in their original audience roles; no Gather context was carried into this workspace. The real run report and read-only check after server reload preserve the observed result.

- Baseline made no Qloo requests. Qloo made two Search requests and one videogame Insights request, returning ten real neighbors with descriptions and seed explainability.
- Studio Ghibli's returned music/book entities did not resolve the intended film reference. Ambient music remained a broad unresolved genre. These limitations were preserved; only Outer Wilds became a seed.
- Both arms added local `experience.js`, preserving the starter's `app.js` exactly. The two source-anchored applications were recorded before website writes and pointed to existing changed HTML targets.
- Both arms independently built a six-point discovery map linked to existing catalogue facts. The Qloo version additionally reveals unknown point labels, counts visited points and accumulates an ordered discovery journal. Its journal interpretation cites returned Tacoma and Return of the Obra Dinn descriptions. An Edith Finch linear-vignette option was considered and rejected.
- Actual browser checks exercised map buttons, catalogue filtering, selection and local wishlist submission in both variants, with no JavaScript errors. The Qloo buttons also responded to Enter, and source-anchor navigation opened the actual matching Studio record. Responsive checks and captures are listed in the focused audit.

The functional journal is an observable incremental difference; the main map concept is shared. Neither the application checks nor this pair establishes a strong Qloo advantage, creative superiority or a feature a baseline model could never create. Resolving specific film and music references would be needed to evaluate the intended broader taste fusion. The portable plugin archive was rebuilt with 18 verified entries and the shared policy kept identical to the MCP/Kiro source.

# The blind spot benchmark: protocol

Pre-registered on 23 October 2026. This file and [`audiences.json`](audiences.json) are committed before any run. The agents' predictions are committed next, before Qloo measures any audience. The results come last, whatever they are.

## The question

When an AI coding agent is asked to design for an audience, how much of what that audience loves, as Qloo measures it, does the agent already know?

Every Moûsa session asks this once, for one audience. The eleven sessions in the gallery give a first answer:
- the frozen predictions named 22 of the 714 works Qloo measured (3.1%);
- 22 of the 245 works the agents predicted were measured (9.0%).

Those sessions share a few audiences, so they are not independent. This benchmark asks the same question of 20 audiences and three agents.

## Design

- **Audiences.** The 20 in [`audiences.json`](audiences.json), each named by two works or people the audience loves. They were chosen to span music, film, TV, books, games and people; mainstream and niche; and several audiences rooted outside the US and UK (Japan, India, Latin America). None is replaced after this commit.
- **Agents.** Claude Code, the Codex CLI and the Kiro CLI, each with its own default model. Each run records the agent's exact version and model.
- **The request.** Every run gets the same brief, the café in `audiences.json`, with the audience's two names set into it. The medium is web.

**Each run** has the same three steps.
1. **Moûsa plans the taste questions** (`taste_profile` with `dryRun`). The plan comes from the engine, with no model and no Qloo request, so every agent gets the same domains for an audience.
2. **The agent freezes its prediction** with Moûsa's own tool (`design_validate` with `stage: "prediction"`). The prediction holds three to six works for each planned domain, the qualities the agent expects, and the design it would make from them alone.
   - Qloo is not reachable in this step: no key is given to the session.
   - The agent has no file, shell or web tool.
   - The prompt is the live try's prediction prompt, adapted to say that Qloo is off on purpose.
   - The prediction is sealed with its SHA-256 at the freeze.
3. **After every prediction is committed to this repository, Moûsa measures each audience with Qloo.** This is `taste_profile` again, engine only, with no model. As in every session, each measured work is marked predicted or new, with the engine's liberal name match.

## Measures

- **Primary: known share.** The share of the works Qloo measured that the agent's frozen prediction named.
- **Secondary:**
  - **Confirmed share:** the share of the agent's predicted works that Qloo measured.
  - **Qualities known:** the share of the shared qualities that the prediction named.
  - **Known share by domain:** pooled over audiences.

For each agent, a measure is the mean over audiences, with every audience weighted equally. A 95% bootstrap interval over audiences (10,000 resamples, seed 20261023) is reported beside it, and so are the pooled sums.

## Hypotheses

The thresholds come from the eleven-session pilot above.
- **H1.** For each agent, the mean known share is below 15%.
- **H2.** For each agent, the mean confirmed share is below 25%.

Each is read three ways:
- **supported** when the interval's upper bound is below the threshold;
- **not established** when the mean is below the threshold but the interval is not;
- **not supported** otherwise.

**Exploratory, and labelled so:**
- differences between agents, paired by audience;
- the domains with the largest blind spots;
- whether better-known audiences are better predicted.

## Exclusions and failures

- **An audience Qloo cannot measure.** If Qloo cannot resolve the audience's names, or measures too little for a Taste Brief, the audience is reported and left out of every agent's means.
- **A failed run.** A run whose agent freezes no prediction within six minutes is tried once more. A second failure is reported as a failure and counted in no mean.
- **No changes after this commit.** Nothing is re-run because of its result, and no prediction is edited: its seal would no longer match.

## What it does not show

- **Qloo's measurement is aggregate affinity data, not ground truth about any person.** A work missing from Qloo's lists may still be loved.
- **The two lists differ in size.** The agent names three to six works per domain; Qloo measures about 60 to 80 works in all. Both shares are bounded by this. Read them together: neither alone says the agent is wrong.
- **The name match is liberal.** It can only raise the known share.
- **It is one prompt, one brief and one run per agent and audience.** It measures what each agent assumes when Moûsa asks it, not everything a model knows.
- **It says nothing about whether a design made with Qloo is better.** That is a separate question, which [the evidence record](../verification.md) treats.

## Data

- **The predictions are the agents' own words** and hold no Qloo data. They are published in [`predictions/`](predictions/), one file per agent and audience, with their seals.
- **The results publish the names Qloo measured and the counts, never Qloo's ids, scores or descriptions.** Qloo's answers stay on the machine that asked for them, as Qloo's developer guide requires.

## Amendments

**1. Models, and Codex's skill reads (23 October 2026).** Made before any run of the benchmark, after a pilot on an audience outside the list (The Bear and Fleetwood Mac). The pilot's predictions are not part of the benchmark.
- **Why "each agent's own default model" had to change.** It could not be recorded for two agents.
  - Kiro's default is `auto`, which picks a model by task and does not say which one answered.
  - Codex started without the person's config.toml (as Moûsa's live runs start it) defaults to gpt-6.1-sol at reasoning effort none. The person's own setting is the same model at high effort.
- **The models each agent now runs with.** Each is the model the person uses with Moûsa:
  - Claude Code: its default from the person's settings, claude-opus-5-5 with the 1M context window.
  - Codex: the person's config.toml model and reasoning effort, passed by name, gpt-6.1-sol at high.
  - Kiro: the hosted try's model, claude-opus-5.5.
- **Codex's shell.** Codex reads a skill's files with its shell, in a read-only sandbox, because it has no other way to read them. Each Codex command is checked to be such a read. A session that ran any other command is set aside and run once more, and a second such session is a failure.

## Reproduce

```sh
node scripts/benchmark.mjs plan        # the folders and the engine's plans: no model, no request
node scripts/benchmark.mjs predict --host claude-code   # then codex, then kiro
node scripts/benchmark.mjs measure     # Qloo, after the predictions are committed
node scripts/benchmark.mjs analyze     # results.json and results.md
```

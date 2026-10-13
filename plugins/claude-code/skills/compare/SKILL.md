---
name: compare
description: Run only when the person explicitly asks to compare a design made with Qloo against one made without it, from the same brief. It builds both arms in their own workspaces from one frozen prediction, measures the audience once, and reports how far the two designs differ and how much of the Qloo design rests on what the prediction did not contain.
disable-model-invocation: true
---

# Compare a design with Qloo and without

A comparison shows what measured taste changed. Both arms get the same brief, the same plan, the same frozen prediction and the same stages; only the source of the taste differs:
- the **Qloo arm** measures the audience;
- the **baseline arm** designs from the prediction alone.

**The cost.** It costs two full design runs and one measurement of at most 24 Qloo requests. Tell the person before you start.

## The workspaces

| Arm | workspace | Taste |
| --- | --- | --- |
| With Qloo | `compare/with-qloo` | `taste_profile({ workspace })` |
| Without Qloo | `compare/without-qloo` | `taste_profile({ baseline: true, workspace })` |

Each workspace holds its arm's files and its own `.mousa/` records. Pass the arm's `workspace` to every Moûsa call of that arm, and build its files inside its folder. When the design restyles an existing project, first copy the starter files, unchanged, into both folders.

## Steps

1. **Agree on the brief** and collect the audience signal, as in the `taste-brief` skill (step 1).
2. **Plan both arms with identical arguments.** Call `taste_profile({ dryRun: true, medium, references, ..., workspace })` once for each workspace.
3. **Write one prediction and its design sketch** before any Qloo data. Save the identical artifact in both workspaces: `design_validate({ stage: 'prediction', artifact, workspace })`.
4. **Set the baseline arm to design without Qloo.** Call `taste_profile({ baseline: true, workspace: 'compare/without-qloo' })` now, before either arm is built. From here on, every Qloo call is refused in that workspace, so the baseline cannot measure by mistake.
5. **Build both arms, each through the `design` skill's review.**
   - **The baseline arm** starts from its reading.
   - **The Qloo arm** first measures with `taste_profile({ workspace: 'compare/with-qloo' })`, then builds, using `taste_ask` as in any design.

   How the arms run depends on the host:
   - **Claude Code.** Give the arms to this plugin's agents: `mousa:mousa-baseline` for the baseline and `mousa:mousa-designer` for the Qloo arm. Give each the brief and its workspace. Each works in its own context and folder, so they may run at the same time. The baseline agent has no Qloo tools.
   - **Codex and other hosts.** Build the baseline arm first, in this session, before measuring, so it is built before any Qloo data is seen. Then measure and build the Qloo arm. Say in the report that the Qloo arm was built after the baseline. For a cleaner pair, build each arm in a session of its own.
6. **Compare.** Call `design_compare({ a: 'compare/with-qloo', b: 'compare/without-qloo' })`.
7. **Report:**
   - the distance, overall and by palette, type, sections and CSS features;
   - `samePrediction`;
   - the Qloo arm's headline: how many devices rest on what the prediction did not contain;
   - each arm's review verdicts and repairs;
   - the limits below.

## Fairness

- Give both arms the same effort, stages, tools and capabilities. Never weaken the baseline.
- While building one arm, do not open the other arm's files.
- Keep every product fact in both.

## Limits to report

- One pair is one sample. Model variance alone makes two designs differ, so a single distance does not isolate Qloo's effect. Repeat the pair before calling a difference the data's effect.
- The distance compares palettes, type classes, landmark sections and CSS features. It does not measure quality or what people prefer.
- The headline counts devices anchored to surprises. It shows that the data changed the specification, not that the result is better.

# The blind spot benchmark: results

Analyzed 2026-10-23 under the [pre-registered protocol](README.md). 20 of 20 audiences could be measured.

| Agent | Runs | Known share (mean, 95% interval) | Confirmed share (mean, 95% interval) | H1 (< 15%) | H2 (< 25%) |
|---|---|---|---|---|---|
| claude-code (claude-opus-5-5[1m]) | 20 | 6.8% (5.2% to 8.5%) | 16.1% (12.3% to 20.0%) | supported | supported |
| codex (gpt-6.1-sol (reasoning effort high)) | 20 | 4.7% (3.2% to 6.1%) | 13.9% (9.7% to 18.2%) | supported | supported |
| kiro (claude-opus-5.5) | 20 | 6.6% (5.2% to 8.0%) | 15.8% (12.4% to 19.3%) | supported | supported |

Pooled over audiences:
- claude-code: the predictions named 95 of 1395 measured works (6.8%); 92 of 571 predicted works were measured (16.1%).
- codex: the predictions named 65 of 1395 measured works (4.7%); 64 of 456 predicted works were measured (14.0%).
- kiro: the predictions named 92 of 1395 measured works (6.6%); 89 of 565 predicted works were measured (15.8%).

Exploratory, paired by audience (known share, first agent minus second):
- claude-code − codex: 2.2% over 20 audiences (1.2% to 3.2%)
- claude-code − kiro: 0.2% over 20 audiences (-0.4% to 0.9%)
- codex − kiro: -1.9% over 20 audiences (-2.7% to -1.1%)

Every run, its prediction and its seal are in results.json and predictions/. Qloo's names appear there; its ids, scores and descriptions do not.

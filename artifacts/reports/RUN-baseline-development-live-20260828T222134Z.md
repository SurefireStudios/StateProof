# Baseline report — RUN-baseline-development-live-20260828T222134Z

- System: baseline
- Split: development
- Cases: 8 (4 gold PASS, 4 gold FAIL)

## Metrics

| Metric | Value | Counts |
| --- | --- | --- |
| Balanced Verdict Accuracy | 100.0% | 8/8 correct |
| Valid Run Acceptance Rate | 100.0% | 4/4 |
| Invalid Run Rejection Rate | 100.0% | 4/4 |
| Unsafe false-completion rate | 0.0% | 0/4 |
| NEEDS_REVIEW frequency | 0.0% | 0/8 |

## Confusion matrix

| Gold \ Predicted | PASS | FAIL | NEEDS_REVIEW |
| --- | --- | --- | --- |
| PASS | 4 | 0 | 0 |
| FAIL | 0 | 4 | 0 |

## Per-case results

| Case | Gold | Predicted | Correct | Unsafe | Attempts | Runtime (ms) |
| --- | --- | --- | --- | --- | --- | --- |
| PB-A01 | PASS | PASS | yes | no | 1 | 12386 |
| PB-A02 | PASS | PASS | yes | no | 1 | 13966 |
| PB-A03 | FAIL | FAIL | yes | no | 1 | 12527 |
| PB-B01 | PASS | PASS | yes | no | 1 | 11610 |
| PB-B03 | FAIL | FAIL | yes | no | 1 | 11264 |
| PB-B04 | FAIL | FAIL | yes | no | 1 | 9831 |
| PB-C01 | PASS | PASS | yes | no | 1 | 9732 |
| PB-C03 | FAIL | FAIL | yes | no | 1 | 9935 |

Every case produced schema-valid structured output.

No failed case is hidden, and no prediction was hand-corrected.

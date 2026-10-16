# AI evals

`pnpm --filter ./evals test` runs unit tests and then the eval harness. Unit tests use only
recorded responses or injected fakes, including the transport test of the real adapter.
The harness always runs the entire recorded set through the registry's `FakeAiProvider`,
the production `CappedAiProvider` and the production parse, normalisation and insight services.
Pending photos are counted and skipped; their recorded output contracts are still validated.
No database, Azure access, real person or real health data is involved.

Without a key the command succeeds after printing:

```text
5 photo cases pending an image
live evals skipped: no ANTHROPIC_API_KEY
```

With `ANTHROPIC_API_KEY_EVALS` (preferred) or `ANTHROPIC_API_KEY`, the harness also runs live
through the registry's Anthropic adapter and a shared `MemoryAiCallRepository` with a 200-call
cap. Four workers run cases concurrently. An injected, provider-neutral transport honours
429 `retry-after` seconds or HTTP dates, including retries in a separate 200-request cap.
Both HTTP work and retry waits abort at the three-minute live-run deadline. The eval-only
request timeout uses that budget so a long `retry-after` can complete; production keeps its
normal per-role timeouts. Caps, budget
exhaustion, schema errors, refusals and missed thresholds fail the command. No key or model
response is printed; reports contain only counts, scores and fictional case ids.
A full live run costs approximately $2, as estimated in the approved plan; it has no measured
baseline yet. Use a dedicated eval key with its own spend limit (#72).

## Scopes and thresholds

`EVALS_SCOPE=pr` is the default: live parses, normalisations, meal insights and at most ten ready
photo cases, ordered by filename. `EVALS_SCOPE=release` adds weekly insights and every ready
photo. The fake run always covers all text cases, regardless of scope. PR CI invokes the command
only when `evals/`, `web/src/ai/` or `shared/src/ai/` changes; it maps the dedicated repository
secret to `ANTHROPIC_API_KEY`. Release wiring is owned by the release lane.

`thresholds.json` is reviewed configuration, initially `"baseline": "unset"`:

| Metric             | Minimum | Definition                                                                                                   |
| ------------------ | ------- | ------------------------------------------------------------------------------------------------------------ |
| Parse item recall  | 0.80    | Expected folded name is a substring of a returned item's food/estimate name; each returned item matches once |
| Parse quantities   | 0.60    | Carbs within ±25% of expected, among matched items                                                           |
| Photo accuracy     | 0.50    | Total carbs within ±30% of the sum of weighed item carbs                                                     |
| Normalised names   | 0.80    | Folded expected name occurs in the generated name                                                            |
| Unmatched messages | 1.00    | Expected unmatched text occurs in the returned unmatched list                                                |

Photo accuracy is enforced once the **whole corpus** has at least twenty images, including
when a PR evaluates only ten. Zero-carb targets require an exact zero. Gram quantities use the
matched food's carbs per 100 g; named portions use its recorded portion carbs.
Every raw output string passes `assertNoDosing` before production services can retry or filter
it; a hit fails the run even if a later response is acceptable. Insight strings additionally
reject `trykket` / `registreringen`, inherited advice verbs and numbers absent from the exact
projected model input (comma and dot decimal forms compare equally). These safety thresholds
are zero hits. Accepted fixtures contain no rejected prose; guard tests script negative outputs.
After the first keyed live run, record its measured baseline in a follow-up PR and tighten
accuracy thresholds to baseline minus a margin. Never lower a threshold just to pass a run.

## Adding a case

Each JSON file under `cases/{parse,normalise,insight,photo}/` contains a unique `id`, `kind` and
`locale`. Follow the existing cases, which are validated against strict schemas in `src/cases.ts`.
Add a separately authored recorded provider script under that id in `fixtures/answers.json`.
Those answers are fictional structured responses, not a generated copy of expected results.

- Parse: `text`, `expected` items (`name`, `carbs` and `portion` or `grams`), and `unmatched`.
  The library tool reads only `fixtures/library.json`, independent of expected answers. Its
  fictional foods mirror the seed foods, marked unverified, with a few spelling aliases.
  Recorded scripts include the lookup tool calls and final structured meal, so identity and
  nutrition validation in the production parse service runs too.
- Normalise: a fictional OFF-style `name` and the `expected` normalised name.
- Insight: `kind: meal` with an `InsightInput`, or `kind: week` with a `WeekInsightInput`.
  Only aggregate `InsightStats` / `InsightNumbers` belong here, never readings. Meal comparisons
  include different `leadMinutes` and peaks that tempt a timing recommendation.
- Photo: follow [the photo handoff](cases/photo/README.md). The owner supplies plate images
  and weighed or label-read targets in #72. Pending targets are fictional examples, not measurements.

Run `pnpm --filter ./evals test` after any case or prompt change. Run the same command with
`EVALS_SCOPE=release` and the dedicated key for a full live baseline. All cases and outputs stay
fictional; image privacy and dimensions are checked even for images not referenced by a case.

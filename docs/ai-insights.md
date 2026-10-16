# AI observations

Meal detail shows an **Observation · AI** for owners and carers when AI is enabled for the space.
The sentence becomes available once the meal's three-hour statistics window is complete. It describes
computed statistics and earlier occurrences of the same meal. Simple mode has no observation.

The meal route computes statistics through the history service and projects them through
`shared/src/ai/insight/input.ts`. The provider receives aggregate values and local meal labels, never
reading series, reading timestamps, member names or identifiers. A hash of the projected input caches
the sentence separately for each locale. Converted display glucose values are deterministic statistics
included in the provider input when mg/dL is selected. Changed statistics or meal labels produce a new hash. The service checks generated
numerals against the input and retries rejected text once. AI-off, incomplete-window, exhausted-cap
and unavailable-provider states do not produce a sentence.

The poller's `weekly-insight` timer runs hourly at five minutes past the hour. It visits AI-enabled
spaces between Sunday 18:00 and Monday 06:00 in each space's timezone and generates the summary for
the week starting on the preceding Monday. It stores one weekly snapshot; later history changes do
not regenerate that snapshot. The language follows the subject's preference, with Danish as the
fallback for a space without a subject. The provider and shared daily cap follow the space settings.
One space's failure does not stop the remaining spaces, and logs contain identifiers, counts and
error codes rather than generated text.

History reads the weekly cache without calling a provider. On phones the week card shows the summary
and questions; desktop shows questions only. Owners and carers can edit and copy the questions.
Edits remain unverified and emit `insight.updated`; generated rows emit `insight.created`. The store
is the only production writer of the existing Insight model. Unsafe questions are dropped and counted;
an unsafe summary is retried once, then rejected without a stored row.

All generated strings and edited questions pass the generated-text vocabulary guard. Tests use
fictional data and `FakeAiProvider` behind the same capped interface used in production. No provider
is configured by this feature; an installation without keys keeps AI unavailable until configured.

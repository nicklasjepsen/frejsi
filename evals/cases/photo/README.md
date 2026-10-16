# Plate photo cases — pending the owner (#72)

Photos come from the owner. They show plates only: no faces, identifying marks, hands, documents
or surroundings that identify anyone. Agents do not invent owner photographs. The five pending
cases describe fictional plate layouts, masses and carb targets so the format is ready; their
numbers must be replaced with weighed or label-read values when an image arrives.

A case contains `id`, `kind: "photo"`, `locale`, `description`, `photo`, and `items` with `name`,
`grams` and `carbs`. Set `photo` to `"pending"` until the owner supplies the image. Ready files
use a plain filename such as `plate-01.jpg` under `images/`; subdirectories and relative paths
are rejected. Zero cases is valid. The harness prints the pending count and evaluates only ready
cases. The accuracy threshold starts when the corpus contains twenty images.

Before committing an owner-supplied file, strip metadata and downscale it with `preparePhoto`
from `evals/src/photo.ts` (which uses the production photo processor). Write the returned bytes
under `images/`, update the case's targets and add its fictional response to
`evals/fixtures/answers.json`. Images must be JPEG, no dimension over 1600 px, without EXIF,
XMP, IPTC, ICC or comment metadata. The loader rejects unprocessed images rather than silently
rewriting tracked files. `src/photo.test.ts` exercises stripping and dimension checks using a
synthetic image generated in memory; it contains no camera photo or identifying metadata.

# Recipe fixtures

Hand-written, fictional recipes with round numbers for the recipe parser tests and the evals
(v0.6.0 plan §6). No real site, author, photo or person; the JSON-LD page imitates the
`schema.org/Recipe` shape that recipe sites publish, nothing more.

- `lasagne.jsonld.html`: a page with `application/ld+json` of `@type: Recipe`, read without a
  model call. Six ingredient lines in the amount-unit-name grammar and `recipeYield: "6 portioner"`.
- `lasagne.txt`: the same recipe as pasted text, for the model path and the text eval case.
- `boller.txt`: a sweet bun recipe as pasted text with dl, spsk, tsk and stk units.

The amounts are chosen so the expected carbs are easy to check by hand against
`evals/fixtures/library.json`.

# Contributing to Frejsi

Thank you. Frejsi is small and early; the best contributions right now are food-source plugins for your country, glucose-source adapters, translations, and corrections to the spec.

## Ground rules

- **No insulin dosing features.** Pull requests that compute, suggest or display insulin units, ratios or corrections will be closed. This is a product boundary, not a technical limitation.
- Everything that enters the food library from an external source or AI is unverified until a human ticks it. Keep it that way.
- No real people, no real health data in fixtures, seeds, screenshots or docs.

## Developer Certificate of Origin

We use the [DCO](https://developercertificate.org/) instead of a CLA. Sign off every commit:

```
git commit -s -m "feat: add matvaretabellen food source"
```

## Workflow

1. Open an issue first for anything bigger than a typo.
2. Branch from `main`, keep PRs small, add tests next to the code.
3. Conventional commit messages (`feat:`, `fix:`, `docs:` …).
4. English in code, comments, commits and docs. UI strings go through i18n (`da`, `en`).

## Licence

By contributing you agree your contribution is licensed under [AGPL-3.0](LICENSE).

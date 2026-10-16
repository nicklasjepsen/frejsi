// The deployment's variables reach deploy.sh from the workflows (plan v0.5.0 section 7 and 9).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { repoRoot } from './helpers.mjs';

const read = (name) => readFileSync(path.join(repoRoot, '.github/workflows', name), 'utf8');

test('release.yml and preview.yml read the resource group from AZURE_RESOURCE_GROUP, defaulting to frejsi', () => {
  for (const name of ['release.yml', 'preview.yml']) {
    assert.match(read(name), /^ {2}AZURE_RESOURCE_GROUP: \$\{\{ vars\.AZURE_RESOURCE_GROUP \|\| 'frejsi' \}\}$/m, name);
  }
});

test('the deploy step hands DEFAULT_LOCALE, FOOD_SOURCES, OFF_COUNTRY and OFF_CONTRIBUTE_HOST to deploy.sh from repository variables', () => {
  const release = read('release.yml');
  const step = release.slice(release.indexOf('(infra/deploy.sh)'), release.indexOf('run: bash infra/deploy.sh'));
  for (const name of ['DEFAULT_LOCALE', 'FOOD_SOURCES', 'OFF_COUNTRY', 'OFF_CONTRIBUTE_HOST']) {
    assert.match(step, new RegExp(`^ {10}${name}: \\$\\{\\{ vars\\.${name} \\}\\}$`, 'm'), name);
  }
});

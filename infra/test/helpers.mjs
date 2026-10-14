// Shared helpers for the infra tests. Node's built-in test runner only; no workspace needed,
// so this directory runs before the pnpm scaffold exists and in infra-check.yml.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const infraDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const repoRoot = path.resolve(infraDir, '..');

/** Resolve the bicep CLI: $BICEP, then PATH, then ~/.local/bin/bicep. */
export function bicepBin() {
  const candidates = [process.env.BICEP, 'bicep', path.join(process.env.HOME ?? '', '.local/bin/bicep')];
  for (const c of candidates) {
    if (!c) continue;
    const r = spawnSync(c, ['--version'], { encoding: 'utf8' });
    if (r.status === 0) return c;
  }
  throw new Error('bicep CLI not found; set $BICEP or install it on PATH (see infra/README.md)');
}

export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', cwd: repoRoot, ...opts });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** Build main.bicep to ARM JSON (stdout) and parse it. Throws on any diagnostic. */
export function buildMain() {
  const r = run(bicepBin(), ['build', path.join(infraDir, 'main.bicep'), '--stdout']);
  if (r.status !== 0 || /warning|error/i.test(r.stderr)) {
    throw new Error(`bicep build failed or warned:\n${r.stderr}`);
  }
  return JSON.parse(r.stdout);
}

/**
 * Minimal ARM expression resolver, enough to evaluate `tags`, `sku` and app settings in the built
 * JSON: literals, `[parameters('x')]`, `[variables('x')]`, `[format(...)]` with string args and
 * `[newGuid()]`. Anything else is returned as the raw expression string so a test can fail loudly.
 */
export function resolve(value, scope) {
  if (typeof value !== 'string') {
    if (Array.isArray(value)) return value.map((v) => resolve(v, scope));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v, scope)]));
    }
    return value;
  }
  if (!value.startsWith('[') || !value.endsWith(']')) return value;
  const expr = value.slice(1, -1);
  let m = expr.match(/^parameters\('([^']+)'\)$/);
  if (m) {
    const name = m[1];
    if (scope.paramValues && name in scope.paramValues) return resolve(scope.paramValues[name], scope.parent);
    const def = scope.template.parameters?.[name]?.defaultValue;
    return def === undefined ? value : resolve(def, scope);
  }
  m = expr.match(/^variables\('([^']+)'\)$/);
  if (m) {
    const v = scope.template.variables?.[m[1]];
    return v === undefined ? value : resolve(v, scope);
  }
  m = expr.match(/^format\('([^']*)'(?:,\s*(.*))?\)$/);
  if (m) {
    const args = m[2] ? splitArgs(m[2]).map((a) => resolve(`[${a}]`, scope)) : [];
    return m[1].replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)]));
  }
  return value;
}

function splitArgs(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  let inStr = false;
  for (const ch of s) {
    if (ch === "'" ) inStr = !inStr;
    if (!inStr) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) {
        out.push(cur.trim());
        cur = '';
        continue;
      }
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * Walk every resource in the template and in every nested module template, yielding
 * `{ resource, scope, modulePath }` where `scope` lets `resolve()` evaluate expressions.
 */
export function* walkResources(template, scope = { template, paramValues: null, parent: null }, modulePath = 'main') {
  const resources = template.resources;
  const list = Array.isArray(resources) ? resources : Object.values(resources ?? {});
  for (const resource of list) {
    if (resource.type === 'Microsoft.Resources/deployments' && resource.properties?.template) {
      const paramValues = Object.fromEntries(
        Object.entries(resource.properties.parameters ?? {}).map(([k, v]) => [k, v.value]),
      );
      const nested = resource.properties.template;
      yield* walkResources(nested, { template: nested, paramValues, parent: scope }, `${modulePath}/${resource.name}`);
    } else {
      yield { resource, scope, modulePath };
    }
  }
}

export function readIfExists(p) {
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

#!/usr/bin/env bash
# Lists what is inside the three images and fails on anything that must never ship in one: an .env
# file, a key or certificate, a secrets directory, test fixtures, git history. Used by
# .github/workflows/compose-check.yml; run it by hand after `docker compose -f docker/compose.yaml build`.
# Paths inside node_modules are other people's packages and are not judged.
set -euo pipefail

images=(frejsi-web frejsi-poller frejsi-migrate)
[ "$#" -gt 0 ] && images=("$@")

forbidden='(^|/)\.env(\..*)?$|(^|/)\.git(/|ignore$|attributes$)|(^|/)\.github(/|$)|\.(pem|key|pfx|p12)$|(^|/)secrets?(/|$)|(^|/)fixtures?(/|$)|(^|/)docker/\.env'
status=0
for image in "${images[@]}"; do
  container="$(docker create "$image")"
  listing="$(docker export "$container" | tar -t | sed 's|^\./||')"
  docker rm "$container" >/dev/null
  echo "== ${image}: $(printf '%s\n' "$listing" | wc -l) entries"
  hits="$(printf '%s\n' "$listing" | grep -v 'node_modules/' | grep -E "$forbidden" || true)"
  # The Functions image carries an empty Secrets directory of its own; the app puts nothing in it.
  hits="$(printf '%s\n' "$hits" | grep -Ev '^azure-functions-host/Secrets/?$|^(usr|opt|etc|var|proc|sys|lib)/' || true)"
  if [ -n "$hits" ]; then
    echo "forbidden files in ${image}:" >&2
    printf '%s\n' "$hits" >&2
    status=1
  fi
done
exit "$status"

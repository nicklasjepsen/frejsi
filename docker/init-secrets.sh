#!/usr/bin/env bash
# Generates the secrets a Docker Compose install needs, once, on this machine. Nothing it writes is
# ever committed or put in an image: docker/.env is ignored by git and by .dockerignore, and the two
# volumes are Docker volumes. Re-running keeps what exists (use --rotate to start over).
#
#   docker/.env              from docker/.env.example, every <generated-by-init-secrets> filled in
#   volume frejsi-host-keys  host.json and source-connect.json for the Functions host (function key)
#   volume frejsi-credentials  empty; the poller stores glucose-source credentials here
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
env_file="${here}/.env"
placeholder="<generated-by-init-secrets>"
helper_image="${INIT_SECRETS_IMAGE:-alpine:3.22}"

random() { # 32 hex characters per 16 bytes, letters and digits only
  od -An -N"${1:-24}" -tx1 /dev/urandom | tr -d ' \n'
}

rotate=0
[ "${1:-}" = "--rotate" ] && rotate=1

command -v docker >/dev/null || { echo "docker is required" >&2; exit 1; }

if [ -f "$env_file" ] && [ "$rotate" -eq 0 ]; then
  echo "docker/.env already exists; keeping it (--rotate replaces it and the keys)."
else
  sa_password="Fj$(random 12)aA1"      # meets SQL Server's complexity rules, no ; or } characters
  bootstrap_token="$(random 24)"
  connect_key="$(random 24)"
  azurite_key="$(head -c 32 /dev/urandom | base64 | tr -d '\n')"
  umask 077
  tmp="$(mktemp "${here}/.env.XXXXXX")"
  sed -e "s|^SQL_SA_PASSWORD=.*|SQL_SA_PASSWORD=\"${sa_password}\"|" \
      -e "s|^BOOTSTRAP_TOKEN=.*|BOOTSTRAP_TOKEN=\"${bootstrap_token}\"|" \
      -e "s|^SOURCE_CONNECT_KEY=.*|SOURCE_CONNECT_KEY=\"${connect_key}\"|" \
      -e "s|^AZURITE_ACCOUNT_KEY=.*|AZURITE_ACCOUNT_KEY=\"${azurite_key}\"|" \
      -e "s|password=${placeholder}|password=${sa_password}|" \
      -e "s|AccountKey=${placeholder}|AccountKey=${azurite_key}|" \
      "${here}/.env.example" >"$tmp"
  if grep -v "^#" "$tmp" | grep -q "$placeholder"; then
    rm -f "$tmp"; echo "a placeholder is left in docker/.env; docker/.env.example changed shape" >&2; exit 1
  fi
  mv "$tmp" "$env_file"
  chmod 600 "$env_file"
  echo "wrote docker/.env (mode 600)"
fi

# shellcheck disable=SC1090
connect_key="$(sed -n 's/^SOURCE_CONNECT_KEY="\(.*\)"$/\1/p' "$env_file")"
[ -n "$connect_key" ] || { echo "SOURCE_CONNECT_KEY is empty in docker/.env" >&2; exit 1; }

docker volume create frejsi-host-keys >/dev/null
docker volume create frejsi-credentials >/dev/null

# The Functions host reads its keys from files (AzureWebJobsSecretStorageType=Files): host.json holds
# the host keys, <function>.json the keys of one function. Unencrypted, as the host accepts them.
master_key="$(random 24)"
docker run --rm -i -e "MASTER_KEY=${master_key}" -e "CONNECT_KEY=${connect_key}" -e "FORCE=${rotate}" \
  -v frejsi-host-keys:/keys -v frejsi-credentials:/credentials "$helper_image" sh -eu -c '
    umask 077
    if [ ! -f /keys/host.json ] || [ "$FORCE" = 1 ]; then
      printf "{\"masterKey\":{\"name\":\"master\",\"value\":\"%s\",\"encrypted\":false},\"functionKeys\":[],\"systemKeys\":[]}\n" "$MASTER_KEY" >/keys/host.json
    fi
    printf "{\"keys\":[{\"name\":\"default\",\"value\":\"%s\",\"encrypted\":false}]}\n" "$CONNECT_KEY" >/keys/source-connect.json.tmp
    mv /keys/source-connect.json.tmp /keys/source-connect.json
    chmod 600 /keys/host.json /keys/source-connect.json
    chmod 700 /credentials
  '

echo "wrote the function keys to the frejsi-host-keys volume"
echo "next: docker compose -f docker/compose.yaml up --build"
echo "the bootstrap token is in docker/.env (BOOTSTRAP_TOKEN); it is not printed here."

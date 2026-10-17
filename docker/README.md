# Frejsi on Docker Compose

Everything needed to run Frejsi on one host with Docker and nothing else. The walkthrough for people
is the "Docker Compose (any host with Docker)" section of
[docs/deploy-your-own.md](../docs/deploy-your-own.md#docker-compose-any-host-with-docker); this page
is the reference for the files and the record of the one manual verification.

## Files

| File                      | What it is                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `compose.yaml`            | `sql` (SQL Server 2025), `azurite`, the one-shot `migrate`, `web` and `poller`                                                                          |
| `.env.example`            | every setting, placeholders only; `init-secrets.sh` turns it into `docker/.env`                                                                         |
| `init-secrets.sh`         | generates the secrets once: `docker/.env` (mode 600) and the `frejsi-host-keys` and `frejsi-credentials` volumes                                        |
| `web.Dockerfile`          | `next build` in a Debian Node stage; the standalone output (with `.next/static` and `public`) runs as the `node` user from `web/server.js`              |
| `poller.Dockerfile`       | the esbuild bundle (`pnpm --filter ./poller build`) copied into `mcr.microsoft.com/azure-functions/node:4-node22`                                       |
| `migrate.Dockerfile`      | the Prisma CLI and `shared/prisma/`; runs `prisma migrate deploy`, then `ensure-photos-container.cjs` creates the private `photos` container in Azurite |
| `check-image-contents.sh` | lists the images and fails on an `.env`, key, secrets directory, fixture or `.git` file (used by `compose-check.yml`)                                   |
| `verify/`                 | the fictional https Nightscout used for the verification below; not in any image                                                                        |

## How it differs from the Azure deployment

- `DATABASE_URL` is a SQL login (`sa`) on the `sql` container; the Azure managed identity path of
  `createPrismaFromEnv` is not used.
- Secrets: `SECRETS_DIR` (the `credentials` volume) selects `FileSecrets` in
  `shared/src/secrets/`; `KEY_VAULT_URL` is unset. Nothing in `web/` or `poller/` knows which.
- Photos: `BLOB_CONNECTION_STRING` points at Azurite as `azurite`, and `BLOB_PUBLIC_ENDPOINT` is the
  address the browser reads photos from (`http://localhost:10000/frejsi`). Azurite has one account,
  `frejsi`, whose key is generated into `docker/.env`: the emulator's well-known key is not used, and
  `UseDevelopmentStorage=true;DevelopmentStorageProxyUri=...` cannot work for the web and migrate
  containers because the Blob SDK treats the proxy as an HTTP proxy for `127.0.0.1`, not as the
  endpoint.
- No Web PubSub: `NoopEventSink` is chosen, `negotiate` answers 503 and clients poll. No Application
  Insights, no Key Vault, no alert.
- The poller's host keys are files (`AzureWebJobsSecretStorageType=Files`): `source-connect.json`
  holds the function key the web app presents as `SOURCE_CONNECT_KEY`, `host.json` the host keys.
  `host.json` in the app root has an `extensionBundle`, which the Functions host downloads at start;
  the poller uses only the timer and HTTP triggers, so a failed download does not stop it.

## Verification the lane performed (2026-10-16)

On the claude-agents VM: Docker 29.1.3, Compose v2.40.3, no BuildKit plugin.

1. From a state with no containers, volumes or `docker/.env`: `docker/init-secrets.sh`, then
   `docker compose -f docker/compose.yaml up -d --build`. `sql` became healthy, `migrate` applied
   `0001_foundation`, `0002_food`, `0003_ai` (Prisma created the empty `frejsi` database itself) and
   printed `photos: container ready`, then `web` and `poller` started. A cold build took about five
   minutes on this machine; a build with the layers cached about two.
2. `curl http://localhost:3000/api/health` answered `{"ok":true,"version":"dev","db":"ok","readings":"none"}`.
3. Bootstrap: `POST /api/bootstrap` with a wrong token answered 401; with `BOOTSTRAP_TOKEN` it
   answered 200 and an `inviteUrl` on `http://localhost:3000`.
4. Fake reading: with `FAKE_GLUCOSE_SOURCE=1` on the poller and the new space's `glucoseSource` set
   by SQL (the Settings form probes the real service), the `poll` timer stored 136 fictional
   readings and their `reading` events at the next five-minute mark, four and a half minutes after
   the change (inside the ten minutes the timer's schedule allows). `readings` in the health answer
   turned `stale` because the fake's readings are anchored to a fixed day.
5. `source-connect` over the Compose network, with `FAKE_GLUCOSE_SOURCE` unset: the override
   `verify/compose.nightscout.yaml` adds `verify/nightscout-fixture.mjs`, a fictional https
   Nightscout at `nightscout.fixture.test` with a throwaway certificate the poller trusts through
   `NODE_EXTRA_CA_CERTS`. A request from inside the `web` container to `http://poller/api/source-connect`
   with `SOURCE_CONNECT_KEY` answered 200 `{"result":"ok",...}` (401 without the key or with a wrong
   one) and the poller wrote `/credentials/glucose-<spaceId>` and `/credentials/glucose-<spaceId>.<version>`,
   mode 600, through `FileSecrets` (the versioned file is what the answered `secretRef` names;
   the plain one is the latest, for a space saved before v0.5.4). With
   the space's `glucoseSource` set to that source by SQL, the next cycle stored three readings with
   `source: nightscout` and the health answer turned `fresh`.
6. A photo pair put through `BlobPhotoStore` with `BLOB_PUBLIC_ENDPOINT` answered 200 on the signed
   read URL from `localhost:10000`.
7. `docker/check-image-contents.sh` found nothing forbidden in the three images. `docker compose
down -v`, removing the two volumes and `docker/.env` returned the machine to its start.

Limits of this record: no browser session was driven (the Settings screen, a passkey, a photo
uploaded from the app), so steps 4 and 5 call the same routes and tables the screen uses but not the
screen; the `sourceStatus`/`glucoseSource` update the web route makes after a successful connect was
done by SQL. To repeat step 5:

```sh
CERTS=$(mktemp -d)
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$CERTS/key.pem" -out "$CERTS/cert.pem" -days 1 \
  -subj /CN=nightscout.fixture.test -addext subjectAltName=DNS:nightscout.fixture.test
chmod 644 "$CERTS"/*.pem
export FIXTURE_CERTS="$CERTS"
docker compose -f docker/compose.yaml -f docker/verify/compose.nightscout.yaml up -d --build
# in Settings, Glukosekilde, Nightscout: https://nightscout.fixture.test and any token
```

#!/bin/bash
# Base44 DB entrypoint wrapper.
#
# The self-signed SSL certs are bind-mounted read-only from the host, but
# PostgreSQL refuses a private key with group/world access and git does not
# track file ownership/mode — so a fresh clone can land with root:root 0644
# certs that Postgres rejects. This wrapper copies the certs into a writable
# location with correct ownership/mode before handing off to the official
# postgres entrypoint, making the DB boot independent of host file perms.
set -e

mkdir -p /certs
cp /certs-src/server.crt /certs/server.crt
cp /certs-src/server.key /certs/server.key
chown postgres:postgres /certs/server.crt /certs/server.key
chmod 644 /certs/server.crt
chmod 600 /certs/server.key

exec docker-entrypoint.sh "$@"

#!/usr/bin/env bash
set -Eeuo pipefail
PROJECT_DIR=${LC_PROJECT_DIR:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)}
docker compose --project-directory "$PROJECT_DIR" --env-file "$PROJECT_DIR/.env.production" -f "$PROJECT_DIR/compose.production.yaml" exec -T --interactive=false postgres \
  psql -X -w -U lc -d lc -v ON_ERROR_STOP=1 -c "DELETE FROM server_activity WHERE created_at < now() - interval '90 days';"

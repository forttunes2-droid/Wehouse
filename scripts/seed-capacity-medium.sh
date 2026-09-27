#!/usr/bin/env bash
set -euo pipefail

# Small enough for a disposable standard CI runner, never a hosted project.
status=$(npx --yes supabase@2.114.0 status -o json)
node -e 'const s=JSON.parse(process.argv[1]);const u=new URL(s.API_URL||s.api_url);if(!["localhost","127.0.0.1"].includes(u.hostname)||u.protocol!=="http:")process.exit(1)' "$status"
seed() {
  local kind=$1 total=$2
  docker exec -i supabase_db_wehouse psql -U postgres -d postgres -v ON_ERROR_STOP=1 -v start=1 -v end="$total" < "supabase/tests/capacity_scale_${kind}.sql"
}
seed homes 50000
seed hotels 100000
seed rooms 100000
seed profiles 50000
docker exec supabase_db_wehouse psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c 'analyze public.listings; analyze public.hotels; analyze public.hotel_rooms; analyze public.profiles;'

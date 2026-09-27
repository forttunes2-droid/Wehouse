#!/usr/bin/env bash
set -euo pipefail

# Destructive fixture for a disposable local Supabase stack only.
status=$(npx --yes supabase@2.114.0 status -o json)
node -e 'const s=JSON.parse(process.argv[1]); const u=new URL(s.API_URL||s.api_url); if(!["localhost","127.0.0.1"].includes(u.hostname)||u.protocol!=="http:")process.exit(1)' "$status"
free_gb=$(df -BG --output=avail / | tail -1 | tr -dc '0-9')
if (( free_gb < 100 )); then echo "Need at least 100 GB free on disposable runner; found ${free_gb} GB" >&2; exit 1; fi

seed() {
  local kind=$1 total=$2 start=1 end
  while (( start <= total )); do
    end=$((start+999999)); if (( end > total )); then end=$total; fi
    echo "Seeding synthetic ${kind} ${start}-${end}"
    docker exec -i supabase_db_wehouse psql -U postgres -d postgres -v ON_ERROR_STOP=1 -v start="$start" -v end="$end" < "supabase/tests/capacity_scale_${kind}.sql"
    start=$((end+1))
  done
}
seed homes 3000000
seed hotels 4000000
seed rooms 4000000
seed profiles 20000000
docker exec supabase_db_wehouse psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c 'analyze public.listings; analyze public.hotels; analyze public.hotel_rooms; analyze public.profiles;'
docker exec supabase_db_wehouse psql -U postgres -d postgres -v ON_ERROR_STOP=1 -Atc "select (select count(*) from public.listings where listing_id like 'load-home-scale-%'),(select count(*) from public.hotels where hotel_id between -5000000 and -1000001),(select count(*) from public.profiles where user_id like 'load-user-%')" | grep -x '3000000|4000000|20000000'

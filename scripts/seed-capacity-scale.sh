#!/usr/bin/env bash
set -euo pipefail

# Destructive fixture for a disposable local Supabase stack only.
status=$(npx --yes supabase@2.114.0 status -o json)
node -e 'const s=JSON.parse(process.argv[1]); const u=new URL(s.API_URL||s.api_url); if(!["localhost","127.0.0.1"].includes(u.hostname)||u.protocol!=="http:")process.exit(1)' "$status"
free_gb=$(df -BG --output=avail / | tail -1 | tr -dc '0-9')
if (( free_gb < 100 )); then echo "Need at least 100 GB free on disposable runner; found ${free_gb} GB" >&2; exit 1; fi
case "${WEHOUSE_CAPACITY_PRESET:-full}" in
  million) homes=1000000; hotels=1000000; profiles=1000000 ;;
  full) homes=3000000; hotels=4000000; profiles=20000000 ;;
  *) echo "Unknown catalog preset" >&2; exit 1 ;;
esac

seed() {
  local kind=$1 total=$2 start=1 end
  while (( start <= total )); do
    end=$((start+999999)); if (( end > total )); then end=$total; fi
    echo "Seeding synthetic ${kind} ${start}-${end}"
    docker exec -i supabase_db_wehouse psql -U postgres -d postgres -v ON_ERROR_STOP=1 -v start="$start" -v end="$end" < "supabase/tests/capacity_scale_${kind}.sql"
    start=$((end+1))
  done
}
seed homes "$homes"
seed hotels "$hotels"
seed rooms "$hotels"
seed profiles "$profiles"
docker exec supabase_db_wehouse psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c 'analyze public.listings; analyze public.hotels; analyze public.hotel_rooms; analyze public.profiles;'
docker exec supabase_db_wehouse psql -U postgres -d postgres -v ON_ERROR_STOP=1 -Atc "select (select count(*) from public.listings where listing_id like 'load-home-scale-%'),(select count(*) from public.hotels where hotel_id between -5000000 and -1000001),(select count(*) from public.profiles where user_id like 'load-user-%')" | grep -x "${homes}|${hotels}|${profiles}"
docker exec supabase_db_wehouse psql -U postgres -d postgres -v ON_ERROR_STOP=1 -Atc "select count(*) filter (where sub_type='short_let'),count(*) filter (where sub_type='long_stay') from public.listings where listing_id like 'load-home-scale-%'" | grep -x "$((homes/2))|$((homes/2))"

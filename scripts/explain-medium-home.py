"""Expand the exact SQL function body with test constants for a nested plan.

The hosted function and schema are not changed. The resulting EXPLAIN runs
only against the seeded disposable Postgres container.
"""
from pathlib import Path
import re

source = Path('supabase/migrations/20260927101830_bounded_public_home_search.sql').read_text()
body = source.split('as $$\n', 1)[1].split('\n$$;', 1)[0].strip().rstrip(';')
types = {
    'p_query': 'NULL::text', 'p_state': 'NULL::text',
    'p_city': 'NULL::text', 'p_stay_type': 'NULL::text',
    'p_min_price': 'NULL::numeric', 'p_max_price': 'NULL::numeric',
    'p_min_bedrooms': 'NULL::integer', 'p_min_bathrooms': 'NULL::integer',
    'p_cursor_created_at': 'NULL::timestamptz', 'p_cursor_id': 'NULL::uuid',
    'p_limit': '24',
}
for name, city in [('Expanded home feed statement', None), ('Expanded home city statement', 'Lafia')]:
    values = {**types, 'p_city': "'Lafia'::text" if city else 'NULL::text'}
    query = body
    for param, literal in values.items():
        query = re.sub(r'\b' + param + r'\b', literal, query)
    print(f'\\echo {name}')
    print('explain (analyze,buffers) ' + query + ';')

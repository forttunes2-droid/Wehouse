# Unapplied legacy SQL

These scripts were found scattered outside `supabase/migrations` (repository
root, `/migrations`, `public/supabase/migrations`, `src/lib/supabase/migrations`).
Nothing in the code, tests, scripts or workflows references them, and the
coordinated release tool never runs them.

They are kept only as history. **Do not run them.** Several are destructive
(for example dropping columns or deleting rows) and predate the current
security model. `supabase/migrations` is the only executable schema source.

The copy that was in `public/` was previously served as a static file on the
website; it no longer is.

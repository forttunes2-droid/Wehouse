-- Step 1: Verify metadata column exists
SELECT metadata->>'user_id' as user_from_meta FROM notifications LIMIT 1;

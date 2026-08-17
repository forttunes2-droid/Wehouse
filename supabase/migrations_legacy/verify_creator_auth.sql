-- Quick test: verify the functions exist and work

-- 1. Check if functions exist
SELECT proname AS function_name, 
       pg_get_function_arguments(oid) AS arguments
FROM pg_proc 
WHERE proname IN ('set_creator_auth', 'verify_creator_auth')
ORDER BY proname;

-- 2. Test: set a password for your creator account (replace 'WHU-0001' with your actual creator user_id)
-- SELECT set_creator_auth('WHU-0001', 'your_password_here');

-- 3. Test: verify the password
-- SELECT verify_creator_auth('WHU-0001', 'your_password_here');

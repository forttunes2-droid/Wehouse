-- Fix Block 6: cast conversation_id to UUID since that's the column type
CREATE OR REPLACE FUNCTION public.get_conversation_messages(p_conversation_id text)
RETURNS SETOF public.messages
LANGUAGE sql
SECURITY DEFINER
AS $$ 
  SELECT * FROM public.messages 
  WHERE conversation_id = p_conversation_id::uuid
  ORDER BY created_at ASC;
$$;

-- Fix Block 7: profiles delete policy
CREATE POLICY "profiles_delete" ON profiles
  FOR DELETE TO authenticated
  USING (public.is_staff_or_creator(auth.uid()::text));

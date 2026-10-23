-- Match the existing compressed-video contract at the Storage boundary.
-- Existing objects and bucket visibility/permissions are preserved.
do $$
begin
  if (select count(*) from storage.buckets where id in('listing-videos','worker-showcase','listing-candidates','property-access-private','worker-verification-videos','worker-files'))<>6 then
    raise exception 'Required media buckets are missing; reconcile the storage baseline before this release';
  end if;
end $$;
update storage.buckets set file_size_limit=13000000
  where id in('listing-videos','worker-showcase','listing-candidates','property-access-private','worker-verification-videos','worker-files');

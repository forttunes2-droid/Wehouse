-- RLS does not protect TRUNCATE. Browser roles only retain row operations the app needs.
revoke truncate,references,trigger on public.platform_settings from anon,authenticated;
revoke insert,update,delete on public.platform_settings from anon;
revoke truncate,references,trigger on public.announcements from anon,authenticated;
revoke truncate,references,trigger on public.announcement_recipients from anon,authenticated;
revoke insert,update,delete on public.announcements from anon;
revoke insert,update,delete on public.announcement_recipients from anon;

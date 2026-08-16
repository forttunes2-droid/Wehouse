update public.platform_settings
set value='https://wehouse.com.ng', updated_at=now()
where key='company_website' and is_active=true;

drop index if exists public.partner_pro_subscription_customer_plan;
create unique index partner_pro_subscription_customer_plan on public.partner_pro_subscriptions(customer_code,plan_code,environment) where customer_code is not null and auto_renews;
drop policy if exists listings_property_host_read_assigned on public.listings;
create policy listings_property_host_read_assigned on public.listings for select to authenticated using (public.current_actor_can_manage_property(id));
drop policy if exists property_host_assignments_read_own on public.property_host_assignments;
create policy property_host_assignments_read_own on public.property_host_assignments for select to authenticated using ((user_id=public.current_profile_user_id()) or private.current_actor_owns_host_property(listing_id));

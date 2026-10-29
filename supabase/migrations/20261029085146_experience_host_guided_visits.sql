-- Owner decision: every Experience is guided by its host. Garden visits use
-- the existing Outdoor category, Provider workspace and reviewed activity plan.
update public.experience_categories set
 description='Host-guided garden visits and outdoor activities with clear routes, access, accessibility and safety requirements.',
 examples=array['Guided garden visits','Guided nature walks','Introductory outdoor skills','Supervised local outdoor activities'],updated_at=now()
 where code='outdoor';

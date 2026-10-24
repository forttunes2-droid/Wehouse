-- Required product configuration: schema-only baselines omit table data.
-- Keep stable reason codes used by Help and case APIs, with one owning domain.
insert into public.case_reason_registry
 (reason_code,label,owning_domain,allowed_subject_types,requires_evidence,customer_description,active,version)
values
 ('app_help','Using WeHouse','support',array['account','page'],false,'Help using WeHouse.',true,1),
 ('account_access','Account access','support',array['account'],false,'Help accessing your account.',true,1),
 ('worker_verification','Professional profile review','worker_operations',array['worker'],false,'Help with your service profile, documents or review.',true,1),
 ('worker_job_issue','Service job issue','worker_operations',array['worker_job'],false,'Help with a service job linked to your account.',true,1),
 ('payment_issue','Payment or refund issue','finance_operations',array['long_let','short_let','hotel','worker_job','shared_payment'],false,'Review a payment or refund linked to your booking or service.',true,1),
 ('payout_issue','Withdrawal issue','finance_operations',array['payout'],false,'Review a withdrawal or payout account request.',true,1),
 ('account_compromise','Account security','security_operations',array['account'],false,'Review suspected unauthorized access to your account.',true,1),
 ('safety_threat','Safety concern','security_operations',array['account','long_let','short_let','hotel','worker_job','conversation','listing','inspection'],false,'Report a safety concern linked to your account or activity.',true,1),
 ('arrival_issue','Stay arrival issue','property_operations',array['long_let','short_let','hotel'],false,'Review an eligible arrival issue on a confirmed stay.',true,1),
 ('field_visit','Property inspection','property_operations',array['inspection','long_let','short_let','hotel','listing'],false,'Coordinate a property inspection through Property Operations.',true,1),
 ('property_submission_help','Property submission help','property_operations',array['inspection'],false,'Help with a property submission, inspection or publication journey.',true,1)
on conflict(reason_code) do update set
 label=excluded.label,owning_domain=excluded.owning_domain,
 allowed_subject_types=excluded.allowed_subject_types,
 requires_evidence=excluded.requires_evidence,
 customer_description=excluded.customer_description,active=true,
 version=greatest(public.case_reason_registry.version,excluded.version);

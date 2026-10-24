-- Restore absent configuration only. Do not replace operator values or enable sales.
insert into public.platform_settings(key,value,category,label,description,data_type,editable,is_active)
values
('worker_pro_product_name','WeHouse Works','worker_pro','Public plan name','Short name shown to Workers. Default: WeHouse Works.','string',true,true),
('worker_pro_product_tagline','Run your work with clearer numbers, documents and reach.','worker_pro','Plan tagline','One clear sentence explaining what the tools do.','string',true,true),
('worker_pro_monthly_price_ngn','0','worker_pro','Monthly web price (₦)','Price for new monthly web subscriptions. Saving it synchronizes the Paystack monthly plan.','number',true,true),
('worker_pro_yearly_price_ngn','0','worker_pro','Yearly web price (₦)','Total annual price for new yearly web subscriptions. Set it below twelve monthly payments to offer a visible saving.','number',true,true),
('worker_pro_apple_product_id','','worker_pro','Apple monthly product ID','Monthly auto-renewable subscription product configured in App Store Connect.','string',true,true),
('worker_pro_apple_yearly_product_id','','worker_pro','Apple yearly product ID','Yearly product in the same App Store subscription group as the monthly product.','string',true,true),
('worker_pro_google_product_id','','worker_pro','Google Play monthly product ID','Monthly subscription product ID with one eligible base plan in Google Play Console.','string',true,true),
('worker_pro_google_yearly_product_id','','worker_pro','Google Play yearly product ID','Separate yearly subscription product ID with one eligible base plan in Google Play Console.','string',true,true),
('worker_pro_terms_version','','worker_pro','Published plan terms version','Version Workers must accept before starting a subscription.','string',true,true),
('worker_pro_terms_content','','worker_pro','Paid plan subscription terms','Explain both prices, automatic renewal, paid-through cancellation, expiry, failed-payment handling, feature access and refunds.','string',true,true),
('worker_pro_payment_grace_days','0','worker_pro','Failed-payment grace (days)','Optional access after a failed renewal. Zero keeps access only through the already-paid period.','number',true,true),
('worker_pro_support_response_hours','24','worker_pro','Priority support target (hours)','Ordinary platform-help response target. Safety, payment, refund and dispute handling never depends on payment.','number',true,true),
('worker_pro_sales_enabled','false','worker_pro','Enable paid plan web sales','Opens web checkout only after legal approval, published terms, and at least one verified Paystack plan.','boolean',true,true),
('worker_pro_web_paystack_plan_code','','worker_pro','Paystack monthly plan','Server-verified monthly plan code; empty until synchronized.','string',true,true),
('worker_pro_web_paystack_yearly_plan_code','','worker_pro','Paystack yearly plan','Server-verified yearly plan code; empty until synchronized.','string',true,true)
on conflict(key) do nothing;

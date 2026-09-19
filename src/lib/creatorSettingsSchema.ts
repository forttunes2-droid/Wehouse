export type Kind='text'|'email'|'number'|'toggle'|'textarea';
export type Def={key:string;label:string;description:string;kind:Kind;defaultValue:string;min?:number;max?:number;step?:number;category?:string};
export type CreatorSettingsGroupId = 'identity' | 'worker_pro' | 'worker_trust' | 'access';
type Group={id:CreatorSettingsGroupId;label:string;description:string;note?:string;settings:Def[]};

export const CREATOR_SETTING_GROUPS:Group[]=[
 {id:'identity',label:'Platform identity',description:'Public WeHouse contact information.',settings:[
  {key:'company_name',label:'Company name',description:'Company name used by screens that display company details.',kind:'text',defaultValue:'WeHouse'},
  {key:'support_email',label:'Support email',description:'Primary public support email.',kind:'email',defaultValue:''},
  {key:'support_phone',label:'Support phone',description:'Primary public support phone number.',kind:'text',defaultValue:''},
 ]},
 {id:'worker_pro',label:'Paid Worker plan',description:'Optional monthly or yearly tools, separate from free Worker onboarding, Reviewed and Trusted.',note:'The public name, prices, annual saving, Sponsored slots and support target are controlled here without a code change. Saving either price pauses new web sales and synchronizes its Paystack plan without changing existing subscribers. Apple and Google control native-store prices.',settings:[
  {key:'worker_pro_product_name',label:'Public plan name',description:'Short name shown to Workers. Default: WeHouse Works.',kind:'text',defaultValue:'WeHouse Works',category:'worker_pro'},
  {key:'worker_pro_product_tagline',label:'Plan tagline',description:'One clear sentence explaining what the tools do.',kind:'text',defaultValue:'Run your work with clearer numbers, documents and reach.',category:'worker_pro'},
  {key:'worker_pro_monthly_price_ngn',label:'Monthly web price (₦)',description:'Price for new monthly web subscriptions. Saving it synchronizes the Paystack monthly plan.',kind:'number',defaultValue:'0',min:0,max:10000000,step:1,category:'worker_pro'},
  {key:'worker_pro_yearly_price_ngn',label:'Yearly web price (₦)',description:'Total annual price for new yearly web subscriptions. Set it below twelve monthly payments to offer a visible saving.',kind:'number',defaultValue:'0',min:0,max:10000000,step:1,category:'worker_pro'},
  {key:'worker_pro_apple_product_id',label:'Apple monthly product ID',description:'Monthly auto-renewable subscription product configured in App Store Connect.',kind:'text',defaultValue:'',category:'worker_pro'},
  {key:'worker_pro_apple_yearly_product_id',label:'Apple yearly product ID',description:'Yearly product in the same App Store subscription group as the monthly product.',kind:'text',defaultValue:'',category:'worker_pro'},
  {key:'worker_pro_google_product_id',label:'Google Play monthly product ID',description:'Monthly subscription product or base plan configured in Google Play Console.',kind:'text',defaultValue:'',category:'worker_pro'},
  {key:'worker_pro_google_yearly_product_id',label:'Google Play yearly product ID',description:'Yearly subscription product or base plan configured in Google Play Console.',kind:'text',defaultValue:'',category:'worker_pro'},
  {key:'worker_pro_terms_version',label:'Published plan terms version',description:'Version Workers must accept before starting a subscription.',kind:'text',defaultValue:'',category:'worker_pro'},
  {key:'worker_pro_terms_content',label:'Paid plan subscription terms',description:'Explain both prices, automatic renewal, paid-through cancellation, expiry, failed-payment handling, feature access and refunds.',kind:'textarea',defaultValue:'',category:'worker_pro'},
  {key:'worker_pro_payment_grace_days',label:'Failed-payment grace (days)',description:'Optional access after a failed renewal. Zero keeps access only through the already-paid period.',kind:'number',defaultValue:'0',min:0,max:14,step:1,category:'worker_pro'},
  {key:'worker_pro_support_response_hours',label:'Priority support target (hours)',description:'Ordinary platform-help response target. Safety, payment, refund and dispute handling never depends on payment.',kind:'number',defaultValue:'24',min:1,max:168,step:1,category:'worker_pro'},
  {key:'worker_featured_slot_count',label:'Sponsored slots',description:'Maximum matching Featured Workers shown separately. Organic results remain unchanged.',kind:'number',defaultValue:'3',min:0,max:6,step:1,category:'worker_pro'},
  {key:'worker_featured_sales_enabled',label:'Enable Featured Workers',description:'Requires approved Worker marketplace and sponsored-placement legal gates. Cards are always labelled Sponsored.',kind:'toggle',defaultValue:'false',category:'worker_pro'},
  {key:'worker_pro_sales_enabled',label:'Enable paid plan web sales',description:'Opens web checkout only after legal approval, published terms, and at least one verified Paystack plan.',kind:'toggle',defaultValue:'false',category:'worker_pro'},
 ]},
 {id:'worker_trust',label:'WeHouse Trusted',description:'Marketplace trust is earned from real WeHouse performance after professional approval.',note:'A Worker is first WeHouse Reviewed. WeHouse Trusted is earned later from completed jobs, rating, Worker-caused cancellations and unresolved disputes.',settings:[
  {key:'worker_trust_enabled',label:'Enable WeHouse Trusted',description:'Turn on automatic earned marketplace trust only after Worker-booking reputation data is ready.',kind:'toggle',defaultValue:'false',category:'worker_trust'},
  {key:'worker_trusted_min_completed_jobs',label:'Minimum completed WeHouse jobs',description:'Completed Worker bookings required before Trusted can be earned.',kind:'number',defaultValue:'5',min:0,max:10000,step:1,category:'worker_trust'},
  {key:'worker_trusted_min_rating',label:'Minimum rating',description:'Minimum marketplace rating required for Trusted.',kind:'number',defaultValue:'4.5',min:0,max:5,step:0.1,category:'worker_trust'},
  {key:'worker_trusted_max_cancel_rate',label:'Maximum Worker cancellation rate (%)',description:'Maximum percentage of terminal jobs cancelled by the Worker while retaining Trusted.',kind:'number',defaultValue:'20',min:0,max:100,step:1,category:'worker_trust'},
  {key:'worker_trusted_block_open_disputes',label:'Block Trusted with unresolved disputes',description:'Require a clean Worker-booking dispute record before Trusted is shown.',kind:'toggle',defaultValue:'true',category:'worker_trust'},
 ]},
 {id:'access',label:'Platform access',description:'High-level access switches.',settings:[
  {key:'maintenance_mode',label:'Maintenance mode',description:'Pause new registrations and normal sign-in. Existing sessions and background services are not stopped.',kind:'toggle',defaultValue:'false'},
  {key:'registration_open',label:'Registration open',description:'Allow new accounts to register.',kind:'toggle',defaultValue:'true'},
 ]},
];


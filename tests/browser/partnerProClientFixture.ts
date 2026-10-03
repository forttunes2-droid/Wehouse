const today = new Date();
const day = (offset: number) => { const d = new Date(today); d.setDate(d.getDate() + offset); return d.toISOString().slice(0,10); };
const month = (offset: number) => { const d = new Date(today); d.setDate(1); d.setMonth(d.getMonth() + offset); return d.toISOString().slice(0,7); };
const tasks = [
  { id:'task-1',asset_kind:'hotel',asset_id:'42',title:'Inspect room after checkout',due_on:day(2),status:'open',created_at:new Date().toISOString() },
  { id:'task-2',asset_kind:'home',asset_id:'home-1',title:'Replace kitchen tap',due_on:day(5),status:'open',created_at:new Date().toISOString() },
];
const arrivalInstructions: Record<string,string> = {};
const data = {
  assets:[{kind:'hotel',id:'42',title:'Garden Lodge'},{kind:'home',id:'home-1',title:'Lafia Courtyard Home'}],
  stays:[
    {kind:'hotel',asset_id:'42',asset_title:'Garden Lodge',booking_id:'stay-1',check_in:day(1),check_out:day(3),status:'confirmed'},
    {kind:'home',asset_id:'home-1',asset_title:'Lafia Courtyard Home',booking_id:'stay-2',check_in:day(4),check_out:day(7),status:'occupied'},
  ],
  income:[{month_key:month(-2),net_amount:184000,earnings:3},{month_key:month(-1),net_amount:252000,earnings:5},{month_key:month(0),net_amount:98000,earnings:2}],
  tasks,stays_limited:false,tasks_limited:false,
};
export const supabase:any={rpc:async(name:string,args:any)=>{
  if(name==='get_my_partner_pro')return {data:{active:true,current_period_end:new Date(Date.now()+30*86400000).toISOString(),sales_enabled:true,monthly_price_ngn:5000,yearly_price_ngn:50000,terms_version:'test',terms_content:'Preview terms',terms_accepted:true,auto_renews:false},error:null};
  if(name==='get_my_partner_pro_overview')return {data:{...data,tasks:[...tasks]},error:null};
  if(name==='get_my_partner_pro_arrival_setup')return {data:{occupancy:[{kind:'hotel',asset_id:'42',title:'Garden Lodge',booked_unit_nights:9,available_unit_nights:60},{kind:'home',asset_id:'home-1',title:'Lafia Courtyard Home',booked_unit_nights:3,available_unit_nights:30}],instructions:Object.entries(arrivalInstructions).map(([key,instructions])=>({kind:key.split(':')[0],asset_id:key.split(':')[1],instructions}))},error:null};
  if(name==='save_my_partner_pro_arrival_instructions'){arrivalInstructions[`${args.p_kind}:${args.p_asset_id}`]=args.p_instructions;return {data:true,error:null};}
  if(name==='save_my_partner_pro_task'){
    if(args.p_task_id){const task=tasks.find(row=>row.id===args.p_task_id);if(task)task.status=args.p_done?'done':'open';}
    else tasks.push({id:`task-${tasks.length+1}`,asset_kind:args.p_kind,asset_id:args.p_asset_id,title:args.p_title,due_on:args.p_due_on,status:'open',created_at:new Date().toISOString()});
    return {data:'saved',error:null};
  }
  throw new Error(`Unexpected RPC ${name}`);
}};

import { supabase } from './client';

export type RegisteredInstitution={
  id:string;
  canonical_name:string;
  institution_type:'university'|'polytechnic'|'college';
  state:string;
  local_government:string|null;
  regulator:'NUC'|'NBTE'|'NCCE';
  aliases:string[];
};

export async function getRegisteredInstitutions(state:string){
  if(!state.trim())return {institutions:[] as RegisteredInstitution[],error:null};
  const{data,error}=await supabase
    .from('registered_institutions')
    .select('id,canonical_name,institution_type,state,local_government,regulator,aliases')
    .eq('state',state)
    .eq('is_active',true)
    .order('canonical_name',{ascending:true});
  return {institutions:(data||[]) as RegisteredInstitution[],error};
}

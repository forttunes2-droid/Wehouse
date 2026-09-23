import {control} from './stabilisationClientFixture';
export const useCreatorAuth=()=>({requestElevation:(action:string,after:(id:string)=>void)=>{control.elevations.push(action);after('test-elevation');}});

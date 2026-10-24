import ReviewedDocuments from './ReviewedDocuments';
export default function WorkerCredentials({workerId,operator=false,onChanged,onReadyChange}:{workerId:string;operator?:boolean;onChanged?:()=>void|Promise<void>;onReadyChange?:(ready:boolean)=>void}){
 return <ReviewedDocuments key={`${workerId}:${operator}`} requestId={workerId} accountId={workerId} operator={operator} kind="worker" onChanged={onChanged} onReadyChange={onReadyChange}/>;
}

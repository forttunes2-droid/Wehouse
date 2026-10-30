import ReviewedDocuments from './ReviewedDocuments';
export default function PropertyDocuments(props:{requestId:string;accountId:string;operator?:boolean;onChanged?:()=>void|Promise<void>;onReadyChange?:(ready:boolean)=>void}){return <ReviewedDocuments {...props}/>;}

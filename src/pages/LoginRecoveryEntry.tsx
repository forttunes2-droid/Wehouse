import Login from './Login';
import PasswordRecoveryStable from './PasswordRecoveryStable';

type PublicRole='user'|'worker'|'property_partner';
type Props={onLoginSuccess:(authId:string,email:string,role?:PublicRole)=>void;serverError:string;kickedOut?:boolean};

function isRecovery(){try{return new URLSearchParams(window.location.search).get('auth')==='recovery'}catch{return false}}

export default function LoginRecoveryEntry(props:Props){return isRecovery()?<PasswordRecoveryStable/>:<Login {...props}/>}

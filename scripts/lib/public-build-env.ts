// Build-time protection: runtime rejection cannot undo a published credential.
// These signatures cover the private credentials used by WeHouse; permission
// checks and provider secret storage remain necessary independently of this scan.
const privateName=/(?:SECRET|SERVICE_ROLE|PRIVATE_KEY|DATABASE_URL|PASSWORD|ACCESS_TOKEN|API_TOKEN)/i;
const privateValue=/\b(?:sb_secret_|sk_live_|sk_test_|sk-proj-)[A-Za-z0-9_-]{12,}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;
const jwt=/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,}/g;

export function containsPrivateCredential(value:string):boolean {
 if(privateValue.test(value))return true;
 for(const match of value.matchAll(jwt)){
  try{
   const payload=JSON.parse(Buffer.from(match[0].split('.')[1],'base64url').toString('utf8')) as {role?:string};
   if(payload.role==='service_role'||payload.role==='supabase_admin')return true;
  }catch{/* Other non-credential strings are not evidence of a private key. */}
 }
 return false;
}

export function assertPublicBuildEnvironment(environment:Record<string,unknown>):void {
 for(const [name,value] of Object.entries(environment)){
  if(!name.startsWith('VITE_'))continue;
  if(privateName.test(name)||typeof value==='string'&&containsPrivateCredential(value))
   throw new Error(`Refusing to publish private credentials through ${name}. Use server-only environment storage.`);
 }
}

export function assertPublicAsset(name:string,source:string):void {
 if(containsPrivateCredential(source))throw new Error(`Refusing to emit private credentials in ${name}.`);
}

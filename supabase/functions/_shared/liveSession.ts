/** Call ONLY after auth.getUser(token) has verified this bearer and its user.
 * This is a state/revocation check, not an unsigned-JWT authentication scheme. */
export async function hasLiveSession(admin: { rpc: (name:string, params:Record<string,unknown>) => PromiseLike<{data:unknown;error:unknown}> }, verifiedAuthId:string, token:string): Promise<boolean> {
  try {
    const part = token.split('.')[1];
    const payload = JSON.parse(atob(part.replace(/-/g,'+').replace(/_/g,'/')));
    if (payload.sub !== verifiedAuthId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.session_id || '')) return false;
    const {data,error} = await admin.rpc('auth_session_is_active',{p_auth_id:verifiedAuthId,p_session_id:payload.session_id});
    return !error && data === true;
  } catch { return false; }
}

/** Uses server workspace grants, never a legacy profile.role or a client choice. */
export async function hasActiveWorkspace(admin: { rpc: (name:string, params:Record<string,unknown>) => PromiseLike<{data:unknown;error:unknown}> }, userId:string, workspace:string): Promise<boolean> {
  try { const {data,error}=await admin.rpc('user_has_active_workspace',{p_user_id:userId,p_workspace_role:workspace}); return !error && data===true; }
  catch { return false; }
}

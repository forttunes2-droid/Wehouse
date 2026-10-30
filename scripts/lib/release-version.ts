type BuildEnvironment={VERCEL_GIT_COMMIT_SHA?:string;GITHUB_SHA?:string;WEHOUSE_BUILD_VERSION?:string};
/** A PR workflow's GITHUB_SHA can be a synthetic merge, while checkout is its
 * reviewed head. Always identify the code actually built when Git is present. */
export function sourceReleaseVersion(checkoutHead:string|null,environment:BuildEnvironment,now=Date.now()){
  const actual=checkoutHead?.trim();
  const vercel=environment.VERCEL_GIT_COMMIT_SHA?.trim();
  if(actual){
    if(!/^[a-f0-9]{40,64}$/.test(actual))throw new Error('The checked-out release commit is invalid.');
    if(vercel&&vercel!==actual)throw new Error('The Vercel release commit does not match the checked-out source.');
    return actual;
  }
  const supplied=vercel||environment.WEHOUSE_BUILD_VERSION||environment.GITHUB_SHA;
  return supplied?.trim()||`local-${now}`;
}

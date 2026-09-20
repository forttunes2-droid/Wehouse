export type IdentityReviewPolicy = {
  identity_required?: boolean;
  identity_current?: boolean;
};

export function identityReviewGateSatisfied(policy: IdentityReviewPolicy | null) {
  return policy?.identity_required === false || (policy?.identity_required === true && policy.identity_current === true);
}

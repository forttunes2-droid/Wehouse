export const supabase: any = {
  rpc: async (name: string) => name.startsWith('activate_my_') ? (window as any).__activateFixture(name) : name === 'get_my_legal_status'
    ? { data: { privacy_accepted: false, terms_accepted: false }, error: null }
    : { data: null, error: null },
  from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }),
};

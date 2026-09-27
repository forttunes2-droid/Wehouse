import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

/** Presentation gate only. Public reads stay redacted by the existing server APIs;
 * this never creates an identity or replaces server authorisation. */
export type DiscoveryAccess = { requireSignIn: () => void; busy: boolean; notice?: ReactNode };
export const DiscoveryAccessContext = createContext<DiscoveryAccess | null>(null);
export const useDiscoveryAccess = () => useContext(DiscoveryAccessContext);

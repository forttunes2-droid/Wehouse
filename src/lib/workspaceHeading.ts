import { createContext } from 'react';

// A workspace owns its page title. Embedded sections only add a heading when
// it identifies a different part of the page.
export const WorkspaceHeadingContext = createContext('');

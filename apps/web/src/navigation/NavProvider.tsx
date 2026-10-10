import { createContext, type ReactNode } from 'react';
import type { Nav } from './history';

export const NavContext = createContext<Nav | null>(null);

export function NavProvider({ nav, children }: { nav: Nav; children: ReactNode }) {
  return <NavContext.Provider value={nav}>{children}</NavContext.Provider>;
}

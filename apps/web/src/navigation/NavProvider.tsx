import type { ReactNode } from 'react';
import type { Nav } from './history';
import { NavContext } from './navContext';

export function NavProvider({ nav, children }: { nav: Nav; children: ReactNode }) {
  return <NavContext.Provider value={nav}>{children}</NavContext.Provider>;
}

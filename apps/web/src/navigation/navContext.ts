import { createContext } from 'react';
import type { Nav } from './history';

export const NavContext = createContext<Nav | null>(null);

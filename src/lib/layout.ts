// Layout measurements that JavaScript needs to know about.
//
// Lives here rather than in Navbar.tsx: Vite's fast refresh only hot-swaps a
// file whose exports are all components. A constant exported next to Navbar
// would turn every navbar edit into a full page reload.

/** Height of the sticky site navbar in px. Must match its `h-14` class. */
export const NAV_HEIGHT = 56
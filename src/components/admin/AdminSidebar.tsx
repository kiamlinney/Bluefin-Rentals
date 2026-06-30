import * as React from 'react'
import {Link, useLocation, useRouter} from '@tanstack/react-router'
import { adminNav } from './nav'
import { ChevronDown, ChevronUp, ChevronFirst, ChevronLast, Menu, X } from 'lucide-react'
import { logoutUser } from "@/lib/auth.ts";

/**
 * useLocalStorage
 * A resilient localStorage state hook with the following properties:
 * - Initializes from the current key's stored JSON value (or fallback `initial`).
 * - Writes any state change back to localStorage.
 * - Reacts to key changes at runtime: when `key` changes, it
 *   • loads the value for the new key and updates state;
 *   • removes the stale value for the old key to avoid orphaned entries.
 */
function useLocalStorage<T>(key: string, initial: T) {
    const prevKeyRef = React.useRef<string>(key)

    const [value, setValue] = React.useState<T>(() => {
        try {
            const raw = localStorage.getItem(key)
            return raw ? (JSON.parse(raw) as T) : initial
        } catch {
            return initial
        }
    })

    // Persist value for the current key
    React.useEffect(() => {
        try { localStorage.setItem(key, JSON.stringify(value)) } catch {}
    }, [key, value])

    // When the key changes, clean up old key and load the new key's value
    React.useEffect(() => {
        const prevKey = prevKeyRef.current
        if (prevKey !== key) {
            try { localStorage.removeItem(prevKey) } catch {}
            try {
                const raw = localStorage.getItem(key)
                setValue(raw ? (JSON.parse(raw) as T) : initial)
            } catch {
                setValue(initial)
            }
            prevKeyRef.current = key
        }
    }, [key, initial])

    return [value, setValue] as const
}

function SidebarContent({
    collapsed,
    setCollapsed,
    setMobileOpen,
    openSections,
    toggleSection,
    pathname,
    user,
    onLogout,
}: {
    collapsed: boolean
    setCollapsed: (fn: (c: boolean) => boolean) => void
    setMobileOpen: (open: boolean) => void
    openSections: Record<string, boolean>
    toggleSection: (label: string) => void
    pathname: string
    user: any | null
    onLogout: () => Promise<void> | void
}) {
    return (
        <aside
            className={[
                'h-full border-r bg-gray-100 transition-all duration-200',
                collapsed ? 'w-16' : 'w-64',
                'flex flex-col'
            ].join(' ')}
            aria-label="Admin Navigation"
        >
            {/* Header with collapse toggle */}
            <div className="flex items-center justify-between p-3 border-b">
                <button
                    className="md:hidden inline-flex items-center gap-2 rounded px-2 py-1 border"
                    onClick={() => setMobileOpen(false)}
                    aria-label="Close sidebar"
                >
                    <X size={16} />
                </button>
                {/* When collapsed, hide title element entirely to avoid empty inline box */}
                {!collapsed && (
                    <div className="text-sm text-black font-semibold truncate px-1">Bluefin Admin</div>
                )}
                <button
                    className="hidden md:inline-flex items-center gap-2 rounded px-2 py-1 cursor-pointer"
                    onClick={() => setCollapsed((c) => !c)}
                    aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                >
                    {collapsed ? <ChevronLast size={16} /> : <ChevronFirst size={16} />}
                </button>
            </div>

            {/* Nav list */}
            <nav className={[
                'flex-1 py-2',
                collapsed ? 'overflow-visible' : 'overflow-y-auto'
            ].join(' ')}>
                <ul className="space-y-1">
                    {adminNav.map((item) => {
                        const hasChildren = !!item.children?.length
                        const sectionActive =
                            (!!item.path && (pathname === item.path || pathname.startsWith(item.path + '/'))) ||
                            item.children?.some((c) => pathname === c.path || pathname.startsWith(c.path + '/'))
                        const open = openSections[item.label] ?? false
                        const Icon = item.icon

                        if (!hasChildren) {
                            // Single-link item, calendar
                            return (
                                <li key={item.label} className="group relative">
                                    <Link
                                        to={item.path!}
                                        className={[
                                            'w-full flex rounded-md text-left text-sm hover:bg-neutral-50 hover:underline',
                                            collapsed
                                                ? 'flex-col items-center justify-center gap-0.5 px-1 py-2'
                                                : 'flex-row items-center gap-3 px-3 py-2',
                                        ].join(' ')}
                                        activeProps={{ className: 'text-emerald-700' }}
                                        inactiveProps={{}}
                                    >
                                        <span className={collapsed ? 'flex flex-col items-center gap-0.5' : 'flex items-center gap-3'}>
                                            {Icon ? <Icon className="shrink-0" size={18} /> : null}
                                                {collapsed
                                                    ? <span className="text-[10px] text-center leading-tight w-full truncate">{item.label}</span>
                                                    : <span className="truncate">{item.label}</span>
                                                }
                                        </span>
                                    </Link>
                                </li>
                            )
                        }

                        // Section with children
                        return (
                            <li key={item.label} className="group relative">
                                <button
                                    className={[
                                        'w-full flex rounded-md text-left text-sm cursor-pointer hover:underline',
                                        collapsed
                                            ? 'flex-col items-center justify-center gap-0.5 px-1 py-2'
                                            : 'flex-row items-center justify-between px-3 py-2',
                                        sectionActive ? 'text-emerald-700' : 'hover:bg-neutral-50', // activeProps for trips/business
                                    ].join(' ')}
                                    onClick={() => !collapsed && toggleSection(item.label)}
                                    aria-expanded={open}
                                    aria-controls={`section-${item.label}`}
                                >
                                    <span className={collapsed ? 'flex flex-col items-center gap-0.5' : 'flex items-center gap-3'}>
                                        {Icon ? <Icon className="shrink-0" size={18} /> : null}
                                            {collapsed
                                                ? <span className="text-[10px] text-center leading-tight w-full truncate">{item.label}</span> // The text of trips/business collapsed
                                                : <span className="truncate">{item.label}</span>
                                            }
                                    </span>
                                    {!collapsed && (open ? <ChevronDown size={16} /> : <ChevronUp size={16} />)}
                                </button>

                                {/* Expanded mode children list */}
                                {!collapsed && open && (
                                    <ul id={`section-${item.label}`} className="mt-1 ml-8 space-y-1">
                                        {item.children!.map((child) => {
                                            const CIcon = child.icon
                                            return (
                                                <li key={child.path}>
                                                    <Link
                                                        to={child.path}
                                                        className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-neutral-50"
                                                        activeProps={{ className: 'bg-emerald-700/30 text-emerald-700' }} // For the children
                                                        inactiveProps={{}}
                                                    >
                                                        {CIcon ? <CIcon className="shrink-0" size={16} /> : null}
                                                        <span className="truncate">{child.label}</span>
                                                    </Link>
                                                </li>
                                            )
                                        })}
                                    </ul>
                                )}

                                {/* Collapsed-mode flyout submenu: appears on hover to access children */}
                                {collapsed && hasChildren && (
                                    <div className="absolute left-full top-0 hidden group-hover:block z-50 pl-2 ">
                                        <div className="min-w-44 rounded-xl border bg-white shadow-lg p-2">
                                            <div className="px-2 py-1 text-xs font-semibold text-neutral-500">{item.label}</div>
                                            <ul className="mt-1 space-y-1">
                                                {item.children!.map((child) => {
                                                    const CIcon = child.icon
                                                    return (
                                                        <li key={child.path}>
                                                            <Link
                                                                to={child.path}
                                                                className="flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-neutral-50 whitespace-nowrap"
                                                                activeProps={{ className: 'bg-neutral-100 text-[#6a9455] font-semibold' }}
                                                                inactiveProps={{}}
                                                            >
                                                                {CIcon ? <CIcon className="shrink-0" size={16} /> : null}
                                                                <span className="truncate">{child.label}</span>
                                                            </Link>
                                                        </li>
                                                    )
                                                })}
                                            </ul>
                                        </div>
                                    </div>
                                )}
                            </li>
                        )
                    })}
                </ul>
            </nav>

            {/* Account footer */}
            <div className="border-t p-3">
                {!collapsed ? (
                    <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                            <div className="text-[11px] text-neutral-500">Signed in as</div>
                            <div className="text-sm font-medium truncate">{user?.email}</div>
                        </div>
                        <div className="flex items-center gap-2">
                            <Link to="/" className="text-xs px-2 py-1 rounded border hover:bg-neutral-50">Guest</Link>
                            <button onClick={() => onLogout()} className="text-xs px-2 py-1 rounded border text-red-600 hover:bg-red-50 cursor-pointer">Logout</button>
                        </div>
                    </div>
                ) : (
                    <div className="flex items-center justify-center">
                        <button
                            //onClick={() => onLogout()}
                            //title="Log out"
                            className="w-8 h-8 rounded-full bg-neutral-200 text-neutral-700 font-semibold"
                        >
                            {(user?.email?.[0] || 'U').toUpperCase()}
                        </button>
                    </div>
                )}
            </div>
        </aside>
    )
}

/**
 * AdminSidebar
 *
 * High-level responsibilities:
 * - Render the left admin navigation with collapse/expand and mobile drawer.
 * - Keep UI preferences (collapsed state and open sections) in localStorage.
 * - Use TanStack Router primitives for active styling and reactive location.
 * - Provide accessible behavior in both expanded and collapsed modes.
 * - In collapsed mode, show tooltips and flyout submenus to reach children.
 */
export function AdminSidebar({ user }: { user: any }) {
    const { pathname } = useLocation()
    const router = useRouter()

    // Sidebar states persisted in localStorage
    const [collapsed, setCollapsed] = useLocalStorage<boolean>('admin:sidebar:collapsed', false)
    const [mobileOpen, setMobileOpen] = React.useState(false)

    // Control section dropdowns in expanded mode
    const [openSections, setOpenSections] = useLocalStorage<Record<string, boolean>>('admin:sidebar:sections', {})

    // On first load (no stored state), auto-open only the section that contains the current route
    React.useEffect(() => {
        if (openSections && Object.keys(openSections).length === 0) {
            const initial: Record<string, boolean> = {}
            for (const item of adminNav) {
                if (item.children && item.children.length) {
                    const sectionPathMatch = (!!item.path && (pathname === item.path || pathname.startsWith(item.path + '/')))
                    const childMatch = item.children.some(
                        (c) => pathname === c.path || pathname.startsWith(c.path + '/')
                    )
                    if (sectionPathMatch || childMatch) {
                        initial[item.label] = true
                        break
                    }
                }
            }
            if (Object.keys(initial).length > 0) {
                setOpenSections(initial)
            }
        }
    }, [pathname])

    const toggleSection = (label: string) =>
        setOpenSections((s) => ({ ...s, [label]: !s[label] }))

    // Logout handler to use in sidebar footer controls
    const handleLogout = async () => {
        try {
            await logoutUser();
            await router.invalidate();
            router.navigate({ to: '/' });
        } catch (err) {
            console.error('Logout failed:', err);
        }
    }

    return (
        <div className="h-full flex flex-col shrink-0">
            {/* Mobile trigger */}
            <div className="md:hidden p-2 border-b flex items-center justify-between">
                <button
                    className="inline-flex items-center gap-2 rounded px-3 py-2 border"
                    onClick={() => setMobileOpen(true)}
                    aria-label="Open sidebar"
                >
                    <Menu size={16} /> <span className="text-sm">Menu</span>
                </button>
            </div>

            {/* Desktop sidebar */}
            <div className="hidden md:block sticky top-0 h-screen">
                <SidebarContent
                    collapsed={collapsed}
                    setCollapsed={setCollapsed}
                    setMobileOpen={setMobileOpen}
                    openSections={openSections}
                    toggleSection={toggleSection}
                    pathname={pathname}
                    user={user}
                    onLogout={handleLogout}
                />
            </div>

            {/* Mobile drawer */}
            {mobileOpen && (
                <div className="fixed inset-0 z-50 md:hidden">
                    <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
                    <div className="absolute inset-y-0 left-0 max-w-[80%] w-64 h-full bg-white shadow-xl">
                        <SidebarContent
                            collapsed={false}
                            setCollapsed={setCollapsed}
                            setMobileOpen={setMobileOpen}
                            openSections={openSections}
                            toggleSection={toggleSection}
                            pathname={pathname}
                            user={user}
                            onLogout={handleLogout}
                        />
                    </div>
                </div>
            )}

        </div>
    )
}
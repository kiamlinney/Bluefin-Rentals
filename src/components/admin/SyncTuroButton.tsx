import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { RefreshCw } from 'lucide-react'
import { syncTuroBookings } from '@/lib/db'

// The Turo catch-up. The scheduled sync only looks back a day, so anything Turo
// emailed while it couldn't run (the site down, the domain suspended) is missed
// until someone presses this, which looks back 30 days. Safe to press any time:
// emails already applied are skipped.

type SyncResult = Awaited<ReturnType<typeof syncTuroBookings>>

export function SyncTuroButton() {
    const router = useRouter()
    const [loading, setLoading] = useState(false)
    const [result, setResult] = useState<SyncResult | null>(null)
    const [error, setError] = useState<string | null>(null)

    async function handleClick() {
        setLoading(true)
        setError(null)
        setResult(null)
        try {
            const outcome = await syncTuroBookings()
            setResult(outcome)
            await router.invalidate()
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Sync failed. See the server logs.')
        } finally {
            setLoading(false)
        }
    }

    const summary = result && [
        `${result.synced} updated`,
        result.canceled > 0 && `${result.canceled} cancelled`,
        result.swapsFlagged > 0 && `${result.swapsFlagged} swap${result.swapsFlagged === 1 ? '' : 's'} to sort out`,
        result.overlapsAlerted > 0 && `${result.overlapsAlerted} new overlap${result.overlapsAlerted === 1 ? '' : 's'}`,
    ].filter(Boolean).join(' · ')

    return (
        <div className="flex flex-col items-start gap-1 text-sm">
            <button
                type="button"
                onClick={handleClick}
                disabled={loading}
                className="flex items-center gap-2 border border-gray-200 rounded-lg px-4 py-2 text-gray-700 hover:bg-gray-50 cursor-pointer disabled:opacity-60 disabled:cursor-wait"
            >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                {loading ? 'Syncing Turo…' : 'Sync Turo (last 30 days)'}
            </button>
            {summary && <p className="text-green-700">Synced: {summary}.</p>}
            {result && result.errors.length > 0 && (
                <details className="text-red-700">
                    <summary className="cursor-pointer">
                        {result.errors.length} email{result.errors.length === 1 ? '' : 's'} couldn’t be read
                    </summary>
                    <ul className="mt-1 list-disc pl-5 text-xs">
                        {result.errors.map(e => <li key={e}>{e}</li>)}
                    </ul>
                </details>
            )}
            {error && <p className="text-red-700">{error}</p>}
        </div>
    )
}

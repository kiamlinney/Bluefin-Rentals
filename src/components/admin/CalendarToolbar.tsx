import {ChevronDown, Search} from "lucide-react";

export function CalendarToolbar() {
    return (
        <div className="flex items-center gap-3 mb-4">
            {/* Search field */}
            <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 w-72">
                <input
                    type="text"
                    placeholder="Make, model, plate #"
                    className="flex-1 text-sm outline-none placeholder:text-gray-400 bg-transparent"
                />
                <Search size={16} className="text-gray-400"/>
            </div>

            {/* Sort */}
            <button
                type="button"
                className="flex items-center gap-2 border border-gray-200 rounded-lg px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer"
            >
                Sort
                <ChevronDown size={14}/>
            </button>

            {/* Listing status */}
            <button
                type="button"
                className="flex items-center gap-2 border border-gray-200 rounded-lg px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer"
            >
                Listing Status
                <ChevronDown size={14}/>
            </button>

            {/* Vehicle filter */}
            <button
                type="button"
                className="flex items-center gap-2 border border-gray-200 rounded-lg px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer"
            >
                Vehicle
                <ChevronDown size={14}/>
            </button>

        </div>
    )
}
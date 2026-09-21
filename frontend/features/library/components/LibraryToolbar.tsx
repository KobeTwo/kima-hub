"use client";

import { LibraryFilter, SortOption } from "@/hooks/useQueries";
import { Tab } from "../types";
import { RefinePanel } from "./RefinePanel";

interface LibraryToolbarProps {
    activeTab: Tab;
    filter: LibraryFilter;
    sortBy: SortOption;
    itemsPerPage: number;
    onFilterChange: (filter: LibraryFilter) => void;
    onSortChange: (sort: SortOption) => void;
    onItemsPerPageChange: (items: number) => void;
}

export function LibraryToolbar({
    activeTab,
    filter,
    sortBy,
    itemsPerPage,
    onFilterChange,
    onSortChange,
    onItemsPerPageChange,
}: LibraryToolbarProps) {
    return (
        <div className="flex items-center gap-3 pb-4 border-b border-white/5">
            <RefinePanel
                activeTab={activeTab}
                filter={filter}
                sortBy={sortBy}
                itemsPerPage={itemsPerPage}
                onFilterChange={onFilterChange}
                onSortChange={onSortChange}
                onItemsPerPageChange={onItemsPerPageChange}
            />
        </div>
    );
}

"use client";

import { X } from "lucide-react";

interface DiscoverActionBarProps {
    isGenerating: boolean;
    onCancelGeneration?: () => void;
}

export function DiscoverActionBar({
    isGenerating,
    onCancelGeneration,
}: DiscoverActionBarProps) {
    return (
        <div className=" px-6 md:px-8 py-6">
            <div className="max-w-[1600px] mx-auto flex items-center gap-4">
                {/* Cancel Generation Button */}
                {isGenerating && onCancelGeneration && (
                    <button
                        onClick={onCancelGeneration}
                        className="h-12 px-4 flex items-center gap-2 border-2 border-red-500/30 hover:border-red-500 hover:bg-red-500/10 text-red-400 rounded-lg transition-all duration-300 text-sm font-black uppercase tracking-wider"
                    >
                        <X className="w-4 h-4" />
                        Cancel
                    </button>
                )}
            </div>
        </div>
    );
}

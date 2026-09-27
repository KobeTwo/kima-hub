"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";

const ACTIVITY_PANEL_KEY = "kima_activity_panel_open";

export function useActivityPanel() {
    const [isOpen, setIsOpen] = useState(() => {
        if (typeof window === "undefined") return false;
        return localStorage.getItem(ACTIVITY_PANEL_KEY) === "true";
    });
    const [activeTab, setActiveTab] = useState<"notifications" | "active" | "imports" | "history" | "settings">("notifications");

    // Synchronous mirror of isOpen. open/close must decide whether to emit an
    // event *before* React commits the state update, and they must never
    // dispatch from inside a setState updater: the listeners below
    // (AuthenticatedLayout) call straight back into open/close/toggle, which
    // re-entered the updater while the old state was still current and
    // recursed until the call stack overflowed.
    const isOpenRef = useRef(isOpen);

    // Persist state to localStorage
    useEffect(() => {
        if (typeof window !== "undefined") {
            localStorage.setItem(ACTIVITY_PANEL_KEY, isOpen ? "true" : "false");
        }
    }, [isOpen]);

    const emitOpenState = useCallback((next: boolean) => {
        window.dispatchEvent(
            new CustomEvent(next ? "open-activity-panel" : "close-activity-panel")
        );
    }, []);

    const toggle = useCallback(() => {
        const next = !isOpenRef.current;
        isOpenRef.current = next;
        setIsOpen(next);
        emitOpenState(next);
    }, [emitOpenState]);

    const open = useCallback(() => {
        if (isOpenRef.current) return;
        isOpenRef.current = true;
        setIsOpen(true);
        emitOpenState(true);
    }, [emitOpenState]);

    const close = useCallback(() => {
        if (!isOpenRef.current) return;
        isOpenRef.current = false;
        setIsOpen(false);
        emitOpenState(false);
    }, [emitOpenState]);

    return useMemo(() => ({
        isOpen,
        activeTab,
        setActiveTab,
        toggle,
        open,
        close,
    }), [isOpen, activeTab, setActiveTab, toggle, open, close]);
}

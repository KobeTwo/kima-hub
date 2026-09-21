"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect, useRef, useCallback } from "react";
import Image from "next/image";
import { cn } from "@/utils/cn";
import { api } from "@/lib/api";
import { DPAD_KEYS } from "@/lib/tv-utils";
import { useTVNavigation } from "@/hooks/useTVNavigation";
import { RefreshCw } from "lucide-react";

const tvNavigation = [
    { name: "Home", href: "/" },
    { name: "Search", href: "/search" },
    { name: "Collection", href: "/collection" },
    { name: "Discovery", href: "/discover" },
    { name: "Playlists", href: "/playlists" },
];

export function TVLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();
    // Start with nav focused and first tab selected for immediate D-pad usability
    const [focusedTabIndex, setFocusedTabIndex] = useState(0);
    const [isNavFocused, setIsNavFocused] = useState(true);
    const [isSyncing, setIsSyncing] = useState(false);
    const navRef = useRef<HTMLDivElement>(null);

    // TV content navigation hook
    const {
        containerRef: contentRef,
        focusFirstCard,
        handleKeyDown: handleContentKeyDown,
    } = useTVNavigation({
        onBack: () => {
            setIsNavFocused(true);
            const currentIndex = tvNavigation.findIndex(n => n.href === pathname);
            setFocusedTabIndex(currentIndex >= 0 ? currentIndex : 0);
        },
    });

    // Add tv-mode class to body on mount
    useEffect(() => {
        document.documentElement.classList.add('tv-mode');
        document.body.classList.add('tv-mode');
        return () => {
            document.documentElement.classList.remove('tv-mode');
            document.body.classList.remove('tv-mode');
        };
    }, []);

    // Sync library
    const handleSync = async () => {
        setIsSyncing(true);
        try {
            await api.scanLibrary();
        } catch (error) {
            console.error("Sync failed:", error);
        } finally {
            setIsSyncing(false);
        }
    };

    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (isNavFocused) {
            if (e.key === DPAD_KEYS.LEFT) {
                e.preventDefault();
                setFocusedTabIndex(prev => Math.max(0, prev - 1));
            } else if (e.key === DPAD_KEYS.RIGHT) {
                e.preventDefault();
                setFocusedTabIndex(prev => Math.min(tvNavigation.length - 1, prev + 1));
            } else if (e.key === DPAD_KEYS.DOWN) {
                e.preventDefault();
                setIsNavFocused(false);
                // Use the navigation hook to focus first card
                focusFirstCard();
            } else if (e.key === DPAD_KEYS.CENTER) {
                e.preventDefault();
                router.push(tvNavigation[focusedTabIndex].href);
            }
        } else {
            // Delegate to content navigation hook
            handleContentKeyDown(e);
        }
    }, [isNavFocused, focusedTabIndex, router, focusFirstCard, handleContentKeyDown]);

    useEffect(() => {
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [handleKeyDown]);

    // Focus correct nav tab when isNavFocused changes or focusedTabIndex changes
    useEffect(() => {
        if (isNavFocused && navRef.current) {
            const tabs = navRef.current.querySelectorAll<HTMLAnchorElement>('[data-tv-tab]');
            tabs[focusedTabIndex]?.focus();
        }
    }, [focusedTabIndex, isNavFocused]);

    // On initial mount and pathname change, set the correct focused tab
    useEffect(() => {
        const currentIndex = tvNavigation.findIndex(n =>
            n.href === pathname || (n.href !== "/" && pathname.startsWith(n.href))
        );
        if (currentIndex >= 0) {
            setFocusedTabIndex(currentIndex);
        }
    }, [pathname]);

    return (
        <>
            {/* Nav */}
            <header className="tv-nav">
                <Link href="/" className="tv-logo">
                    <Image src="/assets/images/kima.webp" alt="Kima" width={24} height={24} priority />
                    <span>Kima</span>
                </Link>

                <nav ref={navRef} className="tv-nav-links">
                    {tvNavigation.map((item, index) => {
                        const isActive = pathname === item.href || 
                            (item.href !== "/" && pathname.startsWith(item.href));
                        const isFocused = isNavFocused && focusedTabIndex === index;

                        return (
                            <Link
                                key={item.name}
                                href={item.href}
                                data-tv-tab
                                className={cn("tv-nav-link", isActive && "active", isFocused && "focused")}
                                onFocus={() => {
                                    setIsNavFocused(true);
                                    setFocusedTabIndex(index);
                                }}
                            >
                                {item.name}
                            </Link>
                        );
                    })}
                </nav>

                {/* Spacer */}
                <div className="flex-1" />

                {/* Sync button */}
                <button 
                    onClick={handleSync}
                    disabled={isSyncing}
                    className="tv-sync-btn"
                    title="Sync Library"
                >
                    <RefreshCw className={cn("w-4 h-4", isSyncing && "animate-spin")} />
                </button>
            </header>

            {/* Content */}
            <main id="main-content" tabIndex={-1} ref={contentRef} className="tv-content">
                {children}
            </main>
        </>
    );
}

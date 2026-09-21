import { useState, useCallback, useEffect, useRef } from "react";
import { useToast } from "@/lib/toast-context";
import { api } from "@/lib/api";

export function usePreviewPlayer() {
    const { toast } = useToast();
    const [currentPreview, setCurrentPreview] = useState<string | null>(null);
    const [previewAudios, setPreviewAudios] = useState<
        Map<string, HTMLAudioElement>
    >(new Map());
    const previewAudiosRef = useRef<Map<string, HTMLAudioElement>>(new Map());

    // Keep ref in sync
    useEffect(() => {
        previewAudiosRef.current = previewAudios;
    });

    // Cleanup only on unmount
    useEffect(() => {
        return () => {
            previewAudiosRef.current.forEach((audio) => {
                audio.pause();
                audio.src = "";
            });
        };
    }, []);

    const handleTogglePreview = useCallback(
        (albumId: string, artistName: string, trackTitle: string) => {

            // Stop currently playing preview and destroy it
            if (currentPreview && currentPreview !== albumId) {
                const audio = previewAudios.get(currentPreview);
                if (audio) {
                    audio.pause();
                    audio.src = "";
                    audio.load();
                }
                const newMap = new Map(previewAudios);
                newMap.delete(currentPreview);
                setPreviewAudios(newMap);
            }

            // Toggle the clicked preview
            if (currentPreview === albumId) {
                const audio = previewAudios.get(albumId);
                if (audio) {
                    audio.pause();
                    audio.src = "";
                    audio.load();
                }
                // Remove from map to free memory
                const newMap = new Map(previewAudios);
                newMap.delete(albumId);
                setPreviewAudios(newMap);
                setCurrentPreview(null);
            } else {
                let audio = previewAudios.get(albumId);
                if (!audio) {
                    audio = new Audio(
                        api.getTrackPreviewStreamUrl(artistName, trackTitle)
                    );
                    audio.onended = () => {
                        setCurrentPreview(null);
                    };
                    audio.onerror = () => {
                        toast.error("Failed to load preview");
                        setCurrentPreview(null);
                    };
                    const newMap = new Map(previewAudios);
                    newMap.set(albumId, audio);
                    setPreviewAudios(newMap);
                }

                audio
                    .play()
                    .then(() => {
                        setCurrentPreview(albumId);
                    })
                    .catch((error) => {
                        toast.error("Failed to play preview: " + error.message);
                    });
            }
        },
        [toast, currentPreview, previewAudios]
    );

    return {
        currentPreview,
        handleTogglePreview,
    };
}

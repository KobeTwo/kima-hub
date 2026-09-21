import { api } from "@/lib/api";
import { useDownloadContext } from "@/lib/download-context";
import { useToast } from "@/lib/toast-context";
import { Album } from "../types";

export function useAlbumActions() {
    const { toast } = useToast();
    const { addPendingDownload, isPendingByMbid } = useDownloadContext();

    const downloadAlbum = async (album: Album | null, e?: React.MouseEvent) => {
        if (e) {
            e.stopPropagation();
        }

        if (!album) {
            toast.error("Album data not available");
            return;
        }

        const mbid = album.rgMbid || album.mbid || album.id;
        if (!mbid) {
            toast.error("Album MBID not available");
            return;
        }

        if (isPendingByMbid(mbid)) {
            toast.info("Album is already being downloaded");
            return;
        }

        try {
            addPendingDownload("album", album.title, mbid);

            toast.info(`Preparing download: "${album.title}"...`);

            await api.downloadAlbum(
                album.artist?.name || "Unknown Artist",
                album.title,
                mbid
            );

            toast.success(`Downloading "${album.title}"`);
        } catch {
            toast.error("Failed to start album download");
        }
    };

    return {
        downloadAlbum,
    };
}

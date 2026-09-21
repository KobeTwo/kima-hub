import { DiscoverySeeding, SeedArtist } from '../discoverySeeding';
import { prisma } from '../../../utils/db';
import { lidarrService } from '../../lidarr';

jest.mock('../../../utils/db', () => ({
    prisma: {
        album: {
            groupBy: jest.fn(),
            findMany: jest.fn(),
            findFirst: jest.fn(),
        },
        artist: {
            findMany: jest.fn(),
            findFirst: jest.fn(),
        },
        ownedAlbum: {
            findFirst: jest.fn(),
        },
        discoveryAlbum: {
            findFirst: jest.fn(),
        },
        downloadJob: {
            findFirst: jest.fn(),
        },
        unavailableAlbum: {
            findFirst: jest.fn(),
        },
    },
}));

jest.mock('../../lidarr', () => ({
    lidarrService: {
        isAlbumAvailable: jest.fn(),
    },
}));

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockLidarrService = lidarrService as jest.Mocked<typeof lidarrService>;

describe('DiscoverySeeding', () => {
    let seeding: DiscoverySeeding;

    beforeEach(() => {
        jest.clearAllMocks();
        seeding = new DiscoverySeeding();
    });

    describe('getSeedArtists', () => {
        const userId = 'user-123';

        // Helper: build mock album rows for album.findMany
        const albums = (...artists: Array<{ id: string; name: string; mbid: string | null }>) =>
            artists.map((a, i) => ({ artist: { id: a.id, name: a.name, mbid: a.mbid }, albumIndex: i }));

        it('should return seed artists from library albums with valid MBIDs', async () => {
            (mockPrisma.album.findMany as jest.Mock).mockResolvedValue(albums(
                { id: 'artist-1', name: 'Artist One', mbid: 'valid-mbid-1' },
                { id: 'artist-2', name: 'Artist Two', mbid: 'valid-mbid-2' },
                { id: 'artist-3', name: 'Artist Three', mbid: 'valid-mbid-3' },
            ));

            const result = await seeding.getSeedArtists(userId);

            expect(result).toHaveLength(3);
            expect(result).toEqual(
                expect.arrayContaining([
                    { name: 'Artist One', mbid: 'valid-mbid-1' },
                    { name: 'Artist Two', mbid: 'valid-mbid-2' },
                    { name: 'Artist Three', mbid: 'valid-mbid-3' },
                ])
            );
            expect(mockPrisma.album.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: { location: 'LIBRARY' } })
            );
        });

        it('should filter out artists with temp- MBIDs', async () => {
            (mockPrisma.album.findMany as jest.Mock).mockResolvedValue(albums(
                { id: 'artist-1', name: 'Artist One', mbid: 'temp-12345' },
                { id: 'artist-2', name: 'Artist Two', mbid: 'valid-mbid-2' },
                { id: 'artist-3', name: 'Artist Three', mbid: 'valid-mbid-3' },
                { id: 'artist-4', name: 'Artist Four', mbid: 'valid-mbid-4' },
                { id: 'artist-5', name: 'Artist Five', mbid: 'valid-mbid-5' },
            ));

            const result = await seeding.getSeedArtists(userId);

            expect(result).toHaveLength(4);
            expect(result.find((a) => a.mbid === 'temp-12345')).toBeUndefined();
        });

        it('should filter out artists with null MBIDs', async () => {
            (mockPrisma.album.findMany as jest.Mock).mockResolvedValue(albums(
                { id: 'artist-1', name: 'Artist One', mbid: null },
                { id: 'artist-2', name: 'Artist Two', mbid: 'valid-mbid-2' },
                { id: 'artist-3', name: 'Artist Three', mbid: 'valid-mbid-3' },
                { id: 'artist-4', name: 'Artist Four', mbid: 'valid-mbid-4' },
                { id: 'artist-5', name: 'Artist Five', mbid: 'valid-mbid-5' },
            ));

            const result = await seeding.getSeedArtists(userId);

            expect(result).toHaveLength(4);
            expect(result.find((a) => a.mbid === null)).toBeUndefined();
        });

        it('should return an empty array when the library has no albums', async () => {
            (mockPrisma.album.findMany as jest.Mock).mockResolvedValue([]);

            const result = await seeding.getSeedArtists(userId);

            expect(result).toEqual([]);
        });

        it('should respect seedCount parameter', async () => {
            const artists = Array.from({ length: 20 }, (_, i) => ({
                id: `artist-${i}`,
                name: `Artist ${i}`,
                mbid: `mbid-${i}`,
            }));
            (mockPrisma.album.findMany as jest.Mock).mockResolvedValue(albums(...artists));

            const result = await seeding.getSeedArtists(userId, 5);

            expect(result).toHaveLength(5);
        });

        it('should deduplicate artists appearing in multiple albums', async () => {
            (mockPrisma.album.findMany as jest.Mock).mockResolvedValue(albums(
                { id: 'artist-1', name: 'Same Artist', mbid: 'valid-mbid-1' },
                { id: 'artist-1', name: 'Same Artist', mbid: 'valid-mbid-1' },
                { id: 'artist-2', name: 'Different Artist', mbid: 'valid-mbid-2' },
                { id: 'artist-1', name: 'Same Artist', mbid: 'valid-mbid-1' },
                { id: 'artist-3', name: 'Third Artist', mbid: 'valid-mbid-3' },
            ));

            const result = await seeding.getSeedArtists(userId);

            // 3 unique artists despite 5 albums (artist-1 appears 3 times)
            expect(result).toHaveLength(3);
            expect(result.map((a) => a.name).sort()).toEqual([
                'Different Artist',
                'Same Artist',
                'Third Artist',
            ]);
        });
    });

    describe('isArtistInLibrary', () => {
        it('should return true when artist found by MBID with albums', async () => {
            (mockPrisma.artist.findFirst as jest.Mock).mockResolvedValue({
                id: 'artist-1',
                mbid: 'valid-mbid',
                albums: [{ id: 'album-1' }],
            });

            const result = await seeding.isArtistInLibrary('valid-mbid');

            expect(result).toBe(true);
            expect(mockPrisma.artist.findFirst).toHaveBeenCalledWith({
                where: { mbid: 'valid-mbid' },
                include: { albums: { take: 1 } },
            });
        });

        it('should return false when artist found by MBID but has no albums', async () => {
            (mockPrisma.artist.findFirst as jest.Mock).mockResolvedValue({
                id: 'artist-1',
                mbid: 'valid-mbid',
                albums: [],
            });

            const result = await seeding.isArtistInLibrary('valid-mbid');

            expect(result).toBe(false);
        });

        it('should return false when artist not found', async () => {
            (mockPrisma.artist.findFirst as jest.Mock).mockResolvedValue(null);

            const result = await seeding.isArtistInLibrary('unknown-mbid');

            expect(result).toBe(false);
        });

        it('should skip temp- MBIDs and return false', async () => {
            const result = await seeding.isArtistInLibrary('temp-12345');

            expect(result).toBe(false);
            expect(mockPrisma.artist.findFirst).not.toHaveBeenCalled();
        });
    });

    describe('isAlbumOwned', () => {
        const userId = 'user-123';

        it('should return true when album found in OwnedAlbum table', async () => {
            (mockPrisma.ownedAlbum.findFirst as jest.Mock).mockResolvedValue({
                rgMbid: 'album-mbid',
            });

            const result = await seeding.isAlbumOwned('album-mbid', userId);

            expect(result).toBe(true);
        });

        it('should return true when album found in Album table', async () => {
            (mockPrisma.ownedAlbum.findFirst as jest.Mock).mockResolvedValue(null);
            (mockPrisma.album.findFirst as jest.Mock).mockResolvedValue({
                rgMbid: 'album-mbid',
            });

            const result = await seeding.isAlbumOwned('album-mbid', userId);

            expect(result).toBe(true);
        });

        it('should return true when album found in previous discovery', async () => {
            (mockPrisma.ownedAlbum.findFirst as jest.Mock).mockResolvedValue(null);
            (mockPrisma.album.findFirst as jest.Mock).mockResolvedValue(null);
            (mockPrisma.discoveryAlbum.findFirst as jest.Mock).mockResolvedValue({
                rgMbid: 'album-mbid',
            });

            const result = await seeding.isAlbumOwned('album-mbid', userId);

            expect(result).toBe(true);
        });

        it('should return true when album has pending download', async () => {
            (mockPrisma.ownedAlbum.findFirst as jest.Mock).mockResolvedValue(null);
            (mockPrisma.album.findFirst as jest.Mock).mockResolvedValue(null);
            (mockPrisma.discoveryAlbum.findFirst as jest.Mock).mockResolvedValue(null);
            (mockPrisma.downloadJob.findFirst as jest.Mock).mockResolvedValue({
                targetMbid: 'album-mbid',
                status: 'pending',
            });

            const result = await seeding.isAlbumOwned('album-mbid', userId);

            expect(result).toBe(true);
        });

        it('should return true when album available in Lidarr', async () => {
            (mockPrisma.ownedAlbum.findFirst as jest.Mock).mockResolvedValue(null);
            (mockPrisma.album.findFirst as jest.Mock).mockResolvedValue(null);
            (mockPrisma.discoveryAlbum.findFirst as jest.Mock).mockResolvedValue(null);
            (mockPrisma.downloadJob.findFirst as jest.Mock).mockResolvedValue(null);
            mockLidarrService.isAlbumAvailable.mockResolvedValue(true);

            const result = await seeding.isAlbumOwned('album-mbid', userId);

            expect(result).toBe(true);
            expect(mockLidarrService.isAlbumAvailable).toHaveBeenCalledWith('album-mbid');
        });

        it('should return false when album not found anywhere', async () => {
            (mockPrisma.ownedAlbum.findFirst as jest.Mock).mockResolvedValue(null);
            (mockPrisma.album.findFirst as jest.Mock).mockResolvedValue(null);
            (mockPrisma.discoveryAlbum.findFirst as jest.Mock).mockResolvedValue(null);
            (mockPrisma.downloadJob.findFirst as jest.Mock).mockResolvedValue(null);
            mockLidarrService.isAlbumAvailable.mockResolvedValue(false);

            const result = await seeding.isAlbumOwned('album-mbid', userId);

            expect(result).toBe(false);
        });
    });
});

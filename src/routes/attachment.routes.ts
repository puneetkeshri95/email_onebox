import { Router, Request, Response } from 'express';
import { AttachmentStorageService } from '../services/attachment-storage.service';
import { isAuthenticated } from '../utils/session-utils';
import path from 'path';

const router = Router();
const attachmentStorage = new AttachmentStorageService();

/**
 * GET /api/attachments/:filename - Download  attachment
 */
router.get('/:filename', async (req: Request, res: Response) => {
    try {
        // Check if user is authenticated
        if (!isAuthenticated(req)) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required',
                message: 'Please sign in to download attachments',
            });
        }

        const { filename } = req.params;
        
        // Validate filename (basic security check)
        if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
            return res.status(400).json({
                success: false,
                error: 'Invalid filename',
                message: 'The requested filename is not valid',
            });
        }

        // Get the attachment data
        const attachmentData = await attachmentStorage.getAttachment(filename);
        
        if (!attachmentData) {
            return res.status(404).json({
                success: false,
                error: 'Attachment not found',
                message: `Attachment ${filename} not found`,
            });
        }

        // Extract original filename from the stored filename
        // Format: emailId_originalName_timestamp.ext
        const parts = filename.split('_');
        let originalFilename = filename;
        if (parts.length >= 3) {
            // Remove emailId and timestamp, keep the middle part(s) as original name
            const emailId = parts[0];
            const timestamp = parts[parts.length - 1];
            const originalParts = parts.slice(1, -1);
            const nameWithoutTimestamp = originalParts.join('_');
            const ext = path.extname(timestamp);
            originalFilename = nameWithoutTimestamp + ext;
        }

        // Set appropriate headers for download
        res.setHeader('Content-Disposition', `attachment; filename="${originalFilename}"`);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Length', attachmentData.length);

        // Send the file
        res.send(attachmentData);

    } catch (error) {
        console.error('❌ Error serving attachment:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to download attachment',
            message: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});

/**
 * GET /api/attachments/stats - Get attachment storage statistics
 */
router.get('/stats', async (req: Request, res: Response) => {
    try {
        // Check if user is authenticated
        if (!isAuthenticated(req)) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required',
                message: 'Please sign in to view attachment statistics',
            });
        }

        const stats = await attachmentStorage.getStorageStats();
        
        res.json({
            success: true,
            data: {
                totalFiles: stats.totalFiles,
                totalSizeBytes: stats.totalSize,
                totalSizeMB: Math.round(stats.totalSize / (1024 * 1024) * 100) / 100,
                storageDirectory: stats.storageDir
            },
            timestamp: new Date().toISOString(),
        });

    } catch (error) {
        console.error('❌ Error getting attachment stats:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get attachment statistics',
            message: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});

export default router;

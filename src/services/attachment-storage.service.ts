import * as fs from 'fs/promises';
import * as path from 'path';
import { EmailAttachment } from '../models/types';

/**
 * Service to handle email attachment storage separately from Elasticsearch
 * This prevents indexing errors with large binary files
 */
export class AttachmentStorageService {
    private readonly storageDir: string;

    constructor() {
        // Create attachments directory in the project data folder
        this.storageDir = path.join(process.cwd(), 'data', 'attachments');
        this.ensureStorageDirectory();
    }

    /**
     * Ensure the storage directory exists
     */
    private async ensureStorageDirectory(): Promise<void> {
        try {
            await fs.mkdir(this.storageDir, { recursive: true });
        } catch (error) {
            console.error('❌ Failed to create attachments directory:', error);
        }
    }

    /**
     * Store an attachment and return metadata for indexing
     * @param emailId - The email ID this attachment belongs to
     * @param attachment - The attachment data
     * @returns Attachment metadata without binary data
     */
    async storeAttachment(emailId: string, attachment: EmailAttachment): Promise<EmailAttachment> {
        if (!attachment.data || attachment.isInline) {
            // Don't store inline attachments or attachments without data
            return attachment;
        }

        try {
            // Generate a unique filename
            const sanitizedFilename = this.sanitizeFilename(attachment.filename);
            const fileExtension = path.extname(sanitizedFilename);
            const baseName = path.basename(sanitizedFilename, fileExtension);
            const uniqueFilename = `${emailId}_${baseName}_${Date.now()}${fileExtension}`;
            const filePath = path.join(this.storageDir, uniqueFilename);

            // Store the file
            await fs.writeFile(filePath, attachment.data);

            console.log(`📎 Stored attachment: ${attachment.filename} (${attachment.size} bytes)`);

            // Return metadata without binary data
            return {
                ...attachment,
                data: undefined, // Remove binary data
                downloadUrl: `/api/attachments/${uniqueFilename}` // Add download URL
            };

        } catch (error) {
            console.error(`❌ Failed to store attachment ${attachment.filename}:`, error);
            
            // Return original attachment without data on error
            return {
                ...attachment,
                data: undefined
            };
        }
    }

    /**
     * Store multiple attachments for an email
     */
    async storeEmailAttachments(emailId: string, attachments: EmailAttachment[]): Promise<EmailAttachment[]> {
        const storedAttachments: EmailAttachment[] = [];

        for (const attachment of attachments) {
            const stored = await this.storeAttachment(emailId, attachment);
            storedAttachments.push(stored);
        }

        return storedAttachments;
    }

    /**
     * Retrieve an attachment by filename
     */
    async getAttachment(filename: string): Promise<Buffer | null> {
        try {
            const filePath = path.join(this.storageDir, filename);
            return await fs.readFile(filePath);
        } catch (error) {
            console.error(`❌ Failed to retrieve attachment ${filename}:`, error);
            return null;
        }
    }

    /**
     * Delete attachments for an email
     */
    async deleteEmailAttachments(emailId: string): Promise<void> {
        try {
            const files = await fs.readdir(this.storageDir);
            const emailAttachments = files.filter(file => file.startsWith(`${emailId}_`));

            for (const file of emailAttachments) {
                const filePath = path.join(this.storageDir, file);
                await fs.unlink(filePath);
            }

            console.log(`🗑️ Deleted ${emailAttachments.length} attachments for email ${emailId}`);
        } catch (error) {
            console.error(`❌ Failed to delete attachments for email ${emailId}:`, error);
        }
    }

    /**
     * Sanitize filename for safe storage
     */
    private sanitizeFilename(filename: string): string {
        // Remove or replace dangerous characters
        return filename
            .replace(/[<>:"/\\|?*]/g, '_') // Replace dangerous chars with underscore
            .replace(/\s+/g, '_') // Replace spaces with underscore
            .replace(/_{2,}/g, '_') // Replace multiple underscores with single
            .substring(0, 255); // Limit length
    }

    /**
     * Get storage statistics
     */
    async getStorageStats(): Promise<{
        totalFiles: number;
        totalSize: number;
        storageDir: string;
    }> {
        try {
            const files = await fs.readdir(this.storageDir);
            let totalSize = 0;

            for (const file of files) {
                const filePath = path.join(this.storageDir, file);
                const stats = await fs.stat(filePath);
                totalSize += stats.size;
            }

            return {
                totalFiles: files.length,
                totalSize,
                storageDir: this.storageDir
            };
        } catch (error) {
            console.error('❌ Failed to get storage stats:', error);
            return {
                totalFiles: 0,
                totalSize: 0,
                storageDir: this.storageDir
            };
        }
    }

    /**
     * Clean up old attachments (optional maintenance)
     */
    async cleanupOldAttachments(daysOld: number = 30): Promise<void> {
        try {
            const files = await fs.readdir(this.storageDir);
            const cutoffTime = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
            let deletedCount = 0;

            for (const file of files) {
                const filePath = path.join(this.storageDir, file);
                const stats = await fs.stat(filePath);
                
                if (stats.mtimeMs < cutoffTime) {
                    await fs.unlink(filePath);
                    deletedCount++;
                }
            }

            console.log(`🧹 Cleaned up ${deletedCount} old attachments (older than ${daysOld} days)`);
        } catch (error) {
            console.error('❌ Failed to cleanup old attachments:', error);
        }
    }
}

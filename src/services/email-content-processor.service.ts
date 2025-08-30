import * as cheerio from 'cheerio';
import { Email, EmailAttachment, InlineImage, EmailContentProcessingResult } from '../models/types';
import { Attachment } from 'mailparser';
import { AttachmentStorageService } from './attachment-storage.service';

export class EmailContentProcessorService {
    private attachmentStorage: AttachmentStorageService;

    constructor() {
        this.attachmentStorage = new AttachmentStorageService();
    }

    /**
     * Process email content for safe display with proper image handling
     */
    async processEmailContent(
        htmlContent: string | null,
        plainTextContent: string | null,
        attachments: Attachment[] = [],
        emailId?: string // Add emailId for attachment storage
    ): Promise<EmailContentProcessingResult> {

        // Extract inline images and regular attachments
        const { inlineImages, regularAttachments } = this.categorizeAttachments(attachments);

        // Store attachments separately if emailId is provided
        let processedAttachments = regularAttachments;
        if (emailId && regularAttachments.length > 0) {
            try {
                processedAttachments = await this.attachmentStorage.storeEmailAttachments(emailId, regularAttachments);
            } catch (error) {
                console.error('❌ Error storing attachments, using metadata only:', error);
                // Fallback: remove binary data but keep metadata
                processedAttachments = regularAttachments.map(att => ({
                    ...att,
                    data: undefined
                }));
            }
        }

        if (!htmlContent) {
            return {
                cleanHtml: this.textToHtml(plainTextContent || ''),
                plainText: plainTextContent || '',
                hasExternalImages: false,
                inlineImages,
                attachments: processedAttachments, // Use processed attachments
                contentSafe: true
            };
        }

        // Load HTML into Cheerio for manipulation
        const $ = cheerio.load(htmlContent, {
            decodeEntities: false,
            xmlMode: false
        });

        // Process inline images
        await this.processInlineImages($, inlineImages);

        // Handle external images (block by default for privacy)
        const hasExternalImages = this.processExternalImages($);

        // Sanitize HTML content
        this.sanitizeHtml($);

        // Apply responsive styling
        this.applyEmailStyling($);

        // Add attachment section if there are attachments with download URLs
        if (processedAttachments.length > 0) {
            this.addAttachmentSection($, processedAttachments);
        }

        const cleanHtml = $.html();

        // Extract better quality plain text
        let plainText = '';

        // Remove script and style content first
        $('script, style').remove();

        // Get text from body or root, preserving some structure
        const extractedText = $('body').length > 0 ? $('body').text() : $('*').text();

        plainText = extractedText
            .replace(/\s+/g, ' ')  // Normalize whitespace
            .replace(/\n\s*\n/g, '\n')  // Remove excessive line breaks
            .trim();

        return {
            cleanHtml,
            plainText,
            hasExternalImages,
            inlineImages,
            attachments: processedAttachments, // Use processed attachments
            contentSafe: true
        };
    }

    /**
     * Categorize attachments into inline images and regular attachments
     */
    private categorizeAttachments(attachments: Attachment[]): {
        inlineImages: InlineImage[];
        regularAttachments: EmailAttachment[];
    } {
        const inlineImages: InlineImage[] = [];
        const regularAttachments: EmailAttachment[] = [];

        attachments.forEach(attachment => {
            const isInline = attachment.contentDisposition === 'inline' &&
                attachment.cid &&
                attachment.contentType?.startsWith('image/');

            if (isInline) {
                inlineImages.push({
                    cid: attachment.cid!,
                    contentType: attachment.contentType,
                    data: attachment.content,
                    filename: attachment.filename
                });
            } else {
                // For regular attachments, include binary data for storage processing
                // The AttachmentStorageService will handle storage and remove binary data
                regularAttachments.push({
                    filename: attachment.filename || 'unknown',
                    contentType: attachment.contentType,
                    size: attachment.size || attachment.content?.length || 0,
                    contentId: attachment.cid,
                    isInline: false,
                    // Include binary data for storage service to process
                    data: attachment.content // Will be removed after storage
                });
            }
        });

        return { inlineImages, regularAttachments };
    }

    /**
     * Process inline images by converting them to data URLs
     */
    private async processInlineImages($: cheerio.Root, inlineImages: InlineImage[]): Promise<void> {
        $('img[src^="cid:"]').each((index, element) => {
            const cidSrc = $(element).attr('src');
            if (cidSrc) {
                const cid = cidSrc.replace('cid:', '');
                const inlineImage = inlineImages.find(img => img.cid === cid);

                if (inlineImage && inlineImage.data) {
                    // Convert to base64 data URL
                    const base64Data = inlineImage.data.toString('base64');
                    const dataUrl = `data:${inlineImage.contentType};base64,${base64Data}`;

                    $(element).attr('src', dataUrl);
                    $(element).attr('data-inline', 'true');
                    $(element).attr('loading', 'lazy');
                }
            }
        });
    }

    /**
     * Handle external images (block for privacy by default)
     */
    private processExternalImages($: cheerio.Root): boolean {
        let hasExternalImages = false;

        $('img').each((index, element) => {
            const src = $(element).attr('src');

            if (src && (src.startsWith('http://') || src.startsWith('https://'))) {
                hasExternalImages = true;

                // Store original src and replace with placeholder
                $(element).attr('data-original-src', src);
                $(element).attr('src', this.createImagePlaceholder());
                $(element).addClass('blocked-external-image');
                $(element).attr('title', 'External image blocked for privacy. Click to load.');
                $(element).attr('alt', 'External image (click to load)');
            }
        });

        return hasExternalImages;
    }

    /**
     * Create a placeholder for blocked external images
     */
    private createImagePlaceholder(): string {
        // SVG placeholder for blocked images
        const svgPlaceholder = `
            <svg width="200" height="150" viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">
                <rect width="200" height="150" fill="#f8f9fa" stroke="#e1e4e8" stroke-width="1"/>
                <text x="100" y="75" text-anchor="middle" fill="#586069" font-family="Arial, sans-serif" font-size="12">
                    🖼️ External Image
                </text>
                <text x="100" y="95" text-anchor="middle" fill="#586069" font-family="Arial, sans-serif" font-size="10">
                    Click to load
                </text>
            </svg>
        `;
        return `data:image/svg+xml;base64,${Buffer.from(svgPlaceholder).toString('base64')}`;
    }

    /**
     * Sanitize HTML content for security
     */
    private sanitizeHtml($: cheerio.Root): void {
        // Remove dangerous elements
        $('script, object, embed, applet, form, input, button, select, textarea, iframe').remove();

        // Remove dangerous attributes
        $('*').each((index, element) => {
            const $el = $(element);

            // Get all attributes safely
            const elementAttribs = (element as any).attribs || {};

            // Remove event handlers and dangerous attributes
            Object.keys(elementAttribs).forEach(attr => {
                if (attr.startsWith('on') ||
                    attr === 'javascript:' ||
                    attr === 'data-src' ||
                    attr === 'srcset') {
                    $el.removeAttr(attr);
                }
            });

            // Clean href attributes
            const href = $el.attr('href');
            if (href && (href.startsWith('javascript:') || href.startsWith('data:'))) {
                $el.removeAttr('href');
            }

            // Clean style attributes to remove potentially dangerous CSS
            const style = $el.attr('style');
            if (style) {
                const cleanStyle = this.sanitizeStyle(style);
                if (cleanStyle) {
                    $el.attr('style', cleanStyle);
                } else {
                    $el.removeAttr('style');
                }
            }
        });
    }

    /**
     * Sanitize CSS styles
     */
    private sanitizeStyle(style: string): string {
        // Remove dangerous CSS properties
        const dangerousProperties = [
            'position', 'top', 'left', 'right', 'bottom', 'z-index',
            'position: fixed', 'position: absolute',
            'expression', 'behavior', 'binding',
            '@import', 'javascript:', 'vbscript:'
        ];

        let cleanStyle = style;
        dangerousProperties.forEach(prop => {
            const regex = new RegExp(prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
            cleanStyle = cleanStyle.replace(regex, '');
        });

        return cleanStyle.trim();
    }

    /**
     * Add attachment section to email HTML
     */
    private addAttachmentSection($: cheerio.Root, attachments: EmailAttachment[]): void {
        const visibleAttachments = attachments.filter(att => att.downloadUrl && !att.isInline);
        
        if (visibleAttachments.length === 0) {
            return;
        }

        const attachmentHtml = `
            <div class="email-attachments" style="
                border-top: 1px solid #e1e4e8;
                margin-top: 20px;
                padding-top: 15px;
                background-color: #f8f9fa;
                border-radius: 6px;
                padding: 15px;
            ">
                <h4 style="
                    margin: 0 0 10px 0;
                    color: #24292e;
                    font-size: 14px;
                    font-weight: 600;
                ">📎 Attachments (${visibleAttachments.length})</h4>
                <div class="attachment-list">
                    ${visibleAttachments.map(att => this.createAttachmentHtml(att)).join('')}
                </div>
            </div>
        `;

        // Add to the end of the body or root element
        if ($('body').length > 0) {
            $('body').append(attachmentHtml);
        } else {
            $.root().append(attachmentHtml);
        }
    }

    /**
     * Create HTML for a single attachment
     */
    private createAttachmentHtml(attachment: EmailAttachment): string {
        const fileIcon = this.getFileIcon(attachment.contentType);
        const fileSize = this.formatFileSize(attachment.size);
        
        return `
            <div class="attachment-item" style="
                display: flex;
                align-items: center;
                padding: 8px 12px;
                margin: 4px 0;
                background: white;
                border: 1px solid #e1e4e8;
                border-radius: 4px;
                text-decoration: none;
                color: #24292e;
                transition: background-color 0.2s;
            " onmouseover="this.style.backgroundColor='#f1f8ff'" onmouseout="this.style.backgroundColor='white'">
                <span style="
                    font-size: 16px;
                    margin-right: 8px;
                    display: inline-block;
                    width: 20px;
                    text-align: center;
                ">${fileIcon}</span>
                <div style="flex: 1; min-width: 0;">
                    <div style="
                        font-weight: 500;
                        color: #0366d6;
                        margin-bottom: 2px;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        white-space: nowrap;
                    ">
                        <a href="${attachment.downloadUrl}" style="
                            color: #0366d6;
                            text-decoration: none;
                        " onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">
                            ${attachment.filename}
                        </a>
                    </div>
                    <div style="
                        font-size: 12px;
                        color: #586069;
                    ">${attachment.contentType} • ${fileSize}</div>
                </div>
                <a href="${attachment.downloadUrl}" download="${attachment.filename}" style="
                    background: #0366d6;
                    color: white;
                    padding: 4px 8px;
                    border-radius: 3px;
                    font-size: 12px;
                    text-decoration: none;
                    border: none;
                    cursor: pointer;
                " onmouseover="this.style.backgroundColor='#0256cc'" onmouseout="this.style.backgroundColor='#0366d6'">
                    Download
                </a>
            </div>
        `;
    }

    /**
     * Get appropriate icon for file type
     */
    private getFileIcon(contentType: string): string {
        if (contentType.startsWith('image/')) return '🖼️';
        if (contentType.includes('pdf')) return '📄';
        if (contentType.includes('word') || contentType.includes('doc')) return '📝';
        if (contentType.includes('excel') || contentType.includes('sheet')) return '📊';
        if (contentType.includes('powerpoint') || contentType.includes('presentation')) return '📻';
        if (contentType.includes('zip') || contentType.includes('rar') || contentType.includes('archive')) return '📦';
        if (contentType.includes('text')) return '📄';
        if (contentType.includes('video')) return '🎥';
        if (contentType.includes('audio')) return '🎵';
        return '📎';
    }

    /**
     * Format file size for display
     */
    private formatFileSize(bytes: number): string {
        if (bytes === 0) return '0 B';
        
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    /**
     * Apply email-specific styling for better display
     */
    private applyEmailStyling($: cheerio.Root): void {
        // Add container styling
        $('body').addClass('email-content');

        // Make images responsive
        $('img').each((index, element) => {
            const $img = $(element);

            // Add responsive styling
            $img.css({
                'max-width': '100%',
                'height': 'auto',
                'display': 'block',
                'margin': '8px 0'
            });

            // Add loading attribute for performance
            if (!$img.attr('loading')) {
                $img.attr('loading', 'lazy');
            }
        });

        // Fix table styling
        $('table').css({
            'border-collapse': 'collapse',
            'max-width': '100%',
            'table-layout': 'auto'
        });

        $('td, th').css({
            'padding': '8px',
            'border': '1px solid #ddd'
        });

        // Style links
        $('a').css({
            'color': '#1a73e8',
            'text-decoration': 'underline'
        });

        // Add spacing to paragraphs
        $('p').css({
            'margin': '12px 0',
            'line-height': '1.5'
        });
    }

    /**
     * Convert plain text to HTML
     */
    private textToHtml(text: string): string {
        if (!text) return '';

        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n\n/g, '</p><p>')
            .replace(/\n/g, '<br>')
            .replace(/^/, '<p>')
            .replace(/$/, '</p>')
            .replace(/<p><\/p>/g, '')
            .replace(/\s{2,}/g, ' '); // Normalize multiple spaces
    }

    /**
     * Load external images when user allows
     */
    loadExternalImages(html: string): string {
        const $ = cheerio.load(html);

        $('.blocked-external-image').each((index, element) => {
            const originalSrc = $(element).attr('data-original-src');
            if (originalSrc) {
                $(element).attr('src', originalSrc);
                $(element).removeClass('blocked-external-image');
                $(element).removeAttr('data-original-src');
                $(element).removeAttr('title');
            }
        });

        return $.html();
    }

    /**
     * Extract preview text from HTML content
     */
    extractPreview(htmlContent: string, maxLength: number = 150): string {
        if (!htmlContent) return '';

        const $ = cheerio.load(htmlContent);
        const text = $('body').text().trim() || $('*').text().trim();

        if (text.length <= maxLength) {
            return text;
        }

        return text.substring(0, maxLength).trim() + '...';
    }
}

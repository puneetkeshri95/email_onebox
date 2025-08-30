export interface EmailAccount {
    id: string;
    type: 'gmail' | 'outlook';
    username: string;
    password: string;
    imapConfig: {
        host: string;
        port: number;
        secure: boolean;
    };
    slackWebhookUrl?: string;
}

// New OAuth2-based email account interface
export interface OAuth2EmailAccount {
    id: string;
    email: string;
    provider: 'gmail' | 'outlook';
    access_token: string;
    refresh_token: string;
    client_id: string;
    client_secret: string;
    lastSyncedUID?: number;
    lastSyncTime?: Date;
    isActive?: boolean;
    connectionRetries?: number;
    slackWebhookUrl?: string;
    imapSettings?: {
        host: string;
        port: number;
        secure: boolean;
    };
}

// Connection pool configuration
export interface ConnectionPoolConfig {
    maxConnections: number;
    connectionTimeout: number;
    retryAttempts: number;
    retryDelay: number;
    keepAliveInterval: number;
}

export interface EmailAttachment {
    filename: string;
    contentType: string;
    size: number;
    contentId?: string; // For inline images
    data?: Buffer; // Optional - excluded from search indexing for large files
    isInline: boolean;
    downloadUrl?: string; // For larger attachments
}

export interface InlineImage {
    cid: string; // Content-ID
    contentType: string;
    data: Buffer;
    filename?: string;
}

export interface Email {
    id: string;
    messageId: string;
    accountId: string;
    folder: string;
    from: string;
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;

    // Enhanced body content
    body: string; // Primary display body (HTML preferred, fallback to text)
    htmlBody?: string; // Original HTML content
    textBody?: string; // Plain text content
    cleanHtml?: string; // Sanitized HTML for safe display

    // Content metadata
    isHtml: boolean;
    hasExternalImages: boolean;
    hasAttachments: boolean;

    // Date and metadata
    date: Date;
    size?: number;

    // Attachments and images
    attachments: EmailAttachment[];
    inlineImages: InlineImage[];

    // Email flags and properties
    flags: string[];
    isRead?: boolean;
    isImportant?: boolean;
    priority?: 'high' | 'normal' | 'low';

    // AI classification
    aiCategory?: 'interested' | 'meeting_booked' | 'not_interested' | 'spam' | 'out_of_office';
    aiConfidence?: number;

    // Document content for search
    attachmentText?: string; // Extracted text from PDF/DOC attachments for search

    // Processing metadata
    processedAt?: Date;
    contentProcessed?: boolean;
}

export interface AIClassificationResult {
    category: 'interested' | 'meeting_booked' | 'not_interested' | 'spam' | 'out_of_office';
    confidence: number;
    method?: string; // Optional field to track which AI method was used
}

export interface RAGContext {
    productDescription: string;
    meetingLink: string;
    customInstructions: string;
}

export interface SuggestedReply {
    content: string;
    confidence: number;
    context: string[];
}

export interface EmailContentProcessingResult {
    cleanHtml: string;
    plainText: string;
    hasExternalImages: boolean;
    inlineImages: InlineImage[];
    attachments: EmailAttachment[];
    contentSafe: boolean;
}

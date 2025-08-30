import { EmailAccount } from './oauth.service';
import { emailAccounts } from './account.store';
import { OAuthService } from './oauth.service';
import { google } from 'googleapis';
import { Client } from '@microsoft/microsoft-graph-client';
import nodemailer from 'nodemailer';

export interface EmailDraft {
    id?: string;
    from: string; // Account ID of sender
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    body: string;
    isHtml: boolean;
    attachments?: EmailAttachment[];
    priority?: 'low' | 'normal' | 'high';
    requestReadReceipt?: boolean;
}

export interface EmailAttachment {
    filename: string;
    content: Buffer | string;
    contentType: string;
    encoding?: string;
}

export interface SendEmailResponse {
    success: boolean;
    messageId?: string;
    error?: string;
    sentAt?: Date;
}

/**
 * Service for sending emails through connected accounts
 */
export class EmailSenderService {
    private oauthService: OAuthService;

    constructor() {
        this.oauthService = new OAuthService();
    }

    /**
     * Send an email using the specified account
     */
    async sendEmail(draft: EmailDraft, accountId: string): Promise<SendEmailResponse> {
        try {
            const account = emailAccounts.get(accountId);
            if (!account) {
                return {
                    success: false,
                    error: 'Account not found or not connected'
                };
            }

            if (!account.isActive) {
                return {
                    success: false,
                    error: 'Account is not active'
                };
            }

            //   based on provider
            if (account.provider === 'gmail') {
                return await this.sendGmailEmail(account, draft);
            } else if (account.provider === 'outlook') {
                return await this.sendOutlookEmail(account, draft);
            } else {
                return {
                    success: false,
                    error: `Unsupported email provider: ${account.provider}`
                };
            }

        } catch (error) {
            console.error('❌ Error sending email:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error occurred'
            };
        }
    }

    /**
     * Send email using Gmail API
     */
    private async sendGmailEmail(account: EmailAccount, draft: EmailDraft): Promise<SendEmailResponse> {
        try {
            // Get fresh access token
            const freshAccessToken = await this.oauthService.getFreshAccessToken(account.credentials);

            // Set up Gmail API client
            const oauth2Client = new google.auth.OAuth2(
                process.env.GOOGLE_CLIENT_ID,
                process.env.GOOGLE_CLIENT_SECRET
            );

            oauth2Client.setCredentials({
                access_token: freshAccessToken,
                refresh_token: account.credentials.refreshToken
            });

            const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

            // Create email message
            const message = this.createMimeMessage(account.email, draft);

            // Send email
            const response = await gmail.users.messages.send({
                userId: 'me',
                requestBody: {
                    raw: Buffer.from(message).toString('base64')
                        .replace(/\+/g, '-')
                        .replace(/\//g, '_')
                        .replace(/=+$/, '')
                }
            });

            console.log(`✅ Gmail email sent successfully from ${account.email}:`, response.data.id);

            return {
                success: true,
                messageId: response.data.id || '',
                sentAt: new Date()
            };

        } catch (error: any) {
            console.error('❌ Error sending Gmail email:', error);

            // Handle specific Gmail API errors
            if (error.code === 403) {
                return {
                    success: false,
                    error: 'Insufficient permissions. Please re-authenticate your Gmail account with send permissions.'
                };
            } else if (error.code === 401) {
                return {
                    success: false,
                    error: 'Authentication failed. Please re-authenticate your Gmail account.'
                };
            }

            return {
                success: false,
                error: error.message || 'Failed to send email through Gmail API'
            };
        }
    }

    /**
     * Create MIME message for Gmail API
     */
    private createMimeMessage(fromEmail: string, draft: EmailDraft): string {
        const lines = [];

        // Headers
        lines.push(`From: ${fromEmail}`);
        lines.push(`To: ${draft.to.join(', ')}`);
        if (draft.cc && draft.cc.length > 0) {
            lines.push(`Cc: ${draft.cc.join(', ')}`);
        }
        if (draft.bcc && draft.bcc.length > 0) {
            lines.push(`Bcc: ${draft.bcc.join(', ')}`);
        }
        lines.push(`Subject: ${draft.subject}`);
        lines.push('MIME-Version: 1.0');

        if (draft.attachments && draft.attachments.length > 0) {
            // Multipart message with attachments
            const boundary = `boundary_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
            lines.push('');

            // Body part
            lines.push(`--${boundary}`);
            lines.push(`Content-Type: ${draft.isHtml ? 'text/html' : 'text/plain'}; charset=UTF-8`);
            lines.push('Content-Transfer-Encoding: 7bit');
            lines.push('');
            lines.push(draft.body);
            lines.push('');

            // Attachment parts
            draft.attachments.forEach(attachment => {
                lines.push(`--${boundary}`);
                lines.push(`Content-Type: ${attachment.contentType}; name="${attachment.filename}"`);
                lines.push(`Content-Disposition: attachment; filename="${attachment.filename}"`);
                lines.push('Content-Transfer-Encoding: base64');
                lines.push('');

                // Convert attachment content to base64
                const content = Buffer.isBuffer(attachment.content)
                    ? attachment.content
                    : Buffer.from(attachment.content, (attachment.encoding as BufferEncoding) || 'utf8');
                lines.push(content.toString('base64'));
                lines.push('');
            });

            lines.push(`--${boundary}--`);
        } else {
            // Simple message without attachments
            lines.push(`Content-Type: ${draft.isHtml ? 'text/html' : 'text/plain'}; charset=UTF-8`);
            lines.push('Content-Transfer-Encoding: 7bit');
            lines.push('');
            lines.push(draft.body);
        }

        return lines.join('\r\n');
    }

    /**
     * Send email using Microsoft Graph API
     */
    private async sendOutlookEmail(account: EmailAccount, draft: EmailDraft): Promise<SendEmailResponse> {
        try {
            // Get fresh access token
            const freshAccessToken = await this.oauthService.getFreshAccessToken(account.credentials);

            // Create Graph client
            const graphClient = Client.init({
                authProvider: (done) => {
                    done(null, freshAccessToken);
                }
            });

            // Prepare recipients
            const toRecipients = draft.to.map(email => ({
                emailAddress: {
                    address: email.trim(),
                    name: email.trim()
                }
            }));

            const ccRecipients = draft.cc?.map(email => ({
                emailAddress: {
                    address: email.trim(),
                    name: email.trim()
                }
            })) || [];

            const bccRecipients = draft.bcc?.map(email => ({
                emailAddress: {
                    address: email.trim(),
                    name: email.trim()
                }
            })) || [];

            // Prepare message
            const message: any = {
                subject: draft.subject,
                body: {
                    contentType: draft.isHtml ? 'HTML' : 'Text',
                    content: draft.body
                },
                toRecipients: toRecipients,
                ccRecipients: ccRecipients.length > 0 ? ccRecipients : undefined,
                bccRecipients: bccRecipients.length > 0 ? bccRecipients : undefined,
                importance: this.convertPriorityToImportance(draft.priority),
                isReadReceiptRequested: draft.requestReadReceipt || false
            };

            // Add attachments if any
            if (draft.attachments && draft.attachments.length > 0) {
                message.attachments = draft.attachments.map(attachment => {
                    const content = Buffer.isBuffer(attachment.content)
                        ? attachment.content
                        : Buffer.from(attachment.content, (attachment.encoding as BufferEncoding) || 'utf8');

                    return {
                        '@odata.type': '#microsoft.graph.fileAttachment',
                        name: attachment.filename,
                        contentType: attachment.contentType,
                        contentBytes: content.toString('base64')
                    };
                });
            }

            // Send email
            const response = await graphClient
                .api('/me/sendMail')
                .post({
                    message: message,
                    saveToSentItems: true
                });

            console.log(`✅ Outlook email sent successfully from ${account.email}`);

            return {
                success: true,
                messageId: `outlook-${Date.now()}`, // Graph API doesn't return messageId in send response
                sentAt: new Date()
            };

        } catch (error: any) {
            console.error('❌ Error sending Outlook email:', error);

            // Handle specific Graph API errors
            if (error.code === 'Forbidden' || error.status === 403) {
                return {
                    success: false,
                    error: 'Insufficient permissions. Please re-authenticate your Outlook account with send permissions.'
                };
            } else if (error.code === 'Unauthorized' || error.status === 401) {
                return {
                    success: false,
                    error: 'Authentication failed. Please re-authenticate your Outlook account.'
                };
            } else if (error.code === 'InvalidAuthenticationToken') {
                return {
                    success: false,
                    error: 'Invalid authentication token. Please re-authenticate your Outlook account.'
                };
            }

            return {
                success: false,
                error: error.message || 'Failed to send email through Microsoft Graph API'
            };
        }
    }

    /**
     * Convert priority to Microsoft Graph importance
     */
    private convertPriorityToImportance(priority?: string): string {
        switch (priority) {
            case 'high':
                return 'high';
            case 'low':
                return 'low';
            default:
                return 'normal';
        }
    }

    /**
     * Create nodemailer transporter for the account (fallback method)
     * Note: Now using direct APIs (Gmail API, Microsoft Graph) for better reliability
     */
    private async createTransporter(account: EmailAccount) {
        // Get fresh access token
        const freshAccessToken = await this.oauthService.getFreshAccessToken(account.credentials);

        if (account.provider === 'gmail') {
            // Note: Gmail now uses Gmail API directly in sendGmailEmail method
            return nodemailer.createTransport({
                service: 'gmail',
                auth: {
                    type: 'OAuth2',
                    user: account.email,
                    clientId: process.env.GOOGLE_CLIENT_ID,
                    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
                    refreshToken: account.credentials.refreshToken,
                    accessToken: freshAccessToken
                }
            });
        } else if (account.provider === 'outlook') {
            // Note: Outlook now uses Microsoft Graph API directly in sendOutlookEmail method
            return nodemailer.createTransport({
                service: 'hotmail',
                auth: {
                    type: 'OAuth2',
                    user: account.email,
                    clientId: process.env.MICROSOFT_CLIENT_ID,
                    clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
                    refreshToken: account.credentials.refreshToken,
                    accessToken: freshAccessToken
                }
            });
        } else {
            throw new Error(`Unsupported email provider: ${account.provider}`);
        }
    }

    /**
     * Get available sender accounts for the authenticated user
     */
    async getAvailableSenders(userAccountIds: string[]): Promise<EmailAccount[]> {
        return userAccountIds
            .map(id => emailAccounts.get(id))
            .filter((account): account is EmailAccount =>
                account !== undefined && account.isActive
            );
    }

    /**
     * Validate email addresses
     */
    validateEmail(email: string): boolean {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    /**
     * Validate email draft before sending
     */
    validateDraft(draft: EmailDraft): { isValid: boolean; errors: string[] } {
        const errors: string[] = [];

        if (!draft.to || draft.to.length === 0) {
            errors.push('At least one recipient is required');
        }

        // Validate all email addresses
        [...(draft.to || []), ...(draft.cc || []), ...(draft.bcc || [])]
            .forEach(email => {
                if (!this.validateEmail(email.trim())) {
                    errors.push(`Invalid email address: ${email}`);
                }
            });

        if (!draft.subject || draft.subject.trim().length === 0) {
            errors.push('Subject is required');
        }

        if (!draft.body || draft.body.trim().length === 0) {
            errors.push('Email body is required');
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    /**
     * Parse email addresses from a string (handles comma and semicolon separation)
     */
    parseEmailAddresses(addressString: string | string[]): string[] {
        // If already an array, return it (after trimming)
        if (Array.isArray(addressString)) {
            return addressString.map(email => email.trim()).filter(email => email.length > 0);
        }

        // Ensure we have a string
        if (typeof addressString !== 'string') {
            // Handle invalid input
            console.warn(`Invalid input to parseEmailAddresses: ${typeof addressString}`);
            return [];
        }

        return addressString
            .split(/[,;]/)
            .map(email => email.trim())
            .filter(email => email.length > 0);
    }

    /**
     * Create email draft with smart defaults
     */
    createDraft(fromAccountId: string, overrides: Partial<EmailDraft> = {}): EmailDraft {
        return {
            from: fromAccountId,
            to: [],
            cc: [],
            bcc: [],
            subject: '',
            body: '',
            isHtml: false,
            priority: 'normal',
            requestReadReceipt: false,
            ...overrides
        };
    }
}

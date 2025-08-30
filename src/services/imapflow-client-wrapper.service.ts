import { EventEmitter } from 'events';
import { simpleParser, ParsedMail } from 'mailparser';
import { Email } from '../models/types';
import { OAuthService, EmailAccount } from './oauth.service';
import { ElasticsearchService } from './elasticsearch.service';
import { AIService } from './ai.service';
import { SlackService } from './slack.service';
import { WebhookService } from './webhook.service';
import { EmailContentProcessorService } from './email-content-processor.service';
import { config } from '../config/config';

// ImapFlow interface (to be replaced when package is available)
interface ImapFlowClient {
    authenticated: boolean;
    isMailboxOpen: boolean;
    connect(): Promise<void>;
    close(): Promise<void>;
    logout(): Promise<void>;
    mailboxOpen(path: string, options?: any): Promise<any>;
    mailboxClose(): Promise<void>;
    search(query: any, options?: any): Promise<number[]>;
    fetch(range: string | number[], options?: any): AsyncIterable<any>;
    setFlags(range: string | number[], flags: string[]): Promise<void>;
    idle(): AsyncIterable<any>;
    getQuota(): Promise<any>;
    on(event: string, listener: (...args: any[]) => void): this;
    off(event: string, listener: (...args: any[]) => void): this;
    emit(event: string, ...args: any[]): boolean;
}

export class ImapFlowService extends EventEmitter {
    private clients: Map<string, ImapFlowClient> = new Map();
    private oauthService: OAuthService;
    private elasticsearchService: ElasticsearchService;
    private aiService: AIService;
    private slackService: SlackService;
    private webhookService: WebhookService;
    private emailProcessor: EmailContentProcessorService;
    private connectedAccounts: Map<string, EmailAccount> = new Map();
    private lastProcessedUIDs: Map<string, number> = new Map();

    constructor() {
        super();
        this.oauthService = new OAuthService();
        this.elasticsearchService = new ElasticsearchService();
        this.aiService = new AIService();
        this.slackService = new SlackService();
        this.webhookService = new WebhookService();
        this.emailProcessor = new EmailContentProcessorService();

        console.log('🚀 ImapFlow Service initialized with OAuth integration');
    }

    /**
     * Add an OAuth email account and start IMAP connection
     */
    async connectAccount(account: EmailAccount): Promise<void> {
        try {
            console.log(`🔗 Connecting ImapFlow for ${account.provider} account: ${account.email}`);

            // Store account
            this.connectedAccounts.set(account.id, account);

            // Get fresh access token
            const accessToken = await this.oauthService.getFreshAccessToken(account.credentials);
            account.credentials.accessToken = accessToken;

            // Create ImapFlow client
            const client = await this.createImapFlowClient(account);

            // Connect to IMAP server
            await client.connect();

            console.log(`✅ ImapFlow connected to ${account.provider}: ${account.email}`);

            // Store client
            this.clients.set(account.id, client);

            // Set up event handlers
            this.setupClientEventHandlers(account.id, client);

            // Open INBOX and start initial sync
            await this.openInboxAndSync(account, client);

            // Start IDLE mode for real-time updates
            await this.startIdleMode(account, client);

            this.emit('accountConnected', account);

        } catch (error: any) {
            console.error(`❌ Failed to connect ImapFlow for ${account.email}:`, error.message);

            // Handle authentication errors
            if (this.isAuthError(error)) {
                console.error(`🔐 Authentication failed for ${account.email}, account may need re-authorization`);
                this.emit('authFailed', account, error);
            } else {
                this.emit('connectionError', account, error);
            }

            throw error;
        }
    }

    /**
     * Create ImapFlow client with OAuth2 settings
     */
    private async createImapFlowClient(account: EmailAccount): Promise<ImapFlowClient> {
        // Get IMAP settings for provider
        const imapSettings = this.getImapSettings(account.provider);

        // This is a placeholder implementation
        // In actual implementation with imapflow package, this would be:
        // const { ImapFlow } = require('imapflow');
        // return new ImapFlow({
        //     host: imapSettings.host,
        //     port: imapSettings.port,
        //     secure: imapSettings.secure,
        //     auth: {
        //         user: account.email,
        //         accessToken: account.credentials.accessToken
        //     },
        //     logger: console, // Enable for debugging
        //     keepalive: {
        //         interval: 25 * 60 * 1000, // 25 minutes (Gmail timeout is ~29 minutes)
        //         forceNoop: true
        //     }
        // });

        // For now, return a mock client that simulates ImapFlow behavior
        return {
            authenticated: false,
            isMailboxOpen: false,
            connect: async () => {
                console.log(`📡 Mock ImapFlow connecting to ${imapSettings.host} for ${account.email}`);
                (this as any).authenticated = true;
            },
            close: async () => {
                (this as any).authenticated = false;
                (this as any).isMailboxOpen = false;
            },
            logout: async () => {
                (this as any).authenticated = false;
                (this as any).isMailboxOpen = false;
            },
            mailboxOpen: async (path: string) => {
                console.log(`📬 Opening mailbox ${path} for ${account.email}`);
                (this as any).isMailboxOpen = true;
                return { exists: 150, recent: 5, unseen: 12 };
            },
            mailboxClose: async () => {
                (this as any).isMailboxOpen = false;
            },
            search: async (query: any) => {
                console.log(`🔍 Searching emails for ${account.email}:`, query);
                // Mock return UIDs for recent emails
                return [101, 102, 103, 104, 105, 106, 107, 108, 109, 110];
            },
            fetch: async function* (range: string | number[]) {
                console.log(`📥 Fetching emails ${range} for ${account.email}`);
                // Mock email data
                const mockEmails = [
                    {
                        uid: 110,
                        flags: new Set(['\\Seen']),
                        envelope: {
                            date: new Date(),
                            subject: `Mock Email from ImapFlow - ${account.provider}`,
                            from: [{ address: 'sender@example.com', name: 'Mock Sender' }],
                            to: [{ address: account.email, name: account.email }]
                        },
                        source: Buffer.from(`
Subject: Mock Email from ImapFlow - ${account.provider}
From: sender@example.com
To: ${account.email}
Date: ${new Date().toISOString()}
Content-Type: text/html

<html>
<body>
<h2>Mock Email Content</h2>
<p>This is a mock email fetched via ImapFlow for account: ${account.email}</p>
<p>Provider: ${account.provider}</p>
<p>Generated at: ${new Date().toISOString()}</p>
</body>
</html>
                        `.trim())
                    }
                ];

                for (const email of mockEmails) {
                    yield email;
                }
            },
            setFlags: async (range: string | number[], flags: string[]) => {
                console.log(`🏷️ Setting flags ${flags} on messages ${range} for ${account.email}`);
            },
            idle: async function* () {
                console.log(`💤 Starting IDLE mode for ${account.email}`);
                // Mock IDLE updates
                let count = 150;
                while (true) {
                    await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30 seconds
                    count++;
                    yield { type: 'exists', previous: count - 1, current: count };
                }
            },
            getQuota: async () => ({
                storageUsed: Math.floor(Math.random() * 5000),
                storageLimit: 15000
            }),
            on: function (event: string, listener: (...args: any[]) => void) { return this; },
            off: function (event: string, listener: (...args: any[]) => void) { return this; },
            emit: function (event: string, ...args: any[]) { return true; }
        } as ImapFlowClient;
    }

    /**
     * Get IMAP settings for provider
     */
    private getImapSettings(provider: 'gmail' | 'outlook') {
        switch (provider) {
            case 'gmail':
                return {
                    host: 'imap.gmail.com',
                    port: 993,
                    secure: true
                };
            case 'outlook':
                return {
                    host: 'outlook.office365.com',
                    port: 993,
                    secure: true
                };
            default:
                throw new Error(`Unknown provider: ${provider}`);
        }
    }

    /**
     * Set up event handlers for IMAP client
     */
    private setupClientEventHandlers(accountId: string, client: ImapFlowClient): void {
        client.on('error', async (error: Error) => {
            console.error(`❌ IMAP client error for ${accountId}:`, error.message);

            const account = this.connectedAccounts.get(accountId);
            if (account && this.isAuthError(error)) {
                console.error(`🔐 Authentication error, account may need re-authorization: ${account.email}`);
                this.emit('authFailed', account, error);
            } else {
                this.emit('connectionError', account, error);
            }
        });

        client.on('close', () => {
            const account = this.connectedAccounts.get(accountId);
            console.log(`🔌 IMAP connection closed for ${account?.email || accountId}`);
            this.clients.delete(accountId);
            this.emit('connectionClosed', account);
        });
    }

    /**
     * Open INBOX and perform initial sync
     */
    private async openInboxAndSync(account: EmailAccount, client: ImapFlowClient): Promise<void> {
        // Open INBOX
        const mailboxInfo = await client.mailboxOpen('INBOX');
        console.log(`📬 Opened INBOX for ${account.email}, ${mailboxInfo.exists} messages`);

        // Perform initial sync for recent emails (using config-based days)
        await this.performInitialSync(account, client);
    }

    /**
     * Perform initial email sync
     */
    private async performInitialSync(account: EmailAccount, client: ImapFlowClient): Promise<void> {
        try {
            console.log(`🔄 Starting initial ImapFlow sync for ${account.email}`);

            // Get last processed UID for this account
            const lastUID = this.lastProcessedUIDs.get(account.id) || 0;

            // Search for recent emails (using config-based days)
            const syncDays = Math.min(config.emailSync?.syncDays || 30, 30);
            const since = new Date();
            since.setDate(since.getDate() - syncDays);

            const messageUIDs = await client.search({
                since: since
            });

            if (messageUIDs.length === 0) {
                console.log(`📭 No recent emails found for ${account.email}`);
                return;
            }

            // Filter out already processed emails
            const newUIDs = messageUIDs.filter(uid => uid > lastUID);

            if (newUIDs.length === 0) {
                console.log(`✅ All emails already processed for ${account.email}`);
                return;
            }

            console.log(`📧 Processing ${newUIDs.length} new emails for ${account.email}`);

            // Process emails in batches
            await this.processEmailBatch(account, client, newUIDs);

            // Update last processed UID
            this.lastProcessedUIDs.set(account.id, Math.max(...newUIDs));

            console.log(`✅ Initial ImapFlow sync completed for ${account.email}`);

        } catch (error) {
            console.error(`❌ Initial sync failed for ${account.email}:`, error);
            throw error;
        }
    }

    /**
     * Process a batch of emails
     */
    private async processEmailBatch(account: EmailAccount, client: ImapFlowClient, uids: number[]): Promise<void> {
        const emails: Email[] = [];

        try {
            for await (const message of client.fetch(uids, {
                envelope: true,
                source: true,
                flags: true,
                uid: true
            })) {
                try {
                    const email = await this.processMessage(message, account);
                    if (email) {
                        emails.push(email);
                    }
                } catch (error) {
                    console.error(`Error processing message UID ${message.uid}:`, error);
                }
            }

            // Index emails in Elasticsearch
            if (emails.length > 0) {
                await this.elasticsearchService.indexEmails(emails);
                console.log(`📥 Indexed ${emails.length} emails for ${account.email}`);
            }

        } catch (error) {
            console.error(`Error processing email batch for ${account.email}:`, error);
            throw error;
        }
    }

    /**
     * Process a single email message
     */
    private async processMessage(message: any, account: EmailAccount): Promise<Email | null> {
        try {
            // Parse email content
            const parsed: ParsedMail = await simpleParser(message.source);

            // Process email content
            const contentResult = await this.emailProcessor.processEmailContent(
                parsed.html || null,
                parsed.text || null,
                parsed.attachments || []
            );

            // Helper functions for address extraction
            const extractEmails = (addressObj: any): string[] => {
                if (!addressObj) return [];
                if (Array.isArray(addressObj)) {
                    return addressObj.map(addr => addr.address || addr.text || '').filter(Boolean);
                }
                return [addressObj.address || addressObj.text || ''].filter(Boolean);
            };

            const extractSingleEmail = (addressObj: any): string => {
                if (!addressObj) return '';
                if (Array.isArray(addressObj)) {
                    return addressObj[0]?.address || addressObj[0]?.text || '';
                }
                return addressObj.address || addressObj.text || '';
            };

            const email: Email = {
                id: `${account.id}-${message.uid}`,
                messageId: parsed.messageId || `${account.id}-${message.uid}-${Date.now()}`,
                accountId: account.id,
                folder: 'INBOX',
                from: extractSingleEmail(parsed.from),
                to: extractEmails(parsed.to),
                cc: extractEmails(parsed.cc),
                bcc: extractEmails(parsed.bcc),
                subject: parsed.subject || '(No Subject)',
                body: contentResult.plainText || contentResult.cleanHtml || 'No content available',
                htmlBody: parsed.html || undefined,
                textBody: contentResult.plainText || parsed.text || undefined,
                cleanHtml: contentResult.cleanHtml,
                isHtml: !!parsed.html,
                hasExternalImages: contentResult.hasExternalImages,
                hasAttachments: contentResult.attachments.length > 0,
                date: parsed.date || new Date(),
                size: message.source.length,
                attachments: contentResult.attachments,
                inlineImages: contentResult.inlineImages,
                flags: Array.from(message.flags || []),
                isRead: message.flags?.has('\\Seen') || false,
                isImportant: message.flags?.has('\\Flagged') || false,
                priority: 'normal',
                processedAt: new Date(),
                contentProcessed: true
            };

            // AI Classification
            try {
                const classification = await this.aiService.classifyEmail(email);
                email.aiCategory = classification.category;
                email.aiConfidence = classification.confidence;

                // Send notifications for interested emails
                if (classification.category === 'interested') {
                    // Send Slack notification if webhook URL is configured
                    if (account.credentials && 'slackWebhookUrl' in account.credentials) {
                        const slackUrl = (account.credentials as any).slackWebhookUrl;
                        if (slackUrl) {
                            await this.slackService.sendNotification(slackUrl, email);
                        }
                    }

                    // Send webhook notification
                    await this.webhookService.triggerWebhook(email);
                }
            } catch (error) {
                console.error('AI classification error:', error);
            }

            return email;

        } catch (error) {
            console.error('Error processing email message:', error);
            return null;
        }
    }

    /**
     * Start IDLE mode for real-time email updates
     */
    private async startIdleMode(account: EmailAccount, client: ImapFlowClient): Promise<void> {
        try {
            console.log(`🔄 Starting IDLE mode for ${account.email}`);

            for await (const update of client.idle()) {
                console.log(`📨 IDLE update for ${account.email}:`, update);

                if (update.type === 'exists') {
                    // New messages arrived
                    await this.handleNewMessages(account, client, update.previous, update.current);
                }
            }

        } catch (error: any) {
            console.error(`❌ IDLE mode error for ${account.email}:`, error.message);
            this.emit('idleError', account, error);
        }
    }

    /**
     * Handle new messages detected in IDLE mode
     */
    private async handleNewMessages(account: EmailAccount, client: ImapFlowClient, previousCount: number, currentCount: number): Promise<void> {
        const newMessageCount = currentCount - previousCount;
        if (newMessageCount <= 0) return;

        console.log(`📧 ${newMessageCount} new message(s) for ${account.email}`);

        try {
            // Fetch UIDs of new messages
            const range = `${previousCount + 1}:${currentCount}`;
            const newUIDs: number[] = [];

            for await (const message of client.fetch(range, { uid: true })) {
                newUIDs.push(message.uid);
            }

            // Process new messages
            await this.processEmailBatch(account, client, newUIDs);

            // Update last processed UID
            if (newUIDs.length > 0) {
                this.lastProcessedUIDs.set(account.id, Math.max(...newUIDs));
            }

            this.emit('newEmails', account, newUIDs.length);

        } catch (error) {
            console.error(`❌ Error processing new messages for ${account.email}:`, error);
        }
    }

    /**
     * Check if error is authentication related
     */
    private isAuthError(error: Error): boolean {
        const authErrorMessages = [
            'AUTHENTICATIONFAILED',
            'NO AUTHENTICATE',
            'Invalid credentials',
            'Authentication failed',
            'Access denied',
            'Unauthorized',
            'invalid_grant'
        ];

        return authErrorMessages.some(msg =>
            error.message.toUpperCase().includes(msg.toUpperCase())
        );
    }

    /**
     * Disconnect account
     */
    async disconnectAccount(accountId: string): Promise<void> {
        const client = this.clients.get(accountId);
        const account = this.connectedAccounts.get(accountId);

        if (client) {
            try {
                await client.logout();
                await client.close();
            } catch (error) {
                console.error(`Error disconnecting ${account?.email || accountId}:`, error);
            }
        }

        this.clients.delete(accountId);
        this.connectedAccounts.delete(accountId);
        this.lastProcessedUIDs.delete(accountId);

        console.log(`🔌 Disconnected ImapFlow for ${account?.email || accountId}`);
        this.emit('accountDisconnected', account);
    }

    /**
     * Get connected accounts
     */
    getConnectedAccounts(): EmailAccount[] {
        return Array.from(this.connectedAccounts.values());
    }

    /**
     * Get connection status
     */
    getConnectionStatus(): { [accountId: string]: boolean } {
        const status: { [accountId: string]: boolean } = {};

        for (const [accountId, client] of this.clients) {
            status[accountId] = client.authenticated;
        }

        return status;
    }

    /**
     * Mark email as read
     */
    async markAsRead(accountId: string, uid: number): Promise<boolean> {
        const client = this.clients.get(accountId);

        if (!client || !client.authenticated) {
            return false;
        }

        try {
            await client.setFlags([uid], ['\\Seen']);
            return true;
        } catch (error) {
            console.error(`Error marking email as read:`, error);
            return false;
        }
    }

    /**
     * Disconnect all accounts
     */
    async disconnectAll(): Promise<void> {
        const accountIds = Array.from(this.clients.keys());

        for (const accountId of accountIds) {
            await this.disconnectAccount(accountId);
        }

        console.log('🔌 Disconnected all ImapFlow accounts');
    }
}

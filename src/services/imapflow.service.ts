import { EventEmitter } from 'events';
import { simpleParser, ParsedMail } from 'mailparser';
import { Email } from '../models/types';
import { EmailAccount, OAuthService } from './oauth.service';
import { ElasticsearchService } from './elasticsearch.service';
import { AIService } from './ai.service';
import { SlackService } from './slack.service';
import { WebhookService } from './webhook.service';
import { EmailContentProcessorService } from './email-content-processor.service';
import { ImapFlow, FetchMessageObject } from 'imapflow';
import { config } from '../config/config';
import { emailAccounts, setAccount } from './account.store';

/**
 * ImapFlow Service for real-time email synchronization
 * Integrates with existing OAuth2 accounts for seamless IMAP access
 */
export class ImapFlowService extends EventEmitter {
    private clients: Map<string, ImapFlow> = new Map();
    private connectedAccounts: Map<string, EmailAccount> = new Map();
    private lastProcessedUIDs: Map<string, number> = new Map();
    private elasticsearchService: ElasticsearchService;
    private aiService: AIService;
    private slackService: SlackService;
    private webhookService: WebhookService;
    private emailProcessor: EmailContentProcessorService;
    private oauthService: OAuthService;
    private reconnectTimeouts: Map<string, NodeJS.Timeout> = new Map();
    private reconnectAttempts: Map<string, number> = new Map();
    private maxReconnectAttempts: number = 5;
    private baseReconnectDelay: number = 30000; // 30 seconds

    constructor() {
        super();
        this.elasticsearchService = new ElasticsearchService();
        this.aiService = new AIService();
        this.slackService = new SlackService();
        this.webhookService = new WebhookService();
        this.emailProcessor = new EmailContentProcessorService();
        this.oauthService = new OAuthService();

        console.log('🚀 ImapFlow Service initialized');
    }

    /**
     * Connect an OAuth email account to ImapFlow
     */
    async connectAccount(account: EmailAccount): Promise<boolean> {
        try {
            // Check if already connected
            const existingClient = this.clients.get(account.id);
            if (existingClient) {
                console.log(`ℹ️ ImapFlow already connected for ${account.email}, checking connection status`);

                try {
                    // Test if the existing connection is still alive
                    await existingClient.getMailboxLock('INBOX');
                    console.log(`✅ Existing ImapFlow connection is healthy for ${account.email}`);
                    return true;
                } catch (error) {
                    console.log(`🔄 Existing connection is stale for ${account.email}, creating new connection`);
                    // Clean up the stale connection
                    await this.disconnectAccount(account.id);
                }
            }

            console.log(`🔗 Connecting ImapFlow for ${account.provider} account: ${account.email}`);

            // Store account
            this.connectedAccounts.set(account.id, account);

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

            // Reset reconnection attempts on successful connection
            this.reconnectAttempts.delete(account.id);

            this.emit('accountConnected', account);
            return true;

        } catch (error: any) {
            console.error(`❌ Failed to connect ImapFlow for ${account.email}:`, error.message);
            this.emit('connectionError', account, error);

            // Handle specific error types
            if (this.isAuthError(error)) {
                console.log(`🔑 Authentication error detected for ${account.email}`);
                await this.handleAuthError(account);
            } else {
                // Schedule reconnection attempt for other errors
                this.scheduleReconnection(account);
            }
            return false;
        }
    }

    /**
     * Disconnect an account from ImapFlow
     */
    async disconnectAccount(accountId: string): Promise<void> {
        const client = this.clients.get(accountId);
        const account = this.connectedAccounts.get(accountId);

        // Clear reconnection timeout and attempts
        const timeout = this.reconnectTimeouts.get(accountId);
        if (timeout) {
            clearTimeout(timeout);
            this.reconnectTimeouts.delete(accountId);
        }
        this.reconnectAttempts.delete(accountId);

        if (client) {
            try {
                await client.logout();
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
     * Get connection status for all accounts
     */
    getConnectionStatus(): { [accountId: string]: boolean } {
        const status: { [accountId: string]: boolean } = {};

        for (const [accountId, client] of this.clients) {
            status[accountId] = !!client?.authenticated;
        }

        return status;
    }

    /**
     * Get detailed connection status
     */
    getDetailedConnectionStatus(): Array<{
        id: string;
        email: string;
        provider: string;
        connected: boolean;
        isActive: boolean;
    }> {
        const status: Array<any> = [];

        for (const [accountId, account] of this.connectedAccounts) {
            const client = this.clients.get(accountId);
            status.push({
                id: accountId,
                email: account.email,
                provider: account.provider,
                connected: client?.authenticated || false,
                isActive: client?.authenticated || false
            });
        }

        return status;
    }


    async markAsRead(accountId: string, uid: number): Promise<boolean> {
        const client = this.clients.get(accountId);

        if (!client || !client.authenticated) {
            return false;
        }

        try {
            await client.messageFlagsAdd({ uid }, ['\\Seen']);
            return true;
        } catch (error) {
            console.error(`Error marking email as read:`, error);
            return false;
        }
    }

    /**
     * Manually trigger incremental sync for a specific account
     */
    async manualSync(accountId: string): Promise<number> {
        const client = this.clients.get(accountId);
        const account = this.connectedAccounts.get(accountId);

        if (!client || !account) {
            throw new Error(`Account ${accountId} not connected to ImapFlow`);
        }

        if (!client.authenticated) {
            throw new Error(`ImapFlow client not authenticated for ${account.email}`);
        }

        try {
            console.log(`🔄 Manual incremental sync triggered for ${account.email}`);

            // Get the last processed UID for this account
            const lastUID = this.lastProcessedUIDs.get(accountId) || 0;

            // This will trigger the background sync mechanism which only fetches new emails
            await this.performBackgroundSync(account, client, lastUID);

            console.log(`✅ Manual incremental sync completed for ${account.email}`);
            return 0; // Return count not implemented, just return 0
        } catch (error) {
            console.error(`❌ Manual sync failed for ${account.email}:`, error);
            throw error;
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

    /**
     * Create ImapFlow client with OAuth2 settings
     */
    private async createImapFlowClient(account: EmailAccount): Promise<ImapFlow> {
        const imapSettings = this.getImapSettings(account.provider);

        // Check if token needs refresh before creating client
        await this.ensureValidToken(account);

        // Create ImapFlow client with OAuth2 settings
        return new ImapFlow({
            host: imapSettings.host,
            port: imapSettings.port,
            secure: imapSettings.secure,
            auth: {
                user: account.email,
                accessToken: account.credentials.accessToken
            },
            logger: false, // Disable verbose logging
            clientInfo: {
                name: 'Email Sync Service',
                version: '1.0.0'
            },
            // Add connection timeouts to prevent hanging
            connectionTimeout: 60000, // 60 seconds
            greetingTimeout: 30000    // 30 seconds
            // Note: 'keepalive' is not a valid ImapFlow option and has been removed
        });
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
    private setupClientEventHandlers(accountId: string, client: ImapFlow): void {
        client.on('error', async (error: Error) => {
            console.error(`❌ IMAP client error for ${accountId}:`, error.message);
            const account = this.connectedAccounts.get(accountId);

            // Handle specific error types differently
            if (this.isAuthError(error)) {
                console.log(`🔑 Authentication error detected for ${account?.email}, attempting token refresh`);
                await this.handleAuthError(account);
            } else if (this.isConnectionError(error)) {
                console.log(`🔌 Connection error detected for ${account?.email}`);

                // Socket timeouts during IDLE are often due to expired tokens
                if (account && this.isSocketTimeout(error)) {
                    console.log(`⏰ Socket timeout detected, attempting token refresh first`);
                    await this.handleAuthError(account);
                } else if (account) {
                    console.log(`🔄 Scheduling reconnection for connection error`);
                    this.scheduleReconnection(account);
                }
            }

            this.emit('connectionError', account, error);
        });

        client.on('close', () => {
            const account = this.connectedAccounts.get(accountId);
            console.log(`🔌 IMAP connection closed for ${account?.email || accountId}`);
            this.clients.delete(accountId);
            this.emit('connectionClosed', account);

            // Schedule reconnection if not manually disconnected
            if (account && this.connectedAccounts.has(accountId)) {
                this.scheduleReconnection(account);
            }
        });

        client.on('exists', async (data) => {
            console.log(`📨 New email exists event for ${accountId}:`, data);
            const account = this.connectedAccounts.get(accountId);
            if (account) {
                await this.handleExistsEvent(account, client, data);
            }
        });
    }

    /**
     * Open INBOX and perform initial sync
     */
    private async openInboxAndSync(account: EmailAccount, client: ImapFlow): Promise<void> {
        const mailbox = await client.mailboxOpen('INBOX');
        console.log(`📬 Opened INBOX for ${account.email}, ${mailbox.exists} messages`);

        await this.performInitialSync(account, client);
    }

    /**
     * Perform initial email sync with progressive loading strategy and 30-day limit
     */
    private async performInitialSync(account: EmailAccount, client: ImapFlow): Promise<void> {
        try {
            console.log(`🔄 Starting initial ImapFlow sync for ${account.email}`);

            const lastUID = this.lastProcessedUIDs.get(account.id) || 0;

            // Use config-based sync days with 30-day maximum
            const syncDays = Math.min(config.emailSync?.syncDays || 30, 30);
            const since = new Date();
            since.setDate(since.getDate() - syncDays);

            console.log(`📅 Syncing emails from last ${syncDays} days (since ${since.toISOString()}) for ${account.email}`);

            // Get mailbox status to find total messages and highest UID
            const mailboxStatus = await client.status('INBOX', { messages: true, uidNext: true });

            if (mailboxStatus.messages === 0) {
                console.log(`📭 No emails found in INBOX for ${account.email}`);
                return;
            }

            // Check if we have already synced recent emails to avoid duplicates
            const existingEmailsCount = await this.getExistingEmailsCount(account.id, since);
            console.log(`📊 Found ${existingEmailsCount} existing emails for ${account.email} in the last ${syncDays} days`);

            // First, get most recent emails for immediate display (configurable limit)
            const initialLimit = config.emailSync?.initialSyncLimit || 50;
            console.log(`📧 First syncing ${initialLimit} most recent emails for ${account.email}`);

            // Calculate UIDs for the most recent messages
            const totalMessages = mailboxStatus.messages || 0;
            const startIndex = Math.max(1, totalMessages - initialLimit);

            // Fetch the most recent messages first
            const recentMessages: number[] = [];
            for await (const message of client.fetch(`${startIndex}:*`, {
                envelope: true,
                source: true,
                flags: true,
                uid: true
            })) {
                // Quick date check to avoid processing very old emails
                if (message.envelope?.date && new Date(message.envelope.date) < since) {
                    console.log(`⏭️ Skipping old email from ${message.envelope.date} (UID: ${message.uid})`);
                    continue;
                }
                recentMessages.push(message.uid);
            }

            // Process these messages first for immediate display
            if (recentMessages.length > 0) {
                console.log(`📧 Processing ${recentMessages.length} recent emails first for ${account.email}`);
                const processedCount = await this.processEmailBatchWithDuplicateCheck(account, client, recentMessages, since);

                // Set last processed UID
                this.lastProcessedUIDs.set(account.id, Math.max(...recentMessages));

                // Emit event for UI update
                this.emit('initialEmailsLoaded', account, processedCount);
                console.log(`✅ Initial sync processed ${processedCount} new emails for ${account.email}`);
            } else {
                console.log(`📭 No recent emails found within date range for ${account.email}`);
            }

            // Then queue up additional emails in the background with strict limits
            setTimeout(async () => {
                try {
                    await this.performBackgroundSyncWithLimits(account, client, since, recentMessages);
                } catch (backgroundError) {
                    console.error(`⚠️ Background sync error for ${account.email}:`, backgroundError);
                    // Don't throw from background processing
                }
            }, 2000); // Wait 2 seconds before starting background processing

            console.log(`✅ Initial quick sync completed for ${account.email}, limited background sync in progress`);

        } catch (error) {
            console.error(`❌ Initial sync failed for ${account.email}:`, error);
            throw error;
        }
    }

    /**
     * Get count of existing emails for an account within a date range
     */
    private async getExistingEmailsCount(accountId: string, since: Date): Promise<number> {
        try {
            const searchResult = await this.elasticsearchService.searchEmails(
                '',
                {
                    accountId: accountId,
                    dateFrom: since
                },
                1 // Only need count, not actual emails
            );

            return searchResult?.length || 0;
        } catch (error) {
            console.error(`Error checking existing emails count for ${accountId}:`, error);
            return 0;
        }
    }

    /**
     * Process email batch with duplicate checking and date filtering
     */
    private async processEmailBatchWithDuplicateCheck(
        account: EmailAccount,
        client: ImapFlow,
        uids: number[],
        sinceDate: Date
    ): Promise<number> {
        const emails: Email[] = [];
        let processedCount = 0;
        let skippedDuplicates = 0;
        let skippedOld = 0;

        try {
            // Fetch messages in smaller batches for better performance
            const batchSize = 25; // Reduced batch size
            for (let i = 0; i < uids.length; i += batchSize) {
                const batchUIDs = uids.slice(i, i + batchSize);

                for await (const message of client.fetch(batchUIDs, {
                    envelope: true,
                    source: true,
                    flags: true,
                    uid: true
                })) {
                    try {
                        // First check: Skip emails older than our date limit
                        if (message.envelope?.date && new Date(message.envelope.date) < sinceDate) {
                            skippedOld++;
                            continue;
                        }

                        // Second check: Generate email ID and check if it already exists
                        const emailId = `${account.id}-${message.uid}`;
                        const existingEmail = await this.elasticsearchService.getEmailById(emailId);

                        if (existingEmail) {
                            skippedDuplicates++;
                            continue;
                        }

                        // Process the email if it passes all checks
                        const email = await this.processMessage(message, account);
                        if (email) {
                            // Additional date check on processed email
                            if (new Date(email.date) >= sinceDate) {
                                emails.push(email);
                                processedCount++;
                            } else {
                                skippedOld++;
                            }
                        }
                    } catch (error) {
                        console.error(`Error processing message UID ${message.uid}:`, error);
                    }
                }
            }

            if (emails.length > 0) {
                await this.elasticsearchService.indexEmails(emails);
                console.log(`📥 Indexed ${emails.length} new emails for ${account.email} (skipped ${skippedDuplicates} duplicates, ${skippedOld} old emails)`);
            } else {
                console.log(`📭 No new emails to index for ${account.email} (skipped ${skippedDuplicates} duplicates, ${skippedOld} old emails)`);
            }

            return processedCount;

        } catch (error) {
            console.error(`Error processing email batch for ${account.email}:`, error);
            throw error;
        }
    }

    /**
     * Perform background sync with strict limits and duplicate checking
     */
    private async performBackgroundSyncWithLimits(
        account: EmailAccount,
        client: ImapFlow,
        sinceDate: Date,
        alreadyProcessedUIDs: number[]
    ): Promise<void> {
        try {
            // Search for emails within the date range, excluding already processed ones
            const searchCriteria = { since: sinceDate };
            const allMessageUIDs = await client.search(searchCriteria);

            if (!Array.isArray(allMessageUIDs) || allMessageUIDs.length === 0) {
                console.log(`📭 No additional emails found for background sync of ${account.email}`);
                return;
            }

            // Filter out messages we've already processed
            const processedUIDs = new Set(alreadyProcessedUIDs);
            const remainingUIDs = allMessageUIDs.filter(uid => !processedUIDs.has(uid));

            if (remainingUIDs.length === 0) {
                console.log(`📭 No new emails found for background sync of ${account.email}`);
                return;
            }

            // Apply strict limits for background sync
            const backgroundBatchSize = config.emailSync?.backgroundBatchSize || 100;
            const maxBackgroundEmails = Math.min(remainingUIDs.length, backgroundBatchSize);

            // Take the most recent emails within our limit
            const limitedUIDs = remainingUIDs.slice(-maxBackgroundEmails);

            console.log(`📧 Background sync processing ${limitedUIDs.length} emails for ${account.email} (from ${remainingUIDs.length} candidates, max allowed: ${backgroundBatchSize})`);

            const processedCount = await this.processEmailBatchWithDuplicateCheck(account, client, limitedUIDs, sinceDate);

            if (limitedUIDs.length > 0) {
                const highestUID = Math.max(...limitedUIDs);
                const currentLastUID = this.lastProcessedUIDs.get(account.id) || 0;
                if (highestUID > currentLastUID) {
                    this.lastProcessedUIDs.set(account.id, highestUID);
                }
            }

            console.log(`✅ Background sync completed for ${account.email}, processed ${processedCount} new emails`);

            // If there are still more emails and we haven't hit our absolute limit, 
            // schedule another batch after a longer delay
            const totalProcessed = alreadyProcessedUIDs.length + limitedUIDs.length;
            const maxTotalEmails = config.emailSync?.maxEmails || 300;

            if (remainingUIDs.length > limitedUIDs.length && totalProcessed < maxTotalEmails) {
                const remainingAfterBatch = remainingUIDs.length - limitedUIDs.length;
                console.log(`📧 Scheduling next background batch for ${account.email} (${remainingAfterBatch} emails remaining, ${totalProcessed}/${maxTotalEmails} total processed)`);

                setTimeout(() => {
                    this.performAdditionalBackgroundSync(account, client, sinceDate, [...alreadyProcessedUIDs, ...limitedUIDs]);
                }, 5 * 60 * 1000); // Wait 5 minutes before next batch
            } else {
                console.log(`🏁 Background sync complete for ${account.email} - reached limits or no more emails`);
            }

        } catch (error) {
            console.error(`❌ Error in background sync for ${account.email}:`, error);
        }
    }

    /**
     * Perform additional background sync batches with even stricter limits
     */
    private async performAdditionalBackgroundSync(
        account: EmailAccount,
        client: ImapFlow,
        sinceDate: Date,
        alreadyProcessedUIDs: number[]
    ): Promise<void> {
        try {
            if (!client || !client.authenticated) {
                console.log(`⚠️ Client no longer authenticated for ${account.email}, stopping additional background sync`);
                return;
            }

            const totalProcessed = alreadyProcessedUIDs.length;
            const maxTotalEmails = config.emailSync?.maxEmails || 300;

            if (totalProcessed >= maxTotalEmails) {
                console.log(`🛑 Reached maximum email limit (${maxTotalEmails}) for ${account.email}, stopping background sync`);
                return;
            }

            console.log(`🔄 Running additional background sync for ${account.email} (${totalProcessed}/${maxTotalEmails} emails processed)`);

            // Search for remaining emails
            const searchCriteria = { since: sinceDate };
            const allMessageUIDs = await client.search(searchCriteria);

            if (!Array.isArray(allMessageUIDs) || allMessageUIDs.length === 0) {
                console.log(`📭 No emails found for additional background sync of ${account.email}`);
                return;
            }

            // Filter out already processed emails
            const processedUIDs = new Set(alreadyProcessedUIDs);
            const remainingUIDs = allMessageUIDs.filter(uid => !processedUIDs.has(uid));

            if (remainingUIDs.length === 0) {
                console.log(`📭 No new emails found for additional background sync of ${account.email}`);
                return;
            }

            // Smaller batch size for additional syncs
            const additionalBatchSize = Math.min(50, maxTotalEmails - totalProcessed);
            const limitedUIDs = remainingUIDs.slice(-additionalBatchSize);

            console.log(`📧 Processing ${limitedUIDs.length} emails in additional background batch for ${account.email}`);

            const processedCount = await this.processEmailBatchWithDuplicateCheck(account, client, limitedUIDs, sinceDate);

            if (limitedUIDs.length > 0) {
                const highestUID = Math.max(...limitedUIDs);
                const currentLastUID = this.lastProcessedUIDs.get(account.id) || 0;
                if (highestUID > currentLastUID) {
                    this.lastProcessedUIDs.set(account.id, highestUID);
                }
            }

            console.log(`✅ Additional background sync completed for ${account.email}, processed ${processedCount} new emails`);

        } catch (error) {
            console.error(`❌ Error in additional background sync for ${account.email}:`, error);
        }
    }

    /**
     * Process a batch of emails (legacy method, replaced by processEmailBatchWithDuplicateCheck)
     */
    private async processEmailBatch(account: EmailAccount, client: ImapFlow, uids: number[]): Promise<void> {
        const emails: Email[] = [];

        try {
            // Fetch messages in batches to avoid memory issues
            const batchSize = 50;
            for (let i = 0; i < uids.length; i += batchSize) {
                const batchUIDs = uids.slice(i, i + batchSize);

                for await (const message of client.fetch(batchUIDs, {
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
            }

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
    private async processMessage(message: FetchMessageObject, account: EmailAccount): Promise<Email | null> {
        try {
            if (!message.source) {
                throw new Error('Message source is undefined');
            }
            const parsed: ParsedMail = await simpleParser(message.source);

            // Generate email ID first for attachment storage
            const emailId = `${account.id}-${message.uid}`;

            const contentResult = await this.emailProcessor.processEmailContent(
                parsed.html || null,
                parsed.text || null,
                parsed.attachments || [],
                emailId // Pass emailId for attachment storage
            );

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
                id: emailId, // Use the generated emailId
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

                if (classification.category === 'interested') {
                    if (account.credentials && 'slackWebhookUrl' in account.credentials) {
                        const slackUrl = (account.credentials as any).slackWebhookUrl;
                        if (slackUrl) {
                            await this.slackService.sendNotification(slackUrl, email);
                        }
                    }
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
    private async startIdleMode(account: EmailAccount, client: ImapFlow): Promise<void> {
        try {
            console.log(`🔄 Starting IDLE mode for ${account.email}`);

            // Start IDLE monitoring
            await client.idle();
            console.log(`✅ IDLE mode started for ${account.email}`);

        } catch (error: any) {
            console.error(`❌ IDLE mode error for ${account.email}:`, error.message);
            this.emit('idleError', account, error);
        }
    }

    /**
     * Handle exists event from IMAP server
     */
    private async handleExistsEvent(account: EmailAccount, client: ImapFlow, data: any): Promise<void> {
        try {
            console.log(`📧 Processing exists event for ${account.email}`, data);

            // Get the current mailbox status
            const status = await client.status('INBOX', { messages: true, uidNext: true });
            const lastUID = this.lastProcessedUIDs.get(account.id) || 0;

            // Search for new messages
            const newUIDs = await client.search({ uid: `${lastUID + 1}:*` });

            if (Array.isArray(newUIDs) && newUIDs.length > 0) {
                console.log(`📧 ${newUIDs.length} new message(s) for ${account.email}`);
                await this.processEmailBatch(account, client, newUIDs);
                this.lastProcessedUIDs.set(account.id, Math.max(...newUIDs));
                this.emit('newEmails', account, newUIDs.length);
            }

        } catch (error) {
            console.error(`❌ Error handling exists event for ${account.email}:`, error);
        }
    }

    /**
     * Schedule reconnection attempt with exponential backoff
     */
    private scheduleReconnection(account: EmailAccount): void {
        if (!account) return;

        // Clear existing timeout
        const existingTimeout = this.reconnectTimeouts.get(account.id);
        if (existingTimeout) {
            clearTimeout(existingTimeout);
        }

        // Get current attempt count
        const attempts = this.reconnectAttempts.get(account.id) || 0;

        // Stop reconnecting after max attempts
        if (attempts >= this.maxReconnectAttempts) {
            console.log(`❌ Max reconnection attempts reached for ${account.email}, stopping reconnection`);
            this.reconnectAttempts.delete(account.id);
            this.emit('maxReconnectAttemptsReached', account);
            return;
        }

        // Calculate delay with exponential backoff
        const delay = this.baseReconnectDelay * Math.pow(2, attempts);
        const jitter = Math.random() * 5000; // Add jitter to prevent thundering herd
        const finalDelay = delay + jitter;

        console.log(`🔄 Scheduling reconnection for ${account.email} in ${Math.round(finalDelay / 1000)}s (attempt ${attempts + 1}/${this.maxReconnectAttempts})`);

        // Schedule reconnection
        const timeout = setTimeout(async () => {
            this.reconnectTimeouts.delete(account.id);
            this.reconnectAttempts.set(account.id, attempts + 1);

            console.log(`🔄 Attempting to reconnect ${account.email} (attempt ${attempts + 1})`);
            const success = await this.connectAccount(account);

            if (success) {
                // Reset attempt counter on successful connection
                this.reconnectAttempts.delete(account.id);
                console.log(`✅ Successfully reconnected ${account.email}`);
            }
        }, finalDelay);

        this.reconnectTimeouts.set(account.id, timeout);
    }

    /**
     * Perform additional background synchronization for remaining emails
     */
    private async performBackgroundSync(account: EmailAccount, client: ImapFlow, lastUID: number): Promise<void> {
        try {
            if (!client || !client.authenticated) {
                console.log(`⚠️ Client no longer authenticated for ${account.email}, skipping background sync`);
                return;
            }

            console.log(`🔄 Running additional background sync for ${account.email} from UID ${lastUID + 1}`);

            // Search for emails with UID higher than our last processed one
            const messageUIDs = await client.search({ uid: `${lastUID + 1}:*` });

            if (!Array.isArray(messageUIDs) || messageUIDs.length === 0) {
                console.log(`📭 No additional emails found for background sync of ${account.email}`);
                return;
            }

            // Limit to 200 emails per batch to prevent long sync times
            const limitedUIDs = messageUIDs.slice(-200);
            console.log(`📧 Processing ${limitedUIDs.length} emails in background sync batch for ${account.email} (from ${messageUIDs.length} total remaining)`);

            await this.processEmailBatch(account, client, limitedUIDs);

            if (limitedUIDs.length > 0) {
                const highestUID = Math.max(...limitedUIDs);
                this.lastProcessedUIDs.set(account.id, highestUID);

                // If there are more emails to process, schedule another background sync
                if (limitedUIDs.length < messageUIDs.length) {
                    console.log(`📧 Scheduling another background sync for ${account.email} (${messageUIDs.length - limitedUIDs.length} emails remaining)`);

                    setTimeout(() => {
                        this.performBackgroundSync(account, client, highestUID);
                    }, 60000); // Wait 1 minute before next background batch
                } else {
                    console.log(`✅ Background sync completed for ${account.email}, all emails processed`);
                }
            }
        } catch (error) {
            console.error(`❌ Error in background sync for ${account.email}:`, error);
            // Don't throw from background processing
        }
    }

    /**
     * Refresh access token and reconnect
     */
    async refreshAndReconnect(accountId: string): Promise<boolean> {
        const account = this.connectedAccounts.get(accountId);
        if (!account) {
            return false;
        }

        try {
            // Disconnect current connection
            await this.disconnectAccount(accountId);

            // Refresh the token
            const refreshedAccount = await this.refreshAccessToken(account);
            if (!refreshedAccount) {
                console.error(`❌ Failed to refresh token for ${account.email}`);
                return false;
            }

            // Update stored account with new token in both maps
            this.connectedAccounts.set(accountId, refreshedAccount);
            setAccount(accountId, refreshedAccount);

            console.log(`✅ Updated stored tokens for ${refreshedAccount.email}`);

            // Reconnect with refreshed token
            return await this.connectAccount(refreshedAccount);

        } catch (error) {
            console.error(`Failed to refresh and reconnect ${account.email}:`, error);
            return false;
        }
    }

    /**
     * Ensure the account has a valid access token
     */
    private async ensureValidToken(account: EmailAccount): Promise<void> {
        // Check if token is expired
        if (this.isTokenExpired(account)) {
            console.log(`🔑 Token expired for ${account.email}, refreshing...`);
            const refreshedAccount = await this.refreshAccessToken(account);
            if (refreshedAccount) {
                // Update the account with new token
                Object.assign(account, refreshedAccount);
                this.connectedAccounts.set(account.id, account);
            } else {
                throw new Error('Failed to refresh expired token');
            }
        }
    }

    /**
     * Check if access token is expired
     */
    private isTokenExpired(account: EmailAccount): boolean {
        // Check if token has expiry information
        if (account.credentials && 'expiresAt' in account.credentials) {
            const expiresAt = (account.credentials as any).expiresAt;
            const now = new Date();
            const expiry = new Date(expiresAt);
            // Consider token expired if it expires within the next 5 minutes
            return now >= new Date(expiry.getTime() - 5 * 60 * 1000);
        }
        return false; // Assume valid if no expiry info
    }

    /**
     * Refresh OAuth access token
     */
    private async refreshAccessToken(account: EmailAccount): Promise<EmailAccount | null> {
        try {
            console.log(`🔄 Refreshing access token for ${account.email}`);

            const refreshToken = account.credentials.refreshToken;
            if (!refreshToken) {
                console.error(`❌ No refresh token available for ${account.email}`);
                return null;
            }

            // Use OAuth service to refresh the token
            let newAccessToken: string;

            if (account.provider === 'gmail') {
                newAccessToken = await this.oauthService.refreshGoogleToken(refreshToken);
            } else if (account.provider === 'outlook') {
                newAccessToken = await this.oauthService.refreshMicrosoftToken(refreshToken);
            } else {
                console.error(`❌ Unknown provider for token refresh: ${account.provider}`);
                return null;
            }

            if (!newAccessToken) {
                console.error(`❌ Failed to get new access token for ${account.email}`);
                return null;
            }

            // Update the account with new token
            const updatedAccount: EmailAccount = {
                ...account,
                credentials: {
                    ...account.credentials,
                    accessToken: newAccessToken,
                    // Update expiry to 1 hour from now (typical for OAuth tokens)
                    expiryDate: Date.now() + (60 * 60 * 1000)
                }
            };

            console.log(`✅ Successfully refreshed access token for ${account.email}`);
            return updatedAccount;

        } catch (error) {
            console.error(`❌ Failed to refresh token for ${account.email}:`, error);
            return null;
        }
    }

    /**
     * Check if error is authentication-related
     */
    private isAuthError(error: Error): boolean {
        const authErrorMessages = [
            'Command failed',
            'authentication failed',
            'invalid credentials',
            'auth',
            'unauthorized',
            'access denied'
        ];

        return authErrorMessages.some(msg =>
            error.message.toLowerCase().includes(msg.toLowerCase())
        );
    }

    /**
     * Check if error is connection-related
     */
    private isConnectionError(error: Error): boolean {
        const connectionErrorMessages = [
            'ECONNRESET',
            'ETIMEOUT',
            'Socket timeout',
            'connection',
            'network',
            'ENOTFOUND',
            'ECONNREFUSED'
        ];

        return connectionErrorMessages.some(msg =>
            error.message.toLowerCase().includes(msg.toLowerCase())
        );
    }

    /**
     * Check if error is specifically a socket timeout
     */
    private isSocketTimeout(error: Error): boolean {
        const timeoutMessages = [
            'socket timeout',
            'ETIMEOUT',
            'timeout'
        ];

        return timeoutMessages.some(msg =>
            error.message.toLowerCase().includes(msg.toLowerCase())
        );
    }

    /**
     * Handle authentication errors
     */
    private async handleAuthError(account: EmailAccount | undefined): Promise<void> {
        if (!account) return;

        try {
            // Attempt to refresh token and reconnect
            const success = await this.refreshAndReconnect(account.id);

            if (!success) {
                console.error(`❌ Failed to handle auth error for ${account.email}`);
                this.emit('authenticationFailed', account);
            }
        } catch (error) {
            console.error(`❌ Error handling auth error for ${account.email}:`, error);
        }
    }

    /**
     * Manual retry connection for a specific account
     */
    async retryConnection(accountId: string): Promise<boolean> {
        const account = this.connectedAccounts.get(accountId);
        if (!account) {
            console.error(`❌ Account not found for retry: ${accountId}`);
            return false;
        }

        // Reset reconnection attempts for manual retry
        this.reconnectAttempts.delete(accountId);

        console.log(`🔄 Manual retry connection for ${account.email}`);
        return await this.connectAccount(account);
    }

    /**
     * Get reconnection status for all accounts
     */
    getReconnectionStatus(): { [accountId: string]: { attempts: number, maxAttempts: number } } {
        const status: { [accountId: string]: { attempts: number, maxAttempts: number } } = {};

        for (const [accountId] of this.connectedAccounts) {
            status[accountId] = {
                attempts: this.reconnectAttempts.get(accountId) || 0,
                maxAttempts: this.maxReconnectAttempts
            };
        }

        return status;
    }
}
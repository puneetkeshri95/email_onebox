import { Client } from '@elastic/elasticsearch';
import { config } from '../config/config';
import { EmailAccount } from './oauth.service';

// In-memory store for fast access and to avoid circular dependencies
export const emailAccounts: Map<string, EmailAccount> = new Map();

// Elasticsearch client for persistent storage
const client = new Client({
    node: config.elasticsearch.url,
    auth: {
        apiKey: config.elasticsearch.apiKey
    },
    requestTimeout: 30000,
});

// Define a dedicated index name for account configurations to keep them
// separate from the email documents.
const ACCOUNTS_INDEX = 'email_accounts';

/**
 * Helper functions for in-memory account storage
 * These avoid circular dependencies between auth routes and services
 */
export function getAllAccounts(): EmailAccount[] {
    return Array.from(emailAccounts.values());
}

export function getAccountById(id: string): EmailAccount | undefined {
    return emailAccounts.get(id);
}

export function setAccount(id: string, account: EmailAccount): void {
    emailAccounts.set(id, account);
}

export function removeAccount(id: string): boolean {
    return emailAccounts.delete(id);
}

export function hasAccount(id: string): boolean {
    return emailAccounts.has(id);
}

/**
 * Initializes the 'email_accounts' index in Elasticsearch.
 * This function should be called once when your application starts up.
 */
export async function initializeAccountsIndex(): Promise<void> {
    try {
        const indexExists = await client.indices.exists({ index: ACCOUNTS_INDEX });
        if (!indexExists) {
            await client.indices.create({
                index: ACCOUNTS_INDEX,
                mappings: {
                    properties: {
                        id: { type: 'keyword' },
                        type: { type: 'keyword' },
                        username: { type: 'keyword' },
                        // For a production app, encrypt sensitive data like passwords/tokens.
                        password: { type: 'text', index: false }, // 'index: false' prevents searching on this field.
                        slackWebhookUrl: { type: 'keyword', index: false },
                        // Add other EmailAccount fields as needed
                    },
                },
            });
            console.log(`✅ Elasticsearch index created: ${ACCOUNTS_INDEX}`);
        }
    } catch (error) {
        console.error(`❌ Error initializing accounts index:`, error);
        // In a real app, you might want to handle this more gracefully.
    }
}

/**
 * Updates a specific account document in Elasticsearch.
 * This is the function your slack.routes.ts will use.
 * @param accountId The ID of the account document to update.
 * @param updates A partial object of the fields to update (e.g., { slackWebhookUrl: '...' }).
 */
export async function updateAccount(accountId: string, updates: Partial<EmailAccount>): Promise<void> {
    try {
        await client.update({
            index: ACCOUNTS_INDEX,
            id: accountId,
            doc: updates,
        });
        console.log(`✅ Updated account in Elasticsearch: ${accountId}`);
    } catch (error) {
        console.error(`❌ Error updating account ${accountId} in Elasticsearch:`, error);
        throw error; // Re-throw to let the caller know the update failed.
    }
}

/**
 * Retrieves a single email account by its ID from Elasticsearch.
 * This is the function your imap.service.ts will use.
 * @param accountId The ID of the account to retrieve.
 * @returns The full EmailAccount object or null if not found.
 */
export async function findAccountById(accountId: string): Promise<EmailAccount | null> {
    try {
        const response = await client.get<EmailAccount>({
            index: ACCOUNTS_INDEX,
            id: accountId,
        });
        return response._source || null;
    } catch (error: any) {
        // A 404 error is expected if the document doesn't exist.
        if (error.statusCode === 404) {
            return null;
        }
        console.error(`❌ Error finding account ${accountId} in Elasticsearch:`, error);
        return null;
    }
}

/**
 * Saves a new email account document to Elasticsearch.
 * You should call this whenever a new email account is added to your system.
 * @param account The full EmailAccount object to save.
 */
export async function saveAccount(account: EmailAccount): Promise<void> {
    try {
        await client.index({
            index: ACCOUNTS_INDEX,
            id: account.id, // Use the account's own ID as the document ID
            document: account,
            refresh: 'wait_for', // Ensure the document is searchable immediately
        });
        console.log(`✅ Saved account to Elasticsearch: ${account.id}`);
    } catch (error) {
        console.error(`❌ Error saving account ${account.id} to Elasticsearch:`, error);
        throw error;
    }
}

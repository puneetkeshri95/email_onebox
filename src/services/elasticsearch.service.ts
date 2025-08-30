import { Client } from '@elastic/elasticsearch';
import { config } from '../config/config';
import { Email } from '../models/types';
//hi

export class ElasticsearchService {
    private client: Client;

    constructor() {
        this.client = new Client({
            node: config.elasticsearch.url,
            auth: {
                apiKey: config.elasticsearch.apiKey
            },
            requestTimeout: 30000,
        });
        this.initializeIndex();
    }

    async resetIndex(): Promise<void> {
        try {
            console.log('🔄 Resetting Elasticsearch index...');

            // Delete existing index if it exist
            const indexExists = await this.client.indices.exists({
                index: config.elasticsearch.index,
            });

            if (indexExists) {
                await this.client.indices.delete({
                    index: config.elasticsearch.index,
                });
                console.log('🗑️ Deleted existing index');
            } else {
                console.log('ℹ️ Index does not exist, will create new one');
            }

            // Recreate the index with correct mapping
            await this.createIndex();
            console.log('✅ Index reset completed');
        } catch (error: any) {
            // Handle the case where we try to delete a non-existent index
            if (error?.meta?.statusCode === 404 && error?.meta?.body?.error?.type === 'index_not_found_exception') {
                console.log('ℹ️ Index was already deleted or does not exist, creating new one');
                try {
                    await this.createIndex();
                    console.log('✅ Index reset completed');
                    return;
                } catch (createError) {
                    console.error('❌ Error creating index after deletion attempt:', createError);
                    throw createError;
                }
            }

            console.error('❌ Error resetting index:', error);
            throw error;
        }
    }

    private async createIndex(): Promise<void> {
        try {
            await this.client.indices.create({
                index: config.elasticsearch.index,
                mappings: {
                    properties: {
                        id: { type: 'keyword' },
                        messageId: { type: 'keyword' },
                        accountId: { type: 'keyword' },
                        folder: { type: 'keyword' },
                        from: { type: 'text', analyzer: 'standard' },
                        to: { type: 'text', analyzer: 'standard' },
                        subject: { type: 'text', analyzer: 'standard' },
                        body: { type: 'text', analyzer: 'standard' },
                        htmlBody: { type: 'text', analyzer: 'standard' },
                        textBody: { type: 'text', analyzer: 'standard' },
                        cleanHtml: { type: 'text', analyzer: 'standard' },
                        date: { type: 'date' },
                        size: { type: 'long' },
                        isRead: { type: 'boolean' },
                        isImportant: { type: 'boolean' },
                        priority: { type: 'keyword' },
                        isHtml: { type: 'boolean' },
                        hasExternalImages: { type: 'boolean' },
                        hasAttachments: { type: 'boolean' },
                        attachments: {
                            type: 'object',
                            properties: {
                                filename: { type: 'text', analyzer: 'standard' },
                                contentType: { type: 'keyword' },
                                size: { type: 'long' },
                                contentId: { type: 'keyword' },
                                isInline: { type: 'boolean' },
                                downloadUrl: { type: 'keyword' }
                            }
                        },
                        inlineImages: {
                            type: 'object',
                            properties: {
                                cid: { type: 'keyword' },
                                contentType: { type: 'keyword' },
                                filename: { type: 'text' }
                            }
                        },
                        flags: { type: 'keyword' },
                        aiCategory: { type: 'keyword' },
                        aiConfidence: { type: 'float' },
                        attachmentText: { type: 'text', analyzer: 'standard' },
                        processedAt: { type: 'date' },
                        contentProcessed: { type: 'boolean' }
                    },
                },
            });
        } catch (error: any) {
            // If index already exists, that's okay
            if (error?.meta?.statusCode === 400 && error?.meta?.body?.error?.type === 'resource_already_exists_exception') {
                console.log('ℹ️ Index already exists during creation');
                return;
            }
            throw error;
        }
    }

    private async initializeIndex(): Promise<void> {
        try {
            // First check if Elasticsearch is accessible
            await this.client.ping();

            const indexExists = await this.client.indices.exists({
                index: config.elasticsearch.index,
            });

            if (!indexExists) {
                // Index doesn't exist, create it
                await this.createIndex();
                console.log('✅ Elasticsearch index created');
            } else {
                // Index exists, check if the mapping is correct for attachments field
                console.log('✅ Elasticsearch index already exists');

                try {
                    const mapping = await this.client.indices.getMapping({
                        index: config.elasticsearch.index
                    });

                    const currentMapping = mapping[config.elasticsearch.index]?.mappings?.properties;
                    const attachmentsMapping = currentMapping?.attachments;

                    // If attachments field is not properly mapped as object, reset the index
                    if (attachmentsMapping && attachmentsMapping.type !== 'object') {
                        console.log('⚠️ Attachments field has incorrect mapping, resetting index...');

                        return;
                    } else if (!attachmentsMapping) {
                        console.log('⚠️ Attachments field is missing, resetting index...');

                        return;
                    } else {
                        console.log('✅ Index mapping is correct');
                    }
                } catch (mappingError) {
                    console.error('❌ Error checking index mapping:', mappingError);
                    // I we can't check the mapping and index exists, log but don't reset
                    console.log('⚠️ Cannot verify index mapping, continuing with existing index');
                }
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';

            // Don't treat index creation errors as fatal
            if (errorMessage.includes('resource_already_exists_exception')) {
                console.log('ℹ️ Elasticsearch index already exists, continuing...');
                return;
            }

            console.error('❌ Elasticsearch not available:', errorMessage);
            console.log('💡 To enable search features, start Elasticsearch: npm run docker:elasticsearch');
            // Don't throw error - let the service continue without Elasticsearch
        }
    }

    async indexEmails(emails: Email[]): Promise<void> {
        try {
            // Filter out potentially problematic fields before indexing
            const emailsForIndexing = emails.map(email => ({
                ...email,
                // Limit email body size to prevent indexing issues
                body: email.body ? this.truncateText(email.body, 50000) : email.body,
                htmlBody: email.htmlBody ? this.truncateText(email.htmlBody, 100000) : email.htmlBody,
                textBody: email.textBody ? this.truncateText(email.textBody, 50000) : email.textBody,
                cleanHtml: email.cleanHtml ? this.truncateText(email.cleanHtml, 100000) : email.cleanHtml,
                // Ensure attachments don't contain binary data
                attachments: email.attachments?.map(att => ({
                    filename: att.filename,
                    contentType: att.contentType,
                    size: att.size,
                    contentId: att.contentId,
                    isInline: att.isInline,
                    downloadUrl: att.downloadUrl
                    // Explicitly exclude 'data' field
                })) || [],
                // Ensure inline images don't contain binary data
                inlineImages: email.inlineImages?.map(img => ({
                    cid: img.cid,
                    contentType: img.contentType,
                    filename: img.filename
                    // Explicitly exclude 'data' field
                })) || []
            }));

            const operations = emailsForIndexing.flatMap((email) => [
                { index: { _index: config.elasticsearch.index, _id: email.id } },
                email,
            ]);

            if (operations.length > 0) {
                const response = await this.client.bulk({
                    operations: operations
                });

                if (response.errors) {
                    console.error('❌ Elasticsearch bulk indexing errors:');

                    // Log detailed error information
                    response.items?.forEach((item: any, index: number) => {
                        if (item.index?.error) {
                            const email = emailsForIndexing[index];
                            console.error(`   - Email ${email?.id}: ${item.index.error.type} - ${item.index.error.reason}`);

                            // Log specific error details for debugging
                            if (item.index.error.reason?.includes('too_many_fields') ||
                                item.index.error.reason?.includes('field_expansion_limit')) {
                                console.error(`     This email may have too many dynamic fields or be too large`);
                            }
                        }
                    });

                    // Count successful vs failed indexing
                    const successful = response.items?.filter((item: any) => !item.index?.error).length || 0;
                    const failed = response.items?.filter((item: any) => item.index?.error).length || 0;

                    console.log(`📥 Indexed ${successful} emails successfully, ${failed} failed`);
                } else {
                    console.log(`✅ Successfully indexed ${emails.length} emails`);
                }
            }
        } catch (error) {
            console.error('❌ Error indexing emails (Elasticsearch may not be running):', error);
            // Don't throw error - let the service continue
        }
    }

    /**
     * Truncate text to prevent indexing issues with very large content
     */
    private truncateText(text: string, maxLength: number): string {
        if (!text || text.length <= maxLength) {
            return text;
        }
        return text.substring(0, maxLength) + '... [truncated]';
    }

    async indexEmail(email: Email): Promise<void> {
        try {
            await this.client.index({
                index: config.elasticsearch.index,
                id: email.id,
                document: email
            });
            console.log(`✅ Successfully indexed email: ${email.id}`);
        } catch (error) {
            console.error('❌ Error indexing email (Elasticsearch may not be running):', error);
            // Don't throw error - let the service continue
        }
    }

    async deleteEmailsByAccount(accountId: string): Promise<void> {
        try {
            await this.client.deleteByQuery({
                index: config.elasticsearch.index,
                query: {
                    term: {
                        accountId: accountId
                    }
                }
            });
            console.log(`✅ Successfully deleted emails for account: ${accountId}`);
        } catch (error) {
            console.error('❌ Error deleting emails by account (Elasticsearch may not be running):', error);
            // Don't throw error - let the service continue
        }
    }

    async searchEmails(
        query: string,
        filters?: {
            accountId?: string;
            accountIds?: string[]; // Support for multiple accounts
            folder?: string;
            aiCategory?: string;
            dateFrom?: Date;
            dateTo?: Date;
        },
        limit: number = 1000
    ): Promise<Email[]> {
        try {
            const must: any[] = [];
            const filter: any[] = [];

            // Text search
            if (query && query.trim()) {
                must.push({
                    multi_match: {
                        query: query,
                        fields: ['subject^2', 'body', 'from', 'to'],
                        type: 'best_fields',
                        fuzziness: 'AUTO',
                    },
                });
            } else {
                must.push({ match_all: {} });
            }

            // Filters - MUST have an account filter to ensure emails are only shown for authenticated users
            if (filters?.accountId) {
                // Single account ID filter
                filter.push({ term: { accountId: filters.accountId } });
            } else if (filters?.accountIds && filters.accountIds.length > 0) {
                // Multiple account IDs filter (for users with multiple connected accounts)
                filter.push({
                    terms: {
                        accountId: filters.accountIds
                    }
                });
            } else {
                // If no account filter provided, return empty result
                // This ensures no emails are displayed unless explicitly requested
                console.log('⚠️ No account ID provided for email search, returning empty result');
                return [];
            }

            if (filters?.folder) {
                filter.push({ term: { folder: filters.folder } });
            }
            if (filters?.aiCategory) {
                filter.push({ term: { aiCategory: filters.aiCategory } });
            }
            if (filters?.dateFrom || filters?.dateTo) {
                const dateRange: any = {};
                if (filters.dateFrom) dateRange.gte = filters.dateFrom;
                if (filters.dateTo) dateRange.lte = filters.dateTo;
                filter.push({ range: { date: dateRange } });
            }

            const response = await this.client.search({
                index: config.elasticsearch.index,
                query: {
                    bool: {
                        must,
                        filter,
                    },
                },
                sort: [{ date: { order: 'desc' as const } }],
                size: limit,
            });

            return response.hits.hits.map((hit: any) => hit._source as Email);
        } catch (error) {
            console.error('❌ Error searching emails (Elasticsearch may not be running):', error);
            // Return empty array if Elasticsearch is not available
            return [];
        }
    }

    async getEmailById(id: string, userAccountIds?: string[]): Promise<Email | null> {
        try {
            const response = await this.client.get({
                index: config.elasticsearch.index,
                id,
            });

            const email = response._source as Email;

            // If userAccountIds are provided, verify the email belongs to one of the user's accounts
            if (userAccountIds && userAccountIds.length > 0) {
                if (!userAccountIds.includes(email.accountId)) {
                    console.warn(`⚠️ Attempt to access email ${id} from unauthorized account`);
                    return null; // Don't return emails from accounts that don't belong to the user
                }
            }

            return email;
        } catch (error: any) {
            if (error.statusCode === 404) {
                return null;
            }
            console.error('❌ Error getting email by ID:', error);
            return null; // Return null instead of throwing
        }
    }

    async updateEmail(id: string, updates: Partial<Email>): Promise<void> {
        try {
            await this.client.update({
                index: config.elasticsearch.index,
                id,
                doc: updates,
            });
            console.log(`✅ Updated email: ${id}`);
        } catch (error) {
            console.error('❌ Error updating email (Elasticsearch may not be running):', error);
            // Don't throw error - let the service continue
        }
    }

    async deleteEmail(id: string): Promise<void> {
        try {
            await this.client.delete({
                index: config.elasticsearch.index,
                id,
            });
            console.log(`✅ Deleted email: ${id}`);
        } catch (error) {
            console.error('❌ Error deleting email:', error);
            throw error;
        }
    }

    async getEmailStats(): Promise<{
        total: number;
        byCategory: Record<string, number>;
        byAccount: Record<string, number>;
    }> {
        try {
            const response = await this.client.search({
                index: config.elasticsearch.index,
                size: 0,
                aggs: {
                    total: {
                        value_count: { field: 'id' },
                    },
                    by_category: {
                        terms: { field: 'aiCategory', missing: 'uncategorized' },
                    },
                    by_account: {
                        terms: { field: 'accountId' },
                    },
                }
            });

            const total = (response.aggregations?.total as any)?.value || 0;
            const byCategory: Record<string, number> = {};
            const byAccount: Record<string, number> = {};

            if (response.aggregations?.by_category) {
                (response.aggregations.by_category as any).buckets?.forEach((bucket: any) => {
                    byCategory[bucket.key] = bucket.doc_count;
                });
            }

            if (response.aggregations?.by_account) {
                (response.aggregations.by_account as any).buckets?.forEach((bucket: any) => {
                    byAccount[bucket.key] = bucket.doc_count;
                });
            }

            return { total, byCategory, byAccount };
        } catch (error) {
            console.error('❌ Error getting email stats (Elasticsearch may not be running):', error);
            // Return default stats if Elasticsearch is not available
            return {
                total: 0,
                byCategory: {},
                byAccount: {}
            };
        }
    }

    /**
     * Clean up old emails older than specified days
     * @param days Number of days to keep emails (older emails will be deleted)
     */
    async cleanupOldEmails(days: number = 30): Promise<void> {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - days);

            const result = await this.client.deleteByQuery({
                index: config.elasticsearch.index,
                query: {
                    range: {
                        date: {
                            lt: cutoffDate.toISOString()
                        }
                    }
                }
            });

            console.log(`🧹 Cleaned up ${result.deleted} emails older than ${days} days`);
        } catch (error) {
            console.error('❌ Error cleaning up old emails:', error);
        }
    }
}
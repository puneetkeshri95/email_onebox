import { Router, Request, Response } from 'express';
import { ElasticsearchService } from '../services/elasticsearch.service';
import { EnhancedRAGService } from '../services/enhanced-rag.service';
import { ImapFlowService } from '../services/imapflow.service';
import { emailAccounts } from '../services/account.store';
import { isAuthenticated, getUserAccountIds } from '../utils/session-utils';

const router = Router();
const elasticsearchService = new ElasticsearchService();
const ragService = new EnhancedRAGService();
const imapFlowService = new ImapFlowService();

// POST /api/emails/resync - Trigger a full resync for authenticated user's accounts
router.post('/resync', async (req: Request, res: Response) => {
    try {
        // Check if user is authenticated
        if (!isAuthenticated(req)) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
        }

        const userAccountIds = getUserAccountIds(req);
        if (userAccountIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No email accounts connected'
            });
        }

        // Get user's accounts and trigger ImapFlow sync
        const userAccounts = Array.from(emailAccounts.values()).filter(
            acc => userAccountIds.includes(acc.id) && acc.isActive
        );

        if (userAccounts.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No active email accounts found for user'
            });
        }

        let resyncCount = 0;
        const results = [];

        for (const account of userAccounts) {
            try {
                console.log(`🔄 Triggering ImapFlow resync for account ${account.email}`);

                // Connect/reconnect the account via ImapFlow (this triggers full sync)
                const connected = await imapFlowService.connectAccount(account);

                if (connected) {
                    // Also trigger a manual sync to ensure latest emails
                    await imapFlowService.manualSync(account.id);
                    resyncCount++;
                    results.push({
                        email: account.email,
                        status: 'success',
                        message: 'ImapFlow resync completed'
                    });
                } else {
                    results.push({
                        email: account.email,
                        status: 'failed',
                        message: 'Failed to connect ImapFlow'
                    });
                }
            } catch (error: any) {
                console.error(`❌ Failed to resync account ${account.email}:`, error);
                results.push({
                    email: account.email,
                    status: 'error',
                    error: error.message
                });
            }
        }

        res.json({
            success: true,
            message: `ImapFlow resync completed for ${resyncCount}/${userAccounts.length} email account(s).`,
            results,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error triggering resync:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to trigger resync',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// POST /api/emails/reset-index - Reset Elasticsearch index (admin function)
router.post('/reset-index', async (req: Request, res: Response) => {
    try {
        // Check if user is authenticated
        if (!isAuthenticated(req)) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
        }

        await elasticsearchService.resetIndex();

        res.json({
            success: true,
            message: 'Elasticsearch index reset successfully',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error resetting index:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to reset index',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// GET /api/emails/stats - Get email statistics (must be before /:id route)
router.get('/stats', async (req: Request, res: Response) => {
    try {
        // Check if user is authenticated via session
        if (!isAuthenticated(req)) {
            return res.json({
                success: true,
                data: {
                    total: 0,
                    byCategory: {},
                    byAccount: {}
                },
                message: 'Please sign in to view statistics',
                timestamp: new Date().toISOString(),
            });
        }

        // Filter stats by user accounts only
        const userAccountIds = getUserAccountIds(req);

        // For now, we'll return the full stats but in a real implementation, 
        // you'd modify getEmailStats to filter by accountIds
        const stats = await elasticsearchService.getEmailStats();

        // Filter out accounts that don't belong to the user
        if (stats && stats.byAccount) {
            const filteredByAccount: Record<string, number> = {};

            // Only include accounts that belong to the user
            Object.keys(stats.byAccount).forEach(accountId => {
                if (userAccountIds.includes(accountId)) {
                    filteredByAccount[accountId] = stats.byAccount[accountId];
                }
            });

            stats.byAccount = filteredByAccount;

            // Recalculate total based on user's accounts
            stats.total = Object.values(filteredByAccount).reduce((sum, count) => sum + count, 0);
        }

        res.json({
            success: true,
            data: stats,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        console.error('❌ Error getting email stats:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get email statistics',
            message: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});

// GET /api/emails/categories - Get available email categories (must be before /:id route)
router.get('/categories', (req: Request, res: Response) => {
    res.json({
        success: true,
        data: {
            categories: [
                { id: 'interested', label: 'Interested', color: '#28a745' },
                { id: 'meeting_booked', label: 'Meeting Booked', color: '#007bff' },
                { id: 'not_interested', label: 'Not Interested', color: '#6c757d' },
                { id: 'spam', label: 'Spam', color: '#dc3545' },
                { id: 'out_of_office', label: 'Out of Office', color: '#ffc107' },
            ],
        },
    });
});

// GET /api/emails/count - Get total email count
router.get('/count', async (req: Request, res: Response) => {
    try {
        const stats = await elasticsearchService.getEmailStats();
        res.json({
            success: true,
            count: stats.total || 0,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        console.error('❌ Error getting email count:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get email count',
            message: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});

// GET /api/emails - Search and list emails
router.get('/', async (req: Request, res: Response) => {
    try {
        // Check if user is authenticated via session
        if (!isAuthenticated(req)) {
            return res.json({
                success: true,
                data: [],
                count: 0,
                message: 'Please sign in to view emails'
            });
        }

        const {
            q: query = '',
            account,
            folder,
            category,
            dateFrom,
            dateTo,
            limit = '1000',
        } = req.query;

        const filters: any = {};

        // Always filter by accountId from authenticated session if not specified
        if (account) {
            filters.accountId = account as string;
        } else {
            // Get all accounts associated with the authenticated user
            const accountsList = getUserAccountIds(req);

            if (accountsList.length > 0) {
                // If multiple accounts, we'll handle that in the elasticsearch service
                filters.accountIds = accountsList;
            } else {
                // No accounts found, return empty result
                return res.json({
                    success: true,
                    data: [],
                    count: 0,
                    message: 'No email accounts connected. Please connect an email account first.'
                });
            }
        }

        if (folder) filters.folder = folder as string;
        if (category) filters.aiCategory = category as string;
        if (dateFrom) filters.dateFrom = new Date(dateFrom as string);
        if (dateTo) filters.dateTo = new Date(dateTo as string);

        const emails = await elasticsearchService.searchEmails(
            query as string,
            filters,
            parseInt(limit as string)
        );

        res.json({
            success: true,
            data: emails,
            count: emails.length,
            query: {
                text: query,
                filters,
            },
            message: emails.length === 0 ? 'No emails found. Start Elasticsearch and configure email accounts to see data.' : undefined,
        });
    } catch (error) {
        console.error('❌ Error searching emails:', error);

        // Check if this might be due to Elasticsearch not being available
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const isElasticsearchError = errorMessage.includes('elasticsearch') ||
            errorMessage.includes('ECONNREFUSED') ||
            errorMessage.includes('connect ECONNREFUSED');

        if (isElasticsearchError) {
            // Return a 200 response with empty data and a helpful message for the frontend
            res.json({
                success: true,
                data: [],
                count: 0,
                isElasticsearchUnavailable: true,
                message: 'Email search service is starting up. Your emails may be syncing in the background.'
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to search emails',
                message: errorMessage,
            });
        }
    }
});

// GET /api/emails/:id - Get specific email
router.get('/:id', async (req: Request, res: Response) => {
    try {
        // Check if user is authenticated via session
        if (!isAuthenticated(req)) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required',
                message: 'Please sign in to view emails',
            });
        }

        const { id } = req.params;

        // Get all accounts associated with the authenticated user
        const userAccountIds = getUserAccountIds(req);

        const email = await elasticsearchService.getEmailById(id, userAccountIds);

        if (!email) {
            return res.status(404).json({
                success: false,
                error: 'Email not found',
                message: `Email with ID ${id} not found or you don't have access to it`,
            });
        }

        res.json({
            success: true,
            data: email,
        });
    } catch (error) {
        console.error('❌ Error getting email:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get email',
            message: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});

// POST /api/emails/:id/reply - Generate suggested reply
router.post('/:id/reply', async (req: Request, res: Response) => {
    try {
        // Check if user is authenticated via session
        if (!isAuthenticated(req)) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required',
                message: 'Please sign in to generate reply suggestions',
            });
        }

        const { id } = req.params;

        // Get all accounts associated with the authenticated user
        const userAccountIds = getUserAccountIds(req);

        const email = await elasticsearchService.getEmailById(id, userAccountIds);

        if (!email) {
            return res.status(404).json({
                success: false,
                error: 'Email not found',
                message: `Email with ID ${id} not found or you don't have access to it`,
            });
        }

        const suggestedReply = await ragService.generateSuggestedReply(email.body || '', email.subject || '');

        res.json({
            success: true,
            data: {
                email: {
                    id: email.id,
                    subject: email.subject,
                    from: email.from,
                    aiCategory: email.aiCategory,
                },
                suggestedReply,
            },
        });
    } catch (error) {
        console.error('❌ Error generating suggested reply:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to generate suggested reply',
            message: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});

// PUT /api/emails/:id - Update email (e.g., mark as processed)
router.put('/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        await elasticsearchService.updateEmail(id, updates);

        res.json({
            success: true,
            message: 'Email updated successfully',
            data: { id, updates },
        });
    } catch (error) {
        console.error('❌ Error updating email:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update email',
            message: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});

export default router;

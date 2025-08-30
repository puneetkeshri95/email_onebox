import { Router, Request, Response } from 'express';
import { emailAccounts } from '../services/account.store';
import { ImapFlowService } from '../services/imapflow.service';

const router = Router();
const imapFlowService = new ImapFlowService();

/**
 * SIMPLIFIED SYNC: Only ImapFlow-based real-time sync
 * - Removed redundant MultiAccountEmailService sync
 * - All sync operations use ImapFlow (most efficient)
 * - No duplicate email processing
 */

/**
 * POST /api/sync/gmail - Trigger ImapFlow sync (simplified)
 */
router.post('/gmail', async (req: Request, res: Response) => {
    try {
        const accounts = Array.from(emailAccounts.values()).filter(
            acc => acc.isActive && acc.provider === 'gmail'
        );

        if (accounts.length === 0) {
            return res.json({
                success: false,
                message: 'No active Gmail accounts found. Please connect a Gmail account first.'
            });
        }

        console.log(`🔄 Starting ImapFlow sync for ${accounts.length} Gmail accounts`);

        const results = [];

        for (const account of accounts) {
            try {
                // Connect or reconnect via ImapFlow (handles all sync automatically)
                const connected = await imapFlowService.connectAccount(account);

                if (connected) {
                    results.push({
                        email: account.email,
                        status: 'connected',
                        message: 'ImapFlow real-time sync active'
                    });
                    console.log(`✅ ImapFlow connected and syncing: ${account.email}`);
                } else {
                    results.push({
                        email: account.email,
                        status: 'failed',
                        message: 'Failed to connect ImapFlow'
                    });
                }

            } catch (error: any) {
                console.error(`❌ Error connecting ImapFlow for ${account.email}:`, error);
                results.push({
                    email: account.email,
                    status: 'error',
                    error: error.message
                });
            }
        }

        res.json({
            success: true,
            message: `ImapFlow sync initiated for ${accounts.length} accounts.`,
            results,
            summary: {
                total: results.length,
                connected: results.filter(r => r.status === 'connected').length,
                failed: results.filter(r => r.status === 'failed' || r.status === 'error').length
            }
        });

    } catch (error: any) {
        console.error('❌ Error in ImapFlow sync:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to initiate ImapFlow sync',
            details: error.message
        });
    }
});

/**
 * POST /api/sync/incremental - Trigger incremental sync via ImapFlow
 */
router.post('/incremental', async (req: Request, res: Response) => {
    try {
        const accounts = Array.from(emailAccounts.values()).filter(
            acc => acc.isActive
        );

        if (accounts.length === 0) {
            return res.json({
                success: false,
                message: 'No active accounts found.'
            });
        }

        console.log(`🔄 Starting incremental sync for ${accounts.length} accounts`);
        const results = [];

        for (const account of accounts) {
            try {
                await imapFlowService.manualSync(account.id);
                results.push({
                    email: account.email,
                    status: 'success',
                    message: 'Incremental sync completed'
                });
            } catch (error: any) {
                console.error(`❌ Error in incremental sync for ${account.email}:`, error);
                results.push({
                    email: account.email,
                    status: 'error',
                    error: error.message
                });
            }
        }

        res.json({
            success: true,
            message: `Incremental sync completed for ${accounts.length} accounts.`,
            results,
            summary: {
                total: results.length,
                success: results.filter(r => r.status === 'success').length,
                failed: results.filter(r => r.status === 'error').length
            }
        });

    } catch (error: any) {
        console.error('❌ Error in incremental sync:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to perform incremental sync',
            details: error.message
        });
    }
});

/**
 * GET /api/sync/status - Get sync status (simplified)
 */
router.get('/status', (req: Request, res: Response) => {
    try {
        const accounts = Array.from(emailAccounts.values());
        const connectedImapFlowAccounts = imapFlowService.getConnectedAccounts();

        const accountsWithStatus = accounts.map(acc => {
            const isImapFlowConnected = connectedImapFlowAccounts.some(iaf => iaf.email === acc.email);
            return {
                id: acc.id,
                email: acc.email,
                provider: acc.provider,
                is_active: acc.isActive,
                sync_method: isImapFlowConnected ? 'ImapFlow (real-time)' : 'Disconnected',
                created_at: acc.createdAt,
                last_sync_at: acc.lastSyncAt || null
            };
        });

        res.json({
            success: true,
            accounts: accountsWithStatus,
            totalAccounts: accounts.length,
            activeAccounts: accounts.filter(acc => acc.isActive).length,
            imapFlowConnections: connectedImapFlowAccounts.length
        });

    } catch (error: any) {
        console.error('❌ Error getting sync status:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get sync status',
            details: error.message
        });
    }
});

export default router;

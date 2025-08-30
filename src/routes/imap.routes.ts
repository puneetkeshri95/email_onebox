import { Router, Request, Response } from 'express';
import { ImapFlowService } from '../services/imapflow.service';
import { emailAccounts } from '../services/account.store';

const router = Router();

// Initialize ImapFlow service (singleton)
let imapFlowService: ImapFlowService | null = null;

const getImapFlowService = (): ImapFlowService => {
    if (!imapFlowService) {
        imapFlowService = new ImapFlowService();

        // Set up event listeners
        imapFlowService.on('accountConnected', (account) => {
            console.log(`✅ ImapFlow connected for ${account.email}`);
        });

        imapFlowService.on('accountDisconnected', (account) => {
            console.log(`🔌 ImapFlow disconnected for ${account?.email || 'unknown'}`);
        });

        imapFlowService.on('newEmails', (account, count) => {
            console.log(`📧 ${count} new emails for ${account.email}`);
        });

        imapFlowService.on('authFailed', (account, error) => {
            console.error(`🔐 Auth failed for ${account.email}:`, error.message);
        });

        imapFlowService.on('connectionError', (account, error) => {
            console.error(`❌ Connection error for ${account?.email || 'unknown'}:`, error.message);
        });
    }
    return imapFlowService;
};

/**
 * POST /api/imap/connect - Connect ImapFlow for all OAuth accounts
 */
router.post('/connect', async (req: Request, res: Response) => {
    try {
        const service = getImapFlowService();
        const accounts = Array.from(emailAccounts.values()).filter(acc => acc.isActive);

        if (accounts.length === 0) {
            return res.json({
                success: true,
                message: 'No active OAuth accounts found. Please connect accounts via /api/auth/google or /api/auth/microsoft',
                connectedAccounts: 0
            });
        }

        const results = [];

        for (const account of accounts) {
            try {
                await service.connectAccount(account);
                results.push({
                    accountId: account.id,
                    email: account.email,
                    provider: account.provider,
                    status: 'connected'
                });
            } catch (error: any) {
                results.push({
                    accountId: account.id,
                    email: account.email,
                    provider: account.provider,
                    status: 'failed',
                    error: error.message
                });
            }
        }

        const successCount = results.filter(r => r.status === 'connected').length;

        res.json({
            success: true,
            message: `ImapFlow connection attempted for ${accounts.length} accounts, ${successCount} successful`,
            results,
            connectedAccounts: successCount
        });

    } catch (error: any) {
        console.error('Error connecting ImapFlow accounts:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to connect ImapFlow accounts',
            details: error.message
        });
    }
});

/**
 * POST /api/imap/connect/:accountId - Connect ImapFlow for specific account
 */
router.post('/connect/:accountId', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.params;
        const account = emailAccounts.get(accountId);

        if (!account) {
            return res.status(404).json({
                success: false,
                error: 'Account not found'
            });
        }

        const service = getImapFlowService();
        await service.connectAccount(account);

        res.json({
            success: true,
            message: `ImapFlow connected for ${account.email}`,
            account: {
                id: account.id,
                email: account.email,
                provider: account.provider
            }
        });

    } catch (error: any) {
        console.error('Error connecting ImapFlow account:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to connect ImapFlow account',
            details: error.message
        });
    }
});

/**
 * POST /api/imap/disconnect/:accountId - Disconnect ImapFlow for specific account
 */
router.post('/disconnect/:accountId', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.params;
        const service = getImapFlowService();

        await service.disconnectAccount(accountId);

        res.json({
            success: true,
            message: 'ImapFlow disconnected successfully'
        });

    } catch (error: any) {
        console.error('Error disconnecting ImapFlow account:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to disconnect ImapFlow account',
            details: error.message
        });
    }
});

/**
 * GET /api/imap/status - Get ImapFlow connection status
 */
router.get('/status', (req: Request, res: Response) => {
    try {
        const service = getImapFlowService();
        const statusInfo = service.getDetailedConnectionStatus();
        const connectionStatus = service.getConnectionStatus();

        res.json({
            success: true,
            accounts: statusInfo,
            totalConnected: Object.values(connectionStatus).filter(Boolean).length,
            totalAccounts: statusInfo.length
        });

    } catch (error: any) {
        console.error('Error getting ImapFlow status:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get ImapFlow status',
            details: error.message
        });
    }
});

/**
 * POST /api/imap/mark-read - Mark email as read
 */
router.post('/mark-read', async (req: Request, res: Response) => {
    try {
        const { accountId, uid } = req.body;

        if (!accountId || !uid) {
            return res.status(400).json({
                success: false,
                error: 'accountId and uid are required'
            });
        }

        const service = getImapFlowService();
        const success = await service.markAsRead(accountId, parseInt(uid, 10));

        if (success) {
            res.json({
                success: true,
                message: 'Email marked as read'
            });
        } else {
            res.status(400).json({
                success: false,
                error: 'Failed to mark email as read'
            });
        }

    } catch (error: any) {
        console.error('Error marking email as read:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to mark email as read',
            details: error.message
        });
    }
});

/**
 * POST /api/imap/disconnect-all - Disconnect all ImapFlow connections
 */
router.post('/disconnect-all', async (req: Request, res: Response) => {
    try {
        const service = getImapFlowService();
        await service.disconnectAll();

        res.json({
            success: true,
            message: 'All ImapFlow connections disconnected'
        });

    } catch (error: any) {
        console.error('Error disconnecting all ImapFlow accounts:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to disconnect all ImapFlow accounts',
            details: error.message
        });
    }
});

export { router as imapRoutes };

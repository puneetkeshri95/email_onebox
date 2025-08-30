import { Router, Request, Response } from 'express';
import { OAuthService, EmailAccount } from '../services/oauth.service';
import { ImapFlowService } from '../services/imapflow.service';
import { emailAccounts, setAccount, removeAccount, getAllAccounts } from '../services/account.store';
import { isAuthenticated, addAccountToSession, removeAccountFromSession, getUserAccounts } from '../utils/session-utils';
// import { MultiAccountEmailService } from '../services/multi-account-email.service';

const router = Router();
const oauthService = new OAuthService();
const imapFlowService = new ImapFlowService();
// const multiAccountService = new MultiAccountEmailService();

/**
 * GET /auth/status - Get user authentication status
 */
router.get('/status', (req: Request, res: Response) => {
    if (isAuthenticated(req) && req.session.user) {
        const connectedAccounts = getUserAccounts(req).filter(acc => acc !== undefined);
        res.json({
            success: true,
            isAuthenticated: true,
            user: {
                email: req.session.user.email,
                provider: req.session.user.provider
            },
            connectedAccounts: connectedAccounts.map(acc => ({
                id: acc!.id,
                email: acc!.email,
                provider: acc!.provider,
                isActive: acc!.isActive
            }))
        });
    } else {
        res.json({
            success: true,
            isAuthenticated: false,
            message: 'User not authenticated'
        });
    }
});

/**
 * GET /auth/providers - Get available OAuth providers
 */
router.get('/providers', (req: Request, res: Response) => {
    res.json({
        success: true,
        providers: [
            {
                name: 'Google',
                id: 'google',
                authUrl: '/api/auth/google',
                description: 'Connect your Gmail account'
            },
            {
                name: 'Microsoft',
                id: 'microsoft',
                authUrl: '/api/auth/microsoft',
                description: 'Connect your Outlook account'
            }
        ]
    });
});

/**
 * GET /auth/google - Initiate Google OAuth flow
 */
router.get('/google', (req: Request, res: Response) => {
    try {
        const authUrl = oauthService.getGoogleAuthUrl();
        res.redirect(authUrl);
    } catch (error) {
        console.error('❌ Error initiating Google OAuth:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to initiate Google authentication'
        });
    }
});

/**
 * GET /auth/gmail - Alias for Google OAuth (for compatibility)
 */
router.get('/gmail', (req: Request, res: Response) => {
    try {
        const authUrl = oauthService.getGoogleAuthUrl();
        res.redirect(authUrl);
    } catch (error) {
        console.error('❌ Error initiating Google OAuth:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to initiate Google authentication'
        });
    }
});

/**
 * GET /auth/microsoft - Initiate Microsoft OAuth flow
 */
router.get('/microsoft', (req: Request, res: Response) => {
    try {
        const authUrl = oauthService.getMicrosoftAuthUrl();
        res.redirect(authUrl);
    } catch (error) {
        console.error('❌ Error initiating Microsoft OAuth:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to initiate Microsoft authentication'
        });
    }
});

/**
 * GET /auth/outlook - Alias for Microsoft OAuth (for compatibility)
 */
router.get('/outlook', (req: Request, res: Response) => {
    try {
        const authUrl = oauthService.getMicrosoftAuthUrl();
        res.redirect(authUrl);
    } catch (error) {
        console.error('❌ Error initiating Microsoft OAuth:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to initiate Microsoft authentication'
        });
    }
});

/**
 * GET /auth/google/callback - Handle Google OAuth callback
 */
router.get('/google/callback', async (req: Request, res: Response) => {
    try {
        const { code, error } = req.query;

        if (error) {
            console.error('❌ Google OAuth error:', error);
            return res.redirect('/oauth-error.html?error=' + encodeURIComponent(error as string));
        }

        if (!code) {
            return res.status(400).json({
                success: false,
                error: 'Authorization code not received'
            });
        }

        // Exchange code for tokens
        const credentials = await oauthService.exchangeGoogleCode(code as string);

        // Create or update email account
        const accountId = `gmail_${credentials.email}`;
        const existingAccount = emailAccounts.get(accountId);

        let emailAccount: EmailAccount;

        if (existingAccount) {
            console.log(`🔄 Updating existing Gmail account: ${credentials.email}`);

            // Revoke old tokens for security
            try {
                await oauthService.revokeTokens(existingAccount.credentials);
                console.log(`🗑️ Revoked old tokens for ${credentials.email}`);
            } catch (error) {
                console.warn(`⚠️ Failed to revoke old tokens for ${credentials.email}:`, error);
                // Continue anyway - not critical
            }

            // Update existing account with new credentials
            emailAccount = {
                ...existingAccount,
                credentials,
                isActive: true,
                lastSyncAt: existingAccount.lastSyncAt, // Preserve sync history
                // Keep original createdAt date
            };

            console.log(`✅ Gmail account updated: ${credentials.email} (preserving sync history)`);
        } else {
            // Create new account
            emailAccount = {
                id: accountId,
                email: credentials.email,
                provider: 'gmail',
                credentials,
                isActive: true,
                createdAt: new Date()
            };

            console.log(`🆕 New Gmail account created: ${credentials.email}`);
        }

        // Store account
        setAccount(accountId, emailAccount);

        // Set user in session if not already set, otherwise just add the account
        if (!req.session.user) {
            req.session.user = {
                id: accountId,
                email: credentials.email,
                provider: 'gmail'
            };
        }

        // Add this account to the session's account list
        addAccountToSession(req, accountId);

        console.log(`✅ Gmail account connected: ${credentials.email}`);

        // Redirect to success page with account info immediately
        const isReturningUser = existingAccount ? 'true' : 'false';
        res.redirect(`/oauth-success.html?email=${encodeURIComponent(credentials.email)}&provider=Gmail&returning=${isReturningUser}`);

        // Start IMAP sync in the background AFTER response has been sent
        setTimeout(async () => {
            try {
                console.log(`🔄 Starting background ImapFlow connection for ${credentials.email} (existing: ${!!existingAccount})`);

                // Check if ImapFlow is already connected for this account
                const connectedAccounts = imapFlowService.getConnectedAccounts();
                const alreadyConnected = connectedAccounts.find(acc => acc.id === emailAccount.id);

                if (alreadyConnected) {
                    console.log(`ℹ️ ImapFlow already connected for ${credentials.email}, skipping duplicate connection`);
                    return;
                }

                // For existing accounts, try to do incremental sync
                if (existingAccount && existingAccount.lastSyncAt) {
                    console.log(`📅 Last sync: ${existingAccount.lastSyncAt.toISOString()}`);
                }

                await imapFlowService.connectAccount(emailAccount);
                console.log(`🔗 ImapFlow successfully connected for ${credentials.email}`);
            } catch (error) {
                console.warn(`⚠️ Failed to connect ImapFlow for ${credentials.email}:`, error);
                // User can manually trigger sync later if needed
            }
        }, 100);

    } catch (error) {
        console.error('❌ Error in Google OAuth callback:', error);
        res.redirect('/oauth-error.html?error=' + encodeURIComponent('Authentication failed'));
    }
});

/**
 * GET /auth/microsoft/callback - Handle Microsoft OAuth callback
 */
router.get('/microsoft/callback', async (req: Request, res: Response) => {
    try {
        const { code, error } = req.query;

        if (error) {
            console.error('❌ Microsoft OAuth error:', error);
            return res.redirect('/oauth-error.html?error=' + encodeURIComponent(error as string));
        }

        if (!code) {
            return res.status(400).json({
                success: false,
                error: 'Authorization code not received'
            });
        }

        // Exchange code for tokens
        const credentials = await oauthService.exchangeMicrosoftCode(code as string);

        // Create or update email account
        const accountId = `outlook_${credentials.email}`;
        const existingAccount = emailAccounts.get(accountId);

        let emailAccount: EmailAccount;

        if (existingAccount) {
            console.log(`🔄 Updating existing Outlook account: ${credentials.email}`);

            // Revoke old tokens for security
            try {
                await oauthService.revokeTokens(existingAccount.credentials);
                console.log(`🗑️ Revoked old tokens for ${credentials.email}`);
            } catch (error) {
                console.warn(`⚠️ Failed to revoke old tokens for ${credentials.email}:`, error);
                // Continue anyway - not critical
            }

            // Update existing account with new credentials
            emailAccount = {
                ...existingAccount,
                credentials,
                isActive: true,
                lastSyncAt: existingAccount.lastSyncAt, // Preserve sync history
                // Keep original createdAt date
            };

            console.log(`✅ Outlook account updated: ${credentials.email} (preserving sync history)`);
        } else {
            // Create new account
            emailAccount = {
                id: accountId,
                email: credentials.email,
                provider: 'outlook',
                credentials,
                isActive: true,
                createdAt: new Date()
            };

            console.log(`🆕 New Outlook account created: ${credentials.email}`);
        }

        // Store account
        setAccount(accountId, emailAccount);

        // Set user in session if not already set, otherwise just add the account
        if (!req.session.user) {
            req.session.user = {
                id: accountId,
                email: credentials.email,
                provider: 'outlook'
            };
        }

        // Add this account to the session's account list
        addAccountToSession(req, accountId);

        console.log(`✅ Outlook account connected: ${credentials.email}`);

        // Redirect to success page with account info immediately
        const isReturningUser = existingAccount ? 'true' : 'false';
        res.redirect(`/oauth-success.html?email=${encodeURIComponent(credentials.email)}&provider=Outlook&returning=${isReturningUser}`);

        // Start IMAP sync in the background AFTER response has been sent
        setTimeout(async () => {
            try {
                console.log(`🔄 Starting background ImapFlow connection for ${credentials.email} (existing: ${!!existingAccount})`);

                // Check if ImapFlow is already connected for this account
                const connectedAccounts = imapFlowService.getConnectedAccounts();
                const alreadyConnected = connectedAccounts.find(acc => acc.id === emailAccount.id);

                if (alreadyConnected) {
                    console.log(`ℹ️ ImapFlow already connected for ${credentials.email}, skipping duplicate connection`);
                    return;
                }

                // For existing accounts, try to do incremental sync
                if (existingAccount && existingAccount.lastSyncAt) {
                    console.log(`📅 Last sync: ${existingAccount.lastSyncAt.toISOString()}`);
                }

                await imapFlowService.connectAccount(emailAccount);
                console.log(`🔗 ImapFlow successfully connected for ${credentials.email}`);
            } catch (error) {
                console.warn(`⚠️ Failed to connect ImapFlow for ${credentials.email}:`, error);
                // User can manually trigger sync later if needed
            }
        }, 100);

    } catch (error) {
        console.error('❌ Error in Microsoft OAuth callback:', error);
        res.redirect('/oauth-error.html?error=' + encodeURIComponent('Authentication failed'));
    }
});

/**
 * GET /auth/accounts - Get connected email accounts
 */
router.get('/accounts', (req: Request, res: Response) => {
    const accounts = Array.from(emailAccounts.values()).map(account => ({
        id: account.id,
        email: account.email,
        provider: account.provider,
        isActive: account.isActive,
        createdAt: account.createdAt,
        lastSyncAt: account.lastSyncAt,
        // Don't expose credentials in API response
        hasValidTokens: !!(account.credentials.accessToken && account.credentials.refreshToken)
    }));

    res.json({
        success: true,
        accounts,
        total: accounts.length
    });
});

/**
 * POST /auth/logout - Sign out the current user
 */
router.post('/logout', async (req: Request, res: Response) => {
    if (req.session.user) {
        const email = req.session.user.email;

        try {
            // Get user's connected accounts before destroying session
            const userAccounts = getUserAccounts(req);

            // Disconnect all ImapFlow connections for this user
            for (const account of userAccounts) {
                if (account) {
                    console.log(`🔌 Disconnecting ImapFlow for ${account.email}`);
                    try {
                        await imapFlowService.disconnectAccount(account.id);
                    } catch (error) {
                        console.warn(`⚠️ Error disconnecting ImapFlow for ${account.email}:`, error);
                    }
                }
            }

            req.session.destroy((err) => {
                if (err) {
                    console.error('❌ Error during logout:', err);
                    return res.status(500).json({
                        success: false,
                        error: 'Failed to logout',
                        message: err.message
                    });
                }

                console.log(`✅ User logged out and ImapFlow disconnected: ${email}`);
                res.json({
                    success: true,
                    message: 'Successfully logged out'
                });
            });
        } catch (error) {
            console.error('❌ Error during logout cleanup:', error);
            // Still try to destroy session even if ImapFlow disconnect fails
            req.session.destroy((err) => {
                res.json({
                    success: true,
                    message: 'Logged out with warnings',
                    warning: 'Some connections may not have been properly closed'
                });
            });
        }
    } else {
        res.json({
            success: true,
            message: 'No active session'
        });
    }
});

/**
 * DELETE /auth/accounts/:accountId - Remove email account
 */
router.delete('/accounts/:accountId', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.params;

        if (emailAccounts.has(accountId)) {
            const account = emailAccounts.get(accountId)!;

            console.log(`🗑️ Starting cleanup for account: ${account.email} (${account.provider})`);

            // Step 1: Disconnect IMAP connection
            try {
                await imapFlowService.disconnectAccount(accountId);
                console.log(`✅ IMAP disconnected for ${account.email}`);
            } catch (imapError) {
                console.warn(`⚠️ Failed to disconnect IMAP for ${account.email}:`, imapError);
                // Continue with cleanup even if IMAP disconnect fails
            }

            // Step 2: Revoke OAuth tokens
            try {
                const revoked = await oauthService.revokeTokens(account.credentials);
                if (revoked) {
                    console.log(`✅ OAuth tokens revoked for ${account.email}`);
                } else {
                    console.warn(`⚠️ Failed to revoke OAuth tokens for ${account.email}`);
                }
            } catch (oauthError) {
                console.warn(`⚠️ Error revoking OAuth tokens for ${account.email}:`, oauthError);
                // Continue with cleanup even if token revocation fails
            }

            // Step 3: Remove from in-memory storage
            removeAccount(accountId);

            // Step 4: Remove from session
            removeAccountFromSession(req, accountId);

            console.log(`✅ Account completely removed: ${account.email} (${account.provider})`);

            res.json({
                success: true,
                message: 'Account removed successfully',
                details: {
                    email: account.email,
                    provider: account.provider,
                    cleanupCompleted: {
                        imapDisconnected: true,
                        tokensRevoked: true,
                        sessionCleared: true
                    }
                }
            });
        } else {
            res.status(404).json({
                success: false,
                error: 'Account not found'
            });
        }
    } catch (error) {
        console.error('❌ Error removing account:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to remove account',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * GET /auth/sync/status - Get sync status for all accounts
 */
router.get('/sync/status', (req: Request, res: Response) => {
    // TODO: Implement when multi-account service is ready
    res.json({
        success: true,
        syncStatus: []
    });
});

/**
 * POST /auth/sync - Start manual sync for all accounts
 */
router.post('/sync', async (req: Request, res: Response) => {
    try {
        // TODO: Implement when multi-account service is ready
        res.json({
            success: true,
            message: 'Sync functionality will be available after multi-account service implementation'
        });
    } catch (error) {
        console.error('❌ Error starting sync:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to start sync'
        });
    }
});

/**
 * POST /auth/accounts/:accountId/toggle - Toggle account active status
 */
router.post('/accounts/:accountId/toggle', (req: Request, res: Response) => {
    const { accountId } = req.params;
    const account = emailAccounts.get(accountId);

    if (account) {
        account.isActive = !account.isActive;
        setAccount(accountId, account);

        console.log(`✅ Account ${accountId} ${account.isActive ? 'activated' : 'deactivated'}`);

        res.json({
            success: true,
            account: {
                id: account.id,
                email: account.email,
                provider: account.provider,
                isActive: account.isActive
            }
        });
    } else {
        res.status(404).json({
            success: false,
            error: 'Account not found'
        });
    }
});

export default router;

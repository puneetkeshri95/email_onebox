import { Request } from 'express';
import { emailAccounts } from '../services/account.store';

// Add TypeScript declaration for express-session
declare module 'express-session' {
    interface SessionData {
        user?: {
            id: string;
            email: string;
            provider: string;
        };
        // Track all account IDs associated with this session
        accountIds?: string[];
        oauth?: {
            state?: string;
            returnTo?: string;
        };
    }
}

/**
 * Helper function to get all account IDs associated with the authenticated user
 * Now supports multiple accounts per session
 */
export function getUserAccountIds(req: Request): string[] {
    if (!req.session.user) return [];

    // Return all account IDs associated with this session
    return req.session.accountIds || [];
}

/**
 * Helper function to check if the user is authenticated
 */
export function isAuthenticated(req: Request): boolean {
    return !!req.session.user;
}

/**
 * Helper function to add an account ID to the user's session
 */
export function addAccountToSession(req: Request, accountId: string): void {
    if (!req.session.accountIds) {
        req.session.accountIds = [];
    }

    // Only add if not already present
    if (!req.session.accountIds.includes(accountId)) {
        req.session.accountIds.push(accountId);
    }
}

/**
 * Helper function to remove an account ID from the user's session
 */
export function removeAccountFromSession(req: Request, accountId: string): void {
    if (req.session.accountIds) {
        req.session.accountIds = req.session.accountIds.filter(id => id !== accountId);
    }
}

/**
 * Helper function to get all connected accounts for the current session
 */
export function getUserAccounts(req: Request) {
    const accountIds = getUserAccountIds(req);
    return accountIds.map(id => emailAccounts.get(id)).filter(Boolean);
}

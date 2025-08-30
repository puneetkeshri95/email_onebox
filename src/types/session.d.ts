import 'express-session';

declare module 'express-session' {
    // Properly extend the SessionData interface to include our custom properties
    interface SessionData {
        user?: {
            id: string;
            email: string;
            provider: string;
        };
        oauth?: {
            state?: string;
            returnTo?: string;
        };
    }
}

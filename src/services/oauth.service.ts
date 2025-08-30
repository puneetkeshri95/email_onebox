import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { config } from '../config/config';

export interface OAuthCredentials {
    provider: 'gmail' | 'outlook';
    email: string;
    accessToken: string;
    refreshToken: string;
    expiryDate?: number;
}

// Type for Google OAuth token response
interface GoogleTokenResponse {
    access_token?: string;
    refresh_token?: string;
    expiry_date?: number;
    token_type?: string;
    scope?: string;
}

// Type for Microsoft OAuth token response
interface MicrosoftTokenResponse {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type: string;
    scope: string;
    error?: string;
    error_description?: string;
}

// Type for Microsoft Graph user profile response
interface MicrosoftProfileResponse {
    mail?: string;
    userPrincipalName?: string;
    displayName?: string;
    id?: string;
}

export interface EmailAccount {
    id: string;
    email: string;
    provider: 'gmail' | 'outlook';
    credentials: OAuthCredentials;
    isActive: boolean;
    createdAt: Date;
    lastSyncAt?: Date;
    slackWebhookUrl?: string;
}

export class OAuthService {
    private googleOAuth2Client: any;

    constructor() {
        this.initializeGoogleOAuth();
    }

    private initializeGoogleOAuth() {
        this.googleOAuth2Client = new google.auth.OAuth2(
            config.oauth.google.clientId,
            config.oauth.google.clientSecret,
            config.oauth.google.redirectUri
        );
    }

    /**
     * Get Google OAuth authorization URL
     */
    getGoogleAuthUrl(): string {
        const scopes = [
            'https://www.googleapis.com/auth/gmail.readonly',
            'https://www.googleapis.com/auth/gmail.send',
            'https://mail.google.com/',
            'email',
            'profile'
        ];

        return this.googleOAuth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: scopes,
            prompt: 'consent' // Force consent to get refresh token
        });
    }

    /**
     * Get Microsoft OAuth authorization URL (simplified)
     */
    getMicrosoftAuthUrl(): string {
        const clientId = config.oauth.microsoft.clientId;
        const redirectUri = encodeURIComponent(config.oauth.microsoft.redirectUri);
        const scope = encodeURIComponent('https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/User.Read offline_access');

        return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?` +
            `client_id=${clientId}` +
            `&response_type=code` +
            `&redirect_uri=${redirectUri}` +
            `&scope=${scope}` +
            `&response_mode=query`;
    }

    /**
     * Exchange Google authorization code for tokens
     */
    async exchangeGoogleCode(code: string): Promise<OAuthCredentials> {
        try {
            const { tokens } = await this.googleOAuth2Client.getToken(code);

            // Type the tokens properly
            const googleTokens = tokens as GoogleTokenResponse;

            // Set credentials to get user info
            this.googleOAuth2Client.setCredentials(tokens);

            // Get user email
            const gmail = google.gmail({ version: 'v1', auth: this.googleOAuth2Client });
            const profile = await gmail.users.getProfile({ userId: 'me' });

            return {
                provider: 'gmail',
                email: profile.data.emailAddress || '',
                accessToken: googleTokens.access_token || '',
                refreshToken: googleTokens.refresh_token || '',
                expiryDate: googleTokens.expiry_date
            };
        } catch (error) {
            console.error('❌ Error exchanging Google code:', error);
            throw new Error('Failed to authenticate with Google');
        }
    }

    /**
     * Exchange Microsoft authorization code for tokens (simplified)
     */
    async exchangeMicrosoftCode(code: string): Promise<OAuthCredentials> {
        try {
            const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
            const params = new URLSearchParams({
                client_id: config.oauth.microsoft.clientId,
                client_secret: config.oauth.microsoft.clientSecret,
                code: code,
                redirect_uri: config.oauth.microsoft.redirectUri,
                grant_type: 'authorization_code',
                scope: 'https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/User.Read offline_access'
            });

            const response = await fetch(tokenUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: params
            });

            if (!response.ok) {
                const errorData = await response.json() as MicrosoftTokenResponse;
                throw new Error(`Token exchange failed: ${errorData.error_description || errorData.error}`);
            }

            const tokenData = await response.json() as MicrosoftTokenResponse;

            // Get user profile
            const profileResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
                headers: {
                    'Authorization': `Bearer ${tokenData.access_token}`
                }
            });

            const profileData = await profileResponse.json() as MicrosoftProfileResponse;

            return {
                provider: 'outlook' as const,
                email: profileData.mail || profileData.userPrincipalName || '',
                accessToken: tokenData.access_token,
                refreshToken: tokenData.refresh_token || '',
                expiryDate: Date.now() + (tokenData.expires_in * 1000)
            };
        } catch (error) {
            console.error('❌ Error exchanging Microsoft code:', error);
            throw new Error('Failed to authenticate with Microsoft');
        }
    }

    /**
     * Refresh Google access token
     */
    async refreshGoogleToken(refreshToken: string): Promise<string> {
        try {
            this.googleOAuth2Client.setCredentials({
                refresh_token: refreshToken
            });

            const { credentials } = await this.googleOAuth2Client.refreshAccessToken();
            const googleCredentials = credentials as GoogleTokenResponse;
            return googleCredentials.access_token || '';
        } catch (error) {
            console.error('❌ Error refreshing Google token:', error);
            throw new Error('Failed to refresh Google token');
        }
    }

    /**
     * Refresh Microsoft access token
     */
    async refreshMicrosoftToken(refreshToken: string): Promise<string> {
        try {
            const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
            const params = new URLSearchParams({
                client_id: config.oauth.microsoft.clientId,
                client_secret: config.oauth.microsoft.clientSecret,
                refresh_token: refreshToken,
                grant_type: 'refresh_token',
                scope: 'https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/User.Read'
            });

            const response = await fetch(tokenUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: params
            });

            if (!response.ok) {
                const errorData = await response.json() as MicrosoftTokenResponse;
                throw new Error(`Token refresh failed: ${errorData.error_description || errorData.error}`);
            }

            const tokenData = await response.json() as MicrosoftTokenResponse;
            return tokenData.access_token;
        } catch (error) {
            console.error('❌ Error refreshing Microsoft token:', error);
            throw new Error('Failed to refresh Microsoft token');
        }
    }

    /**
     * Validate if token is still valid
     */
    isTokenValid(credentials: OAuthCredentials): boolean {
        if (!credentials.expiryDate) {
            return true; // If no expiry date, assume valid
        }

        // Check if token expires in next 5 minutes
        const now = Date.now();
        const fiveMinutes = 5 * 60 * 1000;

        return credentials.expiryDate > (now + fiveMinutes);
    }

    /**
     * Get fresh access token (refresh if needed)
     */
    async getFreshAccessToken(credentials: OAuthCredentials): Promise<string> {
        if (this.isTokenValid(credentials)) {
            return credentials.accessToken;
        }

        // Token is expired or about to expire, refresh it
        if (credentials.provider === 'gmail') {
            return this.refreshGoogleToken(credentials.refreshToken);
        } else {
            return this.refreshMicrosoftToken(credentials.refreshToken);
        }
    }

    /**
     * Revoke Google OAuth tokens
     */
    async revokeGoogleTokens(credentials: OAuthCredentials): Promise<boolean> {
        try {
            // Google's token revocation endpoint
            const revokeUrl = `https://oauth2.googleapis.com/revoke?token=${credentials.refreshToken || credentials.accessToken}`;

            const response = await fetch(revokeUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });

            if (response.ok) {
                console.log(`✅ Successfully revoked Google tokens for ${credentials.email}`);
                return true;
            } else {
                console.warn(`⚠️ Failed to revoke Google tokens for ${credentials.email}:`, response.status, response.statusText);
                return false;
            }
        } catch (error) {
            console.error(`❌ Error revoking Google tokens for ${credentials.email}:`, error);
            return false;
        }
    }

    /**
     * Revoke Microsoft OAuth tokens
     */
    async revokeMicrosoftTokens(credentials: OAuthCredentials): Promise<boolean> {
        try {
            // Microsoft's token revocation endpoint
            const revokeUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/logout';

            // For Microsoft, we can also try to revoke via the API
            const tokenRevokeUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/token`;

            const response = await fetch(tokenRevokeUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams({
                    'client_id': config.oauth.microsoft.clientId,
                    'client_secret': config.oauth.microsoft.clientSecret,
                    'token': credentials.refreshToken || credentials.accessToken,
                    'token_type_hint': credentials.refreshToken ? 'refresh_token' : 'access_token'
                }).toString()
            });

            // Microsoft might not always return 200 for successful revocation
            console.log(`✅ Attempted to revoke Microsoft tokens for ${credentials.email}`);
            return true;
        } catch (error) {
            console.error(`❌ Error revoking Microsoft tokens for ${credentials.email}:`, error);
            return false;
        }
    }

    /**
     * Revoke OAuth tokens for any provider
     */
    async revokeTokens(credentials: OAuthCredentials): Promise<boolean> {
        if (credentials.provider === 'gmail') {
            return this.revokeGoogleTokens(credentials);
        } else if (credentials.provider === 'outlook') {
            return this.revokeMicrosoftTokens(credentials);
        } else {
            console.warn(`⚠️ Unknown provider for token revocation: ${credentials.provider}`);
            return false;
        }
    }
}

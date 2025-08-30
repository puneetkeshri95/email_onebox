import { Router } from 'express';
import axios from 'axios';
import path from 'path';
import { config } from '../config/config';

// Import the in-memory account store functions
import { getAccountById, setAccount } from '../services/account.store';

const router = Router();

/**
 * @route GET /api/slack/install
 * @description Redirects the user to Slack to authorize the app.
 * It passes the internal accountId via the 'state' parameter to identify
 * the user upon their return.
 * @query {string} accountId - The unique ID of the user's email account.
 */
router.get('/install', (req, res) => {
    const accountId = req.query.accountId as string;

    // Validate that an accountId was provided
    if (!accountId) {
        return res.status(400).send('Error: A unique accountId must be provided to install the Slack app.');
    }

    const slackAuthUrl = `https://slack.com/oauth/v2/authorize?client_id=${process.env.SLACK_CLIENT_ID}&scope=incoming-webhook&redirect_uri=${process.env.SLACK_REDIRECT_URI}&state=${accountId}`;
    res.redirect(slackAuthUrl);
});

/**
 * @route GET /api/slack/callback
 * @description The endpoint Slack redirects to after a user authorizes the app.
 * It exchanges the temporary code for a permanent webhook URL and saves it
 * to the database for the account identified by the 'state' parameter.
 */
router.get('/callback', async (req, res) => {
    const tempCode = req.query.code as string;
    const accountId = req.query.state as string; // Retrieve the accountId from state

    // Validate that the state parameter (accountId) is present
    if (!accountId) {
        console.error('❌ Slack callback error: The "state" parameter is missing.');
        return res.status(400).sendFile(path.join(__dirname, '../../public/oauth-error.html'));
    }

    try {
        // Exchange the temporary code for an access token and webhook
        const response = await axios.post('https://slack.com/api/oauth.v2.access', null, {
            params: {
                code: tempCode,
                client_id: config.slack.clientId,
                client_secret: config.slack.clientSecret,
                redirect_uri: config.slack.redirectUri,
            },
        });

        // Check for errors from Slack's API
        if (!response.data.ok) {
            throw new Error(response.data.error || 'An unknown error occurred during Slack authentication.');
        }

        const { url: webhook_url, channel } = response.data.incoming_webhook;

        // **CRITICAL STEP**: Store the webhook_url in the in-memory account store
        const account = getAccountById(accountId);
        if (!account) {
            throw new Error(`Account not found: ${accountId}`);
        }

        // Update the account with the Slack webhook URL
        const updatedAccount = {
            ...account,
            slackWebhookUrl: webhook_url
        };
        setAccount(accountId, updatedAccount);

        console.log(`✅ Successfully stored Slack webhook for account ${accountId} in channel: ${channel}`);
        res.sendFile(path.join(__dirname, '../../public/oauth-success.html'));

    } catch (error) {
        const errorMessage = (error as any).response?.data?.error || (error as Error).message || 'Unknown error occurred';
        console.error(`❌ Slack OAuth error for account ${accountId}:`, errorMessage);
        res.status(500).sendFile(path.join(__dirname, '../../public/oauth-error.html'));
    }
});

export default router;

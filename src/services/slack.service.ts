import axios from 'axios';
import { Email } from '../models/types';

/**
 * A stateless service for sending notifications to Slack via Incoming Webhooks.
 * This service does not hold any state and requires the specific webhook URL 
 * to be passed into its methods for each call.
 */
export class SlackService {
    /**
     * The constructor is empty as the service is stateless.
     */
    constructor() { }

    /**
     * Sends a formatted email notification to a specific Slack webhook URL.
     * @param webhookUrl The unique, user-specific webhook URL obtained via the OAuth flow.
     * @param email The email object to be formatted and sent.
     */
    async sendNotification(webhookUrl: string, email: Email): Promise<void> {
        // Validate that a webhook URL was provided for this specific notification.
        if (!webhookUrl) {
            console.log('📢 Webhook URL not provided for this account, skipping notification.');
            return;
        }

        try {
            // Generate the rich message payload using the private formatter method.
            const messagePayload = this.formatSlackMessage(email);

            // POST the payload directly to the user-specific webhook URL.
            // Note: The `channel` property is not needed in the payload because
            // the webhook URL itself is already tied to a specific channel.
            await axios.post(webhookUrl, {
                username: 'Email Onebox Bot',
                icon_emoji: ':email:',
                text: messagePayload.text, // Fallback text for notifications
                attachments: messagePayload.attachments,
            });

            console.log(`✅ Slack notification sent for email: ${email.subject}`);
        } catch (error) {
            // Log the detailed error from Slack's API if available, otherwise log the general error message.
            const errorMessage = (error as any).response?.data || (error as Error).message || 'Unknown error occurred';
            console.error('❌ Error sending Slack notification:', errorMessage);
            // We do not re-throw the error here to prevent it from crashing a larger process,
            // such as a background email synchronization task.
        }
    }

    /**
     * Formats an email object into a rich Slack message attachment.
     * This is a private helper method combining the best formatting from both versions.
     * @param email The email data to format.
     * @returns A Slack message payload object with formatted text and attachments.
     */
    private formatSlackMessage(email: Email): { text: string; attachments: any[] } {
        const accountName = email.accountId.includes('gmail') ? 'Gmail' : 'Outlook';

        return {
            text: `🎯 New "Interested" Email Received from ${email.from}!`,
            attachments: [
                {
                    color: '#2eb886', // A pleasant green color for "interested" emails
                    fields: [
                        { title: 'From', value: email.from, short: true },
                        { title: 'Account', value: accountName, short: true },
                        { title: 'Subject', value: email.subject, short: false },
                        { title: 'Date', value: new Date(email.date).toLocaleString(), short: true },
                        { title: 'AI Confidence', value: `${Math.round((email.aiConfidence || 0) * 100)}%`, short: true },
                        {
                            title: 'Preview',
                            value: email.body.substring(0, 250) + (email.body.length > 250 ? '...' : ''),
                            short: false,
                        },
                    ],
                    footer: 'Email Onebox AI',
                    ts: Math.floor(new Date(email.date).getTime() / 1000),
                },
            ],
        };
    }

    /**
     * Sends a custom message to a specific Slack webhook URL.
     * @param webhookUrl The unique, user-specific webhook URL.
     * @param message The custom message text to send.
     */
    async sendCustomMessage(webhookUrl: string, message: string): Promise<void> {
        if (!webhookUrl) {
            console.log('📢 Webhook URL not provided for this account, skipping custom message.');
            return;
        }

        try {
            await axios.post(webhookUrl, {
                username: 'Email Onebox Bot',
                icon_emoji: ':robot_face:',
                text: message,
            });

            console.log('✅ Custom Slack message sent');
        } catch (error) {
            const errorMessage = (error as any).response?.data || (error as Error).message || 'Unknown error occurred';
            console.error('❌ Error sending custom Slack message:', errorMessage);
        }
    }

    /**
     * Sends email statistics report to a specific Slack webhook URL.
     * @param webhookUrl The unique, user-specific webhook URL.
     * @param stats The email statistics object containing totals and breakdowns.
     */
    async sendEmailStats(webhookUrl: string, stats: {
        total: number;
        byCategory: Record<string, number>;
        byAccount: Record<string, number>;
    }): Promise<void> {
        if (!webhookUrl) {
            console.log('📢 Webhook URL not provided for this account, skipping stats report.');
            return;
        }

        try {
            const messagePayload = this.formatStatsMessage(stats);

            await axios.post(webhookUrl, {
                username: 'Email Onebox Bot',
                icon_emoji: ':bar_chart:',
                text: '📊 Email Statistics Report',
                attachments: [messagePayload],
            });

            console.log('✅ Email stats sent to Slack');
        } catch (error) {
            const errorMessage = (error as any).response?.data || (error as Error).message || 'Unknown error occurred';
            console.error('❌ Error sending email stats to Slack:', errorMessage);
        }
    }

    /**
     * Formats email statistics into a rich Slack message attachment.
     * @param stats The statistics object to format.
     * @returns A Slack attachment object with formatted statistics.
     */
    private formatStatsMessage(stats: {
        total: number;
        byCategory: Record<string, number>;
        byAccount: Record<string, number>;
    }): any {
        const categoryFields = Object.entries(stats.byCategory).map(([category, count]) => ({
            title: category.replace('_', ' ').toUpperCase(),
            value: count.toString(),
            short: true,
        }));

        const accountFields = Object.entries(stats.byAccount).map(([account, count]) => ({
            title: account.includes('gmail') ? 'Gmail' : 'Outlook',
            value: count.toString(),
            short: true,
        }));

        return {
            color: '#36a64f', // Info blue color for statistics
            fields: [
                {
                    title: 'Total Emails',
                    value: stats.total.toString(),
                    short: false,
                },
                ...categoryFields,
                {
                    title: '\n\nBy Account',
                    value: ' ',
                    short: false,
                },
                ...accountFields,
            ],
            footer: 'Email Onebox Statistics',
            ts: Math.floor(Date.now() / 1000),
        };
    }
}
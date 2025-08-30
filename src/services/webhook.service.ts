import axios from 'axios';
import { config } from '../config/config';
import { Email } from '../models/types';

export class WebhookService {
    private webhookUrl: string;

    constructor() {
        this.webhookUrl = config.externalWebhook.url;
        if (!this.webhookUrl) {
            console.warn('⚠️ External webhook URL not configured');
        }
    }

    async triggerWebhook(email: Email): Promise<void> {
        if (!this.webhookUrl) {
            console.log('🔗 External webhook not configured, skipping trigger');
            return;
        }

        try {
            const payload = this.formatWebhookPayload(email);

            const response = await axios.post(this.webhookUrl, payload, {
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'EmailOnebox/1.0',
                },
                timeout: 10000, // 10 second timeout
            });

            console.log(`✅ Webhook triggered successfully for email: ${email.subject}`);
            console.log(`📡 Response status: ${response.status}`);
        } catch (error) {
            console.error('❌ Error triggering webhook:', error);

            // Don't throw error to prevent breaking the email processing flow
            if (axios.isAxiosError(error)) {
                console.error(`📡 Webhook failed with status: ${error.response?.status}`);
                console.error(`📡 Webhook error message: ${error.message}`);
            }
        }
    }

    private formatWebhookPayload(email: Email): any {
        return {
            event: 'email.interested',
            timestamp: new Date().toISOString(),
            data: {
                email: {
                    id: email.id,
                    messageId: email.messageId,
                    accountId: email.accountId,
                    from: email.from,
                    to: email.to,
                    subject: email.subject,
                    date: email.date.toISOString(),
                    folder: email.folder,
                    aiCategory: email.aiCategory,
                    aiConfidence: email.aiConfidence,
                    preview: email.body.substring(0, 300),
                },
                metadata: {
                    processingTime: new Date().toISOString(),
                    source: 'email-onebox',
                    version: '1.0.0',
                },
            },
        };
    }

    async triggerCustomWebhook(event: string, data: any): Promise<void> {
        if (!this.webhookUrl) {
            console.log('🔗 External webhook not configured, skipping custom trigger');
            return;
        }

        try {
            const payload = {
                event,
                timestamp: new Date().toISOString(),
                data,
                metadata: {
                    source: 'email-onebox',
                    version: '1.0.0',
                },
            };

            const response = await axios.post(this.webhookUrl, payload, {
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'EmailOnebox/1.0',
                },
                timeout: 10000,
            });

            console.log(`✅ Custom webhook triggered: ${event}`);
            console.log(`📡 Response status: ${response.status}`);
        } catch (error) {
            console.error(`❌ Error triggering custom webhook for event: ${event}`, error);
        }
    }

    async sendBatchWebhook(emails: Email[]): Promise<void> {
        if (!this.webhookUrl || emails.length === 0) {
            return;
        }

        try {
            const payload = {
                event: 'emails.batch_processed',
                timestamp: new Date().toISOString(),
                data: {
                    emails: emails.map(email => ({
                        id: email.id,
                        from: email.from,
                        subject: email.subject,
                        aiCategory: email.aiCategory,
                        aiConfidence: email.aiConfidence,
                        date: email.date.toISOString(),
                    })),
                    count: emails.length,
                    interestedCount: emails.filter(e => e.aiCategory === 'interested').length,
                },
                metadata: {
                    source: 'email-onebox',
                    version: '1.0.0',
                },
            };

            const response = await axios.post(this.webhookUrl, payload, {
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'EmailOnebox/1.0',
                },
                timeout: 15000,
            });

            console.log(`✅ Batch webhook triggered for ${emails.length} emails`);
        } catch (error) {
            console.error('❌ Error triggering batch webhook:', error);
        }
    }

    async testWebhook(): Promise<boolean> {
        if (!this.webhookUrl) {
            console.log('🔗 No webhook URL configured to test');
            return false;
        }

        try {
            const testPayload = {
                event: 'webhook.test',
                timestamp: new Date().toISOString(),
                data: {
                    message: 'This is a test webhook from Email Onebox',
                    test: true,
                },
                metadata: {
                    source: 'email-onebox',
                    version: '1.0.0',
                },
            };

            const response = await axios.post(this.webhookUrl, testPayload, {
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'EmailOnebox/1.0',
                },
                timeout: 10000,
            });

            console.log(`✅ Webhook test successful: ${response.status}`);
            return response.status >= 200 && response.status < 300;
        } catch (error) {
            console.error('❌ Webhook test failed:', error);
            return false;
        }
    }
}

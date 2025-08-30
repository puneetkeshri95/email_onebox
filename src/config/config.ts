import dotenv from 'dotenv';

dotenv.config();

export const config = {
    port: process.env.PORT || 3001,
    nodeEnv: process.env.NODE_ENV || 'development',

    // Email Configuration
    gmail: {
        username: process.env.GMAIL_USERNAME || '',
        password: process.env.GMAIL_PASSWORD || '',
        imapConfig: {
            host: 'imap.gmail.com',
            port: 993,
            secure: true,
        },
    },

    outlook: {
        username: process.env.OUTLOOK_USERNAME || '',
        password: process.env.OUTLOOK_PASSWORD || '',
        imapConfig: {
            host: 'outlook.office365.com',
            port: 993,
            secure: true,
        },
    },

    // Email Sync Configuration
    emailSync: {
        // Number of days to sync emails (changed to 30 days max)
        syncDays: parseInt(process.env.EMAIL_SYNC_DAYS || '30'),
        // Maximum emails to fetch per sync (increased for better coverage)
        maxEmails: parseInt(process.env.MAX_EMAILS_PER_SYNC || '2000'),
        // Maximum emails to fetch in initial quick sync (increased to show more emails immediately)
        initialSyncLimit: parseInt(process.env.INITIAL_SYNC_LIMIT || '500'),
        // Maximum emails to fetch in background batches (increased for better performance)
        backgroundBatchSize: parseInt(process.env.BACKGROUND_BATCH_SIZE || '500'),
    },
    //
    // Elasticsearch Configuration
    elasticsearch: {
        url: process.env.ELASTICSEARCH_URL!,
        index: process.env.ELASTICSEARCH_INDEX || 'emails',
        apiKey: process.env.ELASTICSEARCH_API_KEY!
    },

    // Slack Configuration
    slack: {
        webhookUrl: process.env.SLACK_WEBHOOK_URL || '',
        channel: process.env.SLACK_CHANNEL || '#general',
        clientId: process.env.SLACK_CLIENT_ID || '',
        clientSecret: process.env.SLACK_CLIENT_SECRET || '',
        redirectUri: process.env.SLACK_REDIRECT_URI || 'http://localhost:3001/api/slack/callback',
    },

    // External Webhook Configuration
    externalWebhook: {
        url: process.env.EXTERNAL_WEBHOOK_URL || '',
    },

    // AI Configuration
    huggingface: {
        apiKey: process.env.HUGGINGFACE_API_KEY || '',
    },

    // Groq AI Configuration  
    groq: {
        apiKey: process.env.GROQ_API_KEY || '',
    },

    // ChromaDB Configuration
    chromadb: {
        url: process.env.CHROMADB_URL, // Full URL for Railway (takes precedence if provided)
        ssl: process.env.CHROMADB_SSL === 'true',
    },

    // RAG Configuration
    rag: {
        productDescription: process.env.PRODUCT_DESCRIPTION || 'Job application assistant',
        meetingLink: process.env.MEETING_LINK || 'https://cal.com/example',
    },

    // OAuth Configuration
    oauth: {
        google: {
            clientId: process.env.GOOGLE_CLIENT_ID || '',
            clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
            redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/auth/google/callback',
        },
        microsoft: {
            clientId: process.env.MICROSOFT_CLIENT_ID || '',
            clientSecret: process.env.MICROSOFT_CLIENT_SECRET || '',
            redirectUri: process.env.MICROSOFT_REDIRECT_URI || 'http://localhost:3001/auth/microsoft/callback',
            tenantId: process.env.MICROSOFT_TENANT_ID || 'common',
        },
    },

    // Session Configuration
    session: {
        secret: process.env.SESSION_SECRET || 'your-super-secret-session-key',
        secure: process.env.NODE_ENV === 'production',
    },
};

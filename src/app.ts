import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import session from 'express-session';
import path from 'path';
import { config } from './config/config';
import { ElasticsearchService } from './services/elasticsearch.service';
import { EnhancedRAGService } from './services/enhanced-rag.service';
import emailRoutes from './routes/email.routes';
import aiRoutes from './routes/ai.routes'; // Fixed attachment mapping
import authRoutes from './routes/auth.routes';
import slackRoutes from './routes/slack.routes';
import attachmentRoutes from './routes/attachment.routes';
import sendRoutes from './routes/send.routes';
import { imapRoutes } from './routes/imap.routes';
import ragRoutes from './routes/rag.routes';
import { initializeAccountsIndex } from './services/account.store';


class EmailOneboxApp {
    private app: express.Application;
    private elasticsearchService: ElasticsearchService;
    private ragService: EnhancedRAGService;

    constructor() {
        this.app = express();
        this.elasticsearchService = new ElasticsearchService();
        this.ragService = new EnhancedRAGService();
        initializeAccountsIndex();
        this.initializeMiddleware();
        this.initializeRoutes();
        this.setupEventListeners();
    }

    private setupEventListeners(): void {
        console.log('✅ OAuth-based email system ready');
        console.log('📧 Use the frontend to connect your email accounts via OAuth');
        console.log('🔗 Google OAuth: /api/auth/google');
        console.log('🔗 Microsoft OAuth: /api/auth/microsoft');
    }

    private initializeMiddleware(): void {
        // Security middleware with custom CSP for email images
        this.app.use(helmet({
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    styleSrc: ["'self'", "'unsafe-inline'"],
                    scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-hashes'"],
                    scriptSrcAttr: ["'unsafe-inline'"], // Allow inline event handlers
                    imgSrc: ["'self'", "data:", "https:", "http:"], // Allow external images for email content
                    fontSrc: ["'self'", "data:", "https:"],
                    connectSrc: ["'self'", "*"], // Allow connections to any origin (for dev tunnels)
                    frameSrc: ["'self'"],
                    objectSrc: ["'none'"],
                    mediaSrc: ["'self'"],
                    childSrc: ["'self'"]
                }
            }
        }));
        this.app.use(cors());

        // Session middleware for OAuth
        this.app.use(session({
            secret: config.session.secret,
            resave: false,
            saveUninitialized: false,
            cookie: {
                secure: config.session.secure,
                maxAge: 24 * 60 * 60 * 1000, // 24 hours
                httpOnly: true
            }
        }));

        // Logging middleware
        this.app.use(morgan('combined'));

        // Body parsing middleware
        this.app.use(express.json({ limit: '10mb' }));
        this.app.use(express.urlencoded({ extended: true }));

        // Static files for frontend
        this.app.use(express.static(path.join(__dirname, '../public')));

        console.log('✅ Middleware initialized');
    }

    private initializeRoutes(): void {
        // API routes
        this.app.use('/api/emails', emailRoutes);
        this.app.use('/api/ai', aiRoutes);
        this.app.use('/api/auth', authRoutes);
        this.app.use('/api/slack', slackRoutes);
        this.app.use('/api/attachments', attachmentRoutes);
        this.app.use('/api/send', sendRoutes);
        this.app.use('/api/imap', imapRoutes);
        this.app.use('/api/rag', ragRoutes);
        
        // Health check endpoint
        this.app.get('/api/health', (req, res) => {
            res.json({
                status: 'healthy',
                timestamp: new Date().toISOString(),
                version: '1.0.0',
            });
        });

        // Onboarding page route
        this.app.get('/onboarding.html', (req, res) => {
            res.sendFile(path.join(__dirname, '../public/onboarding.html'));
        });

        // Serve frontend
        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, '../public/index.html'));
        });

        // 404 handler for unknown routes
        this.app.use('*', (req, res) => {
            res.status(404).json({
                error: 'Not found',
                message: 'The requested resource was not found',
            });
        });

        console.log('✅ Routes initialized');
    }

    public async start(): Promise<void> {
        try {
            const port = config.port;

            this.app.listen(port, () => {
                console.log(`🚀 Email Onebox server started on port ${port}`);
                console.log(`📱 Frontend available at: http://localhost:${port}`);
                console.log(`🔗 API available at: http://localhost:${port}/api`);
                console.log(`💊 Health check at: http://localhost:${port}/api/health`);
            });
        } catch (error) {
            console.error('❌ Error starting server:', error);
            process.exit(1);
        }
    }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Received SIGINT, shutting down gracefully...');
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
    process.exit(0);
});

// Start the application
const app = new EmailOneboxApp();
app.start().catch((error) => {
    console.error('❌ Failed to start Email Onebox:', error);
    process.exit(1);
});

export default EmailOneboxApp;

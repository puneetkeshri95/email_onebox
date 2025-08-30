# 📧 Email Onebox - Feature-Rich Email Management System

A comprehensive email management system built with TypeScript and Node.js that provides real-time IMAP synchronization, AI-powered categorization, and intelligent reply suggestions.

## ⚠️ Important Warnings & Known Issues

> **Please read these warnings carefully before using the application**

### 🔄 **OAuth Authentication Flow**
⚠️ **Known Issue**: When signing in with Google/Outlook through the onboarding page, the page may not automatically wait for authentication completion. 

**Workaround**: If the onboarding page doesn't redirect automatically after successful authentication:
1. Manually navigate to `multi-email.onrender.com` (remove `/onboarding.html` from the URL)
2. Or simply refresh the page after authentication
3. Your account should be connected and emails will start syncing

### ⏱️ **Initial Email Synchronization**
⚠️ **Important**: After signing in, please wait **at least 5 minutes** for the initial email synchronization to complete.

**What to expect**:
- The system fetches up to 30 days of email history
- Initial sync happens in the background
- Press the **reload button** after 5 minutes to see all synchronized emails
- Larger inboxes may take longer to fully sync

### 🔄 **Email Visibility & Real-time Updates**
⚠️ **Note**: Sometimes emails might not be immediately visible due to sync timing.

**Solutions**:
- **Simple reload**: If emails don't appear, refresh the page
- **New email delay**: When you receive a new email, wait **up to 1 minute** for it to appear
- **Automated service**: The system uses real-time IMAP connections (not cron jobs) with natural latency
- **Network dependent**: Sync speed depends on email server response times

### 🌐 **Production Deployment**
⚠️ **URL Note**: When deployed on Render, access the application at `multi-email.onrender.com` (not localhost:3001)

---

## ✨ Features

### 🔄 **Real-Time Email Synchronization**
- Synchronizes multiple IMAP accounts (Gmail & Outlook) in real-time using OAuth2
- Uses ImapFlow with persistent IMAP connections in IDLE mode (no cron jobs!)
- Fetches up to 30 days of email history with configurable limits
- Progressive loading strategy for better performance

### 🔍 **Elasticsearch-Powered Search**
- Locally hosted Elasticsearch for fast email indexing
- Full-text search across subject, body, sender, and recipients
- Advanced filtering by account, folder, category, and date range
- Optimized for performance with bulk indexing and duplicate detection

### 🤖 **AI-Powered Email Categorization**
- Automatic email classification into 5 categories:
  - 🎯 **Interested** - Positive responses, interview requests
  - 📅 **Meeting Booked** - Confirmed appointments and meetings
  - ❌ **Not Interested** - Rejections and declined opportunities
  - 🚫 **Spam** - Unwanted promotional emails
  - 🏖️ **Out of Office** - Automatic replies and vacation messages
- Uses Groq AI with rule-based fallback for reliable classification
- Confidence scoring for each classification

### 📢 **Slack & Webhook Integration**
- Instant Slack notifications for "Interested" emails
- Configurable webhook triggers for external automation
- Rich message formatting with email metadata
- Batch processing support for high-volume scenarios

### 💡 **RAG-Powered AI Reply Suggestions**
- ChromaDB vector database for context storage
- Template-based reply generation with personalization
- Context-aware responses based on email content
- Customizable templates and meeting link integration
- Confidence scoring for suggested replies

### 🎨 **Interactive Web Interface**
- Clean, responsive vanilla HTML/CSS/JS frontend
- Real-time email updates without page refresh
- Advanced search and filtering capabilities
- OAuth2-based account connection for secure authentication
- Mobile-friendly responsive design with proper security headers

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ and npm 8+
- Docker (for Elasticsearch)
- Gmail and/or Outlook email accounts with app passwords

### 1. Clone and Setup
```bash
git clone <repository-url>
cd email-onebox
npm install
```

### 2. Environment Configuration
```bash
# Copy example environment file
npm run setup:env

# Edit .env file with your credentials
# - OAuth credentials for Gmail/Outlook
# - Slack webhook URL
# - Groq API key for AI classification
# - External webhook URL (webhook.site)
```

### 3. Start Docker Services
```bash
# Start Elasticsearch and ChromaDB with Docker
npm run docker:start-all

# Verify Elasticsearch is running
curl http://localhost:9200/_cluster/health

# Verify ChromaDB is running
curl http://localhost:8000/api/v1/heartbeat
```

### 4. Configure Email Accounts

#### OAuth Setup:
1. **Google Account Setup**:
   - Create a Google Cloud project
   - Configure OAuth consent screen
   - Create OAuth client ID credentials
   - Add authorized redirect URIs: `http://localhost:3001/api/auth/google/callback`
   - Add client ID and secret to .env file

2. **Microsoft Account Setup**:
   - Register an application in Azure portal
   - Configure platform with redirect URI: `http://localhost:3001/api/auth/microsoft/callback`
   - Add permissions for IMAP access
   - Add client ID and secret to .env file

3. **Application OAuth Flow**:
   - Use the onboarding UI to connect your accounts
   - Grant the app permission to access your email
   - Account will be automatically connected via OAuth

### 5. Slack Integration Setup
1. Create a Slack webhook:
   - Go to https://api.slack.com/messaging/webhooks
   - Create a new webhook for your workspace
   - Copy the webhook URL to your `.env` file

### 6. External Webhook Setup
1. Visit https://webhook.site
2. Copy your unique webhook URL
3. Add it to your `.env` file as `EXTERNAL_WEBHOOK_URL`

### 7. Start the Application
```bash
# Development mode with hot reload
npm run dev

# Production mode
npm run build
npm start
```

### 8. Access the Application
- **Frontend**: http://localhost:3001
- **API**: http://localhost:3001/api
- **Health Check**: http://localhost:3001/api/health
- **Onboarding Page**: http://localhost:3001/onboarding.html

## 📚 API Documentation

### Core Endpoints

#### Email Management
```http
GET /api/emails
# Query parameters:
# - q: Search query
# - account: Filter by account ID
# - category: Filter by AI category
# - dateFrom: Start date filter
# - dateTo: End date filter
# - limit: Number of results (default: 50)

GET /api/emails/:id
# Get specific email details

POST /api/emails/:id/reply
# Generate AI-powered reply suggestion

PUT /api/emails/:id
# Update email metadata
```

#### Authentication & Account Management
```http
GET /api/auth/status
# Get current authentication status and connected accounts

GET /api/auth/providers
# Get list of available OAuth providers

GET /api/auth/google
# Start Google OAuth2 flow

GET /api/auth/microsoft
# Start Microsoft OAuth2 flow

GET /api/auth/accounts
# List all connected email accounts

POST /api/auth/logout
# Sign out current user

DELETE /api/auth/accounts/:accountId
# Remove email account and revoke tokens

POST /api/auth/accounts/:accountId/toggle
# Toggle account active status
```

#### Email Statistics & Categories
```http
GET /api/emails/stats
# Get email statistics by category and account

GET /api/emails/categories
# Get available email categories with metadata

GET /api/emails/count
# Get total email count

POST /api/emails/resync
# Trigger manual resync for all accounts

POST /api/emails/reset-index
# Reset Elasticsearch index (admin function)
```

## 🔧 Configuration

### Environment Variables (.env)
```bash
# Server Configuration
NODE_ENV=development
PORT=3001

# OAuth Configuration
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3001/api/auth/google/callback

MICROSOFT_CLIENT_ID=your_microsoft_client_id
MICROSOFT_CLIENT_SECRET=your_microsoft_client_secret
MICROSOFT_REDIRECT_URI=http://localhost:3001/api/auth/microsoft/callback
MICROSOFT_TENANT_ID=common

# Elasticsearch
ELASTICSEARCH_URL=http://localhost:9200
ELASTICSEARCH_INDEX=emails

# ChromaDB
CHROMADB_HOST=localhost
CHROMADB_PORT=8000
CHROMADB_SSL=false

# Slack Integration
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK
SLACK_CHANNEL=#general

# External Webhook
EXTERNAL_WEBHOOK_URL=https://webhook.site/your-unique-url

# AI Configuration
GROQ_API_KEY=your_groq_api_key

# RAG Configuration
PRODUCT_DESCRIPTION="Job application assistant"
MEETING_LINK=https://cal.com/example

# Session Configuration
SESSION_SECRET=your-super-secret-session-key
```

## 🏗️ Architecture

### Backend Services
- **ImapFlowService**: Real-time email synchronization with OAuth2 and IDLE mode
- **ElasticsearchService**: Email indexing and search functionality
- **AIService**: Email classification using Groq AI with rule-based fallback
- **RAGService**: Template-based reply generation with ChromaDB vector storage
- **SlackService**: Slack notification handling with rich formatting
- **WebhookService**: External webhook integration
- **OAuthService**: Secure account connection via OAuth2
- **EmailContentProcessorService**: HTML sanitization and attachment handling

### Frontend Components
- **Email Dashboard**: Real-time email display with categorization
- **Account Onboarding**: OAuth2 connection flow for email accounts
- **Search & Filtering**: Advanced email search with multiple filters
- **Email Detail**: Comprehensive email view with AI suggestions
- **Secure Content Display**: Sanitized HTML rendering with security headers

### Data Flow
1. **OAuth Authentication**: Secure account connection with refresh token support
2. **Email Sync**: ImapFlow fetches emails in real-time with IDLE mode
3. **Content Processing**: Attachments and HTML content securely processed
4. **AI Processing**: Emails classified using Groq AI or rule-based fallback
5. **Storage**: Emails indexed in Elasticsearch with duplicate detection
6. **Notifications**: "Interested" emails trigger Slack/webhook notifications
7. **RAG Processing**: Context stored in ChromaDB for template-based replies

## 🧪 Testing with Postman

### 1. Health Check
```http
GET http://localhost:3001/api/health
```

### 2. Search Emails
```http
GET http://localhost:3001/api/emails?q=interview&category=interested&limit=10
```

### 3. Get Email Details
```http
GET http://localhost:3001/api/emails/gmail-123
```

### 4. Generate AI Reply
```http
POST http://localhost:3001/api/emails/gmail-123/reply
```

### 5. List Connected Accounts
```http
GET http://localhost:3001/api/imap/accounts
```

### 6. Check Account Status
```http
GET http://localhost:3001/api/imap/status
```

### 7. Send Email
```http
POST http://localhost:3001/api/send
Content-Type: application/json

{
  "to": ["recipient@example.com"],
  "subject": "Interview Follow-up",
  "body": "Thank you for the opportunity...",
  "accountId": "gmail-account-123"
}
```

## 🚀 Advanced Features

### OAuth-Based Authentication
- **Secure Authentication**: No password storage, uses OAuth2 tokens
- **Token Refresh**: Automatic refresh of expired access tokens
- **Multi-Account Support**: Connect multiple Gmail and Outlook accounts
- **Connection Management**: Monitor account status and reconnect as needed

### Email Classification
The AI service uses a hybrid approach:
1. **Groq AI Classification**: Fast, accurate language model classification
2. **Rule-based Fallback**: Keyword-based patterns when AI is unavailable
3. **Confidence Scoring**: Each classification includes confidence level
4. **Enhanced Patterns**: Continuously improved classification rules

### Secure Content Processing
- **HTML Sanitization**: Removes potentially harmful scripts and content
- **Attachment Storage**: Securely stores and serves email attachments
- **Image Handling**: Processes inline images with proper Content-ID mapping
- **Content Security Policy**: Strict CSP headers to prevent XSS attacks

### Progressive Sync Strategy
- **Initial Quick Sync**: Loads most recent emails first for immediate display
- **Background Processing**: Continues loading older emails in the background
- **Duplicate Detection**: Prevents duplicate emails during synchronization
- **Configurable Limits**: Adjustable sync depth and batch sizes

## 🔍 Troubleshooting

### Common Issues

#### OAuth Connection Issues
- **Invalid Credentials**: Verify client ID and secret are correct
- **Incorrect Redirect URI**: Must match exactly in OAuth provider settings
- **Token Expiration**: Check for token refresh errors in logs
- **Permission Scope**: Ensure IMAP scope is enabled in OAuth settings

#### IMAP Connection Errors
- **Connection Timeout**: Network issues or firewall blocking port 993
- **OAuth Token Invalid**: Token may have been revoked or expired
- **Rate Limiting**: Google/Microsoft may limit connection attempts
- **Account Settings**: Ensure IMAP access is enabled in the email account

#### Elasticsearch Issues
- **Connection Refused**: Verify Elasticsearch is running on port 9200
- **Memory Issues**: Adjust ES_JAVA_OPTS in Docker command
- **Index Errors**: Check Elasticsearch logs for mapping issues

#### AI Classification Problems
- **Groq API Issues**: Check API key and rate limits
- **Fallback Mode**: System will use rule-based classification if AI fails
- **Low Confidence**: Adjust confidence thresholds in AIService

### Logging and Monitoring
- All services include comprehensive logging with severity levels
- Health check endpoint returns detailed service status
- OAuth token status and refresh attempts are logged

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Implement your changes with tests
4. Submit a pull request with detailed description

## 📄 License

MIT License - see LICENSE file for details

## 🙏 Acknowledgments

- **ImapFlow**: Modern IMAP client for Node.js
- **Groq AI**: Fast, accurate AI classification models
- **Elasticsearch**: High-performance search functionality
- **ChromaDB**: Vector database for RAG functionality
- **OAuth2**: Secure email account authentication
- **Slack API**: Notification integration
- **Express.js**: Robust web server framework
- **Docker**: Container management for services

---

**📧 Email Onebox v1.0.0** - Built with ❤️ for efficient email management

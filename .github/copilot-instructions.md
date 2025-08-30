<!-- Use this file to provide workspace-specific custom instructions to Copilot. For more details, visit https://code.visualstudio.com/docs/copilot/copilot-customization#_use-a-githubcopilotinstructionsmd-file -->

# Feature-Rich Email Onebox - Copilot Instructions

This is a comprehensive email management system built with TypeScript and Node.js that includes:

## Architecture Overview
- **Backend**: TypeScript/Node.js with Express framework
- **Email Sync**: Real-time IMAP synchronization for Gmail and Outlook with IDLE mode
- **Search**: Elasticsearch for fast email indexing and searching
- **AI**: Hugging Face transformers for email classification
- **Vector DB**: ChromaDB for RAG-powered reply suggestions
- **Frontend**: Vanilla HTML/CSS/JS with interactive UI
- **Integrations**: Slack notifications and webhook triggers

## Key Features to Implement
1. Real-time IMAP email synchronization (no cron jobs)
2. Elasticsearch integration for searchable email storage
3. AI-based email categorization (Interested, Meeting Booked, Not Interested, Spam, Out of Office)
4. Slack notifications for "Interested" emails
5. Webhook triggers for external automation
6. RAG-powered AI reply suggestions using vector search

## Development Guidelines
- Use TypeScript with strict typing
- Implement proper error handling and logging
- Follow RESTful API design patterns
- Ensure real-time functionality with WebSockets or SSE
- Create clean, responsive frontend with vanilla JavaScript
- Implement proper security measures for email credentials
- Use Docker for Elasticsearch deployment

## Testing Strategy
- API testing with Postman
- Real-time synchronization validation
- AI model accuracy testing
- Frontend functionality testing

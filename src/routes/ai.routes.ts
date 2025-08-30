import { Router } from 'express';
import { EnhancedRAGService } from '../services/enhanced-rag.service';
import { AIService } from '../services/ai.service';

const router = Router();
const ragService = new EnhancedRAGService();
const aiService = new AIService();

// POST /api/ai/suggest-reply - Get AI suggested reply for an email
router.post('/suggest-reply', async (req, res) => {
    try {
        const { emailId, subject, body } = req.body;

        if (!subject && !body) {
            return res.status(400).json({
                success: false,
                error: 'Email subject or body is required',
            });
        }

        // Create a mock email object for the RAG service
        const email = {
            id: emailId || 'temp-id',
            messageId: 'temp-message-id',
            subject: subject || '',
            body: body || '',
            from: '',
            to: [],
            date: new Date(),
            accountId: '',
            folder: 'INBOX',
            flags: [],
            isHtml: false,
            hasExternalImages: false,
            hasAttachments: false,
            attachments: [],
            inlineImages: []
        };

        // Generate AI reply suggestions using Enhanced RAG
        const suggestion = await ragService.generateSuggestedReply(body || '', subject || '');

        res.json({
            success: true,
            suggestions: suggestion ? [suggestion] : [],
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        console.error('❌ Error generating AI reply suggestion:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to generate AI reply suggestion',
            message: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});

// POST /api/ai/classify - Classify an email
router.post('/classify', async (req, res) => {
    try {
        const { subject, body, from } = req.body;

        if (!subject && !body) {
            return res.status(400).json({
                success: false,
                error: 'Email subject or body is required',
            });
        }

        // Create a mock email object for classification
        const email = {
            id: 'temp-id',
            messageId: 'temp-message-id',
            subject: subject || '',
            body: body || '',
            from: from || '',
            to: [],
            date: new Date(),
            accountId: '',
            folder: 'INBOX',
            flags: [],
            isHtml: false,
            hasExternalImages: false,
            hasAttachments: false,
            attachments: [],
            inlineImages: []
        };

        // Classify the email
        const classification = await aiService.classifyEmail(email);

        res.json({
            success: true,
            data: classification,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        console.error('❌ Error classifying email:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to classify email',
            message: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});

export default router;

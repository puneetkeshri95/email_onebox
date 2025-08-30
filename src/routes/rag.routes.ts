import { Router, Request, Response } from 'express';
import { EnhancedRAGService, BusinessContext } from '../services/enhanced-rag.service';
import { isAuthenticated } from '../utils/session-utils';

const router = Router();
const ragService = new EnhancedRAGService();

/**
 * POST /api/rag/suggest-reply - Generate suggested reply for an email
 */
router.post('/suggest-reply', async (req: Request, res: Response) => {
    try {
        console.log('📥 Smart Replies request received:', {
            hasSession: !!req.session,
            hasUser: !!req.session?.user,
            bodyKeys: Object.keys(req.body || {}),
            userAgent: req.get('User-Agent')?.substring(0, 50)
        });

        if (!isAuthenticated(req)) {
            console.warn('⚠️ Unauthenticated Smart Replies request');
            return res.status(401).json({
                success: false,
                error: 'Authentication required',
                message: 'Please sign in to use suggested replies'
            });
        }

        const { emailText, emailSubject } = req.body;

        console.log('📧 Processing email for Smart Replies:', {
            hasEmailText: !!emailText,
            emailTextLength: emailText?.length || 0,
            hasSubject: !!emailSubject,
            subject: emailSubject || 'No subject'
        });

        if (!emailText) {
            console.warn('⚠️ Missing emailText in request body');
            return res.status(400).json({
                success: false,
                error: 'Invalid input',
                message: 'emailText is required'
            });
        }

        if (emailText.trim().length === 0) {
            console.warn('⚠️ Empty emailText provided');
            return res.status(400).json({
                success: false,
                error: 'Invalid input', 
                message: 'emailText cannot be empty'
            });
        }

        console.log('🤖 Generating suggested reply...');
        const suggestedReply = await ragService.generateSuggestedReply(emailText, emailSubject);

        res.json({
            success: true,
            data: {
                reply: suggestedReply.content,
                confidence: suggestedReply.confidence,
                usedContext: suggestedReply.usedContext.map(ctx => ({
                    id: ctx.id,
                    category: ctx.category,
                    content: ctx.content
                })),
                reasoning: suggestedReply.reasoning
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Error generating suggested reply:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to generate suggested reply',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * GET /api/rag/contexts - Get all business contexts
 */
router.get('/contexts', async (req: Request, res: Response) => {
    try {
        if (!isAuthenticated(req)) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required',
                message: 'Please sign in to view business contexts'
            });
        }

        const contexts = await ragService.getAllBusinessContexts();

        res.json({
            success: true,
            data: contexts,
            count: contexts.length,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Error fetching business contexts:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch business contexts',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * POST /api/rag/contexts - Create new business context
 */
router.post('/contexts', async (req: Request, res: Response) => {
    try {
        if (!isAuthenticated(req)) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required',
                message: 'Please sign in to create business contexts'
            });
        }

        const { content, category, keywords, priority } = req.body;

        if (!content || !category || !keywords) {
            return res.status(400).json({
                success: false,
                error: 'Invalid input',
                message: 'content, category, and keywords are required'
            });
        }

        const newContext: BusinessContext = {
            id: `context_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            content: content.trim(),
            category: category as BusinessContext['category'],
            keywords: Array.isArray(keywords) ? keywords : keywords.split(',').map((k: string) => k.trim()),
            priority: priority || 5,
            metadata: {
                createdAt: new Date(),
                updatedAt: new Date(),
                author: req.session?.user?.email || 'unknown',
                active: true
            }
        };

        await ragService.upsertBusinessContext(newContext);

        res.status(201).json({
            success: true,
            data: newContext,
            message: 'Business context created successfully',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Error creating business context:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create business context',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * PUT /api/rag/contexts/:id - Update business context
 */
router.put('/contexts/:id', async (req: Request, res: Response) => {
    try {
        if (!isAuthenticated(req)) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required',
                message: 'Please sign in to update business contexts'
            });
        }

        const { id } = req.params;
        const { content, category, keywords, priority, active } = req.body;

        const existingContext = await ragService.getBusinessContext(id);
        if (!existingContext) {
            return res.status(404).json({
                success: false,
                error: 'Context not found',
                message: `Business context with ID ${id} not found`
            });
        }

        const updatedContext: BusinessContext = {
            ...existingContext,
            content: content?.trim() || existingContext.content,
            category: category || existingContext.category,
            keywords: keywords ? (Array.isArray(keywords) ? keywords : keywords.split(',').map((k: string) => k.trim())) : existingContext.keywords,
            priority: priority !== undefined ? priority : existingContext.priority,
            metadata: {
                ...existingContext.metadata,
                updatedAt: new Date(),
                active: active !== undefined ? active : existingContext.metadata.active
            }
        };

        await ragService.upsertBusinessContext(updatedContext);

        res.json({
            success: true,
            data: updatedContext,
            message: 'Business context updated successfully',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Error updating business context:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update business context',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * DELETE /api/rag/contexts/:id - Delete business context
 */
router.delete('/contexts/:id', async (req: Request, res: Response) => {
    try {
        if (!isAuthenticated(req)) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required',
                message: 'Please sign in to delete business contexts'
            });
        }

        const { id } = req.params;

        const existingContext = await ragService.getBusinessContext(id);
        if (!existingContext) {
            return res.status(404).json({
                success: false,
                error: 'Context not found',
                message: `Business context with ID ${id} not found`
            });
        }

        await ragService.deleteBusinessContext(id);

        res.json({
            success: true,
            message: 'Business context deleted successfully',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Error deleting business context:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete business context',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * POST /api/rag/reload-contexts - Reload default business contexts (for testing)
 */
router.post('/reload-contexts', async (req: Request, res: Response) => {
    try {
        if (!isAuthenticated(req)) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required',
                message: 'Please sign in to reload contexts'
            });
        }

        await ragService.reloadDefaultContexts();

        res.json({
            success: true,
            message: 'Default business contexts reloaded successfully',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Error reloading business contexts:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to reload business contexts',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * GET /api/rag/health - Health check for RAG service
 */
router.get('/health', async (req: Request, res: Response) => {
    try {
        const health = await ragService.healthCheck();

        res.json({
            success: true,
            data: {
                status: 'operational',
                services: {
                    chromadb: health.chromadb ? 'connected' : 'disconnected',
                    gemini: health.gemini ? 'connected' : 'disconnected'
                },
                contextsLoaded: health.contextsLoaded,
                message: health.chromadb && health.gemini 
                    ? 'All services operational' 
                    : 'Some services unavailable - running in fallback mode'
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Error checking RAG service health:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to check service health',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

export default router;

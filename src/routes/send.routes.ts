import { Router, Request, Response } from 'express';
import { EmailSenderService, EmailDraft } from '../services/email-sender.service';
import { isAuthenticated, getUserAccountIds } from '../utils/session-utils';
import multer, { FileFilterCallback } from 'multer';
import path from 'path';

const router = Router();
const emailSenderService = new EmailSenderService();

// Configure multer for file uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 25 * 1024 * 1024, // 25MB max file size
        files: 10 // Max 10 attachments
    },
    fileFilter: (req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
        // Allow common file types
        const allowedTypes = /\.(jpg|jpeg|png|gif|pdf|doc|docx|txt|xlsx|xls|ppt|pptx|zip|rar)$/i;
        if (allowedTypes.test(path.extname(file.originalname))) {
            cb(null, true);
        } else {
            cb(new Error('File type not allowed'));
        }
    }
});

/**
 * POST /api/send/email - Send an email
 */
router.post('/email', upload.array('attachments'), async (req: Request, res: Response) => {
    try {
        // Check authentication
        if (!isAuthenticated(req)) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        const userAccountIds = getUserAccountIds(req);
        if (userAccountIds.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No email accounts connected'
            });
        }

        const {
            fromAccount,
            to,
            cc,
            bcc,
            subject,
            body,
            isHtml,
            priority,
            requestReadReceipt
        } = req.body;

        // Validate that the fromAccount belongs to the user
        if (!userAccountIds.includes(fromAccount)) {
            return res.status(403).json({
                success: false,
                error: 'You do not have permission to send from this account'
            });
        }

        // Parse email addresses
        const toAddresses = emailSenderService.parseEmailAddresses(to || '');
        const ccAddresses = cc ? emailSenderService.parseEmailAddresses(cc) : [];
        const bccAddresses = bcc ? emailSenderService.parseEmailAddresses(bcc) : [];

        // Create draft
        const draft: EmailDraft = {
            from: fromAccount,
            to: toAddresses,
            cc: ccAddresses,
            bcc: bccAddresses,
            subject: subject || '',
            body: body || '',
            isHtml: isHtml === 'true' || isHtml === true,
            priority: priority || 'normal',
            requestReadReceipt: requestReadReceipt === 'true' || requestReadReceipt === true
        };

        // Add attachments if any
        const files = req.files as Express.Multer.File[];
        if (files && Array.isArray(files)) {
            draft.attachments = files.map((file: Express.Multer.File) => ({
                filename: file.originalname,
                content: file.buffer,
                contentType: file.mimetype
            }));
        }

        // Validate draft
        const validation = emailSenderService.validateDraft(draft);
        if (!validation.isValid) {
            return res.status(400).json({
                success: false,
                error: 'Validation failed',
                errors: validation.errors
            });
        }

        // Send email
        const result = await emailSenderService.sendEmail(draft, fromAccount);

        if (result.success) {
            res.json({
                success: true,
                message: 'Email sent successfully',
                messageId: result.messageId,
                sentAt: result.sentAt,
                data: {
                    from: fromAccount,
                    to: toAddresses,
                    subject: subject,
                    attachmentCount: draft.attachments?.length || 0
                }
            });
        } else {
            res.status(500).json({
                success: false,
                error: result.error || 'Failed to send email'
            });
        }

    } catch (error) {
        console.error('❌ Error in send email route:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * GET /api/send/accounts - Get available sender accounts
 */
router.get('/accounts', async (req: Request, res: Response) => {
    try {
        if (!isAuthenticated(req)) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        const userAccountIds = getUserAccountIds(req);
        const availableAccounts = await emailSenderService.getAvailableSenders(userAccountIds);

        res.json({
            success: true,
            data: availableAccounts.map(account => ({
                id: account.id,
                email: account.email,
                provider: account.provider,
                isActive: account.isActive
            }))
        });

    } catch (error) {
        console.error('❌ Error getting sender accounts:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get sender accounts'
        });
    }
});

/**
 * POST /api/send/validate - Validate email draft
 */
router.post('/validate', async (req: Request, res: Response) => {
    try {
        if (!isAuthenticated(req)) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        const { to, cc, bcc, subject, body } = req.body;

        const draft: Partial<EmailDraft> = {
            to: emailSenderService.parseEmailAddresses(to || ''),
            cc: cc ? emailSenderService.parseEmailAddresses(cc) : [],
            bcc: bcc ? emailSenderService.parseEmailAddresses(bcc) : [],
            subject: subject || '',
            body: body || '',
            isHtml: false
        };

        const validation = emailSenderService.validateDraft(draft as EmailDraft);

        res.json({
            success: true,
            isValid: validation.isValid,
            errors: validation.errors
        });

    } catch (error) {
        console.error('❌ Error validating email:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to validate email'
        });
    }
});

/**
 * POST /api/send/reply/:emailId - Reply to a specific email
 */
router.post('/reply/:emailId', upload.array('attachments'), async (req: Request, res: Response) => {
    try {
        if (!isAuthenticated(req)) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        const { emailId } = req.params;
        const { fromAccount, body, isHtml, includeOriginal } = req.body;
        
        const userAccountIds = getUserAccountIds(req);
        if (!userAccountIds.includes(fromAccount)) {
            return res.status(403).json({
                success: false,
                error: 'You do not have permission to send from this account'
            });
        }

        // Here you would fetch the original email to get reply details
        // For now, this is a placeholder
        
        res.json({
            success: false,
            error: 'Reply functionality will be implemented after email fetching integration'
        });

    } catch (error) {
        console.error('❌ Error sending reply:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to send reply'
        });
    }
});

export default router;

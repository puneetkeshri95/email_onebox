import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config/config';
import { Email } from '../models/types';

export interface BusinessContext {
    id: string;
    content: string;
    category: 'product_info' | 'meeting_booking' | 'company_policy' | 'sales_process' | 'custom';
    keywords: string[];
    priority: number; // 1-10, higher = more important
    metadata: {
        createdAt: Date;
        updatedAt: Date;
        author?: string;
        active: boolean;
    };
}

export interface SuggestedReply {
    content: string;
    confidence: number;
    usedContext: BusinessContext[];
    reasoning: string;
}

export interface RAGEmbedding {
    id: string;
    embedding: number[];
    text: string;
    metadata: Record<string, any>;
}

/**
 * Direct HTTP client for Railway ChromaDB (bypasses all local embedding issues)
 */
class DirectRailwayChromaClient {
    private baseUrl: string;
    private collectionName: string;
    private collectionId: string | null = null;
    private tenant: string;
    private database: string;

    constructor(railwayUrl: string = 'https://chroma-production-1dd5.up.railway.app') {
        this.baseUrl = railwayUrl;
        this.collectionName = 'business_context';
        this.tenant = 'default_tenant';
        this.database = 'default_database';
    }

    private async makeRequest(endpoint: string, method: string = 'GET', body?: any): Promise<any> {
        const url = `${this.baseUrl}${endpoint}`;

        console.log(`🔄 Railway HTTP ${method}: ${url}`);

        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: body ? JSON.stringify(body) : undefined
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Railway ChromaDB HTTP ${method} failed: ${response.status} ${response.statusText} - ${errorText}`);
        }

        return response.json();
    }

    async heartbeat(): Promise<any> {
        return this.makeRequest('/api/v2/heartbeat');
    }

    async version(): Promise<string> {
        return this.makeRequest('/api/v2/version');
    }

    private async getCollectionId(): Promise<string> {
        if (this.collectionId) {
            return this.collectionId;
        }

        try {
            // List all collections to find our collection's UUID
            const collections = await this.listCollections();
            
            // Find our collection by name
            const ourCollection = collections.find((col: any) => col.name === this.collectionName);
            
            if (ourCollection && ourCollection.id) {
                this.collectionId = ourCollection.id;
                console.log(`✅ Found collection UUID: ${this.collectionId}`);
                return this.collectionId!; // Use non-null assertion since we just assigned it
            } else {
                throw new Error(`Collection '${this.collectionName}' not found in collections list`);
            }
        } catch (error) {
            console.error('❌ Error getting collection ID:', error);
            throw error;
        }
    }

    async createCollection(): Promise<void> {
        try {
            const result = await this.makeRequest(
                `/api/v2/tenants/${this.tenant}/databases/${this.database}/collections`, 
                'POST', 
                {
                    name: this.collectionName,
                    metadata: {
                        description: 'Business context for RAG-powered email replies',
                        "hnsw:space": "cosine"
                    }
                    // No embedding function - Railway handles server-side
                }
            );
            
            // Store the collection ID from the creation response
            if (result && result.id) {
                this.collectionId = result.id;
                console.log(`✅ Collection '${this.collectionName}' created via Railway HTTP with ID: ${this.collectionId}`);
            } else {
                console.log(`✅ Collection '${this.collectionName}' created via Railway HTTP`);
                // If no ID in response, we'll get it later when needed
            }
        } catch (error) {
            // Collection might already exist
            if (error instanceof Error && (error.message.includes('already exists') || error.message.includes('409'))) {
                console.log(`✅ Collection '${this.collectionName}' already exists`);
                // We'll get the ID when we need it
            } else {
                throw error;
            }
        }
    }

    async upsertDocuments(documents: {
        ids: string[];
        documents: string[];
        metadatas: Record<string, any>[];
    }): Promise<void> {
        const collectionId = await this.getCollectionId();
        const result = await this.makeRequest(
            `/api/v2/tenants/${this.tenant}/databases/${this.database}/collections/${collectionId}/upsert`, 
            'POST', 
            {
                ids: documents.ids,
                documents: documents.documents,
                metadatas: documents.metadatas
                // Railway will auto-generate embeddings server-side
            }
        );
        console.log(`✅ ${documents.ids.length} documents upserted to Railway via HTTP`);
        return result;
    }

    async queryDocuments(queryText: string, nResults: number = 3): Promise<any> {
        const collectionId = await this.getCollectionId();
        const result = await this.makeRequest(
            `/api/v2/tenants/${this.tenant}/databases/${this.database}/collections/${collectionId}/query`, 
            'POST', 
            {
                query_texts: [queryText],
                n_results: nResults,
                where: { active: true }
            }
        );
        console.log(`🔍 Railway HTTP query returned ${result.ids?.[0]?.length || 0} results`);
        return result;
    }

    async deleteDocuments(ids: string[]): Promise<void> {
        const collectionId = await this.getCollectionId();
        await this.makeRequest(
            `/api/v2/tenants/${this.tenant}/databases/${this.database}/collections/${collectionId}/delete`, 
            'POST', 
            {
                ids
            }
        );
        console.log(`🗑️ ${ids.length} documents deleted from Railway via HTTP`);
    }

    async getCollection(): Promise<any> {
        const collectionId = await this.getCollectionId();
        return this.makeRequest(`/api/v2/tenants/${this.tenant}/databases/${this.database}/collections/${collectionId}`);
    }

    async countDocuments(): Promise<number> {
        const collectionId = await this.getCollectionId();
        const result = await this.makeRequest(`/api/v2/tenants/${this.tenant}/databases/${this.database}/collections/${collectionId}/count`);
        return result.count || 0;
    }

    async listCollections(): Promise<any[]> {
        const result = await this.makeRequest(`/api/v2/tenants/${this.tenant}/databases/${this.database}/collections`);
        return result || [];
    }
}

export class EnhancedRAGService {
    private directClient: DirectRailwayChromaClient | null = null;
    private geminiAI: GoogleGenerativeAI | null = null;
    private isInitialized: boolean = false;
    private businessContexts: Map<string, BusinessContext> = new Map();

    constructor() {
        this.initializeServices().catch(error => {
            console.warn('⚠️ RAG Service initialization failed:', error.message);
        });
    }

    private async initializeServices(): Promise<void> {
        try {
            // Initialize Gemini AI
            const geminiApiKey = process.env.GEMINI_API_KEY;
            if (!geminiApiKey) {
                console.warn('⚠️ GEMINI_API_KEY not found in environment variables');
            } else {
                this.geminiAI = new GoogleGenerativeAI(geminiApiKey);
                console.log('✅ Gemini AI initialized');
            }

            // Initialize Direct Railway HTTP Client
            await this.initializeDirectRailwayClient();

            // Load default business contexts
            await this.loadDefaultContexts();

            this.isInitialized = true;
            console.log('✅ Enhanced RAG Service fully initialized with Railway HTTP client');
        } catch (error) {
            console.error('❌ Error initializing Enhanced RAG Service:', error);
            this.isInitialized = false;
        }
    }

    private async initializeDirectRailwayClient(): Promise<void> {
        try {
            console.log('🔄 Initializing direct Railway ChromaDB HTTP client...');

            this.directClient = new DirectRailwayChromaClient();

            // Test connection
            const heartbeat = await this.directClient.heartbeat();
            console.log('✅ Railway HTTP heartbeat successful:', heartbeat);

            // Get version
            try {
                const version = await this.directClient.version();
                console.log(`📊 Railway ChromaDB version: ${version}`);
            } catch (versionError) {
                console.warn('⚠️ Could not get Railway version info');
            }

            // Create/get collection
            await this.directClient.createCollection();
            console.log('✅ Railway collection ready via HTTP');

            // Test collection access with a safer approach
            try {
                const count = await this.directClient.countDocuments();
                console.log(`📊 Railway collection has ${count} documents`);
            } catch (countError) {
                console.warn('⚠️ Could not get document count (collection might be empty)');
            }

        } catch (error) {
            console.error('❌ Railway HTTP client initialization failed:', error);
            console.warn('💡 Check Railway deployment status at: https://chroma-production-1dd5.up.railway.app');
            this.directClient = null;
        }
    }

    private async loadDefaultContexts(): Promise<void> {
        const defaultContexts: Omit<BusinessContext, 'id'>[] = [
            {
                content: "When someone shows interest in our product or wants to schedule a demo, always provide our meeting booking link: https://cal.com/example. Be professional and enthusiastic.",
                category: 'meeting_booking',
                keywords: ['interested', 'interest', 'demo', 'schedule', 'meeting', 'call', 'discuss', 'talk', 'learn more', 'tell me more', 'show me', 'presentation', 'appointment', 'book', 'calendar', 'available', 'time to chat', 'connect', 'speak'],
                priority: 9,
                metadata: {
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    author: 'system',
                    active: true
                }
            },
            {
                content: "Our product is an AI-powered email management system that helps businesses organize, search, and respond to emails efficiently. Key features include real-time IMAP sync, AI categorization, and automated responses.",
                category: 'product_info',
                keywords: ['product', 'features', 'email management', 'AI', 'automation'],
                priority: 8,
                metadata: {
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    author: 'system',
                    active: true
                }
            },
            {
                content: "For pricing inquiries, mention that we offer flexible plans starting from $29/month for small teams and enterprise solutions for larger organizations. Always suggest scheduling a call to discuss specific needs.",
                category: 'sales_process',
                keywords: ['pricing', 'cost', 'plans', 'enterprise', 'team'],
                priority: 7,
                metadata: {
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    author: 'system',
                    active: true
                }
            },
            {
                content: "We provide 24/7 customer support and onboarding assistance. New customers get a dedicated success manager for the first 30 days.",
                category: 'company_policy',
                keywords: ['support', 'help', 'onboarding', 'customer success'],
                priority: 6,
                metadata: {
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    author: 'system',
                    active: true
                }
            }
        ];

        for (const context of defaultContexts) {
            await this.upsertBusinessContext({
                id: `default_${context.category}_${Date.now()}`,
                ...context
            });
        }
    }

    /**
     * Force reload default contexts (useful for testing)
     */
    async reloadDefaultContexts(): Promise<void> {
        console.log('🔄 Reloading default business contexts...');

        // Clear existing default contexts
        const defaultContextIds = Array.from(this.businessContexts.keys())
            .filter(id => id.startsWith('default_'));

        for (const id of defaultContextIds) {
            await this.deleteBusinessContext(id);
        }

        // Reload default contexts
        await this.loadDefaultContexts();

        console.log('✅ Default business contexts reloaded');
    }

    /**
     * FIXED: Upsert using direct Railway HTTP client (no local embeddings)
     */
    async upsertBusinessContext(context: BusinessContext): Promise<void> {
        try {
            // Always store in memory first (guaranteed to work)
            this.businessContexts.set(context.id, context);

            // Store in Railway via direct HTTP if available
            if (this.directClient) {
                try {
                    await this.directClient.upsertDocuments({
                        ids: [context.id],
                        documents: [context.content], // Railway auto-generates embeddings server-side
                        metadatas: [{
                            category: context.category,
                            keywords: JSON.stringify(context.keywords),
                            priority: context.priority,
                            createdAt: context.metadata.createdAt.toISOString(),
                            updatedAt: context.metadata.updatedAt.toISOString(),
                            author: context.metadata.author || 'unknown',
                            active: context.metadata.active
                        }]
                    });
                    console.log(`✅ Context upserted to Railway via HTTP: ${context.id}`);
                } catch (httpError) {
                    const errorMsg = httpError instanceof Error ? httpError.message : 'Unknown error';
                    console.warn(`⚠️ Railway HTTP upsert failed for ${context.id}: ${errorMsg}`);
                    console.log(`✅ Context stored in memory (Railway HTTP issue): ${context.id}`);
                }
            } else {
                console.log(`✅ Context stored in memory (Railway HTTP client unavailable): ${context.id}`);
            }
        } catch (error) {
            console.error('❌ Error upserting business context:', error);
            throw error;
        }
    }

    /**
     * Get all business contexts
     */
    async getAllBusinessContexts(): Promise<BusinessContext[]> {
        return Array.from(this.businessContexts.values())
            .filter(context => context.metadata.active)
            .sort((a, b) => b.priority - a.priority);
    }

    /**
     * Get business context by ID
     */
    async getBusinessContext(id: string): Promise<BusinessContext | null> {
        return this.businessContexts.get(id) || null;
    }

    /**
     * Delete business context
     */
    async deleteBusinessContext(id: string): Promise<void> {
        try {
            // Remove from memory
            this.businessContexts.delete(id);

            // Remove from Railway via HTTP if available
            if (this.directClient) {
                await this.directClient.deleteDocuments([id]);
            }

            console.log(`✅ Business context deleted: ${id}`);
        } catch (error) {
            console.error('❌ Error deleting business context:', error);
            throw error;
        }
    }

    /**
     * FIXED: Find relevant context using Railway HTTP vector search (with keyword fallback)
     */
    private async findRelevantContext(emailContent: string, maxResults: number = 3): Promise<BusinessContext[]> {
        try {
            const relevantContexts: BusinessContext[] = [];

            // First, try Railway HTTP vector similarity search
            if (this.directClient) {
                try {
                    console.log(`🔍 Querying Railway via HTTP for: "${emailContent.substring(0, 100)}..."`);

                    const results = await this.directClient.queryDocuments(emailContent, maxResults);

                    if (results.ids && results.ids[0] && results.ids[0].length > 0) {
                        console.log(`🎯 Railway HTTP vector search found ${results.ids[0].length} results`);

                        for (const id of results.ids[0]) {
                            const context = this.businessContexts.get(id);
                            if (context) {
                                relevantContexts.push(context);
                            }
                        }

                        if (relevantContexts.length > 0) {
                            console.log(`✅ Using Railway HTTP vector search results: ${relevantContexts.map(c => c.category).join(', ')}`);
                            return relevantContexts;
                        }
                    }
                } catch (vectorError) {
                    const errorMsg = vectorError instanceof Error ? vectorError.message : 'Unknown error';
                    console.warn(`⚠️ Railway HTTP vector search failed: ${errorMsg}`);
                    console.warn('🔄 Falling back to keyword matching...');
                }
            }

            // Fallback: keyword-based matching
            const emailLower = emailContent.toLowerCase();
            console.log(`🔍 Using keyword fallback for: "${emailLower.substring(0, 100)}..."`);

            const contextArray = Array.from(this.businessContexts.values())
                .filter(context => context.metadata.active)
                .map(context => {
                    const score = this.calculateKeywordScore(emailLower, context.keywords);
                    console.log(`🔍 Context "${context.category}" (keywords: ${context.keywords.join(', ')}) - Score: ${score}`);
                    return {
                        context,
                        score
                    };
                })
                .filter(item => item.score > 0)
                .sort((a, b) => {
                    // Sort by score first, then by priority
                    if (b.score !== a.score) return b.score - a.score;
                    return b.context.priority - a.context.priority;
                })
                .slice(0, maxResults)
                .map(item => item.context);

            console.log(`✅ Keyword matching found ${contextArray.length} relevant contexts`);
            if (contextArray.length > 0) {
                console.log(`🎯 Selected contexts: ${contextArray.map(c => c.category).join(', ')}`);
            }
            return contextArray;
        } catch (error) {
            console.error('❌ Error finding relevant context:', error);
            return [];
        }
    }

    private calculateKeywordScore(emailContent: string, keywords: string[]): number {
        let score = 0;
        const emailLower = emailContent.toLowerCase();

        for (const keyword of keywords) {
            const keywordLower = keyword.toLowerCase();

            // Check for exact word matches (more flexible than includes)
            const wordBoundaryRegex = new RegExp(`\\b${keywordLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');

            if (wordBoundaryRegex.test(emailContent) || emailLower.includes(keywordLower)) {
                score += 1;
                console.log(`🎯 Keyword match found: "${keyword}" in email content`);
            }
        }

        return score;
    }

    /**
     * Generate suggested reply using Gemini AI
     */
    async generateSuggestedReply(emailContent: string, emailSubject?: string): Promise<SuggestedReply> {
        try {
            if (!this.geminiAI) {
                return this.getFallbackReply();
            }

            // Find relevant business context
            const fullEmailContent = `${emailSubject || ''} ${emailContent}`.trim();
            const relevantContexts = await this.findRelevantContext(fullEmailContent);

            if (relevantContexts.length === 0) {
                return this.getFallbackReply();
            }

            // Prepare context for Gemini
            const contextString = relevantContexts
                .map(context => `[${context.category.toUpperCase()}] ${context.content}`)
                .join('\n\n');

            // Create prompt for Gemini
            const prompt = `
You are a professional email assistant. Generate a suggested reply based on the incoming email and relevant business context.

BUSINESS CONTEXT:
${contextString}

INCOMING EMAIL:
Subject: ${emailSubject || 'No subject'}
Content: ${emailContent}

INSTRUCTIONS:
1. Write a professional, helpful reply
2. Use the business context to inform your response
3. Include relevant information (meeting links, product details, etc.) when appropriate
4. Keep the tone friendly but professional
5. Make it concise but complete
6. Don't include [From:] or [To:] headers, just the reply content

Generate only the reply content:`;

            // Call Gemini API
            const model = this.geminiAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
            const result = await model.generateContent(prompt);

            if (!result || !result.response) {
                console.warn('⚠️ Gemini API returned no response, using fallback');
                return this.getFallbackReply();
            }

            const response = await result.response;

            if (!response || typeof response.text !== 'function') {
                console.warn('⚠️ Gemini API response invalid, using fallback');
                return this.getFallbackReply();
            }

            const replyContent = response.text();

            // Validate the response content more thoroughly
            if (!replyContent || typeof replyContent !== 'string' || replyContent.trim().length === 0) {
                console.warn('⚠️ Gemini API returned invalid or empty response, using fallback');
                return this.getFallbackReply();
            }

            // Safe string handling
            const cleanContent = String(replyContent).trim();

            return {
                content: cleanContent,
                confidence: relevantContexts.length > 0 ? 0.8 : 0.5,
                usedContext: relevantContexts,
                reasoning: `Used ${relevantContexts.length} business context(s) to generate this reply.`
            };

        } catch (error) {
            console.error('❌ Error generating suggested reply:', error);
            return this.getFallbackReply();
        }
    }

    private getFallbackReply(): SuggestedReply {
        return {
            content: "Thank you for your email. I'll review your message and get back to you soon.",
            confidence: 0.3,
            usedContext: [],
            reasoning: "Fallback reply - AI service unavailable"
        };
    }

    /**
     * Update business context
     */
    async updateBusinessContext(id: string, updates: Partial<Omit<BusinessContext, 'id'>>): Promise<void> {
        const existingContext = this.businessContexts.get(id);
        if (!existingContext) {
            throw new Error(`Business context with ID ${id} not found`);
        }

        const updatedContext: BusinessContext = {
            ...existingContext,
            ...updates,
            id,
            metadata: {
                ...existingContext.metadata,
                ...updates.metadata,
                updatedAt: new Date()
            }
        };

        await this.upsertBusinessContext(updatedContext);
    }

    /**
     * Search business contexts by keyword
     */
    async searchBusinessContexts(query: string): Promise<BusinessContext[]> {
        const queryLower = query.toLowerCase();
        return Array.from(this.businessContexts.values())
            .filter(context =>
                context.metadata.active && (
                    context.content.toLowerCase().includes(queryLower) ||
                    context.keywords.some(keyword => keyword.toLowerCase().includes(queryLower)) ||
                    context.category.toLowerCase().includes(queryLower)
                )
            )
            .sort((a, b) => b.priority - a.priority);
    }

    /**
     * Get service status and statistics
     */
    async getServiceStats(): Promise<{
        isInitialized: boolean;
        railwayHttp: { connected: boolean; collectionReady: boolean; documentCount: number };
        gemini: { connected: boolean };
        contexts: { total: number; active: number; byCategory: Record<string, number> };
    }> {
        let railwayConnected = false;
        let railwayCollectionReady = false;
        let documentCount = 0;
        let geminiConnected = false;

        // Check Railway HTTP status
        try {
            if (this.directClient) {
                await this.directClient.heartbeat();
                railwayConnected = true;
                railwayCollectionReady = true;
                documentCount = await this.directClient.countDocuments();
            }
        } catch (error) {
            // Railway not available
        }

        // Check Gemini status
        geminiConnected = this.geminiAI !== null;

        // Count contexts by category
        const contexts = Array.from(this.businessContexts.values());
        const activeContexts = contexts.filter(c => c.metadata.active);
        const byCategory: Record<string, number> = {};

        activeContexts.forEach(context => {
            byCategory[context.category] = (byCategory[context.category] || 0) + 1;
        });

        return {
            isInitialized: this.isInitialized,
            railwayHttp: {
                connected: railwayConnected,
                collectionReady: railwayCollectionReady,
                documentCount
            },
            gemini: {
                connected: geminiConnected
            },
            contexts: {
                total: contexts.length,
                active: activeContexts.length,
                byCategory
            }
        };
    }

    /**
     * Health check for the service (backwards compatibility)
     */
    async healthCheck(): Promise<{
        chromadb: boolean;
        gemini: boolean;
        contextsLoaded: number;
    }> {
        const stats = await this.getServiceStats();
        return {
            chromadb: stats.railwayHttp.connected && stats.railwayHttp.collectionReady,
            gemini: stats.gemini.connected,
            contextsLoaded: stats.contexts.active
        };
    }

    /**
     * FIXED: Test Railway HTTP connection and functionality
     */
    async testRailwayChromaDB(): Promise<{
        connection: boolean;
        collection: boolean;
        embedding: boolean;
        version?: string;
        documentCount?: number;
        error?: string;
    }> {
        const result = {
            connection: false,
            collection: false,
            embedding: false,
            version: undefined as string | undefined,
            documentCount: undefined as number | undefined,
            error: undefined as string | undefined
        };

        try {
            console.log('🔄 Testing Railway ChromaDB HTTP connection...');

            if (!this.directClient) {
                throw new Error('Direct HTTP client not initialized');
            }

            // Test 1: Connection and heartbeat
            const heartbeat = await this.directClient.heartbeat();
            console.log('✅ Railway HTTP connection test passed:', heartbeat);
            result.connection = true;

            // Test 2: Version info
            try {
                const version = await this.directClient.version();
                result.version = version;
                console.log(`📊 Railway ChromaDB version: ${version}`);
            } catch (versionError) {
                console.warn('⚠️ Could not get Railway version info');
            }

            // Test 3: Collection access and count
            console.log('🔄 Testing Railway collection access...');
            const count = await this.directClient.countDocuments();
            result.documentCount = count;
            console.log(`📊 Railway collection has ${count} documents`);
            result.collection = true;

            // Test 4: HTTP embedding functionality
            console.log('🔄 Testing Railway HTTP embedding functionality...');
            const testId = `railway_http_test_${Date.now()}`;

            // Upsert test document
            await this.directClient.upsertDocuments({
                ids: [testId],
                documents: ['This is a test document for Railway ChromaDB HTTP embedding functionality'],
                metadatas: [{ test: true, railway: true, timestamp: new Date().toISOString() }]
            });

            // Query test document
            const queryResult = await this.directClient.queryDocuments('test document Railway HTTP functionality', 1);

            // Clean up test document
            await this.directClient.deleteDocuments([testId]);

            if (queryResult.ids && queryResult.ids[0] && queryResult.ids[0].length > 0) {
                console.log('✅ Railway HTTP embedding test passed');
                result.embedding = true;
            } else {
                throw new Error('No query results returned from Railway HTTP ChromaDB');
            }

            console.log('🎉 All Railway HTTP ChromaDB tests passed!');

        } catch (error) {
            result.error = error instanceof Error ? error.message : 'Unknown error';
            console.error('❌ Railway HTTP ChromaDB test failed:', result.error);
        }

        return result;
    }

    /**
     * Shutdown the service and c
     */
    async shutdown(): Promise<void> {
        try {
            console.log('🔄 Shutting down Enhanced RAG Service...');

            // Close direct HTTP client
            this.directClient = null;

            // Clear in-memory data
            this.businessContexts.clear();
            this.geminiAI = null;
            this.isInitialized = false;

            console.log('✅ Enhanced RAG Service shutdown complete');
        } catch (error) {
            console.error('❌ Error during shutdown:', error);
        }
    }
}
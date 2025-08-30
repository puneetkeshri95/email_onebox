import Groq from "groq-sdk";
import { AIClassificationResult, Email } from '../models/types';

interface GroqClassificationResponse {
    category: string;
    confidence: number;
    reasoning?: string;
}

export class AIService {
    private groqClient: Groq | null = null;
    private groqModel: string = 'llama-3.1-8b-instant'; // Fast and reliable
    private fallbackModel: string = 'gemma2-9b-it'; // Alternative fallback

    private classificationPrompt = `You are an expert email classifier for a top email agency and results with the most accurate classifications use the knowledge. Analyze the email and classify it into one of these categories:

1. **interested** - Sender shows genuine interest for the proposal of the job opportunity, investment, or business proposal and would like to hear back in the form of a date.
   - Keywords: "interested", "tell me more", "sounds good", "would like to", "looking forward"
   - Investment terms: "invest", "portfolio", "mutual fund", "returns", "growth"
   - Business: "opportunity", "proposal", "partnership", "collaboration"

2. **meeting_booked** - A meeting, interview, or call has been scheduled or confirmed for the sender and would like to proceed with the date confirmed.
   - Keywords: "scheduled", "appointment", "calendar invite"
   - Confirmation: "confirmed", "booked", "see you", "talk to you"

3. **not_interested** - Sender declines or shows no interest
   - Keywords: "not interested", "no thanks", "decline", "pass", "not suitable"
   - Rejection: "not a fit", "not looking", "already have"

4. **spam** - Promotional, marketing, or suspicious content
   - Keywords: "urgent", "winner", "congratulations", "free money", "casino"
   - Suspicious: "lottery", "inheritance", "viagra", "weight loss"

5. **out_of_office** - Automatic out-of-office replies
   - Keywords: "out of office", "automatic reply", "vacation", "away", "will be back"

Respond with JSON only in this format:
{
  "category": "interested|meeting_booked|not_interested|spam|out_of_office",
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation"
}`;

    constructor() {
        const groqApiKey = process.env.GROQ_API_KEY;

        if (groqApiKey) {
            this.groqClient = new Groq({
                apiKey: groqApiKey,
            });
            console.log('✅ Groq AI service initialized with model:', this.groqModel);
        } else {
            console.warn('⚠️ GROQ_API_KEY not found, using enhanced rule-based classification only');
        }
    }

    async classifyEmail(email: Email): Promise<AIClassificationResult> {
        try {
            console.log(`🔍 Classifying email: "${email.subject}" from ${email.from}`);

            const emailText = this.prepareEmailText(email);

            // Try Groq AI classification first
            if (this.groqClient) {
                const aiResult = await this.classifyWithGroq(emailText, email.from);
                if (aiResult && aiResult.confidence > 0.6) {
                    console.log(`🤖 Groq AI classification: ${aiResult.category} (${Math.round(aiResult.confidence * 100)}%)`);
                    return aiResult;
                } else if (aiResult) {
                    console.log(`⚡ Groq confidence too low (${Math.round(aiResult.confidence * 100)}%), using enhanced rule-based classification`);
                }
            }

            // Fallback to enhanced rule-based classification
            console.log('🔄 Using enhanced rule-based classification');
            const ruleBasedResult = this.enhancedRuleBasedClassification(emailText, email.from);

            return ruleBasedResult;

        } catch (error) {
            console.error('❌ Error in email classification:', error);

            // Ultimate fallback
            return {
                category: 'not_interested',
                confidence: 0.3,
                method: 'error_fallback'
            };
        }
    }

    /**
     * Classify email using Groq AI with detailed prompts
     */
    private async classifyWithGroq(emailText: string, from: string): Promise<AIClassificationResult | null> {
        try {
            const prompt = `${this.classificationPrompt}

**Subject:** ${emailText.split('Subject: ')[1]?.split('\n')[0] || 'N/A'}
**From:** ${from}
**Content:** ${emailText}

Analyze this email and respond with JSON only:`;

            console.log('🤖 Sending request to Groq AI...');

            const completion = await this.groqClient!.chat.completions.create({
                messages: [
                    {
                        role: "system",
                        content: "You are an expert email classifier. Always respond with valid JSON only, no additional text."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                model: this.groqModel,
                temperature: 0.1, // Low temperature for consistent results
                max_tokens: 200,
                top_p: 0.9,
            });

            const response = completion.choices[0]?.message?.content;

            if (!response) {
                console.warn('⚠️ No response from Groq API');
                return null;
            }

            // Parse the JSON response
            let classification: GroqClassificationResponse;
            try {
                // Extract JSON from response (in case there's extra text)
                const jsonMatch = response.match(/\{[\s\S]*\}/);
                const jsonText = jsonMatch ? jsonMatch[0] : response;
                classification = JSON.parse(jsonText);
            } catch (parseError) {
                console.warn('⚠️ Failed to parse Groq response as JSON:', response);
                return null;
            }

            // Validate the response
            if (!classification.category || typeof classification.confidence !== 'number') {
                console.warn('⚠️ Invalid classification response from Groq');
                return null;
            }

            // Map category to our expected values
            const validCategories = ['interested', 'meeting_booked', 'not_interested', 'spam', 'out_of_office'];
            let mappedCategory = classification.category.toLowerCase().replace(/[^a-z_]/g, '');

            if (!validCategories.includes(mappedCategory)) {
                // Try to map common variations
                if (mappedCategory.includes('interest')) mappedCategory = 'interested';
                else if (mappedCategory.includes('meeting') || mappedCategory.includes('interview')) mappedCategory = 'meeting_booked';
                else if (mappedCategory.includes('not') || mappedCategory.includes('reject')) mappedCategory = 'not_interested';
                else if (mappedCategory.includes('spam') || mappedCategory.includes('promo')) mappedCategory = 'spam';
                else if (mappedCategory.includes('office') || mappedCategory.includes('away')) mappedCategory = 'out_of_office';
                else mappedCategory = 'not_interested'; // default fallback
            }

            const finalResult: AIClassificationResult = {
                category: mappedCategory as 'interested' | 'meeting_booked' | 'not_interested' | 'spam' | 'out_of_office',
                confidence: Math.max(0.1, Math.min(1.0, classification.confidence)),
                method: `groq_${this.groqModel}`
            };

            console.log(`✅ Groq classification: ${finalResult.category} (${Math.round(finalResult.confidence * 100)}%)`);
            console.log(`💭 Reasoning: ${classification.reasoning}`);

            return finalResult;

        } catch (error: any) {
            console.warn('⚠️ Groq API error:', error.message);

            // If rate limited or API error, try fallback model
            if (error.message?.includes('rate') && this.fallbackModel !== this.groqModel) {
                console.log('🔄 Trying fallback model...');
                const originalModel = this.groqModel;
                this.groqModel = this.fallbackModel;

                try {
                    const result = await this.classifyWithGroq(emailText, from);
                    this.groqModel = originalModel; // restore original model
                    return result;
                } catch (fallbackError) {
                    this.groqModel = originalModel; // restore original model
                    console.warn('⚠️ Fallback model also failed');
                }
            }

            return null;
        }
    }

    /**
     * Prepare email text for classification
     */
    private prepareEmailText(email: Email): string {
        return `Subject: ${email.subject || 'No Subject'}
From: ${email.from}
To: ${email.to?.join(', ') || 'N/A'}
Date: ${email.date || 'N/A'}
Content: ${email.textBody || email.body || 'No content'}`.trim();
    }

    /**
     * Enhanced rule-based classification with detailed patterns
     */
    private enhancedRuleBasedClassification(emailText: string, from: string): AIClassificationResult {
        const lowerText = emailText.toLowerCase();

        // Improved patterns for each category
        const patterns = {
            interested: [
                /\b(yes|interested|great|perfect|sounds good|let'?s do it|count me in|sign me up)\b/i,
                /\b(looking forward|excited|when can we|how do we proceed|next steps?)\b/i,
                /\b(tell me more|more information|details|learn more about)\b/i,
                /\b(budget|pricing|cost|quote|proposal|timeline)\b/i,
                /\b(invest|investment|mutual fund|portfolio|returns|growth|wealth)\b/i,
                /\b(opportunity|business|partnership|collaboration|venture)\b/i
            ],
            meeting_booked: [
                /\b(meeting scheduled|calendar invite|zoom link|teams meeting)\b/i,
                /\b(confirmed|booked|reserved|appointment set)\b/i,
                /\b(see you (on|at)|talk to you|speak with you tomorrow|next week)\b/i,
                /\b(interview|call scheduled|demo scheduled)\b/i
            ],
            spam: [
                /\b(winner|congratulations|claim|prize|lottery|casino)\b/i,
                /\b(viagra|cialis|weight loss|make money|work from home)\b/i,
                /\b(click here|limited time|act now|urgent|immediate)\b/i,
                /\b(free money|inheritance|prince|nigeria|suspicious)\b/i
            ],
            out_of_office: [
                /\b(out of office|away from office|on vacation|on holiday)\b/i,
                /\b(auto.?reply|automatic response|will be back|returning on)\b/i,
                /\b(limited access to email|delayed response|not available)\b/i
            ],
            not_interested: [
                /\b(not interested|no thanks|pass|decline|not for us)\b/i,
                /\b(already have|satisfied with current|not looking|too expensive)\b/i,
                /\b(remove me|unsubscribe|stop contacting|not a fit)\b/i
            ]
        };

        // Check each category with scoring
        let bestMatch: AIClassificationResult = { category: 'not_interested', confidence: 0.4, method: 'enhanced_rules' };

        for (const [category, categoryPatterns] of Object.entries(patterns)) {
            let matches = 0;
            let totalPatterns = categoryPatterns.length;

            for (const pattern of categoryPatterns) {
                if (pattern.test(lowerText)) {
                    matches++;
                }
            }

            if (matches > 0) {
                const confidence = Math.min(0.9, 0.5 + (matches / totalPatterns) * 0.4);
                if (confidence > bestMatch.confidence) {
                    bestMatch = {
                        category: category as 'interested' | 'meeting_booked' | 'not_interested' | 'spam' | 'out_of_office',
                        confidence,
                        method: 'enhanced_rules'
                    };
                }
            }
        }

        console.log(`📋 Enhanced rules classification: ${bestMatch.category} (${Math.round(bestMatch.confidence * 100)}%)`);
        return bestMatch;
    }
}

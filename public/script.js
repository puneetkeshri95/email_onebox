// Use relative URLs instead of hardcoded localhost URL
// This allows the app to work with port forwarding and dev tunnels
const API_BASE_URL = window.location.origin;

class GmailEmailClient {
    constructor() {
        this.emails = [];
        this.currentFilters = {};
        this.selectedEmail = null;
        this.currentQuery = '';
        this.currentView = 'list'; // 'list' or 'detail'
        this.lastEmailCount = 0;
        this.lastCheckTime = null;
        this.checkInterval = null;
        this.isCheckingUpdates = false;
        this.syncCheckInterval = null; // For checking sync status

        this.initializeEventListeners();
        this.loadInitialData();
        this.startRealTimeUpdates();
    }

    initializeEventListeners() {
        // Search functionality
        const searchInput = document.getElementById('searchInput');
        const searchBtn = document.getElementById('searchBtn');

        if (searchBtn) {
            searchBtn.addEventListener('click', () => this.performSearch());
        }
        if (searchInput) {
            searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.performSearch();
            });
        }

        // Filter functionality
        const accountFilter = document.getElementById('accountFilter');
        const categoryFilter = document.getElementById('categoryFilter');
        const dateFrom = document.getElementById('dateFrom');
        const dateTo = document.getElementById('dateTo');
        const clearFilters = document.getElementById('clearFilters');

        if (accountFilter) accountFilter.addEventListener('change', () => this.applyFilters());
        if (categoryFilter) categoryFilter.addEventListener('change', () => this.applyFilters());
        if (dateFrom) dateFrom.addEventListener('change', () => this.applyFilters());
        if (dateTo) dateTo.addEventListener('change', () => this.applyFilters());
        if (clearFilters) clearFilters.addEventListener('click', () => this.clearFilters());

        // UI interactions
        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) refreshBtn.addEventListener('click', () => this.loadEmails());

        // OAuth functionality
        const addGmailBtn = document.getElementById('addGmailBtn');
        const addOutlookBtn = document.getElementById('addOutlookBtn');

        if (addGmailBtn) addGmailBtn.addEventListener('click', () => this.connectGmail());
        if (addOutlookBtn) addOutlookBtn.addEventListener('click', () => this.connectOutlook());

        // Compose email functionality
        const composeBtn = document.getElementById('composeBtn');
        const composeModal = document.getElementById('composeModal');
        const closeComposeModal = document.getElementById('closeComposeModal');
        const composeForm = document.getElementById('composeForm');

        if (composeBtn) composeBtn.addEventListener('click', () => this.openComposeModal());
        if (closeComposeModal) closeComposeModal.addEventListener('click', () => this.closeComposeModal());
        if (composeModal) {
            composeModal.addEventListener('click', (e) => {
                if (e.target === composeModal) this.closeComposeModal();
            });
        }
        if (composeForm) {
            composeForm.addEventListener('submit', (e) => this.handleEmailSend(e));
        }

        // Initialize compose functionality
        this.initializeComposeFeatures();

        // Quick filter buttons
        this.setupQuickFilters();
        const backToList = document.getElementById('backToList');
        const selectAll = document.getElementById('selectAll');

        if (refreshBtn) refreshBtn.addEventListener('click', () => this.refreshEmails());
        if (backToList) backToList.addEventListener('click', () => this.showEmailList());
        if (selectAll) selectAll.addEventListener('change', (e) => this.toggleSelectAll(e.target.checked));

        // Email list interactions (delegated)
        const emailList = document.getElementById('emailList');
        if (emailList) {
            emailList.addEventListener('click', (event) => {
                const emailItem = event.target.closest('.email-item');
                if (emailItem) {
                    const emailId = emailItem.dataset.emailId;
                    const selectedEmail = this.emails.find(e => e.id === emailId);
                    if (selectedEmail) {
                        this.openEmailDetail(selectedEmail);
                    }
                }
            });
        }

        // Menu interactions
        const menuItems = document.querySelectorAll('.menu-item');
        menuItems.forEach(item => {
            item.addEventListener('click', () => {
                this.handleMenuClick(item);
            });
        });
    }

    async loadInitialData() {
        this.showLoading(true);
        try {
            // Clear any existing sync loader
            this.hideSyncingLoader();

            // First check if user is authenticated
            const authStatus = await this.checkAuthenticationStatus();
            if (!authStatus.isAuthenticated) {
                // Redirect to onboarding page
                window.location.href = '/onboarding.html';
                return;
            }

            await Promise.all([
                this.loadEmails(),
                this.loadStats(),
                this.loadConnectedAccounts(),
                this.initializeSmartReplies()
            ]);
        } catch (error) {
            console.error('Error loading initial data:', error);
            this.showToast('❌ Failed to load data', 'error');
        } finally {
            this.showLoading(false);
        }
    }

    async checkAuthenticationStatus() {
        try {
            const response = await fetch(`${API_BASE_URL}/api/auth/status`);
            const data = await response.json();
            return data;
        } catch (error) {
            console.error('Auth check failed:', error);
            return { isAuthenticated: false };
        }
    }

    setupQuickFilters() {
        // Quick filter buttons for categories
        const filterButtons = document.querySelectorAll('.quick-filter-btn');
        filterButtons.forEach(button => {
            button.addEventListener('click', () => {
                const category = button.dataset.category;
                if (category) {
                    // Set the category filter
                    const categoryFilter = document.getElementById('categoryFilter');
                    if (categoryFilter) {
                        categoryFilter.value = category;
                        this.applyFilters();
                    }

                    // Update button states
                    filterButtons.forEach(btn => btn.classList.remove('active'));
                    button.classList.add('active');
                }
            });
        });

        // Clear filters button
        const clearFiltersBtn = document.getElementById('clearFiltersBtn');
        if (clearFiltersBtn) {
            clearFiltersBtn.addEventListener('click', () => {
                this.clearFilters();
                // Reset button states
                filterButtons.forEach(btn => btn.classList.remove('active'));
            });
        }
    }

    async loadEmails() {
        try {
            console.log('Loading emails from API...');

            // First check if emails are being synced
            const syncStatus = await this.checkSyncStatus();
            if (syncStatus.isSyncing) {
                this.showSyncingLoader(syncStatus);
                return;
            }

            const response = await fetch(`${API_BASE_URL}/api/emails`);
            const data = await response.json();

            if (data.success) {
                this.emails = data.data || [];
                this.lastEmailCount = this.emails.length;
                this.lastCheckTime = new Date();
                console.log(`Loaded ${this.emails.length} emails`);
                this.renderEmailList();
                this.updateEmailCount();

                // Handle the case where Elasticsearch is unavailable
                if (data.isElasticsearchUnavailable) {
                    // Check if emails are syncing
                    const syncStatus = await this.checkSyncStatus();
                    if (syncStatus.isSyncing) {
                        this.showSyncingLoader(syncStatus);
                    } else {
                        this.showToast('📨 Email service is starting up. Please wait a moment...', 'info');
                    }
                } else if (data.count === 0 && data.message && !data.message.includes('Elasticsearch')) {
                    this.showToast(data.message, 'info');
                }
            } else {
                throw new Error(data.message || 'Failed to load emails');
            }
        } catch (error) {
            console.error('Error loading emails:', error);

            // Check if this might be due to syncing
            const syncStatus = await this.checkSyncStatus();
            if (syncStatus.isSyncing) {
                this.showSyncingLoader(syncStatus);
            } else {
                this.showToast('❌ Failed to load emails', 'error');
                this.renderEmptyState();
            }
        }
    }

    async loadStats() {
        try {
            const response = await fetch(`${API_BASE_URL}/api/emails/stats`);
            const data = await response.json();

            if (data.success) {
                this.updateHeaderStats(data.data);
                this.updateCategoryStats(data.data);
                this.updateSidebarCounts(data.data);
            }
        } catch (error) {
            console.error('Error loading stats:', error);
        }
    }

    async checkSyncStatus() {
        try {
            const response = await fetch(`${API_BASE_URL}/api/sync/status`);
            const data = await response.json();

            if (data.success) {
                const syncingAccounts = data.accounts.filter(acc => acc.status === 'syncing');
                return {
                    isSyncing: syncingAccounts.length > 0,
                    accounts: data.accounts,
                    syncingAccounts: syncingAccounts
                };
            }
            return { isSyncing: false, accounts: [], syncingAccounts: [] };
        } catch (error) {
            console.error('Error checking sync status:', error);
            return { isSyncing: false, accounts: [], syncingAccounts: [] };
        }
    }

    showSyncingLoader(syncStatus) {
        const emailList = document.getElementById('emailList');
        const emptyState = document.getElementById('emptyState');

        if (!emailList) return;

        // Hide other states
        emailList.style.display = 'none';
        if (emptyState) emptyState.style.display = 'none';

        // Create or update syncing loader
        let syncingLoader = document.getElementById('syncingLoader');
        if (!syncingLoader) {
            syncingLoader = document.createElement('div');
            syncingLoader.id = 'syncingLoader';
            syncingLoader.className = 'syncing-loader';
            emailList.parentNode.insertBefore(syncingLoader, emailList);
        }

        const syncingAccounts = syncStatus.syncingAccounts || [];
        const accountInfo = syncingAccounts.length > 0
            ? `for ${syncingAccounts.map(acc => acc.email).join(', ')}`
            : '';

        syncingLoader.innerHTML = `
            <div class="syncing-content">
                <div class="syncing-animation">
                    <div class="spinner"></div>
                </div>
                <h3>📧 Syncing Your Emails</h3>
                <p>We're fetching and processing your emails ${accountInfo}. This usually takes a few moments.</p>
                <div class="syncing-progress">
                    <div class="progress-bar">
                        <div class="progress-fill"></div>
                    </div>
                    <p class="syncing-status">Please wait while we sync your mailbox...</p>
                </div>
            </div>
        `;

        syncingLoader.style.display = 'flex';

        // Start polling for completion
        if (!this.syncCheckInterval) {
            this.syncCheckInterval = setInterval(async () => {
                const status = await this.checkSyncStatus();
                if (!status.isSyncing) {
                    this.hideSyncingLoader();
                    clearInterval(this.syncCheckInterval);
                    this.syncCheckInterval = null;
                    // Refresh the page after sync completion
                    this.showToast('✅ Email sync completed! Refreshing...', 'success');
                    setTimeout(() => {
                        window.location.reload();
                    }, 1500);
                }
            }, 3000); // Check every 3 seconds
        }
    }

    hideSyncingLoader() {
        const syncingLoader = document.getElementById('syncingLoader');
        if (syncingLoader) {
            syncingLoader.style.display = 'none';
        }
    }

    renderEmailList() {
        const emailList = document.getElementById('emailList');
        const emptyState = document.getElementById('emptyState');

        if (!emailList) return;

        if (this.emails.length === 0) {
            emailList.style.display = 'none';
            if (emptyState) emptyState.style.display = 'flex';
            return;
        }

        emailList.style.display = 'block';
        if (emptyState) emptyState.style.display = 'none';

        emailList.innerHTML = this.emails.map(email => this.renderEmailItem(email)).join('');
    }

    renderEmailItem(email) {
        const date = new Date(email.date);
        const timeStr = this.formatEmailDate(date);
        const snippet = this.createEmailSnippet(email.body);

        return `
            <div class="email-item ${email.isRead ? '' : 'unread'}" data-email-id="${email.id}">
                <input type="checkbox" class="email-checkbox" />
                <span class="email-star ${email.isStarred ? 'active' : 'inactive'}">⭐</span>
                <div class="email-sender">${this.escapeHtml(email.from)}</div>
                <div class="email-content">
                    <div class="email-subject">${this.escapeHtml(email.subject || '(no subject)')}</div>
                    <div class="email-snippet">${this.escapeHtml(snippet)}</div>
                    <div class="email-labels">
                        ${email.aiCategory ? `<span class="email-label ${email.aiCategory}">${this.formatCategory(email.aiCategory)}</span>` : ''}
                        <span class="email-label gmail">Gmail</span>
                    </div>
                </div>
                <div class="email-date">${timeStr}</div>
            </div>
        `;
    }

    openEmailDetail(email) {
        this.selectedEmail = email;
        this.currentView = 'detail';

        // Hide email list view
        const emailListView = document.getElementById('emailListView');
        const emailDetailView = document.getElementById('emailDetailView');

        if (emailListView) emailListView.style.display = 'none';
        if (emailDetailView) emailDetailView.style.display = 'flex';

        // Populate email details
        this.populateEmailDetail(email);

        // Load AI suggestions
        this.loadAISuggestions(email);
    }

    showEmailList() {
        this.currentView = 'list';

        // Show email list view
        const emailListView = document.getElementById('emailListView');
        const emailDetailView = document.getElementById('emailDetailView');

        if (emailListView) emailListView.style.display = 'flex';
        if (emailDetailView) emailDetailView.style.display = 'none';

        this.selectedEmail = null;
    }

    populateEmailDetail(email) {
        // Set email details
        const detailSubject = document.getElementById('detailSubject');
        const detailFrom = document.getElementById('detailFrom');
        const detailTo = document.getElementById('detailTo');
        const detailDate = document.getElementById('detailDate');
        const detailCategory = document.getElementById('detailCategory');

        if (detailSubject) detailSubject.textContent = email.subject || '(no subject)';
        if (detailFrom) detailFrom.textContent = email.from;
        if (detailTo) detailTo.textContent = Array.isArray(email.to) ? email.to.join(', ') : email.to;
        if (detailDate) detailDate.textContent = new Date(email.date).toLocaleString();

        // Update category badge
        if (detailCategory) {
            if (email.aiCategory) {
                detailCategory.textContent = this.formatCategory(email.aiCategory);
                detailCategory.className = `category-badge ${email.aiCategory}`;
            } else {
                detailCategory.textContent = 'Uncategorized';
                detailCategory.className = 'category-badge';
            }
        }

        // Display email body
        this.displayEmailBody(email);

        // Populate inline compose form accounts
        this.populateInlineComposeAccounts();

        // Hide inline compose form initially
        const inlineCompose = document.getElementById('inlineCompose');
        if (inlineCompose) {
            inlineCompose.style.display = 'none';
        }
    }

    async populateInlineComposeAccounts() {
        try {
            console.log('🔄 Starting to load accounts for inline compose...');

            const response = await fetch(`${API_BASE_URL}/api/auth/accounts`);
            const result = await response.json();

            console.log('📡 Accounts API response:', result);

            // Handle API response with 'accounts' array instead of 'data'
            const accounts = result.accounts || result.data || [];

            if (result.success && accounts.length > 0) {
                const inlineFromAccount = document.getElementById('inlineFromAccount');
                if (inlineFromAccount) {
                    // Clear existing options
                    inlineFromAccount.innerHTML = '<option value="">Select sender account...</option>';

                    // Add each account as an option
                    accounts.forEach((account, index) => {
                        const option = document.createElement('option');
                        // Use email as value for direct matching
                        option.value = account.email;
                        option.textContent = `${account.email} (${account.provider})`;
                        inlineFromAccount.appendChild(option);
                        console.log(`➕ Added account option ${index}: ${account.email} (${account.provider})`);
                    });

                    console.log(`✅ Loaded ${accounts.length} accounts for inline compose`);
                    console.log(`📋 Final dropdown options:`, Array.from(inlineFromAccount.options).map((opt, idx) =>
                        `${idx}: "${opt.textContent}" (value: "${opt.value}")`));

                    // After accounts are loaded, try to auto-select the correct one
                    setTimeout(() => {
                        this.autoSelectFromAccount(inlineFromAccount);
                    }, 100); // Small delay to ensure DOM is updated
                } else {
                    console.error('❌ inlineFromAccount element not found');
                }
            } else {
                console.error('❌ No accounts found in API response:', result);
            }
        } catch (error) {
            console.error('❌ Error loading accounts for inline compose:', error);
        }
    }

    displayEmailBody(email) {
        const emailHtmlViewer = document.getElementById('emailHtmlViewer');
        const detailBodyFallback = document.getElementById('detailBodyFallback');

        if (email.isHtml && email.body && emailHtmlViewer) {
            // Show HTML content in iframe
            emailHtmlViewer.style.display = 'block';
            if (detailBodyFallback) detailBodyFallback.style.display = 'none';

            try {
                const styledHtml = this.createStyledEmailHtml(email.body);

                if (emailHtmlViewer.contentDocument) {
                    emailHtmlViewer.contentDocument.open();
                    emailHtmlViewer.contentDocument.write(styledHtml);
                    emailHtmlViewer.contentDocument.close();
                } else {
                    console.error('Iframe contentDocument is not available.');
                    this.fallbackToPlainText(email, emailHtmlViewer, detailBodyFallback);
                }
            } catch (e) {
                console.error('Error writing to iframe:', e);
                this.fallbackToPlainText(email, emailHtmlViewer, detailBodyFallback);
            }
        } else if (detailBodyFallback) {
            // Show plain text content
            emailHtmlViewer.style.display = 'none';
            detailBodyFallback.style.display = 'block';

            if (email.isHtml && email.body) {
                detailBodyFallback.innerHTML = email.body;
            } else {
                detailBodyFallback.textContent = email.body || 'No content available.';
            }
        }
    }

    createStyledEmailHtml(body) {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                        font-size: 14px;
                        line-height: 1.6;
                        color: #202124;
                        margin: 0;
                        padding: 20px;
                        background: #fff;
                        word-wrap: break-word;
                    }
                    
                    img {
                        max-width: 100%;
                        height: auto;
                        border-radius: 4px;
                    }
                    
                    a {
                        color: #1a73e8;
                        text-decoration: none;
                    }
                    
                    a:hover {
                        text-decoration: underline;
                    }
                    
                    blockquote {
                        border-left: 3px solid #e8e8e8;
                        margin: 16px 0;
                        padding-left: 16px;
                        color: #666;
                    }
                    
                    table {
                        border-collapse: collapse;
                        width: 100%;
                        margin: 16px 0;
                    }
                    
                    th, td {
                        border: 1px solid #ddd;
                        padding: 8px;
                        text-align: left;
                    }
                    
                    th {
                        background-color: #f8f9fa;
                    }
                    
                    pre {
                        background: #f8f9fa;
                        border-radius: 4px;
                        padding: 12px;
                        overflow-x: auto;
                        font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
                    }
                </style>
            </head>
            <body>
                ${body}
            </body>
            </html>
        `;
    }

    fallbackToPlainText(email, emailHtmlViewer, detailBodyFallback) {
        emailHtmlViewer.style.display = 'none';
        if (detailBodyFallback) {
            detailBodyFallback.style.display = 'block';
            detailBodyFallback.textContent = email.body || 'No content available.';
        }
    }

    async loadAISuggestions(email) {
        const aiSuggestions = document.getElementById('aiSuggestions');
        const suggestedReplies = document.getElementById('suggestedReplies');

        if (!aiSuggestions || !suggestedReplies) return;

        // Always show the AI suggestions section for the enhanced RAG interface
        aiSuggestions.style.display = 'block';

        // Clear previous suggestions
        suggestedReplies.innerHTML = `
            <div class="suggestions-placeholder">
                <div class="placeholder-content">
                    <div class="placeholder-icon">🤖</div>
                    <h4>AI-Powered Smart Replies</h4>
                    <p>Click "Generate Reply" to create a contextual response based on your business knowledge.</p>
                    <div class="placeholder-features">
                        <span class="feature-tag">📚 Business Context</span>
                        <span class="feature-tag">🎯 Personalized</span>
                        <span class="feature-tag">⚡ Instant</span>
                    </div>
                </div>
            </div>
        `;

        // Check if we can generate suggestions (optional: auto-generate for high-priority emails)
        if (email.aiCategory === 'Interested' || email.aiCategory === 'Meeting Booked') {
            // Auto-generate for interested leads
            setTimeout(() => {
                if (this.selectedEmail && this.selectedEmail.id === email.id) {
                    this.generateSuggestedReply();
                }
            }, 1000);
        }
    }

    async performSearch() {
        const searchInput = document.getElementById('searchInput');
        if (!searchInput) return;

        const query = searchInput.value.trim();
        this.currentQuery = query;

        if (query === '') {
            await this.loadEmails();
            return;
        }

        try {
            this.showLoading(true);
            console.log(`Searching for: "${query}"`);

            const response = await fetch(`${API_BASE_URL}/api/emails?q=${encodeURIComponent(query)}`);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();

            if (data.success) {
                this.emails = data.data || [];
                // Don't update lastEmailCount for search results
                this.renderEmailList();
                this.updateEmailCount();
                this.showToast(`Found ${this.emails.length} emails for "${query}"`, 'success');
                console.log(`Search successful: ${this.emails.length} emails found`);
            } else {
                throw new Error(data.message || 'Search failed');
            }
        } catch (error) {
            console.error('Search error:', error);
            this.showToast(`❌ Search failed: ${error.message}`, 'error');
            // Keep current emails on search failure
        } finally {
            this.showLoading(false);
        }
    }

    applyFilters() {
        const accountFilter = document.getElementById('accountFilter');
        const categoryFilter = document.getElementById('categoryFilter');
        const dateFrom = document.getElementById('dateFrom');
        const dateTo = document.getElementById('dateTo');

        this.currentFilters = {
            account: accountFilter?.value || '',
            category: categoryFilter?.value || '',
            dateFrom: dateFrom?.value || '',
            dateTo: dateTo?.value || ''
        };

        // Apply filters to current email list
        this.renderFilteredEmails();
    }

    renderFilteredEmails() {
        let filteredEmails = [...this.emails];

        // Apply filters
        if (this.currentFilters.account) {
            filteredEmails = filteredEmails.filter(email =>
                email.accountId === this.currentFilters.account
            );
        }

        if (this.currentFilters.category) {
            filteredEmails = filteredEmails.filter(email =>
                email.aiCategory === this.currentFilters.category
            );
        }

        if (this.currentFilters.dateFrom) {
            const fromDate = new Date(this.currentFilters.dateFrom);
            filteredEmails = filteredEmails.filter(email =>
                new Date(email.date) >= fromDate
            );
        }

        if (this.currentFilters.dateTo) {
            const toDate = new Date(this.currentFilters.dateTo);
            toDate.setHours(23, 59, 59, 999);
            filteredEmails = filteredEmails.filter(email =>
                new Date(email.date) <= toDate
            );
        }

        const emailList = document.getElementById('emailList');
        if (emailList) {
            emailList.innerHTML = filteredEmails.map(email => this.renderEmailItem(email)).join('');
        }

        this.updateEmailCount(filteredEmails.length);
    }

    clearFilters() {
        const accountFilter = document.getElementById('accountFilter');
        const categoryFilter = document.getElementById('categoryFilter');
        const dateFrom = document.getElementById('dateFrom');
        const dateTo = document.getElementById('dateTo');

        if (accountFilter) accountFilter.value = '';
        if (categoryFilter) categoryFilter.value = '';
        if (dateFrom) dateFrom.value = '';
        if (dateTo) dateTo.value = '';

        this.currentFilters = {};
        this.renderEmailList();
        this.updateEmailCount();
    }

    async refreshEmails() {
        this.showToast('🔄 Refreshing emails...', 'info');
        await this.loadEmails();
        await this.loadStats();
        this.showToast('✅ Emails refreshed', 'success');
    }

    updateHeaderStats(stats) {
        const totalEmails = document.getElementById('totalEmails');
        const interestedEmails = document.getElementById('interestedEmails');
        const todayEmails = document.getElementById('todayEmails');

        if (totalEmails) totalEmails.textContent = stats.total || 0;
        if (interestedEmails) interestedEmails.textContent = stats.byCategory.interested || 0;

        // Calculate today's emails
        const today = new Date().toDateString();
        const todayCount = this.emails.filter(email =>
            new Date(email.date).toDateString() === today
        ).length;
        if (todayEmails) todayEmails.textContent = todayCount;
    }

    updateSidebarCounts(stats) {
        const inboxCount = document.getElementById('inboxCount');
        const spamCount = document.getElementById('spamCount');

        if (inboxCount) inboxCount.textContent = stats.total || 0;
        if (spamCount) spamCount.textContent = stats.byCategory.spam || 0;
    }

    updateCategoryStats(stats) {
        const container = document.getElementById('categoryStats');
        if (!container) return;

        const categories = [
            { key: 'interested', label: '🎯 Interested', color: '#28a745' },
            { key: 'meeting_booked', label: '📅 Meeting Booked', color: '#007bff' },
            { key: 'not_interested', label: '❌ Not Interested', color: '#6c757d' },
            { key: 'spam', label: '🚫 Spam', color: '#dc3545' },
            { key: 'out_of_office', label: '🏖️ Out of Office', color: '#ffc107' }
        ];

        container.innerHTML = categories.map(category => `
            <div class="stat-row">
                <span class="stat-label">${category.label}</span>
                <span class="stat-count">${stats.byCategory[category.key] || 0}</span>
            </div>
        `).join('');
    }

    updateEmailCount(customCount) {
        const emailCount = document.getElementById('emailCount');
        if (emailCount) {
            const count = customCount !== undefined ? customCount : this.emails.length;
            emailCount.textContent = `${count} emails`;
        }
    }

    toggleSelectAll(checked) {
        const checkboxes = document.querySelectorAll('.email-checkbox');
        checkboxes.forEach(checkbox => {
            checkbox.checked = checked;
        });
    }

    handleMenuClick(menuItem) {
        // Remove active class from all menu items
        document.querySelectorAll('.menu-item').forEach(item => {
            item.classList.remove('active');
        });

        // Add active class to clicked item
        menuItem.classList.add('active');

        // Handle menu actions (placeholder for future functionality)
        const menuText = menuItem.querySelector('.menu-text')?.textContent;
        console.log(`Clicked menu: ${menuText}`);
    }

    showLoading(show) {
        const loadingEmails = document.getElementById('loadingEmails');
        const emailList = document.getElementById('emailList');

        if (loadingEmails) {
            loadingEmails.style.display = show ? 'flex' : 'none';
        }
        if (emailList) {
            emailList.style.display = show ? 'none' : 'block';
        }
    }

    renderEmptyState() {
        const emailList = document.getElementById('emailList');
        const emptyState = document.getElementById('emptyState');

        if (emailList) emailList.style.display = 'none';
        if (emptyState) emptyState.style.display = 'flex';
    }

    startRealTimeUpdates() {
        // Only check for new emails every 2 minutes to reduce resource usage
        this.checkInterval = setInterval(async () => {
            await this.checkForNewEmails();
        }, 120000); // 2 minutes instead of 30 seconds

        // Check once immediately after 10 seconds
        setTimeout(async () => {
            await this.checkForNewEmails();
        }, 10000);
    }

    async checkForNewEmails() {
        // Prevent multiple simultaneous checks
        if (this.isCheckingUpdates) {
            console.log('Update check already in progress, skipping...');
            return;
        }

        // Don't check if we just loaded emails recently (within last 30 seconds)
        if (this.lastCheckTime && (new Date() - this.lastCheckTime) < 30000) {
            console.log('Recent check performed, skipping update check...');
            return;
        }

        this.isCheckingUpdates = true;

        try {
            // Only check count first - much lighter operation
            const response = await fetch(`${API_BASE_URL}/api/emails/count`);
            const data = await response.json();

            if (data.success) {
                const currentCount = data.count;

                // Only fetch full emails if count has actually increased
                if (currentCount > this.lastEmailCount) {
                    console.log(`New emails detected: ${currentCount} vs ${this.lastEmailCount}`);
                    this.showToast(`📧 ${currentCount - this.lastEmailCount} new emails received`, 'info');

                    // Only fetch emails if we're in list view and not searching
                    if (this.currentView === 'list' && !this.currentQuery) {
                        await this.loadNewEmailsOnly();
                        await this.loadStats();
                    } else {
                        // Just update the count without full reload
                        this.lastEmailCount = currentCount;
                    }
                } else if (currentCount < this.lastEmailCount) {
                    // Emails might have been deleted, update count
                    console.log(`Email count decreased: ${currentCount} vs ${this.lastEmailCount}`);
                    this.lastEmailCount = currentCount;

                    // Only reload if we're in list view
                    if (this.currentView === 'list' && !this.currentQuery) {
                        await this.loadEmails();
                        await this.loadStats();
                    }
                }

                this.lastCheckTime = new Date();
            }
        } catch (error) {
            console.error('Error checking for new emails:', error);
            // Don't show error toast for background checks to avoid spam
        } finally {
            this.isCheckingUpdates = false;
        }
    }

    async loadNewEmailsOnly() {
        try {
            // Fetch emails newer than our last check time
            const sinceParam = this.lastCheckTime ? `&since=${encodeURIComponent(this.lastCheckTime.toISOString())}` : '';
            const response = await fetch(`${API_BASE_URL}/api/emails?limit=1000${sinceParam}`);
            const data = await response.json();

            if (data.success && data.data && data.data.length > 0) {
                // Merge new emails with existing ones, avoiding duplicates
                const newEmails = data.data.filter(newEmail =>
                    !this.emails.some(existingEmail => existingEmail.id === newEmail.id)
                );

                if (newEmails.length > 0) {
                    // Add new emails to the beginning of the list
                    this.emails = [...newEmails, ...this.emails];
                    this.lastEmailCount = this.emails.length;
                    this.renderEmailList();
                    this.updateEmailCount();
                    console.log(`Added ${newEmails.length} new emails to the list`);
                }
            }
        } catch (error) {
            console.error('Error loading new emails:', error);
            // Fallback to full reload if incremental update fails
            await this.loadEmails();
        }
    }

    // Clean up interval when page unloads
    destructor() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
    }

    showToast(message, type = 'info') {
        const toastContainer = document.getElementById('toastContainer');
        if (!toastContainer) return;

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;

        toastContainer.appendChild(toast);

        // Remove toast after 5 seconds
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 5000);
    }

    // Utility methods
    formatEmailDate(date) {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const emailDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

        if (emailDate.getTime() === today.getTime()) {
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else if (emailDate.getTime() === today.getTime() - 86400000) {
            return 'Yesterday';
        } else {
            return date.toLocaleDateString();
        }
    }

    createEmailSnippet(body, maxLength = 100) {
        if (!body) return '';

        // Remove HTML tags and get plain text
        const plainText = body.replace(/<[^>]*>/g, '').trim();

        if (plainText.length <= maxLength) {
            return plainText;
        }

        return plainText.substring(0, maxLength) + '...';
    }

    formatCategory(category) {
        const categoryMap = {
            interested: '🎯 Interested',
            meeting_booked: '📅 Meeting Booked',
            not_interested: '❌ Not Interested',
            spam: '🚫 Spam',
            out_of_office: '🏖️ Out of Office'
        };
        return categoryMap[category] || category;
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // OAuth Methods
    async connectGmail() {
        try {
            this.showToast('🔄 Opening Gmail authentication...', 'info');

            // Open popup window for OAuth
            const popup = window.open(
                `${API_BASE_URL}/api/auth/google`,
                'gmail-oauth',
                'width=500,height=600,scrollbars=yes,resizable=yes,status=yes,location=yes,toolbar=no,menubar=no'
            );

            // Handle popup blocking
            if (!popup || popup.closed || typeof popup.closed === 'undefined') {
                this.showToast('❌ Popup blocked! Please allow popups for this site.', 'error');
                return;
            }

            // Focus the popup
            popup.focus();

            // Listen for OAuth completion
            this.listenForOAuthCompletion(popup, 'Gmail');

        } catch (error) {
            console.error('❌ Error connecting Gmail:', error);
            this.showToast('❌ Failed to connect Gmail account', 'error');
        }
    }

    async connectOutlook() {
        try {
            this.showToast('🔄 Opening Outlook authentication...', 'info');

            // Open popup window for OAuth
            const popup = window.open(
                `${API_BASE_URL}/api/auth/microsoft`,
                'outlook-oauth',
                'width=500,height=600,scrollbars=yes,resizable=yes,status=yes,location=yes,toolbar=no,menubar=no'
            );

            // Handle popup blocking
            if (!popup || popup.closed || typeof popup.closed === 'undefined') {
                this.showToast('❌ Popup blocked! Please allow popups for this site.', 'error');
                return;
            }

            // Focus the popup
            popup.focus();

            // Listen for OAuth completion
            this.listenForOAuthCompletion(popup, 'Outlook');

        } catch (error) {
            console.error('❌ Error connecting Outlook:', error);
            this.showToast('❌ Failed to connect Outlook account', 'error');
        }
    }

    listenForOAuthCompletion(popup, providerName) {
        // Listen for messages from the popup
        const messageListener = (event) => {
            // Verify origin for security
            if (event.origin !== window.location.origin) {
                console.log('Ignoring message from different origin:', event.origin);
                return;
            }

            console.log('Received OAuth message:', event.data);

            if (event.data.type === 'oauth-success') {
                // Remove the event listener
                window.removeEventListener('message', messageListener);

                // Handle successful OAuth
                this.handleOAuthSuccess(event.data);

                // Close popup if still open
                if (popup && !popup.closed) {
                    popup.close();
                }
            } else if (event.data.type === 'oauth-error') {
                // Remove the event listener
                window.removeEventListener('message', messageListener);

                // Handle OAuth error
                this.handleOAuthError(event.data);

                // Close popup if still open
                if (popup && !popup.closed) {
                    popup.close();
                }
            }
        };

        window.addEventListener('message', messageListener, false);

        // Store reference to popup for cleanup
        window.oauthPopup = popup;

        // Also check if popup was closed manually
        const checkClosed = setInterval(() => {
            if (popup.closed) {
                clearInterval(checkClosed);
                window.removeEventListener('message', messageListener);

                // Only show message if we haven't received a success message
                setTimeout(() => {
                    if (!popup.authCompleted) {
                        this.showToast(`${providerName} authentication was cancelled`, 'info');
                    }
                }, 500);
            }
        }, 1000);
    }

    handleOAuthSuccess(data) {
        // Mark as completed to avoid showing cancelled message
        if (window.oauthPopup) {
            window.oauthPopup.authCompleted = true;
        }

        this.showToast(`✅ ${data.provider} account connected successfully!`, 'success');

        // Force refresh everything after a short delay to ensure backend processing is complete
        setTimeout(() => {
            this.refreshPageData();
        }, 1000);
    }

    handleOAuthError(data) {
        this.showToast(`❌ Failed to connect account: ${data.error}`, 'error');
    }

    async refreshPageData() {
        try {
            // Show loading indicator
            this.showToast('🔄 Refreshing data...', 'info');

            // Clear current data first
            this.emails = [];
            this.renderEmailList();
            this.updateEmailCount();

            // Force reload all data with a small delay to ensure server is ready
            await new Promise(resolve => setTimeout(resolve, 500));

            await Promise.all([
                this.loadEmails(),
                this.loadStats(),
                this.loadConnectedAccounts()
            ]);

            // Update the email count display
            this.updateEmailCount();

            this.showToast('✅ Account connected and emails loaded!', 'success');
        } catch (error) {
            console.error('❌ Error refreshing data:', error);
            this.showToast('⚠️ Please refresh the page manually', 'error');

            // Fallback: reload the entire page if data refresh fails
            setTimeout(() => {
                window.location.reload();
            }, 2000);
        }
    }

    async loadConnectedAccounts() {
        try {
            const response = await fetch(`${API_BASE_URL}/api/auth/accounts`);
            const data = await response.json();

            if (data.success) {
                this.displayConnectedAccounts(data.accounts);
            }
        } catch (error) {
            console.error('❌ Error loading connected accounts:', error);
        }
    }

    displayConnectedAccounts(accounts) {
        const container = document.getElementById('connectedAccounts');
        const accountFilter = document.getElementById('accountFilter');
        if (!container || !accountFilter) return;

        // Populate the account filter dropdown in the sidebar
        accountFilter.innerHTML = '<option value="">All Accounts</option>';
        accounts.forEach(account => {
            const option = document.createElement('option');
            option.value = account.email;  // Use email for direct matching
            option.textContent = account.email;
            accountFilter.appendChild(option);
        });

        if (accounts.length === 0) {
            container.innerHTML = `<div class="no-accounts">No email accounts connected</div>`;
            return;
        }

        // Generate the HTML for each connected account
        container.innerHTML = accounts.map(account => {
            // If a webhook URL exists, show "Connected", otherwise show "Add to Slack" button
            const slackIntegrationHtml = account.slackWebhookUrl
                ? `<div class="slack-status-connected">✓ Slack Connected</div>`
                : `<a href="/api/slack/install?accountId=${account.id}" class="slack-btn-small" target="_blank" title="Connect to Slack">
                   <img src="https://api.slack.com/img/add_to_slack.png" 
                        srcset="https://api.slack.com/img/add_to_slack.png 1x, https://api.slack.com/img/add_to_slack@2x.png 2x" 
                        alt="Add to Slack" />
               </a>`;

            return `
            <div class="account-item" data-account-id="${account.id}">
                <div class="account-info">
                    <div class="account-provider ${account.provider}">${account.provider === 'gmail' ? 'G' : 'M'}</div>
                    <div class="account-email" title="${account.email}">${account.email}</div>
                </div>
                <div class="account-integrations">
                    ${slackIntegrationHtml}
                </div>
                <div class="account-status ${account.isActive ? 'active' : 'inactive'}">
                    ${account.isActive ? 'Active' : 'Inactive'}
                </div>
                <div class="account-actions">
                     <button class="account-action-btn toggle-account-btn" data-account-id="${account.id}"
                             title="${account.isActive ? 'Deactivate' : 'Activate'}">
                         ${account.isActive ? '⏸️' : '▶️'}
                     </button>
                    <button class="account-action-btn remove-account-btn" data-account-id="${account.id}" title="Remove">🗑️</button>
                </div>
            </div>
        `;
        }).join('');

        // Add event listeners for account actions
        this.addAccountEventListeners();
    }

    addAccountEventListeners() {
        // Remove existing listeners to avoid duplicates
        document.removeEventListener('click', this.handleAccountActions);

        // Add event delegation for account actions
        this.handleAccountActions = (event) => {
            if (event.target.classList.contains('toggle-account-btn')) {
                const accountId = event.target.getAttribute('data-account-id');
                this.toggleAccount(accountId);
            } else if (event.target.classList.contains('remove-account-btn')) {
                const accountId = event.target.getAttribute('data-account-id');
                this.removeAccount(accountId);
            }
        };

        document.addEventListener('click', this.handleAccountActions);
    }

    async toggleAccount(accountId) {
        try {
            const response = await fetch(`${API_BASE_URL}/api/auth/accounts/${accountId}/toggle`, {
                method: 'POST'
            });
            const data = await response.json();

            if (data.success) {
                this.showNotification(`Account ${data.account.isActive ? 'activated' : 'deactivated'}`, 'success');
                this.loadConnectedAccounts();
                this.loadEmails(); // Refresh email list
            }
        } catch (error) {
            console.error('❌ Error toggling account:', error);
            this.showNotification('Failed to toggle account', 'error');
        }
    }

    async removeAccount(accountId) {
        if (!confirm('Are you sure you want to remove this email account?\n\nThis will:\n• Disconnect IMAP connection\n• Revoke OAuth tokens\n• Remove all stored data\n\nThis action cannot be undone.')) {
            return;
        }

        // Show loading state
        this.showNotification('🔄 Removing account and cleaning up...', 'info');

        try {
            const response = await fetch(`${API_BASE_URL}/api/auth/accounts/${accountId}`, {
                method: 'DELETE'
            });
            const data = await response.json();

            if (data.success) {
                const details = data.details || {};
                const email = details.email || 'Account';
                const provider = details.provider || '';

                this.showNotification(`✅ ${email} (${provider}) removed successfully!\n• IMAP disconnected\n• OAuth tokens revoked\n• Session cleared`, 'success');

                // Refresh the UI
                this.loadConnectedAccounts();
                this.loadEmails(); // Refresh email list
            } else {
                throw new Error(data.error || 'Failed to remove account');
            }
        } catch (error) {
            console.error('❌ Error removing account:', error);
            this.showNotification(`❌ Failed to remove account: ${error.message}`, 'error');
        }
    }

    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.innerHTML = `
            <div class="notification-content">
                <span class="notification-icon">${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span>
                <span class="notification-message">${message}</span>
            </div>
        `;

        // Add to page
        document.body.appendChild(notification);

        // Remove after 3 seconds
        setTimeout(() => {
            notification.style.opacity = '0';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 3000);
    }

    // ===============================
    // COMPOSE EMAIL FUNCTIONALITY
    // ===============================

    initializeComposeFeatures() {
        // Initialize editor toolbar buttons
        this.setupEditorToolbar();

        // Initialize attachment handling
        this.setupAttachmentHandling();

        // Load sender accounts when modal opens
        this.loadSenderAccounts();
    }

    async openComposeModal() {
        const modal = document.getElementById('composeModal');
        if (modal) {
            await this.loadSenderAccounts();
            modal.style.display = 'flex';
            document.body.style.overflow = 'hidden';

            // Focus on the first input
            const firstInput = modal.querySelector('#toField');
            if (firstInput) {
                setTimeout(() => firstInput.focus(), 100);
            }
        }
    }

    closeComposeModal() {
        const modal = document.getElementById('composeModal');
        if (modal) {
            modal.style.display = 'none';
            document.body.style.overflow = 'auto';
            this.resetComposeForm();
        }
    }

    resetComposeForm() {
        const form = document.getElementById('composeForm');
        if (form) {
            form.reset();
            this.clearAttachments();
            document.getElementById('isHtml').checked = false;
            document.getElementById('requestReadReceipt').checked = false;
            document.getElementById('priority').value = 'normal';
        }
    }

    async loadSenderAccounts() {
        try {
            const response = await fetch(`${API_BASE_URL}/api/send/accounts`);
            const data = await response.json();

            const select = document.getElementById('fromAccount');
            if (select && data.success) {
                select.innerHTML = '<option value="">Select sender account...</option>';

                data.data.forEach(account => {
                    const option = document.createElement('option');
                    option.value = JSON.stringify(account);
                    option.textContent = `${account.email} (${account.provider})`;
                    select.appendChild(option);
                });
            }
        } catch (error) {
            console.error('Error loading sender accounts:', error);
            this.showNotification('Failed to load sender accounts', 'error');
        }
    }

    setupEditorToolbar() {
        const boldBtn = document.getElementById('boldBtn');
        const italicBtn = document.getElementById('italicBtn');
        const linkBtn = document.getElementById('linkBtn');
        const toggleHtmlBtn = document.getElementById('toggleHtmlBtn');
        const bodyField = document.getElementById('bodyField');

        if (boldBtn) {
            boldBtn.addEventListener('click', () => this.insertFormatting('**', '**', 'Bold text'));
        }
        if (italicBtn) {
            italicBtn.addEventListener('click', () => this.insertFormatting('*', '*', 'Italic text'));
        }
        if (linkBtn) {
            linkBtn.addEventListener('click', () => this.insertLink());
        }
        if (toggleHtmlBtn) {
            toggleHtmlBtn.addEventListener('click', () => this.toggleHtmlMode());
        }
    }

    insertFormatting(startTag, endTag, placeholder) {
        const textarea = document.getElementById('bodyField');
        if (!textarea) return;

        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const selectedText = textarea.value.substring(start, end);
        const replacement = selectedText || placeholder;

        const before = textarea.value.substring(0, start);
        const after = textarea.value.substring(end);

        textarea.value = before + startTag + replacement + endTag + after;

        // Set cursor position
        const newPos = start + startTag.length + replacement.length;
        textarea.selectionStart = textarea.selectionEnd = newPos;
        textarea.focus();
    }

    insertLink() {
        const url = prompt('Enter URL:');
        if (url) {
            const text = prompt('Link text (leave blank to use URL):') || url;
            this.insertFormatting(`[${text}](`, ')', url);
        }
    }

    toggleHtmlMode() {
        const checkbox = document.getElementById('isHtml');
        const button = document.getElementById('toggleHtmlBtn');

        if (checkbox && button) {
            checkbox.checked = !checkbox.checked;
            button.classList.toggle('active', checkbox.checked);

            if (checkbox.checked) {
                this.showNotification('HTML mode enabled', 'info');
            } else {
                this.showNotification('HTML mode disabled', 'info');
            }
        }
    }

    setupAttachmentHandling() {
        const fileInput = document.getElementById('attachments');
        if (fileInput) {
            fileInput.addEventListener('change', (e) => this.handleFileSelection(e));
        }
    }

    handleFileSelection(event) {
        const files = Array.from(event.target.files);
        const maxFileSize = 25 * 1024 * 1024; // 25MB
        const maxFiles = 10;

        // Validate file count
        if (files.length > maxFiles) {
            this.showNotification(`Maximum ${maxFiles} files allowed`, 'error');
            event.target.value = '';
            return;
        }

        // Validate file sizes
        for (let file of files) {
            if (file.size > maxFileSize) {
                this.showNotification(`File "${file.name}" exceeds 25MB limit`, 'error');
                event.target.value = '';
                return;
            }
        }

        this.displayAttachments(files);
    }

    displayAttachments(files) {
        const container = document.getElementById('attachmentList');
        if (!container) return;

        container.innerHTML = '';

        files.forEach((file, index) => {
            const item = document.createElement('div');
            item.className = 'attachment-item';
            item.innerHTML = `
                <span>📎 ${file.name} (${this.formatFileSize(file.size)})</span>
                <button type="button" class="attachment-remove" onclick="emailClient.removeAttachment(${index})">×</button>
            `;
            container.appendChild(item);
        });
    }

    removeAttachment(index) {
        const fileInput = document.getElementById('attachments');
        if (!fileInput) return;

        const dt = new DataTransfer();
        const files = Array.from(fileInput.files);

        files.forEach((file, i) => {
            if (i !== index) dt.items.add(file);
        });

        fileInput.files = dt.files;
        this.displayAttachments(Array.from(dt.files));
    }

    clearAttachments() {
        const fileInput = document.getElementById('attachments');
        const container = document.getElementById('attachmentList');

        if (fileInput) fileInput.value = '';
        if (container) container.innerHTML = '';
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    async handleEmailSend(event) {
        event.preventDefault();

        const sendBtn = document.getElementById('sendEmailBtn');
        const originalText = sendBtn.innerHTML;

        try {
            // Disable send button and show loading
            sendBtn.disabled = true;
            sendBtn.innerHTML = '📤 Sending...';

            // Collect form data
            const formData = new FormData();

            const fromAccount = document.getElementById('fromAccount').value;
            if (!fromAccount) {
                throw new Error('Please select a sender account');
            }

            const accountData = JSON.parse(fromAccount);
            formData.append('fromAccount', accountData.id);

            // Required fields
            const to = document.getElementById('toField').value.trim();
            const subject = document.getElementById('subjectField').value.trim();
            const body = document.getElementById('bodyField').value.trim();

            if (!to || !subject || !body) {
                throw new Error('Please fill in all required fields (To, Subject, Message)');
            }

            formData.append('to', to);
            formData.append('subject', subject);
            formData.append('body', body);

            // Optional fields
            const cc = document.getElementById('ccField').value.trim();
            const bcc = document.getElementById('bccField').value.trim();
            if (cc) formData.append('cc', cc);
            if (bcc) formData.append('bcc', bcc);

            // Options
            formData.append('isHtml', document.getElementById('isHtml').checked);
            formData.append('requestReadReceipt', document.getElementById('requestReadReceipt').checked);
            formData.append('priority', document.getElementById('priority').value);

            // Attachments
            const attachments = document.getElementById('attachments').files;
            for (let i = 0; i < attachments.length; i++) {
                formData.append('attachments', attachments[i]);
            }

            // Send email
            const response = await fetch(`${API_BASE_URL}/api/send/email`, {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            if (result.success) {
                this.showNotification('✅ Email sent successfully!', 'success');
                this.closeComposeModal();
            } else {
                throw new Error(result.error || 'Failed to send email');
            }

        } catch (error) {
            console.error('Error sending email:', error);
            this.showNotification(`❌ Failed to send email: ${error.message}`, 'error');
        } finally {
            // Re-enable send button
            sendBtn.disabled = false;
            sendBtn.innerHTML = originalText;
        }
    }

    // Smart Replies functionality
    async initializeSmartReplies() {
        try {
            // Initialize Smart Replies UI
            this.setupSmartRepliesEventListeners();

            // Check RAG service health and update status
            await this.updateSmartRepliesStatus();

            // Load business contexts
            await this.loadBusinessContexts();

        } catch (error) {
            console.error('Error initializing Smart Replies:', error);
        }
    }

    setupSmartRepliesEventListeners() {
        // Smart Replies toggle
        const smartRepliesToggle = document.getElementById('smartRepliesToggle');
        const smartRepliesPanel = document.getElementById('smartRepliesPanel');

        if (smartRepliesToggle) {
            smartRepliesToggle.addEventListener('click', () => {
                smartRepliesPanel.classList.toggle('hidden');
                this.loadBusinessContexts();
            });
        }

        // Add context button
        const addContextBtn = document.getElementById('addContextBtn');
        if (addContextBtn) {
            addContextBtn.addEventListener('click', () => {
                this.openContextModal();
            });
        }

        // Generate reply button
        const generateReplyBtn = document.getElementById('generateReplyBtn');
        if (generateReplyBtn) {
            generateReplyBtn.addEventListener('click', () => {
                this.generateSuggestedReply();
            });
        }

        // Context modal events
        const closeContextModal = document.getElementById('closeContextModal');
        const contextModal = document.getElementById('contextModal');
        const addContextForm = document.getElementById('addContextForm');

        if (closeContextModal) {
            closeContextModal.addEventListener('click', () => {
                contextModal.style.display = 'none';
            });
        }

        if (contextModal) {
            contextModal.addEventListener('click', (e) => {
                if (e.target === contextModal) {
                    contextModal.style.display = 'none';
                }
            });
        }

        if (addContextForm) {
            addContextForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.addBusinessContext();
            });
        }
    }

    async updateSmartRepliesStatus() {
        try {
            const response = await fetch(`${API_BASE_URL}/api/rag/health`);
            const data = await response.json();

            const statusIndicator = document.querySelector('.smart-replies-status .status-dot');
            const statusText = document.querySelector('.smart-replies-status .status-text');

            if (data.success) {
                const services = data.data.services;
                const allConnected = services.chromadb === 'connected' && services.gemini === 'connected';

                if (allConnected) {
                    statusIndicator.className = 'status-dot connected';
                    statusText.textContent = 'Ready';
                } else {
                    statusIndicator.className = 'status-dot error';
                    statusText.textContent = 'Partial - Missing ' +
                        (services.chromadb !== 'connected' ? 'ChromaDB ' : '') +
                        (services.gemini !== 'connected' ? 'Gemini' : '');
                }
            } else {
                statusIndicator.className = 'status-dot error';
                statusText.textContent = 'Unavailable';
            }
        } catch (error) {
            console.error('Error checking RAG health:', error);
            const statusIndicator = document.querySelector('.smart-replies-status .status-dot');
            const statusText = document.querySelector('.smart-replies-status .status-text');
            statusIndicator.className = 'status-dot error';
            statusText.textContent = 'Error';
        }
    }

    async loadBusinessContexts() {
        try {
            const response = await fetch(`${API_BASE_URL}/api/rag/contexts`);
            const data = await response.json();

            if (data.success) {
                this.renderBusinessContexts(data.data, 'contextsList');
                this.renderBusinessContexts(data.data, 'existingContextsList');
            }
        } catch (error) {
            console.error('Error loading business contexts:', error);
        }
    }

    renderBusinessContexts(contexts, containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (contexts.length === 0) {
            container.innerHTML = '<p style="color: #94a3b8; font-size: 0.85em; text-align: center; padding: 20px;">No business contexts yet. Add your first context to get started!</p>';
            return;
        }

        container.innerHTML = contexts.map(context => `
            <div class="context-item" data-id="${context.id}">
                <div class="context-category">${context.category.replace('_', ' ')}</div>
                <div class="context-content">${context.content}</div>
                <div class="context-meta">
                    <span>Priority: ${context.priority} | Keywords: ${context.keywords.join(', ')}</span>
                    <div class="context-actions">
                        <button class="context-action-btn edit-context" data-id="${context.id}" title="Edit">✏️</button>
                        <button class="context-action-btn delete-context" data-id="${context.id}" title="Delete">🗑️</button>
                    </div>
                </div>
            </div>
        `).join('');

        // Add event listeners for edit and delete buttons
        container.querySelectorAll('.edit-context').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const contextId = e.target.dataset.id;
                this.editBusinessContext(contextId);
            });
        });

        container.querySelectorAll('.delete-context').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const contextId = e.target.dataset.id;
                this.deleteBusinessContext(contextId);
            });
        });
    }

    openContextModal() {
        const modal = document.getElementById('contextModal');
        modal.style.display = 'flex';
        this.loadBusinessContexts();
    }

    async addBusinessContext() {
        try {
            const content = document.getElementById('contextContent').value.trim();
            const category = document.getElementById('contextCategory').value;
            const priority = parseInt(document.getElementById('contextPriority').value);
            const keywords = document.getElementById('contextKeywords').value.split(',').map(k => k.trim()).filter(k => k);

            if (!content || !category || !keywords.length) {
                this.showToast('Please fill in all required fields', 'error');
                return;
            }

            const response = await fetch(`${API_BASE_URL}/api/rag/contexts`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    content,
                    category,
                    priority,
                    keywords
                })
            });

            const data = await response.json();

            if (data.success) {
                this.showToast('✅ Business context added successfully!', 'success');
                document.getElementById('addContextForm').reset();
                await this.loadBusinessContexts();
            } else {
                throw new Error(data.message || 'Failed to add business context');
            }
        } catch (error) {
            console.error('Error adding business context:', error);
            this.showToast(`❌ Failed to add context: ${error.message}`, 'error');
        }
    }

    async deleteBusinessContext(contextId) {
        if (!confirm('Are you sure you want to delete this business context?')) {
            return;
        }

        try {
            const response = await fetch(`${API_BASE_URL}/api/rag/contexts/${contextId}`, {
                method: 'DELETE'
            });

            const data = await response.json();

            if (data.success) {
                this.showToast('✅ Business context deleted successfully!', 'success');
                await this.loadBusinessContexts();
            } else {
                throw new Error(data.message || 'Failed to delete business context');
            }
        } catch (error) {
            console.error('Error deleting business context:', error);
            this.showToast(`❌ Failed to delete context: ${error.message}`, 'error');
        }
    }

    async generateSuggestedReply() {
        if (!this.selectedEmail) {
            this.showToast('Please select an email first', 'info');
            return;
        }

        try {
            const generateBtn = document.getElementById('generateReplyBtn');
            const loadingState = document.getElementById('suggestedReplyLoading');
            const repliesContainer = document.getElementById('suggestedReplies');

            // Show loading state
            generateBtn.disabled = true;
            generateBtn.textContent = 'Generating...';
            loadingState.style.display = 'flex';
            repliesContainer.innerHTML = '';

            // Debug: Check what we're sending
            const requestBody = {
                emailText: this.selectedEmail.body || '',
                emailSubject: this.selectedEmail.subject || ''
            };

            console.log('📤 Sending to Smart Replies API:', {
                emailText: requestBody.emailText.substring(0, 100) + (requestBody.emailText.length > 100 ? '...' : ''),
                emailSubject: requestBody.emailSubject,
                emailTextLength: requestBody.emailText.length
            });

            const response = await fetch(`${API_BASE_URL}/api/rag/suggest-reply`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            const data = await response.json();

            if (data.success) {
                this.renderSuggestedReply(data.data);
            } else {
                throw new Error(data.message || 'Failed to generate suggested reply');
            }

        } catch (error) {
            console.error('Error generating suggested reply:', error);
            this.showToast(`❌ Failed to generate reply: ${error.message}`, 'error');
            document.getElementById('suggestedReplies').innerHTML = `
                <div class="error-state">
                    <p>Failed to generate suggested reply. Please check your Smart Replies configuration.</p>
                </div>
            `;
        } finally {
            // Hide loading state
            const generateBtn = document.getElementById('generateReplyBtn');
            const loadingState = document.getElementById('suggestedReplyLoading');

            generateBtn.disabled = false;
            generateBtn.innerHTML = '✨ Generate Reply';
            loadingState.style.display = 'none';
        }
    }

    renderSuggestedReply(replyData) {
        const container = document.getElementById('suggestedReplies');

        // First, ensure accounts are loaded and auto-selected, then populate the compose form
        this.populateInlineComposeAccounts().then(() => {
            // After accounts are loaded, populate the compose form with the AI reply
            this.populateInlineCompose(replyData.reply);
        });

        container.innerHTML = `
            <div class="suggested-reply-card">
                <div class="reply-header">
                    <h4>💡 AI Reply Generated</h4>
                    <span class="reply-confidence">Confidence: ${Math.round(replyData.confidence * 100)}%</span>
                </div>
                
                <div class="reply-content">${replyData.reply}</div>
                
                <div class="reply-actions">
                    <button class="reply-action-btn primary" onclick="emailClient.generateSuggestedReply()">
                        � Regenerate Reply
                    </button>
                    <button class="reply-action-btn" onclick="emailClient.clearInlineCompose()">
                        �️ Clear Form
                    </button>
                </div>
                
                ${replyData.usedContext && replyData.usedContext.length > 0 ? `
                    <div class="used-context">
                        <h5>📚 Used Business Context:</h5>
                        ${replyData.usedContext.map(ctx => `
                            <span class="context-tag">${ctx.category.replace('_', ' ')}</span>
                        `).join('')}
                    </div>
                ` : ''}
            </div>
        `;

        // Show the inline compose form
        this.showInlineCompose();
    }

    populateInlineCompose(replyText) {
        // Get the inline compose form elements
        const inlineToField = document.getElementById('inlineToField');
        const inlineSubjectField = document.getElementById('inlineSubjectField');
        const inlineBodyField = document.getElementById('inlineBodyField');
        const inlineFromAccount = document.getElementById('inlineFromAccount');

        if (this.selectedEmail) {
            // Extract sender information from the received email
            const senderEmail = this.extractEmailAddress(this.selectedEmail.from);
            const senderName = this.extractSenderName(this.selectedEmail.from);

            console.log(`📧 Auto-filling reply to: ${senderEmail} (${senderName})`);

            // Pre-fill TO field with sender's email address
            if (inlineToField) {
                inlineToField.value = senderEmail;
                inlineToField.title = `Reply to: ${this.selectedEmail.from}`; // Show full sender info on hover
            }

            // Pre-fill SUBJECT field with "Re:" prefix
            if (inlineSubjectField) {
                const subject = this.selectedEmail.subject || '';
                inlineSubjectField.value = subject.startsWith('Re: ') ? subject : `Re: ${subject}`;
            }

            // Auto-select the FROM account that received this email
            this.autoSelectFromAccount(inlineFromAccount);
        }

        // Populate with AI-generated reply
        if (inlineBodyField) {
            inlineBodyField.value = replyText;
        }
    }

    // Separate function to handle FROM account auto-selection
    autoSelectFromAccount(inlineFromAccount) {
        if (!inlineFromAccount || !this.selectedEmail) {
            console.warn('⚠️ Cannot auto-select account: missing elements or email data');
            return;
        }

        // Get the email address that received this email (the "to" field)
        let receiverEmail = '';
        if (this.selectedEmail.to) {
            receiverEmail = Array.isArray(this.selectedEmail.to)
                ? this.selectedEmail.to[0]
                : this.selectedEmail.to;
        }

        const cleanReceiverEmail = this.extractEmailAddress(receiverEmail);

        console.log(`🎯 Looking for account that matches receiver: ${cleanReceiverEmail}`);

        // If no valid receiver email, try to select first account
        if (!cleanReceiverEmail) {
            if (inlineFromAccount.options.length > 1) {
                inlineFromAccount.selectedIndex = 1; // Select first non-default option
                console.log('✅ No receiver email found, selected first available account');
                return;
            }
        }

        // Try direct value match first - most reliable
        inlineFromAccount.value = cleanReceiverEmail;

        // If direct match worked
        if (inlineFromAccount.value === cleanReceiverEmail) {
            console.log(`✅ Found exact match for ${cleanReceiverEmail}`);
            return;
        }

        // If direct match failed, try partial match
        const options = inlineFromAccount.options;

        for (let i = 0; i < options.length; i++) {
            const optionText = options[i].textContent || '';
            const optionValue = options[i].value;

            // Skip the default "Select sender account..." option
            if (optionValue === '' || optionText.includes('Select sender')) {
                continue;
            }

            // Try to match any part of the email
            if (optionText.toLowerCase().includes(cleanReceiverEmail.toLowerCase()) ||
                optionValue.toLowerCase().includes(cleanReceiverEmail.toLowerCase()) ||
                cleanReceiverEmail.toLowerCase().includes(optionValue.toLowerCase())) {
                inlineFromAccount.selectedIndex = i;
                console.log(`✅ Found partial match: ${optionText}`);
                return;
            }
        }

        // If still no match, just select the first account (if any)
        if (options.length > 1) {
            inlineFromAccount.selectedIndex = 1; // First non-default option
            console.log(`✅ No match found, selected first account: ${options[1].textContent}`);
        } else {
            console.warn('⚠️ No accounts available to select');
        }
    }

    // Helper function to extract email address from "Name <email@domain.com>" format
    extractEmailAddress(emailString) {
        if (!emailString) return '';

        // Check if it's in "Name <email@domain.com>" format
        const emailMatch = emailString.match(/<([^>]+)>/);
        if (emailMatch) {
            return emailMatch[1].trim();
        }

        // If no angle brackets, assume it's just the email address
        return emailString.trim();
    }

    // Helper function to extract sender name from "Name <email@domain.com>" format
    extractSenderName(emailString) {
        if (!emailString) return '';

        // Check if it's in "Name <email@domain.com>" format
        const nameMatch = emailString.match(/^([^<]+)</);
        if (nameMatch) {
            return nameMatch[1].trim().replace(/^["']|["']$/g, ''); // Remove quotes if present
        }

        // If no angle brackets, try to extract name from email
        const emailPart = emailString.split('@')[0];
        return emailPart || emailString;
    }

    showInlineCompose() {
        const inlineCompose = document.getElementById('inlineCompose');
        if (inlineCompose) {
            inlineCompose.style.display = 'block';
        }
    }

    clearInlineCompose() {
        const inlineToField = document.getElementById('inlineToField');
        const inlineSubjectField = document.getElementById('inlineSubjectField');
        const inlineBodyField = document.getElementById('inlineBodyField');

        if (inlineToField) inlineToField.value = '';
        if (inlineSubjectField) inlineSubjectField.value = '';
        if (inlineBodyField) inlineBodyField.value = '';

        // Hide the form
        const inlineCompose = document.getElementById('inlineCompose');
        if (inlineCompose) {
            inlineCompose.style.display = 'none';
        }

        this.showToast('🗑️ Compose form cleared', 'info');
    }

    async sendInlineReply() {
        const inlineToField = document.getElementById('inlineToField');
        const inlineSubjectField = document.getElementById('inlineSubjectField');
        const inlineBodyField = document.getElementById('inlineBodyField');
        const fromAccountField = document.getElementById('inlineFromAccount');

        if (!inlineToField || !inlineSubjectField || !inlineBodyField || !fromAccountField) {
            this.showToast('❌ Form elements not found', 'error');
            return;
        }

        const to = inlineToField.value.trim();
        const subject = inlineSubjectField.value.trim();
        const body = inlineBodyField.value.trim();
        const fromAccountEmail = fromAccountField.value;

        if (!to || !subject || !body || !fromAccountEmail) {
            this.showToast('❌ Please fill all required fields', 'error');
            return;
        }

        try {
            // Show sending state
            const sendBtn = document.getElementById('inlineSendBtn');
            if (sendBtn) {
                sendBtn.disabled = true;
                sendBtn.innerHTML = '📤 Sending...';
            }

            // First, get the account ID for the selected email address
            const accountsResponse = await fetch(`${API_BASE_URL}/api/auth/accounts`);
            const accountsResult = await accountsResponse.json();

            if (!accountsResult.success || !accountsResult.accounts || accountsResult.accounts.length === 0) {
                throw new Error('Failed to retrieve account information');
            }

            // Find the matching account by email
            const selectedAccount = accountsResult.accounts.find(account => account.email === fromAccountEmail);

            if (!selectedAccount) {
                throw new Error(`No account found matching the email: ${fromAccountEmail}`);
            }

            // Now send the email using the account ID
            const response = await fetch(`${API_BASE_URL}/api/send/email`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    fromAccount: selectedAccount.id, // Use the account ID here
                    to: to, // Send as a string, not an array
                    subject,
                    body,
                    isHtml: false
                })
            });

            const result = await response.json();

            if (result.success) {
                this.showToast('✅ Email sent successfully!', 'success');
                this.clearInlineCompose();
            } else {
                throw new Error(result.error || 'Failed to send email');
            }

        } catch (error) {
            console.error('Error sending email:', error);
            this.showToast(`❌ Failed to send email: ${error.message}`, 'error');
        } finally {
            // Reset send button
            const sendBtn = document.getElementById('inlineSendBtn');
            if (sendBtn) {
                sendBtn.disabled = false;
                sendBtn.innerHTML = '📤 Send Reply';
            }
        }
    }

    useReplyAsTemplate(replyText) {
        // Open compose modal with the suggested reply as template
        this.openComposeModal();

        setTimeout(() => {
            const bodyField = document.getElementById('bodyField');
            if (bodyField) {
                bodyField.value = replyText;

                // If we have a selected email, pre-fill reply fields
                if (this.selectedEmail) {
                    const toField = document.getElementById('toField');
                    const subjectField = document.getElementById('subjectField');

                    if (toField) toField.value = this.selectedEmail.from;
                    if (subjectField) {
                        const subject = this.selectedEmail.subject || '';
                        subjectField.value = subject.startsWith('Re: ') ? subject : `Re: ${subject}`;
                    }
                }
            }
        }, 100);

        this.showToast('✅ Reply template loaded in compose window', 'success');
    }

    async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            this.showToast('📋 Copied to clipboard!', 'success');
        } catch (error) {
            console.error('Error copying to clipboard:', error);
            this.showToast('❌ Failed to copy to clipboard', 'error');
        }
    }

    // Cleanup method for when the page is closed or navigated away
    cleanup() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
        if (this.syncCheckInterval) {
            clearInterval(this.syncCheckInterval);
            this.syncCheckInterval = null;
        }
    }
}// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('Initializing Gmail Email Client...');
    window.emailClient = new GmailEmailClient();
});

// Cleanup when page is closed
window.addEventListener('beforeunload', () => {
    if (window.emailClient) {
        window.emailClient.cleanup();
    }
});

// Clean up on page unload
window.addEventListener('beforeunload', () => {
    if (window.emailClient && window.emailClient.destructor) {
        window.emailClient.destructor();
    }
});
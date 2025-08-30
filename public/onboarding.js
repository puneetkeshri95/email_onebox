// Onboarding JavaScript functionality
const API_BASE_URL = window.location.origin;

// Smooth scrolling for navigation
function scrollToSection(sectionId) {
    const section = document.getElementById(sectionId);
    if (section) {
        section.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        });
    }
}

// Show demo functionality
function showDemo() {
    showToast('Demo video coming soon! For now, try connecting your account below.', 'info');
}

// Toast notification system
function showToast(message, type = 'info') {
    const toastContainer = document.getElementById('toastContainer');
    if (!toastContainer) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;

    toastContainer.appendChild(toast);

    // Remove toast after 4 seconds
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }, 4000);
}

// Loading overlay functions
function showLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        overlay.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }
}

function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        overlay.style.display = 'none';
        document.body.style.overflow = 'auto';
    }
}

// OAuth connection functions
async function connectGmail() {
    try {
        showLoading();
        
        // Reset success flag
        window.gmailConnectionSuccess = false;
        
        // Check if we're already authenticated
        const checkResponse = await fetch(`${API_BASE_URL}/api/auth/status`);
        const status = await checkResponse.json();
        
        if (status.isAuthenticated && status.connectedAccounts?.some(acc => acc.provider === 'gmail')) {
            hideLoading();
            showToast('Gmail account already connected! Redirecting to dashboard...', 'success');
            setTimeout(() => {
                window.location.href = '/';
            }, 1500);
            return;
        }

        // Open OAuth popup
        const popup = window.open(
            `${API_BASE_URL}/api/auth/google`,
            'gmail-oauth',
            'width=500,height=600,scrollbars=yes,resizable=yes'
        );

        if (!popup) {
            throw new Error('Popup blocked. Please allow popups and try again.');
        }

        // Listen for messages from popup
        const messageListener = (event) => {
            if (event.origin !== window.location.origin) return;

            console.log('Received message from popup:', event.data);

            if (event.data.type === 'OAUTH_SUCCESS' || event.data.type === 'oauth-success') {
                window.gmailConnectionSuccess = true;
                clearInterval(popupChecker);
                hideLoading();
                showToast('✅ Gmail connected successfully! Welcome to Email Onebox!', 'success');
                
                setTimeout(() => {
                    window.location.href = '/';
                }, 2000);
                
                window.removeEventListener('message', messageListener);
                if (!popup.closed) {
                    popup.close();
                }
            } else if (event.data.type === 'OAUTH_ERROR' || event.data.type === 'oauth-error') {
                clearInterval(popupChecker);
                hideLoading();
                showToast(`❌ Failed to connect Gmail: ${event.data.error}`, 'error');
                window.removeEventListener('message', messageListener);
                if (!popup.closed) {
                    popup.close();
                }
            }
        };

        window.addEventListener('message', messageListener);

        // Check if popup was closed manually
        const popupChecker = setInterval(async () => {
            if (popup.closed) {
                clearInterval(popupChecker);
                window.removeEventListener('message', messageListener);
                
                // Wait a bit for potential auth completion
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // Check if authentication actually succeeded (fallback)
                const authSuccess = await fallbackAuthCheck('gmail');
                
                if (!authSuccess && !window.gmailConnectionSuccess) {
                    hideLoading();
                    showToast('Gmail connection was cancelled.', 'info');
                }
            }
        }, 1000);

    } catch (error) {
        hideLoading();
        console.error('Gmail connection error:', error);
        showToast(`Failed to connect Gmail: ${error.message}`, 'error');
    }
}

async function connectOutlook() {
    try {
        showLoading();
        
        // Reset success flag
        window.outlookConnectionSuccess = false;
        
        // Check if we're already authenticated
        const checkResponse = await fetch(`${API_BASE_URL}/api/auth/status`);
        const status = await checkResponse.json();
        
        if (status.isAuthenticated && status.connectedAccounts?.some(acc => acc.provider === 'outlook')) {
            hideLoading();
            showToast('Outlook account already connected! Redirecting to dashboard...', 'success');
            setTimeout(() => {
                window.location.href = '/';
            }, 1500);
            return;
        }

        // Open OAuth popup
        const popup = window.open(
            `${API_BASE_URL}/api/auth/microsoft`,
            'outlook-oauth',
            'width=500,height=600,scrollbars=yes,resizable=yes'
        );

        if (!popup) {
            throw new Error('Popup blocked. Please allow popups and try again.');
        }

        // Listen for messages from popup
        const messageListener = (event) => {
            if (event.origin !== window.location.origin) return;

            console.log('Received message from popup:', event.data);

            if (event.data.type === 'OAUTH_SUCCESS' || event.data.type === 'oauth-success') {
                window.outlookConnectionSuccess = true;
                clearInterval(popupChecker);
                hideLoading();
                showToast('✅ Outlook connected successfully! Welcome to Email Onebox!', 'success');
                
                setTimeout(() => {
                    window.location.href = '/';
                }, 2000);
                
                window.removeEventListener('message', messageListener);
                if (!popup.closed) {
                    popup.close();
                }
            } else if (event.data.type === 'OAUTH_ERROR' || event.data.type === 'oauth-error') {
                clearInterval(popupChecker);
                hideLoading();
                showToast(`❌ Failed to connect Outlook: ${event.data.error}`, 'error');
                window.removeEventListener('message', messageListener);
                if (!popup.closed) {
                    popup.close();
                }
            }
        };

        window.addEventListener('message', messageListener);

        // Check if popup was closed manually
        const popupChecker = setInterval(async () => {
            if (popup.closed) {
                clearInterval(popupChecker);
                window.removeEventListener('message', messageListener);
                
                // Wait a bit for potential auth completion
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // Check if authentication actually succeeded (fallback)
                const authSuccess = await fallbackAuthCheck('outlook');
                
                if (!authSuccess && !window.outlookConnectionSuccess) {
                    hideLoading();
                    showToast('Outlook connection was cancelled.', 'info');
                }
            }
        }, 1000);

    } catch (error) {
        hideLoading();
        console.error('Outlook connection error:', error);
        showToast(`Failed to connect Outlook: ${error.message}`, 'error');
    }
}

// Scroll animations
function handleScrollAnimations() {
    const elements = document.querySelectorAll('.feature-card, .step');
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    });

    elements.forEach(element => {
        element.style.opacity = '0';
        element.style.transform = 'translateY(50px)';
        element.style.transition = 'all 0.6s ease-out';
        observer.observe(element);
    });
}

// Navbar scroll effect
function handleNavbarScroll() {
    const navbar = document.querySelector('.navbar');
    
    window.addEventListener('scroll', () => {
        if (window.scrollY > 100) {
            navbar.style.background = 'rgba(255, 255, 255, 0.98)';
            navbar.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.1)';
        } else {
            navbar.style.background = 'rgba(255, 255, 255, 0.95)';
            navbar.style.boxShadow = 'none';
        }
    });
}

// Typing animation for hero title
function startTypingAnimation() {
    const titleElement = document.querySelector('.hero-title');
    if (!titleElement) return;

    const fullText = titleElement.innerHTML;
    titleElement.innerHTML = '';
    titleElement.style.opacity = '1';

    let index = 0;
    function typeWriter() {
        if (index < fullText.length) {
            titleElement.innerHTML = fullText.slice(0, index + 1);
            index++;
            setTimeout(typeWriter, 50);
        }
    }

    // Start typing animation after a delay
    setTimeout(typeWriter, 500);
}

// Particle animation for background
function createParticles() {
    const particleContainer = document.createElement('div');
    particleContainer.className = 'particles';
    particleContainer.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: -1;
    `;
    
    document.body.appendChild(particleContainer);

    for (let i = 0; i < 50; i++) {
        const particle = document.createElement('div');
        particle.style.cssText = `
            position: absolute;
            width: 2px;
            height: 2px;
            background: rgba(99, 102, 241, 0.3);
            border-radius: 50%;
            animation: float ${5 + Math.random() * 10}s linear infinite;
            left: ${Math.random() * 100}%;
            top: ${Math.random() * 100}%;
            animation-delay: ${Math.random() * 5}s;
        `;
        particleContainer.appendChild(particle);
    }
}

// Check authentication status on load
async function checkAuthStatus() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/auth/status`);
        const status = await response.json();
        
        if (status.isAuthenticated && status.connectedAccounts?.length > 0) {
            // User is already authenticated, redirect to main app
            showToast('You are already signed in! Redirecting to dashboard...', 'info');
            setTimeout(() => {
                window.location.href = '/';
            }, 1500);
            return true;
        }
        return false;
    } catch (error) {
        console.log('Not authenticated yet, showing onboarding');
        return false;
    }
}

// Fallback auth check - used when popup communication might fail
async function fallbackAuthCheck(provider) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/auth/status`);
        const status = await response.json();
        
        if (status.isAuthenticated && status.connectedAccounts?.some(acc => acc.provider === provider)) {
            hideLoading();
            showToast(`✅ ${provider === 'gmail' ? 'Gmail' : 'Outlook'} connected successfully! Welcome to Email Onebox!`, 'success');
            setTimeout(() => {
                window.location.href = '/';
            }, 2000);
            return true;
        }
        return false;
    } catch (error) {
        console.error('Fallback auth check failed:', error);
        return false;
    }
}

// Initialize everything when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Email Onebox Onboarding - Initializing...');
    
    // Check if user is already authenticated
    checkAuthStatus();
    
    // Initialize animations and effects
    handleScrollAnimations();
    handleNavbarScroll();
    createParticles();
    
    // Add event listeners for navigation buttons
    document.querySelectorAll('[data-scroll]').forEach(button => {
        button.addEventListener('click', (e) => {
            const target = e.target.closest('[data-scroll]').getAttribute('data-scroll');
            scrollToSection(target);
        });
    });

    // Add event listeners for auth buttons
    const connectGmailBtn = document.getElementById('connectGmailBtn');
    const connectOutlookBtn = document.getElementById('connectOutlookBtn');
    const showDemoBtn = document.getElementById('showDemoBtn');

    if (connectGmailBtn) {
        connectGmailBtn.addEventListener('click', connectGmail);
    }
    
    if (connectOutlookBtn) {
        connectOutlookBtn.addEventListener('click', connectOutlook);
    }

    if (showDemoBtn) {
        showDemoBtn.addEventListener('click', showDemo);
    }
    
    // Add smooth scrolling to all anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });

    // Add keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Alt + G for Gmail connection
        if (e.altKey && e.key === 'g') {
            e.preventDefault();
            connectGmail();
        }
        
        // Alt + O for Outlook connection
        if (e.altKey && e.key === 'o') {
            e.preventDefault();
            connectOutlook();
        }
    });

    console.log('✅ Onboarding initialized successfully');
    console.log('💡 Keyboard shortcuts: Alt+G (Gmail), Alt+O (Outlook)');
});

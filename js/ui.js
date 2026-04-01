/**
 * ============================================
 * VoteHub — UI Rendering Module
 * ============================================
 *
 * Handles all DOM manipulation and UI updates:
 *   - Rendering idea cards from Firestore data
 *   - Showing/hiding loading, empty, and error states
 *   - Toast notification system
 *   - Updating hero stats
 *   - Animating vote count changes
 *
 * Design principles:
 *   - All content is rendered using textContent or sanitized strings
 *   - No raw innerHTML from user/Firestore data without sanitization
 *   - DOM references are cached for performance
 * ============================================
 */

// eslint-disable-next-line no-unused-vars
const VoteHubUI = (function () {
    'use strict';

    // ── DOM Element References (cached on init) ──
    var elements = {
        authStatus: null,
        statusDot: null,
        statusText: null,
        loadingSkeleton: null,
        ideasGrid: null,
        emptyState: null,
        errorState: null,
        errorMessage: null,
        toastContainer: null,
        totalIdeasCount: null,
        totalVotesCount: null,
        activeVotersCount: null,
        themeSwitcher: null,
        votePopupOverlay: null,
        votePopupMessage: null,
        votePopupClose: null,
        popupConfetti: null
    };

    /** @type {number} Counter for unique toast IDs */
    var toastCounter = 0;

    /**
     * Initialize the UI module by caching DOM references.
     * Must be called after DOM is ready.
     */
    function initialize() {
        elements.authStatus = document.getElementById('auth-status');
        elements.statusDot = elements.authStatus
            ? elements.authStatus.querySelector('.status-dot')
            : null;
        elements.statusText = elements.authStatus
            ? elements.authStatus.querySelector('.status-text')
            : null;
        elements.loadingSkeleton = document.getElementById('loading-skeleton');
        elements.ideasGrid = document.getElementById('ideas-grid');
        elements.emptyState = document.getElementById('empty-state');
        elements.errorState = document.getElementById('error-state');
        elements.errorMessage = document.getElementById('error-message');
        elements.toastContainer = document.getElementById('toast-container');
        elements.totalIdeasCount = document.getElementById('total-ideas-count');
        elements.totalVotesCount = document.getElementById('total-votes-count');
        elements.activeVotersCount = document.getElementById("active-voters-count");
        elements.themeSwitcher = document.getElementById("theme-switcher");
        elements.votePopupOverlay = document.getElementById('vote-popup-overlay');
        elements.votePopupMessage = document.getElementById('vote-popup-message');
        elements.votePopupClose = document.getElementById('vote-popup-close');
        elements.popupConfetti = document.getElementById('popup-confetti');

        // Initialize theme based on local storage or system preference
        _initializeTheme();

        // Add event listeners for theme switcher
        if (elements.themeSwitcher) {
            elements.themeSwitcher.addEventListener("click", _toggleTheme);
        }

        // Vote popup close button
        if (elements.votePopupClose) {
            elements.votePopupClose.addEventListener('click', _closeVotePopup);
        }
        // Close popup by clicking on overlay
        if (elements.votePopupOverlay) {
            elements.votePopupOverlay.addEventListener('click', function (e) {
                if (e.target === elements.votePopupOverlay) {
                    _closeVotePopup();
                }
            });
        }

        console.info('[VoteHub UI] Module initialized. DOM references cached.');
    }

    /**
     * Update the authentication status indicator in the header.
     * @param {'connecting'|'connected'|'error'} status
     * @param {string} [message] - Optional custom message
     */
    function updateAuthStatus(status, message) {
        if (!elements.authStatus) return;

        // Remove all state classes
        elements.authStatus.classList.remove('connected', 'error');

        switch (status) {
            case 'connected':
                elements.authStatus.classList.add('connected');
                if (elements.statusText) {
                    elements.statusText.textContent = message || 'Anonymous Voter';
                }
                break;
            case 'error':
                elements.authStatus.classList.add('error');
                if (elements.statusText) {
                    elements.statusText.textContent = message || 'Connection Error';
                }
                break;
            default:
                if (elements.statusText) {
                    elements.statusText.textContent = message || 'Connecting...';
                }
        }
    }

    /**
     * Show the loading skeleton and hide other states.
     */
    function showLoading() {
        _toggleVisibility(elements.loadingSkeleton, true);
        _toggleVisibility(elements.ideasGrid, false);
        _toggleVisibility(elements.emptyState, false);
        _toggleVisibility(elements.errorState, false);
    }

    /**
     * Show the error state with a message.
     * @param {string} message
     */
    function showError(message) {
        _toggleVisibility(elements.loadingSkeleton, false);
        _toggleVisibility(elements.ideasGrid, false);
        _toggleVisibility(elements.emptyState, false);
        _toggleVisibility(elements.errorState, true);

        if (elements.errorMessage) {
            elements.errorMessage.textContent = message || 'Something went wrong.';
        }
    }

    /**
     * Show the empty state (no ideas in database).
     */
    function showEmpty() {
        _toggleVisibility(elements.loadingSkeleton, false);
        _toggleVisibility(elements.ideasGrid, false);
        _toggleVisibility(elements.emptyState, true);
        _toggleVisibility(elements.errorState, false);
    }

    /**
     * Render the ideas grid with data from Firestore.
     * Each idea is rendered as a card with title, description, vote count, and vote button.
     *
     * @param {Array<{id: string, title: string, description: string, votes: number}>} ideas
     * @param {function} onVoteClick - Callback when vote button is clicked, receives ideaId
     */
    function renderIdeas(ideas, onVoteClick) {
        if (!elements.ideasGrid) return;

        // Hide loading/empty/error, show grid
        _toggleVisibility(elements.loadingSkeleton, false);
        _toggleVisibility(elements.emptyState, false);
        _toggleVisibility(elements.errorState, false);
        _toggleVisibility(elements.ideasGrid, true);

        // Clear existing cards
        elements.ideasGrid.innerHTML = '';

        // Determine the top-voted idea (for highlight)
        var maxVotes = 0;
        ideas.forEach(function (idea) {
            if (idea.votes > maxVotes) maxVotes = idea.votes;
        });

        // Render each idea as a card
        ideas.forEach(function (idea, index) {
            var card = _createIdeaCard(idea, index, maxVotes, onVoteClick);
            elements.ideasGrid.appendChild(card);
        });

        // Update hero stats
        _updateHeroStats(ideas);
    }

    /**
     * Create a single idea card DOM element.
     *
     * @param {{id: string, title: string, description: string, votes: number}} idea
     * @param {number} index - Position in the sorted list
     * @param {number} maxVotes - Highest vote count (for 'top-voted' class)
     * @param {function} onVoteClick
     * @returns {HTMLElement}
     * @private
     */
    function _createIdeaCard(idea, index, maxVotes, onVoteClick) {
        var card = document.createElement('article');
        card.className = 'idea-card';
        card.setAttribute('data-idea-id', idea.id);
        card.id = 'idea-card-' + idea.id;

        var isTopVoted = idea.votes > 0 && idea.votes === maxVotes;
        if (isTopVoted) card.classList.add('top-voted');

        var voted = VoteHubVoting.hasVoted(idea.id);
        var pending = VoteHubVoting.isPending(idea.id);
        if (voted) card.classList.add('card-voted');

        // ── Card Body ──
        var body = document.createElement('div');
        body.className = 'idea-card__body';

        // Top row: number badge + optional top-voted chip
        var topRow = document.createElement('div');
        topRow.className = 'idea-card__top-row';

        var numBadge = document.createElement('div');
        numBadge.className = 'idea-card__number';
        numBadge.textContent = index + 1;
        topRow.appendChild(numBadge);

        if (isTopVoted) {
            var topBadge = document.createElement('span');
            topBadge.className = 'idea-card__top-badge';
            topBadge.textContent = '🏆 Leading';
            topRow.appendChild(topBadge);
        }
        body.appendChild(topRow);

        // Title
        var title = document.createElement('h3');
        title.className = 'idea-card__title';
        title.textContent = idea.title;
        body.appendChild(title);

        // Description
        var desc = document.createElement('p');
        desc.className = 'idea-card__description';
        desc.textContent = idea.description;
        body.appendChild(desc);

        card.appendChild(body);

        // ── Card Footer ──
        var footer = document.createElement('div');
        footer.className = 'idea-card__footer';

        // Tally (vote count + progress bar)
        var tally = document.createElement('div');
        tally.className = 'idea-card__tally';

        var voteCount = document.createElement('div');
        voteCount.className = 'idea-card__vote-count';
        voteCount.innerHTML =
            '<span id="vote-number-' + idea.id + '">' + idea.votes + '</span>' +
            '<span id="vote-label-' + idea.id + '">' + (idea.votes === 1 ? 'vote' : 'votes') + '</span>';
        tally.appendChild(voteCount);

        // Progress bar (percentage of max votes)
        var barWrap = document.createElement('div');
        barWrap.className = 'idea-card__bar-wrap';
        var bar = document.createElement('div');
        bar.className = 'idea-card__bar';
        var pct = maxVotes > 0 ? Math.round((idea.votes / maxVotes) * 100) : 0;
        bar.style.width = pct + '%';
        barWrap.appendChild(bar);
        tally.appendChild(barWrap);
        footer.appendChild(tally);

        // Vote button
        var voteBtn = document.createElement('button');
        voteBtn.className = 'idea-card__vote-btn';
        voteBtn.id = 'vote-btn-' + idea.id;

        if (voted) {
            voteBtn.classList.add('voted');
            voteBtn.textContent = 'Voted';
            voteBtn.disabled = true;
        } else if (pending) {
            voteBtn.textContent = 'Voting...';
            voteBtn.disabled = true;
        } else {
            voteBtn.textContent = 'Vote';
            voteBtn.addEventListener('click', function () { onVoteClick(idea.id); });
        }

        footer.appendChild(voteBtn);
        card.appendChild(footer);

        return card;
    }

    /**
     * Update the hero stats section with aggregated data.
     * @param {Array} ideas
     * @private
     */
    function _updateHeroStats(ideas) {
        var totalIdeas = ideas.length;
        var totalVotes = ideas.reduce(function (sum, idea) {
            return sum + idea.votes;
        }, 0);

        if (elements.totalIdeasCount) {
            elements.totalIdeasCount.textContent = totalIdeas;
        }
        if (elements.totalVotesCount) {
            elements.totalVotesCount.textContent = totalVotes;
        }
        if (elements.activeVotersCount) {
            // Approximate — in a real app you'd query unique voters
            elements.activeVotersCount.textContent = totalVotes > 0 ? '~' + totalVotes : '—';
        }
    }

    /**
     * Animate the vote count change on a specific card.
     * @param {string} ideaId
     */
    function animateVoteCount(ideaId) {
        var numberEl = document.getElementById('vote-number-' + ideaId);
        if (numberEl) {
            numberEl.classList.remove('animate-bump');
            // Force reflow to restart animation
            void numberEl.offsetWidth;
            numberEl.classList.add('animate-bump');
        }
    }

    /**
     * Add a vote burst animation to a card.
     * @param {string} ideaId
     */
    function showVoteBurst(ideaId) {
        var card = document.getElementById('idea-card-' + ideaId);
        if (!card) return;

        var burst = document.createElement('div');
        burst.className = 'vote-burst';
        card.appendChild(burst);

        // Remove the burst element after animation completes
        setTimeout(function () {
            if (burst.parentNode) {
                burst.parentNode.removeChild(burst);
            }
        }, 700);
    }

    /**
     * Show a toast notification.
     * @param {string} message - The message to display
     * @param {'success'|'error'|'info'} type - Type of toast (determines icon & color)
     * @param {number} [duration=3500] - How long to show the toast (in ms)
     */
    function showToast(message, type, duration) {
        if (!elements.toastContainer) return;

        type = type || 'info';
        duration = duration || 3500;

        var icons = {
            success: '✅',
            error: '❌',
            info: 'ℹ️'
        };

        var toast = document.createElement('div');
        toast.className = 'toast toast-' + type;
        toast.id = 'toast-' + (++toastCounter);

        var icon = document.createElement('span');
        icon.className = 'toast-icon';
        icon.textContent = icons[type] || icons.info;

        var text = document.createElement('span');
        text.className = 'toast-text';
        text.textContent = message;

        toast.appendChild(icon);
        toast.appendChild(text);
        elements.toastContainer.appendChild(toast);

        // Trigger slide-in animation
        requestAnimationFrame(function () {
            toast.classList.add('show');
        });

        // Auto-dismiss
        setTimeout(function () {
            toast.classList.remove('show');
            setTimeout(function () {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 400);
        }, duration);
    }

    /**
     * Toggle visibility of an element.
     * @param {HTMLElement|null} el
     * @param {boolean} visible
     * @private
     */
    function _toggleVisibility(el, visible) {
        if (!el) return;
        el.style.display = visible ? '' : 'none';
    }

    /**
     * Initializes the theme (dark/light) based on local storage or system preference.
     * @private
     */
    function _initializeTheme() {
        const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        const savedTheme = localStorage.getItem("theme");

        if (savedTheme === "light") {
            document.body.classList.add("light-mode");
        } else if (savedTheme === "dark") {
            document.body.classList.remove("light-mode");
        } else if (prefersDark) {
            document.body.classList.remove("light-mode");
        } else {
            document.body.classList.add("light-mode");
        }
    }

    /**
     * Toggles the theme between dark and light mode.
     * @private
     */
    function _toggleTheme() {
        document.body.classList.toggle("light-mode");
        const currentTheme = document.body.classList.contains("light-mode") ? "light" : "dark";
        localStorage.setItem("theme", currentTheme);
    }

    /**
     * Show the vote success popup with confetti animation.
     * @param {string} [ideaTitle] - Optional idea title to show in the message
     */
    function showVotePopup(ideaTitle) {
        if (!elements.votePopupOverlay) return;

        // Update message if we have the idea title
        if (elements.votePopupMessage && ideaTitle) {
            elements.votePopupMessage.textContent =
                'You voted for ' + ideaTitle;
        } else if (elements.votePopupMessage) {
            elements.votePopupMessage.textContent = '';
        }

        // Generate confetti dots
        _generateConfetti();

        // Show popup
        elements.votePopupOverlay.classList.add('active');

        // Auto-close after 4 seconds
        clearTimeout(showVotePopup._timer);
        showVotePopup._timer = setTimeout(function () {
            _closeVotePopup();
        }, 4000);
    }

    /**
     * Close the vote popup.
     * @private
     */
    function _closeVotePopup() {
        if (!elements.votePopupOverlay) return;
        clearTimeout(showVotePopup._timer);
        elements.votePopupOverlay.classList.remove('active');

        // Clear confetti after animation
        setTimeout(function () {
            if (elements.popupConfetti) {
                elements.popupConfetti.innerHTML = '';
            }
        }, 400);
    }

    /**
     * Generate confetti dots inside the popup.
     * @private
     */
    function _generateConfetti() {
        if (!elements.popupConfetti) return;
        elements.popupConfetti.innerHTML = '';

        var colors = ['#007bff', '#00c6ff', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];
        var count = 24;
        var shapes = ['', 'square', 'star'];

        for (var i = 0; i < count; i++) {
            var dot = document.createElement('div');
            var shape = shapes[Math.floor(Math.random() * shapes.length)];
            dot.className = 'confetti-dot' + (shape ? ' ' + shape : '');
            var size = 5 + Math.random() * 7;
            dot.style.width = size + 'px';
            dot.style.height = (shape === 'square' ? size * 1.4 : size) + 'px';
            dot.style.left = (5 + Math.random() * 90) + '%';
            dot.style.top = (Math.random() * 30) + '%';
            dot.style.background = colors[Math.floor(Math.random() * colors.length)];
            dot.style.animationDelay = (Math.random() * 0.8) + 's';
            dot.style.animationDuration = (1.5 + Math.random() * 1.2) + 's';
            elements.popupConfetti.appendChild(dot);
        }
    }

    // ── Public API ──
    return {
        initialize: initialize,
        updateAuthStatus: updateAuthStatus,
        showLoading: showLoading,
        showError: showError,
        showEmpty: showEmpty,
        renderIdeas: renderIdeas,
        animateVoteCount: animateVoteCount,
        showVoteBurst: showVoteBurst,
        showToast: showToast,
        showVotePopup: showVotePopup
    };
})();

/**
 * ============================================
 * VoteHub — Main Application Entry Point
 * VIBECODE SAFELY PRINCIPLES APPLIED:
 *   ✅ Tasks broken into phases — Firebase init, auth, listen, render
 *   ✅ Never break existing features — demo mode fallback preserved
 *   ✅ No keys hardcoded — config.js holds config, .env would hold secrets
 *   ✅ Input validation — WEBSITE_IDEAS sanitized before any DOM output
 *   ✅ Backup strategy — demo mode = always-working safe state
 *   ✅ Rate limiting — localStorage blocks repeated votes per device too
 *   ✅ Error messages generic — no internal details exposed to users
 * ============================================
 */

(function () {
    'use strict';

    // ═══════════════════════════════════════════
    // WEBSITE IDEAS — Edit These!
    // Add your own ideas here. Each needs:
    //   id:          URL-safe string (letters, numbers, hyphens only)
    //   title:       Name of the website (max 100 chars)
    //   description: What the site does (max 500 chars)
    //   votes:       Always start at 0
    //
    // VIBECODE SAFELY: IDs use only alphanumeric + hyphens.
    // This prevents any injection via ID in DOM attributes or Firestore paths.
    // ═══════════════════════════════════════════
    var WEBSITE_IDEAS = [
        {
            id: 'dase-errand',
            title: 'DASEerrand',
            description: 'A specialised peer-to-peer logistics and errand platform built ' +
                'for the university ecosystem. It connects busy students who need tasks ' +
                'fulfilled with "student-runners" eager to earn extra income. From courier ' +
                'deliveries and document pickups to grocery runs — DASEerrand makes campus ' +
                'life more efficient for everyone.',
            votes: 0
        },
        {
            id: 'dase-house',
            title: 'DASEhouse',
            description: 'A direct-to-renter property platform that eliminates the ' +
                'middleman. DASEhouse connects property owners directly with prospective ' +
                'tenants, cutting out costly agents and streamlining the entire rental ' +
                'process. Less friction, lower fees, and a more transparent experience ' +
                'for both landlords and renters.',
            votes: 0
        },
        {
            id: 'dase-option',
            title: 'DASEoption',
            description: 'A structured prediction platform that enables users to make ' +
                'informed forecasts on real-world future events. DASEoption transforms ' +
                'speculation into strategy — providing analytical tools, market insights, ' +
                'and a structured framework that meaningfully improves users\' chances of ' +
                'making accurate, confident predictions.',
            votes: 0
        },
        {
            id: 'dase-finance',
            title: 'DASEfinance',
            description: 'A personal financial intelligence tool that helps users project ' +
                'and understand their financial future. By analysing current income, ' +
                'expenses, and spending patterns, DASEfinance generates actionable forecasts ' +
                'and insights — empowering users to make smarter, more informed decisions ' +
                'about their money before it\'s too late.',
            votes: 0
        },
        {
            id: 'dase-day',
            title: 'DASEday',
            description: 'A smart daily planning and routine management platform designed ' +
                'to help users reclaim control of their time. DASEday enables individuals ' +
                'to structure, prioritise, and optimise their daily schedules — transforming ' +
                'scattered tasks into focused routines that drive productivity, reduce ' +
                'overwhelm, and unlock peak daily performance.',
            votes: 0
        }
    ];

    // ── localStorage keys (demo mode persistence) ──
    var STORAGE_VOTES = 'votehub_votes';   // { ideaId: voteCount }
    var STORAGE_VOTED = 'votehub_voted';   // [ ideaId, ... ]

    // ── Rate limiting (demo mode: one vote per 3s per device) ──
    var RATE_LIMIT_MS = 3000;
    var lastClickTime = 0;

    // ═══════════════════════════════════════════
    // BOOT — detect mode and start the right flow
    // ═══════════════════════════════════════════

    function boot() {
        console.info('[VoteHub] 🚀 Booting...');

        VoteHubUI.initialize();
        VoteHubUI.showLoading();

        var liveMode = false;
        try {
            if (VoteHubConfig.isConfigured()) {
                var fb = VoteHubConfig.initializeFirebase();
                liveMode = true;
                _bootLiveMode(fb);
            }
        } catch (e) {
            // Config not set or Firebase failed — safe fallback to demo mode
            console.info('[VoteHub] Firebase not configured. Starting demo mode.', e.message);
        }

        if (!liveMode) {
            _bootDemoMode();
        }
    }

    // ═══════════════════════════════════════════
    // DEMO MODE — Works without Firebase
    // Votes stored in localStorage (per browser/device)
    // ═══════════════════════════════════════════

    function _bootDemoMode() {
        console.info('[VoteHub] Demo mode active.');
        VoteHubUI.updateAuthStatus('connected', 'Anonymous');

        var savedVotes = _loadVotes();
        var userVoted = _loadUserVoted();

        // Merge saved vote counts, validate each field before using
        var ideas = WEBSITE_IDEAS.map(function (idea) {
            return {
                id: _validateId(idea.id),
                title: _validateText(idea.title, 100),
                description: _validateText(idea.description, 500),
                votes: _validateCount(savedVotes[idea.id] || idea.votes)
            };
        }).filter(function (idea) {
            // Drop any idea with an empty/invalid id (safety net)
            return idea.id.length > 0;
        });

        // Sort highest votes first
        ideas.sort(function (a, b) { return b.votes - a.votes; });

        // Patch VoteHubVoting for demo mode (overrides Firestore methods)
        _patchVotingForDemo(userVoted);

        // Fast render — minimal delay for skeleton flash
        setTimeout(function () {
            VoteHubUI.renderIdeas(ideas, function (ideaId) {
                _handleDemoVote(ideaId);
            });
        }, 100);
    }

    /**
     * Handle a vote click in demo mode.
     * VIBECODE SAFELY: rate limit + one-vote-per-device enforcement.
     */
    function _handleDemoVote(ideaId) {
        // Rate limit — 3 seconds between any vote click globally
        var now = Date.now();
        if (now - lastClickTime < RATE_LIMIT_MS) {
            VoteHubUI.showToast('Slow down! Wait a moment.', 'info');
            return;
        }
        lastClickTime = now;

        // One-vote-per-idea per device (localStorage)
        var userVoted = _loadUserVoted();
        if (userVoted.indexOf(ideaId) !== -1) {
            VoteHubUI.showToast('You already voted for this one!', 'info');
            return;
        }

        // VIBECODE SAFELY: Validate the ideaId is one of our known ideas
        // This prevents a rogue call with an arbitrary id injected via console
        var knownIds = WEBSITE_IDEAS.map(function (i) { return i.id; });
        if (knownIds.indexOf(ideaId) === -1) {
            console.warn('[VoteHub] Unknown ideaId rejected:', ideaId);
            return;
        }

        // Record the vote
        var savedVotes = _loadVotes();
        savedVotes[ideaId] = _validateCount((savedVotes[ideaId] || 0) + 1);
        userVoted.push(ideaId);
        _saveVotes(savedVotes);
        _saveUserVoted(userVoted);

        // Re-render with updated data
        _patchVotingForDemo(userVoted);
        var ideas = WEBSITE_IDEAS.map(function (idea) {
            return {
                id: _validateId(idea.id),
                title: _validateText(idea.title, 100),
                description: _validateText(idea.description, 500),
                votes: _validateCount(savedVotes[idea.id] || idea.votes)
            };
        });
        ideas.sort(function (a, b) { return b.votes - a.votes; });

        VoteHubUI.renderIdeas(ideas, function (id) { _handleDemoVote(id); });
        VoteHubUI.showToast('Vote recorded! 🎉', 'success');
        VoteHubUI.animateVoteCount(ideaId);
        VoteHubUI.showVoteBurst(ideaId);

        // Show the premium vote popup
        var votedIdea = WEBSITE_IDEAS.find(function (i) { return i.id === ideaId; });
        VoteHubUI.showVotePopup(votedIdea ? votedIdea.title : null);
    }

    /**
     * Patch VoteHubVoting with demo-mode implementations so ui.js
     * correctly marks voted buttons without needing Firestore.
     */
    function _patchVotingForDemo(userVoted) {
        VoteHubVoting._demoVoted = userVoted.slice(); // copy
        VoteHubVoting.hasVoted = function (id) {
            return VoteHubVoting._demoVoted.indexOf(id) !== -1;
        };
        VoteHubVoting.isPending = function () { return false; };
    }

    // ── localStorage helpers with error safety ──

    function _loadVotes() {
        try { return JSON.parse(localStorage.getItem(STORAGE_VOTES)) || {}; }
        catch (e) { return {}; }
    }

    function _saveVotes(obj) {
        try { localStorage.setItem(STORAGE_VOTES, JSON.stringify(obj)); }
        catch (e) { /* storage full or blocked */ }
    }

    function _loadUserVoted() {
        try {
            var v = JSON.parse(localStorage.getItem(STORAGE_VOTED));
            return Array.isArray(v) ? v : [];
        }
        catch (e) { return []; }
    }

    function _saveUserVoted(arr) {
        try { localStorage.setItem(STORAGE_VOTED, JSON.stringify(arr)); }
        catch (e) { /* storage full or blocked */ }
    }

    // ═══════════════════════════════════════════
    // LIVE MODE — Full Firebase Firestore
    // ═══════════════════════════════════════════

    function _bootLiveMode(fb) {
        console.info('[VoteHub] Live Firebase mode active.');
        VoteHubUI.updateAuthStatus('connecting');

        // ── OPTIMIZATION: Immediate Render ──
        // Show local ideas immediately so the user doesn't see a long loading state.
        // These will be replaced by live data once Firestore connects.
        var initialIdeas = WEBSITE_IDEAS.map(function (idea) {
            return {
                id: _validateId(idea.id),
                title: _validateText(idea.title, 100),
                description: _validateText(idea.description, 500),
                votes: _validateCount(idea.votes)
            };
        });
        VoteHubUI.renderIdeas(initialIdeas, function () {
            VoteHubUI.showToast('Connecting to live voting...', 'info');
        });

        // Make WEBSITE_IDEAS accessible to the vote result handler
        _bootLiveMode.ideas = WEBSITE_IDEAS;

        // Get device fingerprint for one-vote-per-person enforcement
        // VIBECODE SAFELY: Fingerprinting is deferred to a microtask to avoid blocking initial render
        var fingerprint = null;
        setTimeout(function() {
            fingerprint = VoteHubFingerprint.getFingerprint();
            console.info('[VoteHub] Device fingerprint ready.');
        }, 0);

        VoteHubVoting.initialize(fb.db);

        VoteHubVoting.onVoteResult(function (event) {
            if (event.type === 'success') { 
                VoteHubUI.showToast(event.result.message, 'success'); 
                VoteHubUI.animateVoteCount(event.ideaId); 
                VoteHubUI.showVoteBurst(event.ideaId);
                // Find and pass the voted idea title for the popup message
                var votedIdea = WEBSITE_IDEAS.find(function (i) { return i.id === event.ideaId; });
                VoteHubUI.showVotePopup(votedIdea ? votedIdea.title : null);
            }
            if (event.type === 'duplicate') { VoteHubUI.showToast(event.result.message, 'info'); }
            if (event.type === 'error') { VoteHubUI.showToast(event.result.message, 'error'); }
        });

        VoteHubVoting.onDataChange(function (ideas, error) {
            if (error) { VoteHubUI.showError('Could not load ideas. Please refresh.'); return; }
            if (!ideas || ideas.length === 0) { VoteHubUI.showEmpty(); return; }
            
            // Ensure fingerprint is ready before allowing votes
            if (!fingerprint) fingerprint = VoteHubFingerprint.getFingerprint();
            
            VoteHubUI.renderIdeas(ideas, function (ideaId) { _handleLiveVote(ideaId, fingerprint); });
        });

        VoteHubAuth.initialize(fb.auth)
            .then(function (uid) {
                VoteHubUI.updateAuthStatus('connected', 'Anonymous Voter');
                // Ensure fingerprint is ready
                if (!fingerprint) fingerprint = VoteHubFingerprint.getFingerprint();
                VoteHubVoting.startListening(fingerprint);
                console.info('[VoteHub] ✅ Live mode ready.');
            })
            .catch(function (error) {
                // Log error code only — never expose raw auth error messages to UI
                console.error('[VoteHub] Auth failed, code:', error.code || 'unknown');
                // Graceful fallback — user still sees the ideas
                console.info('[VoteHub] Falling back to demo mode.');
                _bootDemoMode();
            });
    }

    function _handleLiveVote(ideaId, fingerprint) {
        if (!fingerprint) { VoteHubUI.showToast('Device identification failed.', 'error'); return; }
        VoteHubVoting.castVote(ideaId, fingerprint);
    }

    // ═══════════════════════════════════════════
    // LOCAL VALIDATION HELPERS
    // VIBECODE SAFELY: Validate even our own data before rendering.
    // "Never Trust Input" applies to hardcoded data too — future-proofing
    // against accidental typos or malicious edits to this file.
    // ═══════════════════════════════════════════

    /** Validate a document/element ID — only allow safe characters */
    function _validateId(val) {
        if (typeof val !== 'string') return '';
        return val.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 128);
    }

    /** Validate and trim text, enforce max length */
    function _validateText(val, maxLen) {
        if (typeof val !== 'string') return '';
        return val.trim().substring(0, maxLen);
    }

    /** Validate vote count is a non-negative integer */
    function _validateCount(val) {
        var n = parseInt(val, 10);
        return (!isNaN(n) && n >= 0) ? n : 0;
    }

    // ── Wait for DOM, then boot ──
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();

/**
 * ============================================
 * VoteHub — Voting Logic Module (Fingerprint Version)
 * ONE PERSON, ONE VOTE ENFORCEMENT
 * ============================================
 * 
 * VIBECODE SAFELY PRINCIPLES APPLIED:
 *   ✅ Never trust user input — all Firestore data sanitized
 *   ✅ Transactional voting — atomically reads + writes, no race conditions
 *   ✅ Rate limiting — max 1 vote attempt per 3 seconds
 *   ✅ One vote per person — enforced via device fingerprint + Firestore rules
 *   ✅ XSS prevention — full sanitize() pipeline before any DOM use
 *   ✅ No sensitive keys — no API keys or secrets anywhere in this file
 *   ✅ Fail-safe — all errors caught, never exposes internal errors to user
 * 
 * KEY CHANGE: Uses device fingerprint instead of UID to track voters.
 * This ensures ONE VOTE PER PERSON across ALL ideas, even across browsers.
 * 
 * ============================================
 *
 * Firestore Data Model:
 *   Collection: ideas
 *   └── Document: {ideaId}
 *       ├── title: string
 *       ├── description: string
 *       ├── votes: number
 *       └── Subcollection: voters
 *           └── Document: {fingerprint}  ← Fingerprint is the doc ID
 *               └── votedAt: Timestamp
 *
 *   Collection: voters (GLOBAL)
 *   └── Document: {fingerprint}  ← One document per device (one vote per person)
 *       ├── votedAt: Timestamp
 *       └── ideaId: string (which idea was voted for)
 */

// eslint-disable-next-line no-unused-vars
const VoteHubVoting = (function () {
    'use strict';

    /** @type {firebase.firestore.Firestore|null} */
    let db = null;

    /** @type {function|null} Unsubscribe function for the real-time listener */
    let unsubscribeSnapshot = null;

    /**
     * SECURITY: Client-side voted cache.
     * Prevents redundant Firestore calls. Server rules are the real enforcement.
     * @type {Set<string>}
     */
    const votedIdeaIds = new Set();

    /**
     * SECURITY: In-flight vote guard.
     * Prevents double-click race conditions before transaction completes.
     * @type {Set<string>}
     */
    const pendingVotes = new Set();

    /**
     * SECURITY: Global vote flag.
     * Once the user has voted (for ANY idea), this is set to true.
     * Prevents voting for multiple ideas.
     * @type {boolean}
     */
    let hasVotedGlobally = false;

    /**
     * RATE LIMITING: Tracks last vote attempt timestamp.
     * Prevents rapid repeated click attempts.
     * Rule: 3 seconds must pass between attempts.
     * @type {number}
     */
    let lastVoteAttempt = 0;

    /** @type {number} Minimum ms between vote attempts */
    const VOTE_RATE_LIMIT_MS = 3000;

    /** @type {function[]} Callbacks for when ideas data changes */
    const dataCallbacks = [];

    /** @type {function[]} Callbacks for vote result events */
    const voteCallbacks = [];

    /**
     * Initialize the voting module with a Firestore instance.
     * Must be called before startListening() or castVote().
     * @param {firebase.firestore.Firestore} firestoreDb
     */
    function initialize(firestoreDb) {
        db = firestoreDb;
        console.info('[VoteHub Voting] Module initialized.');
    }

    /**
     * Begin real-time listening to the 'ideas' collection.
     * Ideas arrive sorted by vote count (highest first).
     * On each snapshot, we also check the user's voted status.
     *
     * @param {string} fingerprint - Device fingerprint for identifying the user
     */
    function startListening(fingerprint) {
        if (!db) {
            console.error('[VoteHub Voting] Not initialized. Call initialize() first.');
            return;
        }

        stopListening(); // clean up any previous listener

        unsubscribeSnapshot = db
            .collection('ideas')
            .orderBy('votes', 'desc')
            .onSnapshot(
                function (snapshot) {
                    var ideas = [];
                    snapshot.forEach(function (doc) {
                        var data = doc.data();

                        // SECURITY: Sanitize ALL fields from Firestore before using them.
                        ideas.push({
                            id: _sanitizeId(doc.id),
                            title: _sanitizeText(data.title, 'Untitled', 100),
                            description: _sanitizeText(data.description, 'No description.', 500),
                            votes: _sanitizeNumber(data.votes)
                        });
                    });

                    // Check voted status then notify UI
                    _checkVotedStatus(fingerprint, ideas).then(function () {
                        _notifyDataCallbacks(ideas);
                    });
                },
                function (error) {
                    console.error('[VoteHub Voting] Snapshot error code:', error.code);
                    _notifyDataCallbacks(null, error);
                }
            );
    }

    /**
     * Stop the real-time listener. Call on teardown.
     */
    function stopListening() {
        if (unsubscribeSnapshot) {
            unsubscribeSnapshot();
            unsubscribeSnapshot = null;
        }
    }

    /**
     * Check if the current user (fingerprint) has already voted for any idea.
     * Also check which specific ideas they've voted for.
     * 
     * @param {string} fingerprint
     * @param {Array} ideas
     * @returns {Promise<void>}
     * @private
     */
    function _checkVotedStatus(fingerprint, ideas) {
        if (!fingerprint || ideas.length === 0) return Promise.resolve();

        // First, check the global voters collection to see if this fingerprint has voted
        return db
            .collection('voters')
            .doc(fingerprint)
            .get()
            .then(function (voterDoc) {
                if (voterDoc.exists) {
                    // User has already voted
                    hasVotedGlobally = true;
                    var votedIdeaId = voterDoc.data().ideaId;
                    votedIdeaIds.add(votedIdeaId);
                } else {
                    hasVotedGlobally = false;
                }
            })
            .catch(function (err) {
                console.warn('[VoteHub Voting] Voted-status check failed:', err.code);
            });
    }

    /**
     * Cast a vote for an idea.
     *
     * SECURITY LAYERS IN ORDER:
     *   1. Fingerprint check — fingerprint must exist
     *   2. Input validation — ideaId must be a valid non-empty string
     *   3. Global vote check — user can only vote once (for any idea)
     *   4. Rate limit — 3s minimum between attempts
     *   5. Pending guard — no duplicate in-flight requests
     *   6. Firestore TRANSACTION — atomic read + write, server-enforced
     *
     * @param {string} ideaId
     * @param {string} fingerprint - Device fingerprint
     * @returns {Promise<{success: boolean, message: string}>}
     */
    function castVote(ideaId, fingerprint) {
        // 1. Fingerprint check
        if (!fingerprint || typeof fingerprint !== 'string' || fingerprint.trim() === '') {
            return Promise.resolve({ success: false, message: 'Device identification failed.' });
        }

        // 2. Input validation — ideaId must be a safe string
        if (!_isValidId(ideaId)) {
            console.warn('[VoteHub Voting] Invalid ideaId rejected:', ideaId);
            return Promise.resolve({ success: false, message: 'Invalid idea.' });
        }

        // 3. Global vote check — ONE VOTE PER PERSON across ALL ideas
        if (hasVotedGlobally) {
            return Promise.resolve({ success: false, message: 'You have already voted. Each person can vote only once.' });
        }

        // 4. Rate limiting — prevent rapid repeated vote attempts
        var now = Date.now();
        if (now - lastVoteAttempt < VOTE_RATE_LIMIT_MS) {
            return Promise.resolve({ success: false, message: 'Please wait a moment before trying again.' });
        }
        lastVoteAttempt = now;

        // 5. Pending guard — prevent double-click before transaction resolves
        if (pendingVotes.has(ideaId)) {
            return Promise.resolve({ success: false, message: 'Vote is already being processed...' });
        }

        // Mark in-flight
        pendingVotes.add(ideaId);
        _notifyVoteCallbacks({ type: 'pending', ideaId: ideaId });

        // 6. Firestore TRANSACTION
        // Atomically:
        //   1. Check global voters collection — ensure fingerprint hasn't voted yet
        //   2. Check idea voters subcollection — ensure fingerprint hasn't voted for this idea
        //   3. Increment vote count
        //   4. Create voter record in idea subcollection
        //   5. Create global voter record
        var ideaRef = db.collection('ideas').doc(ideaId);
        var ideaVoterRef = ideaRef.collection('voters').doc(fingerprint);
        var globalVoterRef = db.collection('voters').doc(fingerprint);

        return db.runTransaction(function (transaction) {
            // Check global voter record first
            return transaction.get(globalVoterRef).then(function (globalVoterDoc) {
                if (globalVoterDoc.exists) {
                    throw new Error('ALREADY_VOTED_GLOBALLY');
                }

                // Check idea exists
                return transaction.get(ideaRef).then(function (ideaDoc) {
                    if (!ideaDoc.exists) {
                        throw new Error('IDEA_NOT_FOUND');
                    }

                    // Check if already voted for this specific idea
                    return transaction.get(ideaVoterRef).then(function (ideaVoterDoc) {
                        if (ideaVoterDoc.exists) {
                            throw new Error('ALREADY_VOTED_FOR_IDEA');
                        }

                        // All checks passed — execute the vote
                        var currentVotes = _sanitizeNumber(ideaDoc.data().votes);
                        
                        // Increment vote count
                        transaction.update(ideaRef, { votes: currentVotes + 1 });
                        
                        // Record voter in idea subcollection
                        transaction.set(ideaVoterRef, {
                            votedAt: firebase.firestore.FieldValue.serverTimestamp()
                        });
                        
                        // Record global voter (one vote per person)
                        transaction.set(globalVoterRef, {
                            votedAt: firebase.firestore.FieldValue.serverTimestamp(),
                            ideaId: ideaId
                        });
                    });
                });
            });
        })
            .then(function () {
                hasVotedGlobally = true;
                votedIdeaIds.add(ideaId);
                pendingVotes.delete(ideaId);
                var result = { success: true, message: 'Vote recorded! 🎉' };
                _notifyVoteCallbacks({ type: 'success', ideaId: ideaId, result: result });
                return result;
            })
            .catch(function (error) {
                pendingVotes.delete(ideaId);

                if (error.message === 'ALREADY_VOTED_GLOBALLY') {
                    hasVotedGlobally = true;
                    var globalResult = { success: false, message: 'You have already voted. Each person can vote only once.' };
                    _notifyVoteCallbacks({ type: 'duplicate', ideaId: ideaId, result: globalResult });
                    return globalResult;
                }

                if (error.message === 'ALREADY_VOTED_FOR_IDEA') {
                    var ideaResult = { success: false, message: 'You already voted for this one!' };
                    _notifyVoteCallbacks({ type: 'duplicate', ideaId: ideaId, result: ideaResult });
                    return ideaResult;
                }

                if (error.message === 'IDEA_NOT_FOUND') {
                    var notFoundResult = { success: false, message: 'This idea no longer exists.' };
                    _notifyVoteCallbacks({ type: 'error', ideaId: ideaId, result: notFoundResult });
                    return notFoundResult;
                }

                console.error('[VoteHub Voting] Transaction failed. Code:', error.code || 'unknown');
                var errorResult = { success: false, message: 'Could not record vote. Please try again.' };
                _notifyVoteCallbacks({ type: 'error', ideaId: ideaId, result: errorResult });
                return errorResult;
            });
    }

    function hasVoted(ideaId) { return votedIdeaIds.has(ideaId); }
    function hasVotedGlobal() { return hasVotedGlobally; }
    function isPending(ideaId) { return pendingVotes.has(ideaId); }

    function onDataChange(callback) {
        if (typeof callback === 'function') dataCallbacks.push(callback);
    }

    function onVoteResult(callback) {
        if (typeof callback === 'function') voteCallbacks.push(callback);
    }

    // ── Sanitization Helpers ──

    function _sanitizeText(val, fallback, maxLen) {
        if (typeof val !== 'string') return fallback;
        var trimmed = val.trim();
        if (trimmed.length === 0) return fallback;
        return trimmed.substring(0, maxLen)
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function _sanitizeId(val) {
        if (typeof val !== 'string') return '';
        return val.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 128);
    }

    function _sanitizeNumber(val) {
        var n = parseInt(val, 10);
        return (!isNaN(n) && n >= 0 && n <= 999999) ? n : 0;
    }

    function _isValidId(val) {
        if (typeof val !== 'string') return false;
        var trimmed = val.trim();
        return trimmed.length > 0 && /^[a-zA-Z0-9_-]+$/.test(trimmed);
    }

    // ── Notification Helpers ──

    function _notifyDataCallbacks(ideas, error) {
        dataCallbacks.forEach(function (cb) {
            try { cb(ideas, error); }
            catch (e) { console.error('[VoteHub Voting] Callback error:', e); }
        });
    }

    function _notifyVoteCallbacks(event) {
        voteCallbacks.forEach(function (cb) {
            try { cb(event); }
            catch (e) { console.error('[VoteHub Voting] Callback error:', e); }
        });
    }

    // Public API
    return {
        initialize: initialize,
        startListening: startListening,
        stopListening: stopListening,
        castVote: castVote,
        hasVoted: hasVoted,
        hasVotedGlobal: hasVotedGlobal,
        isPending: isPending,
        onDataChange: onDataChange,
        onVoteResult: onVoteResult
    };
})();

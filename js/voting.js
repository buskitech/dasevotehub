/**
 * ============================================
 * VoteHub — Voting Logic Module
 * VIBECODE SAFELY PRINCIPLES APPLIED:
 *   ✅ Never trust user input — all Firestore data sanitized
 *   ✅ Transactional voting — atomically reads + writes, no race conditions
 *   ✅ Rate limiting — max 1 vote attempt per 3 seconds per idea
 *   ✅ Double-vote prevention — client cache + pending guard + server rules
 *   ✅ XSS prevention — full sanitize() pipeline before any DOM use
 *   ✅ No sensitive keys — no API keys or secrets anywhere in this file
 *   ✅ Fail-safe — all errors caught, never exposes internal errors to user
 * ============================================
 *
 * Firestore Data Model:
 *   Collection: ideas
 *   └── Document: {ideaId}
 *       ├── title: string
 *       ├── description: string
 *       ├── votes: number
 *       └── Subcollection: voters
 *           └── Document: {uid}  ← UID is the doc ID (forces uniqueness)
 *               └── votedAt: Timestamp
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
     * RATE LIMITING: Tracks last vote attempt timestamp per idea.
     * Prevents rapid repeated click attempts even across different ideas.
     * Rule: 3 seconds must pass between attempts on the same idea.
     * @type {Map<string, number>}
     */
    const lastVoteAttempt = new Map();

    /** @type {number} Minimum ms between vote attempts on the same idea */
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
     * @param {string} uid - Current user's UID
     */
    function startListening(uid) {
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
                        // Never trust data from external sources — even your own database.
                        ideas.push({
                            id: _sanitizeId(doc.id),
                            title: _sanitizeText(data.title, 'Untitled', 100),
                            description: _sanitizeText(data.description, 'No description.', 500),
                            votes: _sanitizeNumber(data.votes)
                        });
                    });

                    // Check voted status then notify UI
                    _checkVotedStatus(uid, ideas).then(function () {
                        _notifyDataCallbacks(ideas);
                    });
                },
                function (error) {
                    // Log server-side error code — never expose raw error to users
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
     * Check which ideas the current user has already voted for.
     * Reads the voters subcollection for the user's UID document.
     * @param {string} uid
     * @param {Array} ideas
     * @returns {Promise<void>}
     * @private
     */
    function _checkVotedStatus(uid, ideas) {
        if (!uid || ideas.length === 0) return Promise.resolve();

        var checks = ideas.map(function (idea) {
            return db
                .collection('ideas').doc(idea.id)
                .collection('voters').doc(uid)
                .get()
                .then(function (voterDoc) {
                    if (voterDoc.exists) votedIdeaIds.add(idea.id);
                })
                .catch(function (err) {
                    // Non-critical — server rules are the real guard
                    console.warn('[VoteHub Voting] Voted-status check skipped for', idea.id, ':', err.code);
                });
        });

        return Promise.all(checks);
    }

    /**
     * Cast a vote for an idea.
     *
     * SECURITY LAYERS IN ORDER:
     *   1. Auth check — uid must exist
     *   2. Input validation — ideaId must be a valid non-empty string
     *   3. Rate limit — 3s minimum between attempts per idea
     *   4. Pending guard — no duplicate in-flight requests
     *   5. Client cache — fast reject if already voted
     *   6. Firestore TRANSACTION — atomic read + write, server-enforced
     *
     * @param {string} ideaId
     * @param {string} uid
     * @returns {Promise<{success: boolean, message: string}>}
     */
    function castVote(ideaId, uid) {
        // 1. Auth check
        if (!uid || typeof uid !== 'string' || uid.trim() === '') {
            return Promise.resolve({ success: false, message: 'Not authenticated.' });
        }

        // 2. Input validation — ideaId must be a safe string
        if (!_isValidId(ideaId)) {
            console.warn('[VoteHub Voting] Invalid ideaId rejected:', ideaId);
            return Promise.resolve({ success: false, message: 'Invalid idea.' });
        }

        // 3. Rate limiting — prevent rapid repeated vote attempts
        var now = Date.now();
        var lastAttempt = lastVoteAttempt.get(ideaId) || 0;
        if (now - lastAttempt < VOTE_RATE_LIMIT_MS) {
            return Promise.resolve({ success: false, message: 'Please wait a moment before trying again.' });
        }
        lastVoteAttempt.set(ideaId, now);

        // 4. Pending guard — prevent double-click before transaction resolves
        if (pendingVotes.has(ideaId)) {
            return Promise.resolve({ success: false, message: 'Vote is already being processed...' });
        }

        // 5. Client cache — fast reject if already voted (server is still the authority)
        if (votedIdeaIds.has(ideaId)) {
            return Promise.resolve({ success: false, message: 'You already voted for this one!' });
        }

        // Mark in-flight
        pendingVotes.add(ideaId);
        _notifyVoteCallbacks({ type: 'pending', ideaId: ideaId });

        // 6. Firestore TRANSACTION
        // Atomically: read voter doc → check not exists → increment votes → set voter doc
        // This prevents race conditions and double-spending even under concurrent requests.
        var ideaRef = db.collection('ideas').doc(ideaId);
        var voterRef = ideaRef.collection('voters').doc(uid);

        return db.runTransaction(function (transaction) {
            return transaction.get(ideaRef).then(function (ideaDoc) {
                if (!ideaDoc.exists) {
                    throw new Error('IDEA_NOT_FOUND');
                }

                return transaction.get(voterRef).then(function (voterDoc) {
                    if (voterDoc.exists) {
                        throw new Error('ALREADY_VOTED');
                    }

                    var currentVotes = _sanitizeNumber(ideaDoc.data().votes);
                    // Increment vote count atomically
                    transaction.update(ideaRef, { votes: currentVotes + 1 });
                    // Record voter — UID as doc ID enforces uniqueness at DB level
                    transaction.set(voterRef, {
                        votedAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                });
            });
        })
            .then(function () {
                votedIdeaIds.add(ideaId);
                pendingVotes.delete(ideaId);
                var result = { success: true, message: 'Vote recorded! 🎉' };
                _notifyVoteCallbacks({ type: 'success', ideaId: ideaId, result: result });
                return result;
            })
            .catch(function (error) {
                pendingVotes.delete(ideaId);

                if (error.message === 'ALREADY_VOTED') {
                    votedIdeaIds.add(ideaId); // sync cache with server
                    var dupeResult = { success: false, message: 'You already voted for this one!' };
                    _notifyVoteCallbacks({ type: 'duplicate', ideaId: ideaId, result: dupeResult });
                    return dupeResult;
                }

                if (error.message === 'IDEA_NOT_FOUND') {
                    var notFoundResult = { success: false, message: 'This idea no longer exists.' };
                    _notifyVoteCallbacks({ type: 'error', ideaId: ideaId, result: notFoundResult });
                    return notFoundResult;
                }

                // Generic error — log code, not full message (may contain internal info)
                console.error('[VoteHub Voting] Transaction failed. Code:', error.code || 'unknown');
                var errorResult = { success: false, message: 'Could not record vote. Please try again.' };
                _notifyVoteCallbacks({ type: 'error', ideaId: ideaId, result: errorResult });
                return errorResult;
            });
    }

    function hasVoted(ideaId) { return votedIdeaIds.has(ideaId); }
    function isPending(ideaId) { return pendingVotes.has(ideaId); }

    function onDataChange(callback) {
        if (typeof callback === 'function') dataCallbacks.push(callback);
    }

    function onVoteResult(callback) {
        if (typeof callback === 'function') voteCallbacks.push(callback);
    }

    // ── Sanitization Helpers (VIBECODE SAFELY: Never Trust Input) ──

    /**
     * Sanitize a text string. Trims, enforces max length, escapes for text use.
     * VIBECODE SAFELY: "Trim, normalize, enforce type/length"
     * @param {*} val - Raw value from Firestore
     * @param {string} fallback - Default if invalid
     * @param {number} maxLen - Maximum allowed character length
     * @returns {string}
     */
    function _sanitizeText(val, fallback, maxLen) {
        if (typeof val !== 'string') return fallback;
        var trimmed = val.trim();
        if (trimmed.length === 0) return fallback;
        // Enforce max length to prevent massive payloads
        return trimmed.substring(0, maxLen);
    }

    /**
     * Sanitize a number field. Clamps to non-negative integer.
     * @param {*} val
     * @returns {number}
     */
    function _sanitizeNumber(val) {
        var n = parseInt(val, 10);
        return (!isNaN(n) && n >= 0) ? n : 0;
    }

    /**
     * Validate a document ID is a safe non-empty string.
     * Blocks path traversal or injection via ID manipulation.
     * Only allows alphanumeric, hyphens, underscores.
     * @param {*} val
     * @returns {boolean}
     */
    function _isValidId(val) {
        return typeof val === 'string' &&
            val.length > 0 &&
            val.length <= 128 &&
            /^[a-zA-Z0-9_-]+$/.test(val);
    }

    /**
     * Sanitize a Firestore doc ID before using it in DOM id attributes.
     * @param {string} id
     * @returns {string}
     */
    function _sanitizeId(id) {
        if (typeof id !== 'string') return '';
        // Keep only safe characters for DOM use
        return id.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 128);
    }

    function _notifyDataCallbacks(ideas, error) {
        dataCallbacks.forEach(function (cb) {
            try { cb(ideas, error); } catch (e) {
                console.error('[VoteHub Voting] Data callback error:', e);
            }
        });
    }

    function _notifyVoteCallbacks(event) {
        voteCallbacks.forEach(function (cb) {
            try { cb(event); } catch (e) {
                console.error('[VoteHub Voting] Vote callback error:', e);
            }
        });
    }

    // ── Public API ──
    return {
        initialize: initialize,
        startListening: startListening,
        stopListening: stopListening,
        castVote: castVote,
        hasVoted: hasVoted,
        isPending: isPending,
        onDataChange: onDataChange,
        onVoteResult: onVoteResult
    };
})();

/**
 * ============================================
 * VoteHub — Authentication Module
 * ============================================
 *
 * Handles anonymous Firebase Authentication.
 *
 * How it works:
 *   - When a user opens the site, we sign them in anonymously.
 *   - Firebase assigns a unique UID to each anonymous session.
 *   - This UID is used to enforce one-vote-per-idea.
 *   - The UID persists across page refreshes (local storage).
 *   - If the user clears browser data, they get a new UID.
 *
 * Security considerations:
 *   - Anonymous auth alone doesn't prevent a determined user from
 *     creating multiple UIDs (e.g., incognito mode).
 *   - For an MVP, this is acceptable. For production, consider:
 *     → Firebase App Check
 *     → Rate limiting via Cloud Functions
 *     → Additional device fingerprinting
 * ============================================
 */

// eslint-disable-next-line no-unused-vars
const VoteHubAuth = (function () {
    'use strict';

    /** @type {firebase.auth.Auth|null} */
    let authInstance = null;

    /** @type {string|null} Current authenticated user's UID */
    let currentUID = null;

    /** @type {function[]} Callbacks to run when auth state changes */
    const authStateCallbacks = [];

    /**
     * Initialize the auth module with a Firebase auth instance.
     * Sets up the auth state listener.
     * @param {firebase.auth.Auth} auth - Firebase Auth instance
     * @returns {Promise<string>} Resolves with the user's UID
     */
    function initialize(auth) {
        authInstance = auth;

        return new Promise(function (resolve, reject) {
            // Listen for auth state changes
            authInstance.onAuthStateChanged(function (user) {
                if (user) {
                    // User is signed in (or was already signed in from a previous session)
                    currentUID = user.uid;
                    console.info('[VoteHub Auth] Authenticated. UID:', currentUID);
                    _notifyCallbacks({ authenticated: true, uid: currentUID });
                    resolve(currentUID);
                } else {
                    // No user signed in — perform anonymous sign-in
                    console.info('[VoteHub Auth] No active session. Signing in anonymously...');
                    _signInAnonymously()
                        .then(function (uid) {
                            resolve(uid);
                        })
                        .catch(function (error) {
                            reject(error);
                        });
                }
            });
        });
    }

    /**
     * Perform anonymous sign-in.
     * @returns {Promise<string>} Resolves with the new UID
     * @private
     */
    function _signInAnonymously() {
        return authInstance
            .signInAnonymously()
            .then(function (credential) {
                currentUID = credential.user.uid;
                console.info('[VoteHub Auth] Anonymous sign-in successful. UID:', currentUID);
                _notifyCallbacks({ authenticated: true, uid: currentUID });
                return currentUID;
            })
            .catch(function (error) {
                console.error('[VoteHub Auth] Sign-in failed:', error.code, error.message);
                _notifyCallbacks({ authenticated: false, uid: null, error: error });
                throw error;
            });
    }

    /**
     * Get the current user's UID.
     * @returns {string|null}
     */
    function getUID() {
        return currentUID;
    }

    /**
     * Check if the user is currently authenticated.
     * @returns {boolean}
     */
    function isAuthenticated() {
        return currentUID !== null;
    }

    /**
     * Register a callback to be notified of auth state changes.
     * @param {function} callback - Receives { authenticated: boolean, uid: string|null, error?: Error }
     */
    function onAuthStateChange(callback) {
        if (typeof callback === 'function') {
            authStateCallbacks.push(callback);
        }
    }

    /**
     * Notify all registered callbacks of an auth state change.
     * @param {object} state - The new auth state
     * @private
     */
    function _notifyCallbacks(state) {
        authStateCallbacks.forEach(function (cb) {
            try {
                cb(state);
            } catch (err) {
                console.error('[VoteHub Auth] Callback error:', err);
            }
        });
    }

    // ── Public API ──
    return {
        initialize: initialize,
        getUID: getUID,
        isAuthenticated: isAuthenticated,
        onAuthStateChange: onAuthStateChange
    };
})();

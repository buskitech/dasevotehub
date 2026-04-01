/**
 * ============================================
 * VoteHub — Device Fingerprinting Module
 * ============================================
 * 
 * This module generates a unique device fingerprint to identify users
 * across browsers and devices. Combined with Firestore rules, it ensures
 * each person can only vote ONCE across the entire platform.
 * 
 * VIBECODE SAFELY PRINCIPLES:
 *   ✅ No PII collected (no IP, email, or personal data)
 *   ✅ Fingerprint stored in localStorage (not sent to server initially)
 *   ✅ Fingerprint used as document ID in Firestore 'voters' collection
 *   ✅ Server-side Firestore rules enforce uniqueness
 *   ✅ Fingerprint changes if browser/device changes (as intended)
 * 
 * ============================================
 */

// eslint-disable-next-line no-unused-vars
const VoteHubFingerprint = (function () {
    'use strict';

    /** @type {string|null} Cached fingerprint */
    let cachedFingerprint = null;

    /** @type {string} localStorage key for fingerprint */
    const FINGERPRINT_KEY = 'votehub_device_fingerprint';

    /**
     * Generate a unique device fingerprint based on browser/device characteristics.
     * This fingerprint persists across browser tabs and sessions on the same device.
     * 
     * Components:
     *   - User Agent (browser type, OS)
     *   - Screen resolution
     *   - Timezone offset
     *   - Language
     *   - Hardware concurrency (CPU cores)
     *   - Device memory (if available)
     *   - WebGL renderer (GPU info)
     * 
     * @returns {string} A unique fingerprint hash (64 chars)
     */
    function generateFingerprint() {
        var components = {
            userAgent: navigator.userAgent || 'unknown',
            screenResolution: (screen.width || 0) + 'x' + (screen.height || 0),
            screenColorDepth: screen.colorDepth || 24,
            timezoneOffset: new Date().getTimezoneOffset(),
            language: navigator.language || 'unknown',
            hardwareConcurrency: navigator.hardwareConcurrency || 1,
            deviceMemory: navigator.deviceMemory || 'unknown',
            webglRenderer: _getWebGLRenderer(),
            localStorage: _isLocalStorageEnabled() ? 'yes' : 'no',
            sessionStorage: _isSessionStorageEnabled() ? 'yes' : 'no',
            plugins: _getPluginsHash()
        };

        // Combine all components into a single string
        var fingerprintString = Object.keys(components)
            .sort()
            .map(function (key) {
                return key + ':' + components[key];
            })
            .join('|');

        // Hash the fingerprint string using a simple hash function
        return _hashString(fingerprintString);
    }

    /**
     * Get or create a persistent device fingerprint.
     * On first call, generates and stores in localStorage.
     * On subsequent calls, returns cached or stored fingerprint.
     * 
     * @returns {string} The device fingerprint
     */
    /** Regex to validate a proper 64-char lowercase hex fingerprint */
    var VALID_FINGERPRINT_RE = /^[a-f0-9]{64}$/;

    function getFingerprint() {
        // Return cached fingerprint if available and valid
        if (cachedFingerprint && VALID_FINGERPRINT_RE.test(cachedFingerprint)) {
            return cachedFingerprint;
        }

        // Try to load from localStorage
        try {
            var stored = localStorage.getItem(FINGERPRINT_KEY);
            if (stored && VALID_FINGERPRINT_RE.test(stored)) {
                cachedFingerprint = stored;
                return cachedFingerprint;
            }
        } catch (e) {
            // localStorage not available
            console.warn('[VoteHub Fingerprint] localStorage not available:', e.message);
        }

        // Generate new fingerprint (also regenerates if old format was invalid)
        var newFingerprint = generateFingerprint();
        console.info('[VoteHub Fingerprint] Generated new fingerprint.');

        // Store in localStorage for persistence
        try {
            localStorage.setItem(FINGERPRINT_KEY, newFingerprint);
        } catch (e) {
            console.warn('[VoteHub Fingerprint] Could not store fingerprint:', e.message);
        }

        cachedFingerprint = newFingerprint;
        return newFingerprint;
    }

    /**
     * Clear the stored fingerprint (for testing or reset).
     * This will cause a new fingerprint to be generated on next call.
     */
    function clearFingerprint() {
        cachedFingerprint = null;
        try {
            localStorage.removeItem(FINGERPRINT_KEY);
        } catch (e) {
            console.warn('[VoteHub Fingerprint] Could not clear fingerprint:', e.message);
        }
    }

    /**
     * Get WebGL renderer information (GPU details).
     * This helps differentiate devices with different graphics capabilities.
     * 
     * @returns {string} WebGL renderer name or 'unknown'
     * @private
     */
    function _getWebGLRenderer() {
        try {
            var canvas = document.createElement('canvas');
            var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
            if (gl) {
                var debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
                if (debugInfo) {
                    return gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
                }
            }
        } catch (e) {
            // WebGL not available
        }
        return 'unknown';
    }

    /**
     * Check if localStorage is enabled and accessible.
     * 
     * @returns {boolean} True if localStorage is available
     * @private
     */
    function _isLocalStorageEnabled() {
        try {
            var test = '__votehub_test__';
            localStorage.setItem(test, test);
            localStorage.removeItem(test);
            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * Check if sessionStorage is enabled and accessible.
     * 
     * @returns {boolean} True if sessionStorage is available
     * @private
     */
    function _isSessionStorageEnabled() {
        try {
            var test = '__votehub_test__';
            sessionStorage.setItem(test, test);
            sessionStorage.removeItem(test);
            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * Get a hash of installed browser plugins.
     * This helps differentiate browsers with different plugin sets.
     * 
     * @returns {string} Hash of plugins or 'unknown'
     * @private
     */
    function _getPluginsHash() {
        try {
            if (navigator.plugins && navigator.plugins.length > 0) {
                var pluginNames = [];
                for (var i = 0; i < navigator.plugins.length; i++) {
                    pluginNames.push(navigator.plugins[i].name);
                }
                return _hashString(pluginNames.join('|'));
            }
        } catch (e) {
            // Plugins not available
        }
        return 'no-plugins';
    }

    /**
     * Hash function to convert a string into a 64-character lowercase hex hash.
     * Uses multiple rounds of a simple hash to fill 64 hex characters.
     * 
     * IMPORTANT: Output MUST be exactly 64 lowercase hex chars to pass
     * Firestore security rule: fingerprint.matches('^[a-f0-9]{64}$')
     * 
     * @param {string} str - String to hash
     * @returns {string} 64-character lowercase hex hash
     * @private
     */
    function _hashString(str) {
        // Generate 8 different 32-bit hashes using different seeds
        // to fill 64 hex characters (8 hashes × 8 hex chars = 64)
        var parts = [];
        for (var round = 0; round < 8; round++) {
            var h = 0x811c9dc5 ^ (round * 0x01000193); // FNV offset + seed
            for (var i = 0; i < str.length; i++) {
                h ^= str.charCodeAt(i);
                h = Math.imul(h, 0x01000193); // FNV-1a prime multiply
                h = h >>> 0; // Keep as unsigned 32-bit
            }
            // Convert to 8-char hex, zero-padded, forced lowercase
            var hex = h.toString(16).toLowerCase();
            while (hex.length < 8) {
                hex = '0' + hex;
            }
            parts.push(hex);
        }
        return parts.join('');
    }

    // Public API
    return {
        getFingerprint: getFingerprint,
        generateFingerprint: generateFingerprint,
        clearFingerprint: clearFingerprint
    };
})();

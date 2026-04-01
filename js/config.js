/**
 * ============================================
 * VoteHub — Firebase Configuration
 * ============================================
 *
 * IMPORTANT: Firebase web API keys are designed to be public.
 * They identify your Firebase project but do NOT grant access.
 * Security is enforced through:
 *   1. Firestore Security Rules (server-side)
 *   2. Firebase Authentication (user identity)
 *   3. App Check (optional, for production hardening)
 *
 * For production, you should:
 *   - Enable Firebase App Check to prevent abuse
 *   - Restrict API key usage in Google Cloud Console
 *   - Use domain-based restrictions on your API key
 *
 * SETUP INSTRUCTIONS:
 *   1. Go to https://console.firebase.google.com
 *   2. Create a new project (or select existing)
 *   3. Add a Web App to your project
 *   4. Copy the firebaseConfig object below
 *   5. Replace the placeholder values with your actual config
 *   6. Enable Anonymous Authentication in Firebase Console:
 *      → Authentication → Sign-in method → Anonymous → Enable
 *   7. Create a Firestore Database:
 *      → Firestore Database → Create database → Start in test mode
 *      → Then apply the security rules from firestore.rules
 * ============================================
 */

// eslint-disable-next-line no-unused-vars
const VoteHubConfig = (function () {
  'use strict';

  /**
   * Firebase project configuration for votehub-prod.
   * These values are safe to be in frontend code — they only identify
   * your Firebase project. Real security is enforced by Firestore Rules.
   * See: https://firebase.google.com/docs/projects/api-keys
   */
  const firebaseConfig = {
    apiKey: "AIzaSyCRLLJkg6Y20HQhhFiJ0abQrPdvMc-P_TU",
    authDomain: "votehub-prod.firebaseapp.com",
    projectId: "votehub-prod",
    storageBucket: "votehub-prod.firebasestorage.app",
    messagingSenderId: "1046062568269",
    appId: "1:1046062568269:web:a55c742e321a7c4bf89d04",
    measurementId: "G-097DRFQZC9"   // Google Analytics (optional)
  };

  /**
   * Validate that Firebase config has been properly set up.
   * Returns true if config looks like real values, false if placeholders.
   * Now that real config is set, this will always return true.
   */
  function isConfigured() {
    return (
      typeof firebaseConfig.apiKey === 'string' &&
      firebaseConfig.apiKey.length > 10 &&
      firebaseConfig.apiKey !== 'YOUR_API_KEY_HERE' &&
      typeof firebaseConfig.projectId === 'string' &&
      firebaseConfig.projectId.length > 0 &&
      firebaseConfig.projectId !== 'YOUR_PROJECT_ID'
    );
  }

  /**
   * Initialize Firebase app with the config.
   * Throws a clear error if config hasn't been set up yet.
   * @returns {{ app: object, auth: object, db: object }}
   */
  function initializeFirebase() {
    // Check if Firebase SDK is loaded
    if (typeof firebase === 'undefined') {
      throw new Error(
        '[VoteHub] Firebase SDK not loaded. Check your script tags in index.html.'
      );
    }

    // Block initialization if config is still using placeholders
    if (!isConfigured()) {
      throw new Error(
        'Firebase config not set. Open js/config.js and replace placeholder values. ' +
        'Running in demo mode instead.'
      );
    }

    // Initialize Firebase (idempotent — won't reinitialize if already done)
    let app;
    if (!firebase.apps.length) {
      app = firebase.initializeApp(firebaseConfig);
    } else {
      app = firebase.apps[0];
    }

    // Initialize Analytics if supported and loaded
    let analytics = null;
    if (typeof firebase.analytics === 'function') {
      analytics = firebase.analytics();
      console.info('[VoteHub] Firebase Analytics initialized.');
    }

    // Get service references
    const auth = firebase.auth();
    const db = firebase.firestore();

    // Enable offline persistence for better UX
    db.enablePersistence({ synchronizeTabs: true }).catch(function (err) {
      if (err.code === 'failed-precondition') {
        // Multiple tabs open — persistence can only be enabled in one tab
        console.info('[VoteHub] Persistence unavailable: multiple tabs open.');
      } else if (err.code === 'unimplemented') {
        // Browser doesn't support persistence
        console.info('[VoteHub] Persistence not supported in this browser.');
      }
    });

    console.info('[VoteHub] Firebase initialized successfully.');

    return { app: app, auth: auth, db: db };
  }

  // ── Public API ──
  return {
    initializeFirebase: initializeFirebase,
    isConfigured: isConfigured
  };
})();



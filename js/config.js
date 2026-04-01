

// eslint-disable-next-line no-unused-vars
const VoteHubConfig = (function () {
  'use strict';

  
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



// Firebase settings for the jojo-reminder project.
// These are public identifiers (they ship in the web page); access is
// controlled by firestore.rules, not by keeping these secret.
self.FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDL8VQdB60vHLHIN-G5RNjAIaD2e9TTMwQ',
  authDomain: 'jojo-reminder.firebaseapp.com',
  projectId: 'jojo-reminder',
  storageBucket: 'jojo-reminder.firebasestorage.app',
  messagingSenderId: '347579580470',
  appId: '1:347579580470:web:3997e4042a9d26f6551897',
};

// Cloud Messaging → Web Push certificates → Key pair (public key).
self.FIREBASE_VAPID_KEY = 'BGIWP6AzSRb23NTtRE068GN2uiparBTZDXcTAmePf-YV19x7PZKHv-uS38vT7REwjmK7fLCihFX6sEfbkoqFQBE';

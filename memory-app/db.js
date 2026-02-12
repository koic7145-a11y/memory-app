// ============================================
// 暗記マスター - Database Schema (Dexie.js)
// ============================================

const db = new Dexie('MemoryAppDB');

db.version(1).stores({
    cards: 'id, category, nextReview, level', // Indexes for searching/filtering
    decks: 'id, name',
    marketing: '++id, date, action' // Access logs etc.
});

// Helper to handle huge image data if needed, though Dexie handles blobs/strings well.
// We store images as DataURLs in the 'cards' table directly for simplicity in Phase 1.

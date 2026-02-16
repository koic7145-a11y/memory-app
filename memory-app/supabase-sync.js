// ============================================
// 暗記マスター - Supabase Sync Module
// ============================================
//
// !! 重要 !!
// 以下の2つの値を、あなたのSupabaseプロジェクトの値に置き換えてください。
// Supabaseダッシュボード → Settings → API から取得できます。
//
const SUPABASE_URL = 'https://lnkpzlamsvsyfximrhdw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxua3B6bGFtc3ZzeWZ4aW1yaGR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyMjM1NjgsImV4cCI6MjA4Njc5OTU2OH0.6Uu3gcyOp9dK72OiTE8J0BYwEi9p8L56baI_RYqFtO4';

class SupabaseSync {
    constructor() {
        this.client = null;
        this.user = null;
        this.isSyncing = false;
        this.realtimeChannel = null;
        this.onSyncStatusChange = null; // callback: (status) => void
        this.onDataChange = null;       // callback: () => void
        this._syncTimer = null;
        this._init();
    }

    // ─── Initialize Supabase Client ───
    _init() {
        if (typeof supabase === 'undefined' || !supabase.createClient) {
            console.warn('Supabase SDK not loaded. Sync disabled.');
            return;
        }
        this.client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

        // Listen for auth state changes
        this.client.auth.onAuthStateChange((event, session) => {
            this.user = session?.user ?? null;
            console.log('[Sync] Auth state:', event, this.user?.email);

            if (event === 'SIGNED_IN') {
                this._setSyncStatus('syncing');
                this.fullSync().then(() => this.subscribeRealtime());
            } else if (event === 'SIGNED_OUT') {
                this.unsubscribeRealtime();
                this._setSyncStatus('offline');
            }
        });

        // Online/Offline listeners
        window.addEventListener('online', () => {
            if (this.user) {
                this._setSyncStatus('syncing');
                this.fullSync();
            }
        });
        window.addEventListener('offline', () => {
            this._setSyncStatus('offline');
        });
    }

    // ─── Status Helper ───
    _setSyncStatus(status) {
        if (this.onSyncStatusChange) {
            this.onSyncStatusChange(status); // 'synced', 'syncing', 'offline', 'error'
        }
    }

    isLoggedIn() {
        return !!this.user;
    }

    // ─── Auth: Email + Password ───
    async signUp(email, password) {
        if (!this.client) return { error: { message: 'Supabase未初期化' } };
        const { data, error } = await this.client.auth.signUp({ email, password });
        return { data, error };
    }

    async signIn(email, password) {
        if (!this.client) return { error: { message: 'Supabase未初期化' } };
        const { data, error } = await this.client.auth.signInWithPassword({ email, password });
        return { data, error };
    }

    async signOut() {
        if (!this.client) return;
        this.unsubscribeRealtime();
        await this.client.auth.signOut();
        this.user = null;
        this._setSyncStatus('offline');
    }

    async getSession() {
        if (!this.client) return null;
        const { data } = await this.client.auth.getSession();
        this.user = data.session?.user ?? null;
        return data.session;
    }

    // ─── Full Sync (Pull then Push) ───
    async fullSync() {
        if (!this.client || !this.user || this.isSyncing) return;
        this.isSyncing = true;
        this._setSyncStatus('syncing');
        try {
            await this.pullChanges();
            await this.pushChanges();
            this._setSyncStatus('synced');
        } catch (e) {
            console.error('[Sync] Full sync failed:', e);
            this._setSyncStatus('error');
        } finally {
            this.isSyncing = false;
        }
    }

    // ─── Push: Local → Supabase ───
    async pushChanges() {
        if (!this.client || !this.user) return;

        // Push unsynced cards
        const unsyncedCards = await db.cards
            .where('synced').equals(0)
            .toArray();

        if (unsyncedCards.length > 0) {
            // Note: Image DataURLs can be very large (>1MB each).
            // Supabase has a payload size limit, so we exclude images from sync
            // and only sync metadata. Images remain in local IndexedDB.
            const rows = unsyncedCards.map(card => ({
                id: card.id,
                user_id: this.user.id,
                question: card.question || '',
                answer: card.answer || '',
                category: card.category || '未分類',
                level: card.level || 0,
                ease_factor: card.easeFactor || 2.5,
                interval_days: card.interval || 0,
                repetitions: card.repetitions || 0,
                next_review: card.nextReview || null,
                review_history: JSON.stringify(card.reviewHistory || []),
                created_at: card.createdAt || new Date().toISOString(),
                updated_at: card.updatedAt || new Date().toISOString(),
                deleted: card.deleted === 1
            }));

            const { error } = await this.client
                .from('cards')
                .upsert(rows, { onConflict: 'id' });

            if (error) {
                console.error('[Sync] Push cards failed:', error);
                alert('[Sync Debug] Push cards failed: ' + JSON.stringify(error));
            } else {
                // Mark all as synced
                const ids = unsyncedCards.map(c => c.id);
                await db.cards.where('id').anyOf(ids).modify({ synced: 1 });
                console.log(`[Sync] Pushed ${ids.length} cards`);
            }
        }

        // Push unsynced decks
        const unsyncedDecks = await db.decks
            .where('synced').equals(0)
            .toArray();

        if (unsyncedDecks.length > 0) {
            const rows = unsyncedDecks.map(deck => ({
                id: deck.id,
                user_id: this.user.id,
                name: deck.name,
                group_name: deck.group || null,
                created_at: deck.createdAt || new Date().toISOString(),
                updated_at: deck.updatedAt || new Date().toISOString(),
                deleted: deck.deleted === 1
            }));

            const { error } = await this.client
                .from('decks')
                .upsert(rows, { onConflict: 'id' });

            if (error) {
                console.error('[Sync] Push decks failed:', error);
            } else {
                const ids = unsyncedDecks.map(d => d.id);
                await db.decks.where('id').anyOf(ids).modify({ synced: 1 });
                console.log(`[Sync] Pushed ${ids.length} decks`);
            }
        }
    }

    // ─── Pull: Supabase → Local ───
    async pullChanges() {
        if (!this.client || !this.user) return;

        // Pull cards
        const { data: remoteCards, error: cardsError } = await this.client
            .from('cards')
            .select('*')
            .eq('user_id', this.user.id);

        if (cardsError) {
            console.error('[Sync] Pull cards failed:', cardsError);
            return;
        }

        let changed = false;
        for (const rc of remoteCards || []) {
            const localCard = await db.cards.get(rc.id);

            const remoteCard = {
                id: rc.id,
                question: rc.question || '',
                answer: rc.answer || '',
                category: rc.category || '未分類',
                level: rc.level || 0,
                easeFactor: rc.ease_factor || 2.5,
                interval: rc.interval_days || 0,
                repetitions: rc.repetitions || 0,
                nextReview: rc.next_review || '',
                reviewHistory: typeof rc.review_history === 'string'
                    ? JSON.parse(rc.review_history) : (rc.review_history || []),
                createdAt: rc.created_at,
                updatedAt: rc.updated_at,
                deleted: rc.deleted ? 1 : 0,
                synced: 1
            };

            if (!localCard) {
                if (!rc.deleted) {
                    await db.cards.add(remoteCard);
                    changed = true;
                }
            } else {
                // Last Write Wins
                const remoteTime = new Date(rc.updated_at).getTime();
                const localTime = new Date(localCard.updatedAt || 0).getTime();

                if (remoteTime > localTime) {
                    if (rc.deleted) {
                        await db.cards.delete(rc.id);
                    } else {
                        await db.cards.put(remoteCard);
                    }
                    changed = true;
                }
            }
        }

        // Pull decks
        const { data: remoteDecks, error: decksError } = await this.client
            .from('decks')
            .select('*')
            .eq('user_id', this.user.id);

        if (decksError) {
            console.error('[Sync] Pull decks failed:', decksError);
            return;
        }

        for (const rd of remoteDecks || []) {
            const localDeck = await db.decks.get(rd.id);

            const remoteDeck = {
                id: rd.id,
                name: rd.name,
                group: rd.group_name || '',
                createdAt: rd.created_at,
                updatedAt: rd.updated_at,
                deleted: rd.deleted ? 1 : 0,
                synced: 1
            };

            if (!localDeck) {
                if (!rd.deleted) {
                    await db.decks.add(remoteDeck);
                    changed = true;
                }
            } else {
                const remoteTime = new Date(rd.updated_at).getTime();
                const localTime = new Date(localDeck.updatedAt || 0).getTime();

                if (remoteTime > localTime) {
                    if (rd.deleted) {
                        await db.decks.delete(rd.id);
                    } else {
                        await db.decks.put(remoteDeck);
                    }
                    changed = true;
                }
            }
        }

        if (changed && this.onDataChange) {
            this.onDataChange();
        }
    }

    // ─── Realtime Subscription ───
    subscribeRealtime() {
        if (!this.client || !this.user) return;
        this.unsubscribeRealtime();

        this.realtimeChannel = this.client
            .channel('sync-changes')
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'cards', filter: `user_id=eq.${this.user.id}` },
                (payload) => {
                    console.log('[Realtime] cards change:', payload.eventType);
                    this._handleRealtimeChange('cards', payload);
                }
            )
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'decks', filter: `user_id=eq.${this.user.id}` },
                (payload) => {
                    console.log('[Realtime] decks change:', payload.eventType);
                    this._handleRealtimeChange('decks', payload);
                }
            )
            .subscribe((status) => {
                console.log('[Realtime] subscription status:', status);
            });
    }

    async _handleRealtimeChange(table, payload) {
        const { eventType, new: newRow, old: oldRow } = payload;

        if (table === 'cards') {
            if (eventType === 'DELETE' || (newRow && newRow.deleted)) {
                await db.cards.delete(oldRow?.id || newRow?.id);
            } else if (eventType === 'INSERT' || eventType === 'UPDATE') {
                const card = {
                    id: newRow.id,
                    question: newRow.question || '',
                    answer: newRow.answer || '',
                    category: newRow.category || '未分類',
                    level: newRow.level || 0,
                    easeFactor: newRow.ease_factor || 2.5,
                    interval: newRow.interval_days || 0,
                    repetitions: newRow.repetitions || 0,
                    nextReview: newRow.next_review || '',
                    reviewHistory: typeof newRow.review_history === 'string'
                        ? JSON.parse(newRow.review_history) : (newRow.review_history || []),
                    createdAt: newRow.created_at,
                    updatedAt: newRow.updated_at,
                    deleted: 0,
                    synced: 1
                };
                await db.cards.put(card);
            }
        } else if (table === 'decks') {
            if (eventType === 'DELETE' || (newRow && newRow.deleted)) {
                await db.decks.delete(oldRow?.id || newRow?.id);
            } else if (eventType === 'INSERT' || eventType === 'UPDATE') {
                const deck = {
                    id: newRow.id,
                    name: newRow.name,
                    group: newRow.group_name || '',
                    createdAt: newRow.created_at,
                    updatedAt: newRow.updated_at,
                    deleted: 0,
                    synced: 1
                };
                await db.decks.put(deck);
            }
        }

        if (this.onDataChange) {
            this.onDataChange();
        }
    }

    unsubscribeRealtime() {
        if (this.realtimeChannel) {
            this.client.removeChannel(this.realtimeChannel);
            this.realtimeChannel = null;
        }
    }

    // ─── Mark a record as needing sync ───
    async markCardDirty(cardId) {
        await db.cards.update(cardId, {
            updatedAt: new Date().toISOString(),
            synced: 0
        });
        this._debouncedSync();
    }

    async markDeckDirty(deckId) {
        await db.decks.update(deckId, {
            updatedAt: new Date().toISOString(),
            synced: 0
        });
        this._debouncedSync();
    }

    // ─── Debounced Sync ───
    _debouncedSync() {
        if (this._syncTimer) clearTimeout(this._syncTimer);
        this._syncTimer = setTimeout(() => {
            if (this.user && navigator.onLine) {
                this.pushChanges().then(() => this._setSyncStatus('synced'));
            }
        }, 2000);
    }
}

// Global instance
const syncModule = new SupabaseSync();

import { getFirestore, FieldValue } from "firebase-admin/firestore";
import * as crypto from "crypto";
/**
 * Firestore implementation of IAuthRepository
 */
export class FirestoreAuthRepository {
    getDb() {
        return getFirestore();
    }
    async verifyKey(apiKey) {
        try {
            const db = this.getDb();
            // Hash the key using SHA-256 to compare with stored keyHash
            const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
            // First try to find by keyHash
            let keysSnapshot = await db.collectionGroup('keys')
                .where('keyHash', '==', keyHash)
                .limit(1)
                .get();
            // Fallback for backwards compatibility with unhashed keys
            if (keysSnapshot.empty) {
                keysSnapshot = await db.collectionGroup('keys')
                    .where('key', '==', apiKey)
                    .limit(1)
                    .get();
            }
            if (keysSnapshot.empty) {
                return null;
            }
            const keyDoc = keysSnapshot.docs[0];
            const userRef = keyDoc.ref.parent.parent;
            if (!userRef) {
                return null;
            }
            return {
                tier: 'enterprise',
                uid: userRef.id,
                keyId: keyDoc.id,
                expires: 0 // Cache expiry will be handled by the cached wrapper
            };
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[FirestoreAuthRepository] Verification error: ${msg}`);
            throw new Error(`Authentication store connection failed: ${msg}`);
        }
    }
    async updateLastUsed(uid, keyId) {
        try {
            const db = this.getDb();
            const keyRef = db.collection('users').doc(uid).collection('keys').doc(keyId);
            await keyRef.update({
                lastUsed: FieldValue.serverTimestamp()
            });
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[FirestoreAuthRepository] Update last used error: ${msg}`);
        }
    }
}
/**
 * Firestore implementation of IActivityLogger
 */
export class FirestoreActivityLogger {
    getDb() {
        return getFirestore();
    }
    async logActivity(uid, keyId, tool, params, success) {
        if (uid === 'admin')
            return; // Bypass logging for superadmin requests
        try {
            const db = this.getDb();
            await db.collection('users').doc(uid).collection('activity').add({
                keyId,
                tool,
                params: JSON.stringify(params),
                success,
                timestamp: FieldValue.serverTimestamp()
            });
            // Increment global user request metrics
            const statsRef = db.collection('users').doc(uid);
            await statsRef.set({
                stats: {
                    totalRequests: FieldValue.increment(1),
                    lastActivity: FieldValue.serverTimestamp()
                }
            }, { merge: true });
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[FirestoreActivityLogger] Failed to log activity: ${msg}`);
        }
    }
}
/**
 * Use case: Validating client API keys
 */
export class AuthenticateUserUseCase {
    authRepo;
    authCache = new Map();
    CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    constructor(authRepo) {
        this.authRepo = authRepo;
    }
    async execute(apiKey, superAdminKey) {
        if (!apiKey) {
            throw new Error("Unauthorized: API Key is required. Set CODEATLAS_API_KEY env var or provide x-api-key header.");
        }
        // 1. Super Admin Bypass
        if (superAdminKey && apiKey === superAdminKey) {
            return { tier: 'enterprise', uid: 'admin', keyId: 'admin', expires: Infinity };
        }
        // 2. Check Local RAM Cache
        const cached = this.authCache.get(apiKey);
        if (cached && cached.expires > Date.now()) {
            return cached;
        }
        // 3. Query Repository
        const authData = await this.authRepo.verifyKey(apiKey);
        if (!authData) {
            throw new Error("Unauthorized: Invalid API Key.");
        }
        // Assign cache expiry timestamp
        authData.expires = Date.now() + this.CACHE_TTL;
        this.authCache.set(apiKey, authData);
        // Dynamic updates of usage statistics (non-blocking)
        this.authRepo.updateLastUsed(authData.uid, authData.keyId).catch(() => { });
        return authData;
    }
}
/**
 * Use case: Recording user telemetry and requests
 */
export class LogTelemetryUseCase {
    logger;
    constructor(logger) {
        this.logger = logger;
    }
    async execute(uid, keyId, tool, params, success) {
        await this.logger.logActivity(uid, keyId, tool, params, success);
    }
}
//# sourceMappingURL=repositories.js.map
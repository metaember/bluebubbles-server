import { performance } from "perf_hooks";

/** Bounds the native cache even when macOS drops change notifications. */
export class ContactCache {
    private expiresAt = 0;
    private listening = false;

    constructor(
        private readonly native: any,
        private readonly properties: string[],
        private readonly now = () => performance.now(),
        private readonly ttlMs = 60_000
    ) {}

    invalidate() {
        this.expiresAt = 0;
        this.native.invalidateCache();
    }

    read(forceRefresh = false) {
        // Never turn revoked permission into a successful empty address book.
        if (this.native.getAuthStatus() !== "Authorized") {
            this.invalidate();
            throw new Error("Contacts permission is not authorized");
        }
        if (!this.listening) {
            this.native.listener.on("contact-changed", () => this.invalidate());
            try {
                this.native.listener.setup();
                this.listening = true;
            } catch (error) {
                this.native.listener.removeAllListeners("contact-changed");
                throw error;
            }
        }
        const expired = forceRefresh || this.expiresAt === 0 || this.now() >= this.expiresAt;
        if (expired) this.invalidate();
        // Always hydrate the same property set, including after native invalidation.
        // ContactInterface is responsible for projecting the requested fields.
        const result = this.native.getAllContacts(this.properties);
        if (expired) this.expiresAt = this.now() + this.ttlMs;
        return result;
    }
}

import { timingSafeEqual } from "crypto";

export function shadowReadPolicy(token: string) {
    return async (ctx: any, next: () => Promise<void>) => {
        // Header-only token; no credentials in URLs/logs. No CORS or socket server.
        const supplied = Buffer.from(ctx.get("Authorization"));
        const expected = Buffer.from(`Bearer ${token}`);
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
            ctx.status = 401;
            return;
        }
        if (ctx.method !== "GET") {
            ctx.status = 405;
            return;
        }
        try {
            await next();
        } catch {
            ctx.status = 503;
            ctx.body = { status: 503, message: "Candidate read unavailable" };
        }
    };
}

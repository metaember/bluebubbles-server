import "reflect-metadata";
import { app } from "electron";
import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";
import Koa from "koa";
import Router from "koa-router";
import { Server } from "@server";
import { ServerRepository } from "@server/databases/server";
import { MessageRepository } from "@server/databases/imessage";
import { ContactsLib } from "@server/api/lib/ContactsLib";
import { ContactRouter } from "@server/api/http/api/v1/routers/contactRouter";
import { ChatRouter } from "@server/api/http/api/v1/routers/chatRouter";
import { MessageRouter } from "@server/api/http/api/v1/routers/messageRouter";
import ServerLog from "electron-log";
import { shadowReadPolicy } from "./shadow-policy";

export async function startShadow() {
    const dataDir = app.getPath("userData");
    ServerLog.transports.file.resolvePath = () => path.join(dataDir, "logs", "main.log");
    const tokenPath = path.join(dataDir, "shadow-token");
    if (!fs.existsSync(tokenPath)) {
        fs.writeFileSync(tokenPath, randomBytes(32).toString("hex"), { mode: 0o600, flag: "wx" });
    }
    const token = fs.readFileSync(tokenPath, "utf8").trim();
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Invalid candidate token");

    const server = Server();
    server.repo = new ServerRepository();
    await server.repo.initialize(); // new, isolated DB; never copy production secrets/jobs
    server.iMessageRepo = new MessageRepository();
    let messagesReady = false;
    try {
        await server.iMessageRepo.initialize(true);
        messagesReady = true;
    } catch {
        console.error("Candidate Messages permission unavailable; production remains untouched.");
    }

    const koa = new Koa();
    koa.use(shadowReadPolicy(token));
    const router = new Router();
    router.get("/shadow/status", ctx => {
        ctx.body = {
            mode: "read-only-shadow", pid: process.pid,
            contacts: ContactsLib.getAuthStatus(), messagesReady,
            version: app.getVersion(), cacheTtlSeconds: 60
        };
    });
    router.get("/api/v1/contact", ContactRouter.get);
    router.get("/api/v1/chat/:guid/message", ChatRouter.getMessages);
    router.get("/api/v1/chat/:guid", ChatRouter.find);
    router.get("/api/v1/message/count", MessageRouter.count);
    router.get("/api/v1/message/:guid", MessageRouter.find);
    koa.use(router.routes());
    const http = koa.listen(1235, "127.0.0.1");
    http.on("error", () => app.exit(1));
    const stop = async () => {
        http.close();
        if (server.iMessageRepo.db?.isInitialized) await server.iMessageRepo.db.destroy();
        await server.repo.db.destroy();
        app.exit(0);
    };
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
    console.log("Read-only candidate listening on 127.0.0.1:1235");
    // May show a macOS permission prompt for this new app identity.
    if (ContactsLib.getAuthStatus() === "Not Determined") {
        void ContactsLib.requestAccess();
    }
}

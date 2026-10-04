// Deliberately a separate entrypoint: never start production's lifecycle/services.
import { app } from "electron";
import fs from "fs";
import path from "path";

app.setName("BlueBubbles Candidate");
const dataDir = path.join(app.getPath("appData"), "bluebubbles-candidate");
fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
app.setPath("userData", dataDir);
app.setPath("sessionData", dataDir);
app.setPath("logs", path.join(dataDir, "logs"));
app.commandLine.appendSwitch("in-process-gpu");

if (!app.requestSingleInstanceLock()) {
    app.exit(0);
} else {
    app.whenReady().then(async () => {
        // require after setting userData: several upstream modules capture it on import.
        try {
            await require("./shadow-server").startShadow();
        } catch {
            // Never serialize request URLs, contact data, or native exception contents.
            console.error("Candidate startup failed; inspect permission status and build tests.");
            app.exit(1);
        }
    });
}

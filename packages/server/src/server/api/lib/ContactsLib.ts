import { isMinHighSierra } from "@server/env";
import { ContactCache } from "./ContactCache";

// Only import node-mac-contacts if we are on macOS 10.13 or higher
// This is because node-mac-contacts was compiled for macOS 10.13 or higher
// This library is here to prevent a crash on lower macOS versions
let contacts: any = null;
try {
    if (isMinHighSierra) contacts = require("node-mac-contacts");
} catch {
    contacts = null;
}

let cache: ContactCache = null;

export class ContactsLib {
    static allExtraProps = [
        'jobTitle',
        'departmentName',
        'organizationName',
        'middleName',
        'note',
        'contactImage',
        'contactThumbnailImage',
        'instantMessageAddresses',
        'socialProfiles'
    ];

    static async requestAccess() {
        if (!contacts) return "Unknown";
        return await contacts.requestAccess();
    }

    static getAuthStatus() {
        if (!contacts) return "Unknown";
        return contacts.getAuthStatus();
    }

    static getContactPermissionStatus() {
        if (!contacts) return "Unknown";
        return contacts.getContactPermissionStatus();
    }

    static getAllContacts(extraProps: string[] = [], forceRefresh = false) {
        if (!contacts) return [];
        if (extraProps.some(prop => !ContactsLib.allExtraProps.includes(prop))) {
            throw new TypeError("Unsupported contact property");
        }
        if (!cache) cache = new ContactCache(contacts, ContactsLib.allExtraProps);
        return cache.read(forceRefresh);
    }

    static invalidateCache() {
        cache?.invalidate();
    }
}

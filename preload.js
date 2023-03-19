const {
    contextBridge,
    ipcRenderer
} = require("electron");

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld(
    "electronAPI", {
        send: (channel, data) => {
            ipcRenderer.send(channel, data);
        },
        receive: (channel, func) => {
             ipcRenderer.on(channel, (event, ...args) => func(...args));
        },
        formatDesfireCard: (name) => {
            ipcRenderer.send('format-desfire-card', name);
        },
        provisionDesfireCard: (name) => {
            ipcRenderer.send('provision-desfire-card', name);
        },
        desfireGetApps: (name) => {
            ipcRenderer.send('desfire-get-apps', name);
        },
        onNfcReaderAttached: (callback) => {
            ipcRenderer.on('nfc-reader-attached', callback);
        },
        onNfcReaderRemoved: (callback) => {
            ipcRenderer.on('nfc-reader-removed', callback);
        },
        onNfcCardAttached: (callback) => {
            ipcRenderer.on('nfc-card-attached', callback);
        },
        onNfcCardRemoved: (callback) => {
            ipcRenderer.on('nfc-card-removed', callback);
        },
        onNfcCardProvisioned: (callback) => {
            ipcRenderer.on('nfc-card-provisioned', callback);
        },
        onNfcCardFormatted: (callback) => {
            ipcRenderer.on('nfc-card-formatted', callback);
        },
        onNfcCardError: (callback) => {
            ipcRenderer.on('nfc-card-error', callback);
        },
        onNfcCardProvisioningStarted: (callback) => {
            ipcRenderer.on('nfc-card-provisioning-started', callback);
        },
        onNfcCardFormattingStarted: (callback) => {
            ipcRenderer.on('nfc-card-formatting-started', callback);
        },
        onDesfireApps: (callback) => {
            ipcRenderer.on('desfire-apps', callback);
        }
    }
);

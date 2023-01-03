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
        setOwner: (name) => {
            ipcRenderer.send('set-owner', name);
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
        onNfcCardError: (callback) => {
            ipcRenderer.on('nfc-card-error', callback);
        },
        onNfcCardProvisioningStarted: (callback) => {
            ipcRenderer.on('nfc-card-provisioning-started', callback);
        }
    }
);

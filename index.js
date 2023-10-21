"use strict";

const crypto = require('crypto');
const path = require('path');
const { NFC, CONNECT_MODE_DIRECT } = require("@aapeli/nfc-pcsc");
const { DesfireCard, DesfireKeySettings } = require("@nicolaielectronics/desfire.js");
const Atr = require("./parseAtr.js");
const fs = require('fs');

const { app, BrowserWindow, ipcMain } = require('electron');

/* Electron window */

var mainWindow = null;
var nfc = null;
var oldNames = null;

var readers = {};

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1024,
        height: 768,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            enableRemoteModule: false,
            preload: path.join(__dirname, 'preload.js')
        },
        icon: "favicon.ico"
    });

    //mainWindow.removeMenu();
    mainWindow.loadFile('ui/index.html');

    ipcMain.on('format-desfire-card', handleFormatDesfireCard);
    ipcMain.on('provision-desfire-card', handleProvisionDesfireCard);
    ipcMain.on('desfire-get-apps', handleDesfireGetApps);
}

function startApp() {
    createWindow();

    //mainWindow.webContents.openDevTools();

    setTimeout(startNfc, 500);
}

function startNfc() {
    nfc = new NFC();

    nfc.on("reader", async reader => {
        if (reader.name in readers) {
            console.error("Error: reader attached but already registered", reader.name);
        }
        readers[reader.name] = new NfcReader(reader, (nfcReader, name) => {
            console.log("Reader removed:", name);
            delete readers[name];
            mainWindow.webContents.send('nfc-reader-removed', reader.name);
        });
        console.log("Reader attached:", reader.name);
        mainWindow.webContents.send('nfc-reader-attached', reader.name);
    });

    nfc.on("error", err => {
        console.error("NFC error", err);
    });
}

app.allowRendererProcessReuse = true;
app.whenReady().then(startApp);

app.on('window-all-closed', () => {
    app.quit();
});

/* NFC */

class GenericCard {
    constructor(reader, card) {
        this._reader = reader;
        this._card = card;
        this.uid = null;
    }

    // Standard smartcard commands

    async getUid() {
        const packet = Buffer.from([0xff, 0xca, 0x00, 0x00, 0x00]);
        const response = await this._reader.transmit(packet, 12);

        if (response.length < 2) {
            this.uid = null;
            throw new Error("Response soo short");
        }

        const statusCode = response.slice(-2).readUInt16BE(0);

        if (statusCode !== 0x9000) {
            this.uid = null;
            throw new Error("Error response from card");
        }

        this.uid = response.slice(0, -2).toString('hex');
        return this.uid;
    }
}

class FelicaCard {
    constructor(reader, card) {
        this._reader = reader;
        this._card = card;
        this.uid = null;
        this.uidBinary = null;
    }

    // Standard smartcard commands

    async getUid() {
        const packet = Buffer.from([0xff, 0xca, 0x00, 0x00, 0x00]);
        const response = await this._reader.transmit(packet, 12);

        if (response.length < 2) {
            this.uid = null;
            this.uidBinary = null;
            throw new Error("Response soo short");
        }

        const statusCode = response.slice(-2).readUInt16BE(0);

        if (statusCode !== 0x9000) {
            this.uid = null;
            throw new Error("Error response from card");
        }

        this.uid = response.slice(0, -2).toString('hex');
        this.uidBinary = response.slice(0, -2);
        return this.uid;
    }

    async ACR122ledbuzzertest() {
        const packet = Buffer.from([0xFF, 0x00, 0x40, 0xFF, 0x04, 1, 2, 3, 0x02]);
        console.log("<<", packet);
        const response = await this._reader.transmit(packet, 40);
        console.log(">>", response);
    }

    async pollxxx() {
        const data = Buffer.from([0x10, 0x06, ...this.uidBinary, 0x01, 0x09, 0x01, 0x01, 0x80, 0x00]);
        const packet = Buffer.from([0xFF, 0x00, 0x00, 0x00, data.length + 3, 0xD4, 0x40, 0x01, ...data]);
        console.log("<<", packet);
        const response = await this._reader.transmit(packet, 40);
        console.log(">>", response);
    }

    async pollxx() {
        console.log(this.uidBinary);
        const packet = Buffer.from([0x10, 0x06, ...this.uidBinary, 0x01, 0x09, 0x01, 0x01, 0x80, 0x00]);
        console.log("<<", packet);
        const response = await this._reader.transmit(packet, 40);
        console.log(">>", response);
    }

    async acr122u_read_firmware_version() {
        const packet = Buffer.from([0xFF, 0x00, 0x48, 0x00, 0x00]);
        console.log("<<", packet);
        const response = await this._reader.transmit(packet, 40);
        console.log(">>", response);
    }
}


class NfcReader {
    constructor(reader, onEnd) {
        this._reader = reader;
        this._onEnd = onEnd;
        this._reader.autoProcessing = false;
        this._reader.on("end", () => {
            if (typeof this._onEnd === "function") {
                this._onEnd(this, reader.name);
            }
        });
        this._reader.on("card", this._onCard.bind(this));
        this._reader.on("card.off", this._onCardRemoved.bind(this));
        reader.on("error", (err) => {
            if (err.message.startsWith("Not found response. Tag not compatible with AID")) {
                console.log(this._reader.name + ": Card is not compatible with this application.");
            } else {
                console.error(this._reader.name + " error:", err);
            }
        });

        this.card = null;
        this.cardPresent = false;
    };

    async _onCard(card) {
        let cardWasPresent = this.cardPresent;
        this.cardPresent = true;
        let atr = new Atr(card.atr);
        /*if (!cardWasPresent) {

        } else {
            // Library has handled the tag
            this.card = card;
            if (typeof card.uid === "string") {
                console.log("Card with UID " + card.uid + " found: ", card);
                mainWindow.webContents.send('nfc-card-attached', {
                    type: "other",
                    reader: this._reader.name,
                    uid: this.card.uid
                });
            } else {
                console.log("Card found:", card);
                mainWindow.webContents.send('nfc-card-attached', {
                    type: "other",
                    reader: this._reader.name,
                    uid: null
                });
            }
        }*/
        /*if (atr.isDesfire()) {
            this.card = new DesfireCard(this._reader, card);
            console.log(this._reader.name + ": Desfire card attached");
            await this.card.getUid();
            mainWindow.webContents.send('nfc-card-attached', {
                reader: this._reader.name,
                card: {
                    type: "desfire",
                    uid: this.card.uid
                }
            });
        } else {
            this.card = new GenericCard(this._reader, card);
            console.log(this._reader.name + ": Other card attached");
            try {
                await this.card.getUid();
            } catch (exception) {
                // Ignore.
            }
            mainWindow.webContents.send('nfc-card-attached', {
                reader: this._reader.name,
                card: {
                    type: "unknown",
                    uid: this.card.uid
                }
            });
        }*/
        this.card = new FelicaCard(this._reader, card);
        console.log(this._reader.name + ": card attached");
        try {
            await this.card.getUid();
            await this.card.poll();
        } catch (exception) {
            // Ignore.
        }
        mainWindow.webContents.send('nfc-card-attached', {
            reader: this._reader.name,
            card: {
                type: "unknown",
                uid: this.card.uid
            }
        });
    }

    async _onCardRemoved(card) {
        this.card = null;
        this.cardPresent = false;
        console.log(this._reader.name + ": card removed");
        mainWindow.webContents.send('nfc-card-removed', {
            reader: this._reader.name,
            card: card
        });
    }

    async formatDesfireCard() {
        if (this.card === null) {
            mainWindow.webContents.send('nfc-card-error', {
                reader: this._reader.name,
                uid: "",
                error: "No card on reader"
            });
            return;
        }
        mainWindow.webContents.send('nfc-card-formatting-started', {
            reader: this._reader.name,
            uid: this.card.uid
        });

        try {
            await this.card.selectApplication(0x000000); // Select PICC
            await this.card.authenticateLegacy(0x00, this.card.default_des_key); // Authenticate using default key
            await this.card.formatPicc(); // Format card

            mainWindow.webContents.send('nfc-card-formatted', {
                reader: this._reader.name,
                uid: this.card.uid
            });
        } catch (error) {
            mainWindow.webContents.send('nfc-card-error', {
                reader: this._reader.name,
                uid: this.card.uid,
                error: error.message
            });
        }
    }

    async provisionDesfireCard() {
        if (this.card === null) {
            mainWindow.webContents.send('nfc-card-error', {
                reader: this._reader.name,
                uid: "",
                error: "No card on reader"
            });
            return;
        }
        mainWindow.webContents.send('nfc-card-provisioning-started', {
            reader: this._reader.name,
            uid: this.card.uid
        });

        try {
            let key = crypto.randomBytes(16);
            let secret = crypto.randomBytes(16);

            await this.card.selectApplication(0x000000); // Select PICC
            await this.card.authenticateLegacy(0x00, this.card.default_des_key); // Authenticate using default key

            let uid = (await this.card.ev1GetCardUid()).toString('hex');
            if (this.card.uid !== uid) {
                console.log("Randomized UID mode detected, this card can not be used");
                mainWindow.webContents.send('nfc-card-error', {
                    reader: this._reader.name,
                    uid: this.card.uid,
                    error: "Randomized UID mode detected, this card can not be used"
                });
                return;
            }

            // Create application, change key and authenticate
            await this.card.createApplication(0x1984, this.card.constants.keySettings.factoryDefault, 1, this.card.constants.keyType.AES);
            await this.card.selectApplication(0x1984);
            await this.card.ev1AuthenticateAes(0, this.card.default_aes_key);
            await this.card.changeKeyAes(42, 0, key);
            await this.card.ev1AuthenticateAes(0, key);

            // Create file, write secret and read back secret for verification
            await this.card.createStandardDataFile(1, false, true, 0, 0, 0, 0, 16);
            await this.card.writeDataEncrypted(1, secret, 0);
            let fileContents = await this.card.readDataEncrypted(1, 0, 16);
            if (Buffer.compare(secret, fileContents) !== 0) {
                console.log("Failed to verify secret file contents");
                mainWindow.webContents.send('nfc-card-error', {
                    reader: this._reader.name,
                    uid: this.card.uid,
                    error: "Failed to verify secret file contents"
                });
                return;
            }

            // Create file, write name and read back name for verification
            /*let nameBuffer = Buffer.from(name).slice(0,16);
            await this.card.createStandardDataFile(2, false, true, 0, 0, 0, 0, 16);
            await this.card.writeDataEncrypted(2, nameBuffer, 0);
            let nameFileContents = await this.card.readDataEncrypted(2, 0, 16);
            if (Buffer.compare(nameBuffer, nameFileContents.slice(0, nameBuffer.length)) !== 0) {
                console.log("Failed to verify name file contents", nameBuffer, nameFileContents);
                mainWindow.webContents.send('nfc-card-error', {
                    reader: this._reader.name,
                    uid: this.card.uid,
                    error: "Failed to verify name file contents"
                });
                return;
            }*/

            mainWindow.webContents.send('nfc-card-provisioned', {
                reader: this._reader.name,
                uid: this.card.uid,
                data: key.toString('hex') + secret.toString('hex')
            });
        } catch (error) {
            mainWindow.webContents.send('nfc-card-error', {
                reader: this._reader.name,
                uid: this.card.uid,
                error: error.message
            });
        }
    }

    async desfireGetApps() {
        if (this.card === null) {
            mainWindow.webContents.send('nfc-card-error', {
                reader: this._reader.name,
                uid: "",
                error: "No card on reader"
            });
            return;
        }
        try {
            await this.card.selectApplication(0x000000); // Select PICC
            await this.card.authenticateLegacy(0x00, this.card.default_des_key); // Authenticate using default key

            let apps = await this.card.getApplicationIdentifiers();

            mainWindow.webContents.send('desfire-apps', {
                reader: this._reader.name,
                uid: this.card.uid,
                apps: apps
            });
        } catch (error) {
            mainWindow.webContents.send('nfc-card-error', {
                reader: this._reader.name,
                uid: this.card.uid,
                error: error.message
            });
        }
    }
}


function handleFormatDesfireCard(_event, name) {
    console.log("Desfire format request", name);
    let reader = readers[name];
    reader.formatDesfireCard();
}

function handleProvisionDesfireCard(_event, name) {
    console.log("Desfire provision request", name);
    let reader = readers[name];
    reader.provisionDesfireCard();
}

function handleDesfireGetApps(_event, name) {
    console.log("Desfire apps request", name);
    let reader = readers[name];
    reader.desfireGetApps();
}

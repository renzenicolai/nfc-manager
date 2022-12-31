"use strict";

const crypto = require('crypto');
const path = require('path');
const { NFC, CONNECT_MODE_DIRECT } = require("@aapeli/nfc-pcsc");
const { DesfireCard, DesfireKeySettings } = require("@nicolaielectronics/desfire.js");
const Atr = require("./parseAtr.js");

const { app, BrowserWindow } = require('electron');

/* Electron window */

var mainWindow = null;
var nfc = null;

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

    mainWindow.removeMenu();
    mainWindow.loadFile('index.html');
}

function startApp() {
    createWindow();

    mainWindow.webContents.openDevTools();

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
        if (atr.isDesfire()) {
            this.card = new DesfireCard(this._reader, card);
            console.log(this._reader.name + ": Desfire card attached");
            await this.card.getUid();
            mainWindow.webContents.send('nfc-card-attached', {
                type: "desfire",
                reader: this._reader.name,
                uid: this.card.uid
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
                type: "other",
                reader: this._reader.name,
                uid: this.card.uid
            });
        }
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
}

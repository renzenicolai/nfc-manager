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
var name = "anonymous";
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

    mainWindow.removeMenu();
    mainWindow.loadFile('index.html');
    
    ipcMain.on('set-owner', handleSetOwner);
}

function handleSetOwner(_event, newName) {
    name = newName;
    console.log("Owner set to ", name);
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
            this.provisionDesfireCard(this.card);
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
    
    async provisionDesfireCard(desfire) {
        mainWindow.webContents.send('nfc-card-provisioning-started', {
            reader: this._reader.name,
            uid: this.card.uid
        });
        
        try {
            let key = crypto.randomBytes(16);
            let secret = crypto.randomBytes(16);
            
            await desfire.selectApplication(0x000000); // Select PICC
            await desfire.authenticateLegacy(0x00, desfire.default_des_key); // Authenticate using default key
            await desfire.formatPicc(); // Format card
            let uid = (await desfire.ev1GetCardUid()).toString('hex');
            if (desfire.uid !== uid) {
                console.log("Randomized UID mode detected, this card can not be used");
                mainWindow.webContents.send('nfc-card-error', {
                    reader: this._reader.name,
                    uid: this.card.uid,
                    error: "Randomized UID mode detected, this card can not be used"
                });
                return;
            }
            
            // Create application, change key and authenticate
            await desfire.createApplication(0x1984, desfire.constants.keySettings.factoryDefault, 1, desfire.constants.keyType.AES);
            await desfire.selectApplication(0x1984);
            await desfire.ev1AuthenticateAes(0, desfire.default_aes_key);
            await desfire.changeKeyAes(42, 0, key);
            await desfire.ev1AuthenticateAes(0, key);
            
            // Create file, write secret and read back secret for verification
            await desfire.createStandardDataFile(1, false, true, 0, 0, 0, 0, 16);
            await desfire.writeDataEncrypted(1, secret, 0);
            let fileContents = await desfire.readDataEncrypted(1, 0, 16);
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
            let nameBuffer = Buffer.from(name).slice(0,16);
            await desfire.createStandardDataFile(2, false, true, 0, 0, 0, 0, 16);
            await desfire.writeDataEncrypted(2, nameBuffer, 0);
            let nameFileContents = await desfire.readDataEncrypted(2, 0, 16);
            if (Buffer.compare(nameBuffer, nameFileContents.slice(0, nameBuffer.length)) !== 0) {
                console.log("Failed to verify name file contents", nameBuffer, nameFileContents);
                mainWindow.webContents.send('nfc-card-error', {
                    reader: this._reader.name,
                    uid: this.card.uid,
                    error: "Failed to verify name file contents"
                });
                return;
            }

            mainWindow.webContents.send('nfc-card-provisioned', {
                reader: this._reader.name,
                uid: this.card.uid,
                data: key.toString('hex') + secret.toString('hex'),
                owner: name
            });
            
            updateDatabase(name, this.card.uid, key.toString('hex') + secret.toString('hex'));
        } catch (error) {
            mainWindow.webContents.send('nfc-card-error', {
                reader: this._reader.name,
                uid: this.card.uid,
                error: error.message
            });
        }
    }
}

function updateDatabase(name, uid, data) {
    /*let database = JSON.parse(fs.readFileSync("nfc.json"));
    database[uid] = {
        secret: data,
        owner: name
    };
    fs.writeFileSync("nfc.json", JSON.stringify(database));*/
}

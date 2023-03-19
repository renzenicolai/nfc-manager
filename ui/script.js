class Reader {
    constructor(name) {
        this.name = name;
        this.card = null;
        this.provisioningResult = null;
        this.desfireApps = [];
    }

    getName() {
        return this.name;
    }

    setCard(card) {
        this.card = card;
        this.provisioningResult = null;
        this.desfireApps = [];
    }

    getCard() {
        return this.card;
    }

    setProvisioningResult(result) {
        this.provisioningResult = result;
    }

    setDesfireApps(apps) {
        this.desfireApps = apps;
    }
}

var readers = [];
var currentReader = null;

function findReader(name) {
    for (let index = 0; index < readers.length; index++) {
        let reader = readers[index];
        if (reader.getName() === name) {
            console.log("findReader(" + name + ") found");
            return reader;
        }
    }
    console.log("findReader(" + name + ") not found");
    return null;
}

function updateCardsUi() {
    let output = [];
    for (let index = 0; index < readers.length; index++) {
        let reader = readers[index];
        let name = reader.getName();
        let card = reader.getCard();
        let empty = true;
        let selected = false;
        let description = name + "<br />" + "No card";
        if (card !== null) {
            empty = false;
            description =  name + "<br />" + card.type + "<br />" + card.uid;
        }
        if (reader === currentReader) {
            selected = true;
        }
        output.push("<div class=\"smartcard" + (empty ? " empty" : "") + (selected ? " selected" : "") + "\" onclick=\"selectReader(" + index + ");\">" + description + "</div>");
    }
    document.getElementById("cards").innerHTML = output.join('');
}

function selectReader(index) {
    currentReader = readers[index];
    updateCardsUi();
    updateReaderUi();
}

function updateReaderUi() {
    if (currentReader === null) {
        document.getElementById("reader").innerHTML = "<div class=\"reader\"></div>";
        return;
    }

    let uid = (currentReader.card !== null) ? currentReader.card.uid : "N/A";
    let secret = (currentReader.provisioningResult !== null) ? currentReader.provisioningResult.data : "N/A";

    let appsString = "";
    for (let index = 0; index < currentReader.desfireApps.length; index++) {
        let app = currentReader.desfireApps[index];
        appsString += app.toString(16);
        if (index < currentReader.desfireApps.length - 1) {
            appsString += ", ";
        }
    }

    document.getElementById("reader").innerHTML = "<div class=\"reader\">" + currentReader.getName() + "<br /><button type=\"button\" onClick=\"formatDesfireCard();\">Format DesFire card</button>&nbsp;<button type=\"button\" onClick=\"provisionDesfireCard();\">Install TkkrLab application to DesFire card</button>&nbsp;<button type=\"button\" onClick=\"desfireGetApps();\">Get list of installed applications</button><br /><br /><table><tr><td>Card identifier</td><td>" + uid + "</td></tr><td>Secret</td><td>" + secret + "</td></tr><tr><td>Apps</td><td>" + appsString + "</td></tr></table></div>";
}

function formatDesfireCard() {
    window.electronAPI.formatDesfireCard(currentReader.getName());
}

function provisionDesfireCard() {
    window.electronAPI.provisionDesfireCard(currentReader.getName());
}

function desfireGetApps() {
    window.electronAPI.desfireGetApps(currentReader.getName());
}

window.electronAPI.onNfcReaderAttached((_event, value) => {
    log( "Reader attached: " + value );
    let reader = new Reader(value);
    readers.push(reader);
    if (readers.length === 1) {
        currentReader = reader;
        updateReaderUi();
    }
    updateCardsUi();
});
window.electronAPI.onNfcReaderRemoved((_event, value) => {
    log( "Reader removed: " + value );
    let reader = findReader(value);
    if (currentReader === reader) {
        currentReader = null;
        updateReaderUi();
    }
    readers = readers.filter(e => e !== reader);
    if (currentReader === null && readers.length > 0) {
        currentReader = readers[0];
        updateReaderUi();
    }
    updateCardsUi();
});

window.electronAPI.onNfcCardAttached((_event, value) => {
    console.log("Card attached", value);
    log( "Card attached to '" + value.reader + "': " + value.card.type + " " + value.card.uid );
    let reader = findReader(value.reader);
    reader.setCard(value.card);
    updateCardsUi();
    if (currentReader === reader) {
        updateReaderUi();
    }
});

window.electronAPI.onNfcCardRemoved((_event, value) => {
    console.log("Card removed", value);
    log( "Card removed from '" + value.reader );
    let reader = findReader(value.reader);
    reader.setCard(null);
    updateCardsUi();
    if (currentReader === reader) {
        updateReaderUi();
    }
});

window.electronAPI.onNfcCardProvisioningStarted((_event, value) => {
    console.log("Card provisioning started", value);
    log( "Provisioning card " + value.uid + "...");
});

window.electronAPI.onNfcCardProvisioned((_event, value) => {
    console.log("Card provisioning completed", value);
    log( "Succesfully provisioned card " + value.uid + ": " + value.data );
    currentReader.setProvisioningResult(value);
    updateReaderUi();
});

window.electronAPI.onNfcCardFormatted((_event, value) => {
    log("Card " + value.uid + " has been formatted");
    updateReaderUi();
    alert("Card " + value.uid + " has been formatted");
});


window.electronAPI.onNfcCardError((_event, value) => {
    log( "Error (card " + value.uid + "): " + value.error );
    updateReaderUi();
    alert("An error occured while communicating with card " + value.uid + ": " + value.error);
});

window.electronAPI.onDesfireApps((_event, value) => {
    let appsString = "";
    for (let index = 0; index < value.apps.length; index++) {
        let app = value.apps[index];
        appsString += " " + app.toString(16);
    }
    log( "Got list of apps for card " + value.uid + ": " + appsString );
    currentReader.setDesfireApps(value.apps);
    updateReaderUi();
});

updateCardsUi();
updateReaderUi();

var loglines = [];
function log(line) {
    loglines.push(line);
    while (loglines.length > 15) loglines.shift();
    document.getElementById("log").innerHTML = loglines.join('<br />');
}

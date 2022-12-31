"use strict";

class Atr {
    constructor(buffer) {
        this._raw = buffer;
        this._decompose(buffer);
    }

    _decompose(buffer) {
        this.ts = buffer[0];
        this.t0 = buffer[1];
        this.hbn = this.t0 & 0x0F;
        this.ta = {};
        this.tb = {};
        this.tc = {};
        this.td = {};
        this.tck = null;
        this.extra = null;
        this.missing = 0;

        let haveTck = false;

        this.protocolNumber = 1;

        let tdi = this.t0;
        let hb_length = this.t0 & 0x0F;
        let pointer = 1;

        while (pointer < buffer.length) {
            if ((tdi | 0xEF) == 0xFF) {
                pointer++;
                this.ta[this.protocolNumber] = buffer[pointer];
            }
            if ((tdi | 0xDF) == 0xFF) {
                pointer++;
                this.tb[this.protocolNumber] = buffer[pointer];
            }
            if ((tdi | 0xBF) == 0xFF) {
                pointer++;
                this.tc[this.protocolNumber] = buffer[pointer];
            }
            if ((tdi | 0x7F) == 0xFF) {
                pointer++;
                this.td[this.protocolNumber] = buffer[pointer];
                tdi = buffer[pointer];
                if ((tdi & 0x0F) != 0) {
                    haveTck = true;
                }
                this.protocolNumber++;
            } else {
                break;
            }
        }

        let last = pointer + 1 + hb_length;

        this.historicalBytes = buffer.slice(pointer + 1, last);

        if (haveTck) {
            this.tck = buffer[last];
        }

        if (buffer.length > last) {
            this.extra = buffer.slice(last);
        }

        if (this.historicalBytes.length < hb_length) {
            this.missing = hb_length - this.historicalBytes.length;
        }

        this.valid = (this.tck == this._checksum(buffer));
    }

    _checksum(buffer) {
        let sum = 0;
        for (let index = 1; index < buffer.length - 1; index++) {
            sum ^= buffer[index];
        }
        return sum;
    }

    isDesfire() {
        if (!this.valid) return false;
        if (this.ts != 0x3b) return false;
        if ((Object.keys(this.ta).length != 0) || (Object.keys(this.tb).length != 0) || (Object.keys(this.tc).length != 0)) return false;
        if ((!("1" in this.td)) || (this.td["1"] != 0x80) || (!("2" in this.td)) || (this.td["2"] != 0x01)) return false;
        if ((this.extra == null) || (this.extra.length != 1) || (this.extra[0] != 0x80)) return false;
        return true;
    }
};

module.exports = Atr;

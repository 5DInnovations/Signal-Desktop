/* vim: ts=4:sw=4
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
;(function() {
    'use strict';

    function isStringable(thing) {
        return (thing === Object(thing) &&
                    (thing.__proto__ == StaticArrayBufferProto ||
                    thing.__proto__ == StaticUint8ArrayProto ||
                    thing.__proto__ == StaticByteBufferProto));
    }
    function convertToArrayBuffer(thing) {
        if (thing === undefined)
            return undefined;
        if (thing === Object(thing)) {
            if (thing.__proto__ == StaticArrayBufferProto)
                return thing;
            //TODO: Several more cases here...
        }

        if (thing instanceof Array) {
            // Assuming Uint16Array from curve25519
            //TODO: Move to convertToArrayBuffer
            var res = new ArrayBuffer(thing.length * 2);
            var uint = new Uint16Array(res);
            for (var i = 0; i < thing.length; i++)
                uint[i] = thing[i];
            return res;
        }

        var str;
        if (isStringable(thing))
            str = stringObject(thing);
        else if (typeof thing == "string")
            str = thing;
        else
            throw new Error("Tried to convert a non-stringable thing of type " + typeof thing + " to an array buffer");
        var res = new ArrayBuffer(str.length);
        var uint = new Uint8Array(res);
        for (var i = 0; i < str.length; i++)
            uint[i] = str.charCodeAt(i);
        return res;
    }

    var Model = Backbone.Model.extend({ database: Whisper.Database });
    var PreKey = Model.extend({ storeName: 'preKeys' });
    var SignedPreKey = Model.extend({ storeName: 'signedPreKeys' });

    function AxolotlStore() {}

    AxolotlStore.prototype = {
        constructor: AxolotlStore,
        get: function(key,defaultValue) {
            return textsecure.storage.get(key, defaultValue);
        },
        put: function(key, value) {
            textsecure.storage.put(key, value);
        },
        remove: function(key) {
            textsecure.storage.remove(key);
        },
        getMyIdentityKey: function() {
            var res = textsecure.storage.get('identityKey');
            if (res === undefined)
                return undefined;

            return {
                pubKey: convertToArrayBuffer(res.pubKey),
                privKey: convertToArrayBuffer(res.privKey)
            };
        },
        getMyRegistrationId: function() {
                return textsecure.storage.get('registrationId');
        },

        /* Returns a prekeypair object or undefined */
        getPreKey: function(keyId) {
            var prekey = new PreKey({id: keyId});
            return new Promise(function(resolve) {
                prekey.fetch().then(function() {
                    resolve({
                        pubKey: prekey.attributes.publicKey,
                        privKey: prekey.attributes.privateKey
                    });
                }).fail(resolve);
            });
        },
        putPreKey: function(keyId, keyPair) {
            var prekey = new PreKey({
                id         : keyId,
                publicKey  : keyPair.pubKey,
                privateKey : keyPair.privKey
            });
            return new Promise(function(resolve) {
                prekey.save().always(function() {
                    resolve();
                });
            });
        },
        removePreKey: function(keyId) {
            var prekey = new PreKey({id: keyId});

            new Promise(function(resolve) {
                var accountManager = new textsecure.AccountManager();
                accountManager.refreshPreKeys().then(resolve);
            });

            return new Promise(function(resolve) {
                prekey.destroy().then(function() {
                    resolve();
                });
            });
        },

        /* Returns a signed keypair object or undefined */
        getSignedPreKey: function(keyId) {
            var prekey = new SignedPreKey({id: keyId});
            return new Promise(function(resolve) {
                prekey.fetch().then(function() {
                    resolve({
                        pubKey: prekey.attributes.publicKey,
                        privKey: prekey.attributes.privateKey
                    });
                }).fail(resolve);
            });
        },
        putSignedPreKey: function(keyId, keyPair) {
            var prekey = new SignedPreKey({
                id         : keyId,
                publicKey  : keyPair.pubKey,
                privateKey : keyPair.privKey
            });
            return new Promise(function(resolve) {
                prekey.save().always(function() {
                    resolve();
                });
            });
        },
        removeSignedPreKey: function(keyId) {
            var prekey = new SignedPreKey({id: keyId});
            return new Promise(function(resolve) {
                prekey.destroy().then(function() {
                    resolve();
                });
            });
        },

        getSession: function(encodedNumber) {
            if (encodedNumber === null || encodedNumber === undefined)
                throw new Error("Tried to get session for undefined/null key");
            return Promise.resolve((function() {
                var number = textsecure.utils.unencodeNumber(encodedNumber)[0];
                var deviceId = textsecure.utils.unencodeNumber(encodedNumber)[1];

                var sessions = textsecure.storage.get("sessions" + number);
                if (sessions === undefined)
                    return undefined;
                if (sessions[deviceId] === undefined)
                    return undefined;

                return sessions[deviceId];
            })());
        },
        putSession: function(encodedNumber, record) {
            if (encodedNumber === null || encodedNumber === undefined)
                throw new Error("Tried to put session for undefined/null key");
            var number = textsecure.utils.unencodeNumber(encodedNumber)[0];
            var deviceId = textsecure.utils.unencodeNumber(encodedNumber)[1];

            var sessions = textsecure.storage.get("sessions" + number);
            if (sessions === undefined)
                sessions = {};
            sessions[deviceId] = record;
            textsecure.storage.put("sessions" + number, sessions);

            return textsecure.storage.devices.getDeviceObject(encodedNumber).then(function(device) {
                if (device === undefined) {
                    return textsecure.storage.axolotl.getIdentityKey(number).then(function(identityKey) {
                        device = { encodedNumber: encodedNumber,
                                //TODO: Remove this duplication
                                identityKey: identityKey
                                };
                        return textsecure.storage.devices.saveDeviceObject(device);
                    });
                }
            });
        },
        removeAllSessions: function(number) {
            if (number === null || number === undefined)
                throw new Error("Tried to put session for undefined/null key");
            return Promise.resolve(textsecure.storage.remove("sessions" + number));
        },
        getIdentityKey: function(identifier) {
            if (identifier === null || identifier === undefined)
                throw new Error("Tried to get identity key for undefined/null key");
            var number = textsecure.utils.unencodeNumber(identifier)[0];
            return Promise.resolve(convertToArrayBuffer(function() {
                var map = textsecure.storage.get("devices" + number);
                return map === undefined ? undefined : map.identityKey;
            }());
        },
        putIdentityKey: function(identifier, identityKey) {
            if (identifier === null || identifier === undefined)
                throw new Error("Tried to put identity key for undefined/null key");
            var number = textsecure.utils.unencodeNumber(identifier)[0];
            return Promise.resolve((function() {
                var map = textsecure.storage.get("devices" + number);
                if (map === undefined)
                    textsecure.storage.put("devices" + number, { devices: [], identityKey: identityKey});
                else if (getString(map.identityKey) !== getString(identityKey))
                    throw new Error("Attempted to overwrite a different identity key");
            })());
        },
        removeIdentityKey: function(number) {
            return Promise.resolve((function() {
                var map = textsecure.storage.get("devices" + number);
                if (map === undefined)
                    throw new Error("Tried to remove identity for unknown number");
                textsecure.storage.remove("devices" + number);
                return textsecure.storage.axolotl.removeAllSessions(number);
            })());
        },


    };

    window.AxolotlStore = AxolotlStore;
})();
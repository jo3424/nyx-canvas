'use strict';
// Trusted public keys for Nyx update signatures (ed25519). The private keys never leave the build boxes.
// A patch is accepted when its manifest.sig verifies with ANY key in this list (key rotation without
// breaking older signers). Do not remove LEGACY: patches signed with the original key must keep working.
const LEGACY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA0BpU/HCp14nIU6nzueOwMEDg0y4HIvfraHwlrXvoRwo=
-----END PUBLIC KEY-----
`;
const CURRENT = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA7bfsGpt4U8DsKLVQ861AQ7UdCiXT8W2YQhS86Zse6Bc=
-----END PUBLIC KEY-----
`;
const TRUSTED = [LEGACY, CURRENT];
Object.assign(TRUSTED, { LEGACY, CURRENT });
module.exports = Object.freeze(TRUSTED);

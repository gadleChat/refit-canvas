// Email/password login is not exposed by this token-only standalone host.
const unsupported=()=>{throw new Error('Use the local API-token connection dialog.');};
export default {ready:Promise.resolve(),crypto_pwhash:unsupported,crypto_generichash:unsupported,crypto_pwhash_SALTBYTES:16,crypto_pwhash_ALG_ARGON2ID13:2};

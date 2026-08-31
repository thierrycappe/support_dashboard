import { exportJWK, generateKeyPair } from 'jose'

const pair = await generateKeyPair('EdDSA', { extractable: true })
const privateJwk = await exportJWK(pair.privateKey)
const publicJwk = await exportJWK(pair.publicKey)

console.log(`SUPPORT_TOWER_ACCESS_TOKEN_PRIVATE_JWK=${JSON.stringify(privateJwk)}`)
console.log(`SUPPORT_TOWER_ACCESS_TOKEN_PUBLIC_JWK=${JSON.stringify(publicJwk)}`)

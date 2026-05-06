import {
  randomBytes,
  scrypt,
  timingSafeEqual,
  createHash,
} from 'node:crypto'

const FORMAT = 'scrypt-v1'
const KEY_LENGTH = 64
const DEFAULT_COST = 16384
const DEFAULT_BLOCK_SIZE = 8
const DEFAULT_PARALLELIZATION = 1

export interface PasswordHashOptions {
  cost?: number
  blockSize?: number
  parallelization?: number
}

function constantTimeStringEquals(actual: string, expected: string): boolean {
  const actualHash = createHash('sha256').update(actual).digest()
  const expectedHash = createHash('sha256').update(expected).digest()
  return timingSafeEqual(actualHash, expectedHash)
}

function deriveKey(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) {
        reject(error)
        return
      }
      resolve(derivedKey)
    })
  })
}

export async function hashPassword(
  password: string,
  options: PasswordHashOptions = {},
): Promise<string> {
  const cost = options.cost ?? DEFAULT_COST
  const blockSize = options.blockSize ?? DEFAULT_BLOCK_SIZE
  const parallelization = options.parallelization ?? DEFAULT_PARALLELIZATION
  const salt = randomBytes(16)
  const derivedKey = await deriveKey(password, salt, KEY_LENGTH, {
    N: cost,
    r: blockSize,
    p: parallelization,
  })

  return [
    FORMAT,
    cost,
    blockSize,
    parallelization,
    salt.toString('base64url'),
    derivedKey.toString('base64url'),
  ].join('$')
}

export async function verifyPassword(
  password: string,
  encodedHash: string,
): Promise<boolean> {
  const parts = encodedHash.split('$')
  if (parts.length !== 6 || parts[0] !== FORMAT) return false

  const [, costValue, blockSizeValue, parallelizationValue, saltValue, hashValue] =
    parts
  const cost = Number(costValue)
  const blockSize = Number(blockSizeValue)
  const parallelization = Number(parallelizationValue)

  if (
    !Number.isInteger(cost) ||
    !Number.isInteger(blockSize) ||
    !Number.isInteger(parallelization)
  ) {
    return false
  }

  const salt = Buffer.from(saltValue, 'base64url')
  const expectedHash = Buffer.from(hashValue, 'base64url')
  const actualHash = await deriveKey(password, salt, expectedHash.length, {
    N: cost,
    r: blockSize,
    p: parallelization,
  })

  if (actualHash.length !== expectedHash.length) return false
  return timingSafeEqual(actualHash, expectedHash)
}

export async function verifyLegacyPlaintextPassword(
  password: string,
  expectedPassword: string,
): Promise<boolean> {
  return constantTimeStringEquals(password, expectedPassword)
}

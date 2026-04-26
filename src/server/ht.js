/**
 * ht.js
 * ═════════════════════════════════════════════════════════════════════════════
 * Fusió de trusted.js + cryptoEngine en un sol mòdul ESM.
 *
 * Exporta:
 *   · getDispositivos()                          → string[]
 *   · agregarDispositivo(publicKey, nombre)      → void
 *   · consultarDispositivo(publicKey)            → boolean
 *   · eliminarDispositivo(publicKey)             → void
 *   · listarDispositivos()                       → void
 *   · encryptAndShard(base64, n, k)              → { encryptedPayload, shards }
 *   · reconstructAndDecrypt(encryptedPayload, fragments) → base64 string
 *
 * Sense dependències externes — tot via node:crypto i node:fs.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync }       from 'node:fs'

const ARCHIVO_CONFIANZA = './src/server/trusted.json'

// ═════════════════════════════════════════════════════════════════════════════
// 1. GESTIÓ DE LA TAULA DE CONFIANÇA  (ex trusted.js)
// ═════════════════════════════════════════════════════════════════════════════

function cargarTabla() {
  if (!existsSync(ARCHIVO_CONFIANZA)) return {}
  return JSON.parse(readFileSync(ARCHIVO_CONFIANZA, 'utf-8'))
}

function guardarTabla(tabla) {
  writeFileSync(ARCHIVO_CONFIANZA, JSON.stringify(tabla, null, 2))
}

/** Retorna totes les claus públiques (hex) de la taula de confiança. */
export function getDispositivos() {
  return Object.keys(cargarTabla())
}

export function agregarDispositivo(publicKey, nombre) {
  const tabla = cargarTabla()
  tabla[publicKey] = { nombre, agregadoEl: new Date().toISOString() }
  guardarTabla(tabla)
  console.log(`\n[ÉXITO] Dispositivo '${nombre}' agregado a la lista de confianza.`)
}

/** Comprova si una clau pública és de confiança. Retorna true/false. */
export function consultarDispositivo(publicKey) {
  const tabla = cargarTabla()
  if (tabla[publicKey]) {
    console.log(`\n[PERMITIDO] Conexión aceptada. Es el dispositivo de: ${tabla[publicKey].nombre}`)
    return true
  }
  console.log(`\n[BLOQUEADO] Alerta: Dispositivo desconocido. Conexión rechazada.`)
  return false
}

export function eliminarDispositivo(publicKey) {
  const tabla = cargarTabla()
  if (tabla[publicKey]) {
    const nombre = tabla[publicKey].nombre
    delete tabla[publicKey]
    guardarTabla(tabla)
    console.log(`\n[ELIMINADO] El dispositivo de '${nombre}' ya no es de confianza.`)
  } else {
    console.log(`\n[ERROR] Esa clave no existe en tu lista.`)
  }
}

export function listarDispositivos() {
  const tabla  = cargarTabla()
  const claves = Object.keys(tabla)
  console.log('\n--- TU LISTA DE CONFIANZA ---')
  if (claves.length === 0) {
    console.log('No tienes a nadie agregado aún.')
  } else {
    claves.forEach(c => console.log(`- ${tabla[c].nombre} (Clave: ${c})`))
  }
  console.log('-----------------------------')
}

// ═════════════════════════════════════════════════════════════════════════════
// 2. GALOIS FIELD GF(2^8)  — base per a Shamir Secret Sharing
//    Polinomi irreductible: x^8 + x^4 + x^3 + x + 1  (0x11b, estàndard AES)
// ═════════════════════════════════════════════════════════════════════════════

const GF_EXP = new Uint8Array(512)
const GF_LOG = new Uint8Array(256)

;(function buildGFTables() {
  let x = 1
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x
    GF_LOG[x] = i
    x = (x ^ (x << 1) ^ (x & 0x80 ? 0x1b : 0)) & 0xff
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255]
})()

const gfMul = (a, b) =>
  a === 0 || b === 0 ? 0 : GF_EXP[(GF_LOG[a] + GF_LOG[b]) % 255]

const gfDiv = (a, b) => {
  if (b === 0) throw new Error('GF: divisió per zero')
  return a === 0 ? 0 : GF_EXP[(GF_LOG[a] - GF_LOG[b] + 255) % 255]
}

// ═════════════════════════════════════════════════════════════════════════════
// 3. SHAMIR SECRET SHARING  sobre GF(2^8), byte a byte
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Divideix un Buffer `secret` en `n` fragments amb llindar `k`.
 * Cada fragment: { x: number, y: string (hex) }
 */
function shamirSplit(secret, n, k) {
  if (k < 2)   throw new Error('k ha de ser >= 2')
  if (k > n)   throw new Error('k no pot ser > n')
  if (n > 254) throw new Error('n no pot ser > 254 en GF(256)')

  const ys = Array.from({ length: n }, () => Buffer.alloc(secret.length))

  for (let b = 0; b < secret.length; b++) {
    const coeff = [secret[b], ...Array.from(randomBytes(k - 1))]
    for (let i = 0; i < n; i++) {
      const x = i + 1
      let   y = 0
      for (let c = k - 1; c >= 0; c--) {
        y = gfMul(y, x) ^ coeff[c]
      }
      ys[i][b] = y
    }
  }

  return Array.from({ length: n }, (_, i) => ({
    x: i + 1,
    y: ys[i].toString('hex'),
  }))
}

/**
 * Reconstrueix el secret a partir d'almenys k fragments { x, y }.
 * Interpolació de Lagrange en GF(2^8).
 */
function shamirCombine(fragments) {
  const pts = fragments.map(f => ({ x: f.x, y: Buffer.from(f.y, 'hex') }))
  const len = pts[0].y.length
  const out = Buffer.alloc(len)

  for (let b = 0; b < len; b++) {
    let secret = 0
    for (let i = 0; i < pts.length; i++) {
      let num = pts[i].y[b]
      let den = 1
      for (let j = 0; j < pts.length; j++) {
        if (i === j) continue
        num = gfMul(num, pts[j].x)
        den = gfMul(den, pts[i].x ^ pts[j].x)
      }
      secret ^= gfDiv(num, den)
    }
    out[b] = secret
  }
  return out
}

// ═════════════════════════════════════════════════════════════════════════════
// 4. AES-256-GCM
// ═════════════════════════════════════════════════════════════════════════════

const KEY_BYTES = 32
const IV_BYTES  = 12

function aesEncrypt(plainBuf) {
  const key    = randomBytes(KEY_BYTES)
  const iv     = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct     = Buffer.concat([cipher.update(plainBuf), cipher.final()])
  const tag    = cipher.getAuthTag()
  return {
    ciphertext: ct.toString('base64'),
    iv:         iv.toString('hex'),
    tag:        tag.toString('hex'),
    key,
  }
}

function aesDecrypt(ciphertext, iv, tag, key) {
  const dec = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'))
  dec.setAuthTag(Buffer.from(tag, 'hex'))
  return Buffer.concat([
    dec.update(Buffer.from(ciphertext, 'base64')),
    dec.final(),
  ])
}

// ═════════════════════════════════════════════════════════════════════════════
// 5. API PÚBLICA — cridada des d'emisor.js
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Xifra el contingut (base64) amb AES-256-GCM i divideix la clau en n
 * fragments SSS amb llindar k.
 *
 * @param {string} base64
 * @param {number} n  Nombre total de fragments (= dispositius actius)
 * @param {number} k  Fragments mínims per desxifrar
 * @returns {{ encryptedPayload: { ciphertext, iv, tag }, shards: Array<{x,y}> }}
 */
export async function encryptAndShard(base64, n, k) {
  const { ciphertext, iv, tag, key } = aesEncrypt(Buffer.from(base64, 'base64'))
  const shards = shamirSplit(key, n, k)
  return { encryptedPayload: { ciphertext, iv, tag }, shards }
}

/**
 * Reconstrueix la clau AES a partir dels fragments i desxifra l'arxiu.
 *
 * @param {{ ciphertext: string, iv: string, tag: string }} encryptedPayload
 * @param {Array<{x,y}|string>} fragments
 * @returns {string}  Contingut desxifrat en base64
 */
export async function reconstructAndDecrypt(encryptedPayload, fragments) {
  const parsed = fragments.map(f =>
    typeof f === 'string' ? JSON.parse(f) : f
  )
  const key   = shamirCombine(parsed)
  const plain = aesDecrypt(
    encryptedPayload.ciphertext,
    encryptedPayload.iv,
    encryptedPayload.tag,
    key,
  )
  return plain.toString('base64')
}

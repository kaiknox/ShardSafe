import DHT from 'hyperdht'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

console.log('==== Servidor P2P a la escucha ====')

// Directori local on es guarden els arxius encriptats
// Format de cada arxiu:
//   línia 1 : fragmentoClave
//   línia 2 : n k
//   resta    : contingut encriptat (encryptedPayload JSON serialitzat)
const DIRECTORIO_ARCHIVOS = './src/server/archivos'

if (!fs.existsSync(DIRECTORIO_ARCHIVOS)) {
  fs.mkdirSync(DIRECTORIO_ARCHIVOS, { recursive: true })
  console.log(`[i] Directori '${DIRECTORIO_ARCHIVOS}' creat.`)
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: construeix i envia una trama [1 byte id | cuerpo] pel canal obert
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Respon pel canal bidireccional existent sense obrir cap connexió nova.
 * @param {import('stream').Duplex} connection
 * @param {number} id - ID de resposta (0-255)
 * @param {Buffer|string} cuerpo
 */
function responder(connection, id, cuerpo = Buffer.alloc(0)) {
  const idBuffer = Buffer.alloc(1)
  idBuffer.writeUInt8(id, 0)
  const cuerpoBuffer = Buffer.isBuffer(cuerpo) ? cuerpo : Buffer.from(cuerpo, 'utf8')
  connection.write(idBuffer)
  connection.end(cuerpoBuffer)
}

// ─────────────────────────────────────────────────────────────────────────────
// Handlers per ID
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ID 1 — Cerca de fragment de clau per nom d'arxiu.
 *
 * Payload esperat (JSON UTF-8):
 *   { nombre: string, direccion: string }
 *
 * Resposta ID 2 pel mateix canal:
 *   - Si trobat  → el fragment de clau (primera línia de l'arxiu), com a string UTF-8
 *   - Si no trobat → cos buit
 */
function manejarId1(connection, payload) {
  let nombre, direccion
  try {
    ;({ nombre, direccion } = JSON.parse(payload.toString('utf8')))
  } catch (e) {
    console.error('[!] ID 1: payload JSON invàlid:', e.message)
    return
  }

  console.log(`[i] ID 1 — Cercant arxiu: "${nombre}" (sol·licitat per ${String(direccion).substring(0, 10)}...)`)

  const rutaArchivo = path.join(DIRECTORIO_ARCHIVOS, nombre)

  if (!fs.existsSync(rutaArchivo)) {
    console.log(`[-] ID 1 — Arxiu "${nombre}" no trobat. Responent buit (ID 2).`)
    responder(connection, 2, Buffer.alloc(0))
    return
  }

  // Línia 1 = fragmentoClave
  const contingut = fs.readFileSync(rutaArchivo, 'utf8')
  const clave = contingut.split('\n')[0].trim()

  console.log(`[+] ID 1 — Fragment de clau trobat per "${nombre}". Responent amb ID 2.`)
  responder(connection, 2, clave)
}

/**
 * ID 3 — Ping. Resposta ID 4 amb cos buit pel mateix canal.
 */
function manejarId3(connection) {
  console.log('[i] ID 3 — Ping rebut. Responent amb ID 4.')
  responder(connection, 4, Buffer.alloc(0))
}

/**
 * ID 5 — Recepció i emmagatzematge d'arxiu encriptat.
 *
 * Payload esperat (JSON UTF-8):
 * {
 *   nombre:         string,   // nom de l'arxiu a guardar
 *   fragmentoClave: string,   // fragment de clau SSS (shard)
 *   n:              number,   // total de shards
 *   k:              number,   // shards mínims per reconstruir
 *   contenido:      string    // encryptedPayload JSON serialitzat (ciphertext+iv)
 * }
 *
 * Format de l'arxiu guardat:
 *   <fragmentoClave>
 *   <n> <k>
 *   <contenido>
 */
function manejarId5(connection, payload) {
  let nombre, fragmentoClave, n, k, contenido
  try {
    ;({ nombre, fragmentoClave, n, k, contenido } = JSON.parse(payload.toString('utf8')))
  } catch (e) {
    console.error('[!] ID 5: payload JSON invàlid:', e.message)
    return
  }

  if (!nombre || fragmentoClave === undefined || n === undefined || k === undefined || contenido === undefined) {
    console.error('[!] ID 5: falten camps al payload.')
    return
  }

  console.log(`[i] ID 5 — Guardant arxiu encriptat: "${nombre}" (n=${n}, k=${k})`)

  const textoArchivo = `${fragmentoClave}\n${n} ${k}\n${contenido}`
  const rutaArchivo  = path.join(DIRECTORIO_ARCHIVOS, nombre)

  try {
    fs.writeFileSync(rutaArchivo, textoArchivo, 'utf8')
    console.log(`[+] ID 5 — Arxiu "${nombre}" guardat a ${rutaArchivo}`)
  } catch (e) {
    console.error(`[!] ID 5 — Error en guardar "${nombre}":`, e.message)
  }
  // ID 5 no requereix resposta → no cridem responder()
}

// ─────────────────────────────────────────────────────────────────────────────
// Servidor DHT
// ─────────────────────────────────────────────────────────────────────────────

const node   = new DHT()
const server = node.createServer()

server.on('connection', function (connection) {
  console.log('\n[+] Nova connexió entrant!')

  const chunks = []

  connection.on('data', (data) => chunks.push(data))

  connection.on('end', () => {
    const bufferTotal = Buffer.concat(chunks)

    if (bufferTotal.length === 0) {
      console.log('[-] Connexió tancada sense dades.')
      return
    }

    const id      = bufferTotal[0]
    const payload = bufferTotal.subarray(1)

    console.log(`[i] Trama rebuda → ID: ${id} | Mida payload: ${payload.length} bytes`)

    switch (id) {
      case 1:  manejarId1(connection, payload); break
      case 3:  manejarId3(connection);          break
      case 5:  manejarId5(connection, payload); break
      default:
        console.log(`[-] ID ${id} no definit. Ignorant.`)
        break
    }
  })

  connection.on('error', (err) => {
    console.error('[!] Error en la connexió:', err)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Arrencada
// ─────────────────────────────────────────────────────────────────────────────

const identity   = JSON.parse(fs.readFileSync('./src/server/identity.json', 'utf-8'))
const semilla    = crypto.createHash('sha256').update(identity.clavePrivada).digest()
const keyPair    = DHT.keyPair(semilla)

// Actualitza la clau pública al JSON
const publicKeyHex = keyPair.publicKey.toString('hex')
identity.direccionPublica = publicKeyHex
fs.writeFileSync('./src/server/identity.json', JSON.stringify(identity, null, 2))

await server.listen(keyPair)
console.log('Escoltant peticions de forma contínua...')
console.log('La teva Clau Pública és:', publicKeyHex)
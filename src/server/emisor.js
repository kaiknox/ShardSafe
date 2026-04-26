import DHT from 'hyperdht'
import fs from 'fs'
import path from 'path'
import { getDispositivos } from './ht.js'
import { encryptAndShard, reconstructAndDecrypt } from './ht.js'

// Directori local d'arxius (ha de coincidir amb el receptor)
const DIRECTORIO_ARCHIVOS = './src/server/archivos'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de xarxa de baix nivell
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Envia una trama [1 byte id | cuerpo] a una direcció P2P i espera resposta.
 * Utilitza el canal bidireccional: no tanca fins rebre resposta o timeout.
 *
 * @param {string}        direccion   - Clau pública del receptor (hex)
 * @param {number}        id          - ID de la trama (0-255)
 * @param {Buffer|string} cuerpo      - Payload a enviar
 * @param {number}        timeoutMs   - Temps màxim d'espera en ms (default 1000)
 * @returns {Promise<Buffer|null>}      Payload de la resposta, o null si timeout/error
 */
function enviarYEsperar(direccion, id, cuerpo = Buffer.alloc(0), timeoutMs = 5000) {
  return new Promise((resolve) => {
    let resolt = false

    const node      = new DHT()
    const publicKey = Buffer.from(direccion, 'hex')
    const connection = node.connect(publicKey)

    // Timer de seguretat
    const timer = setTimeout(() => {
      if (!resolt) {
        resolt = true
        connection.destroy()
        node.destroy()
        resolve(null)
      }
    }, timeoutMs)

    connection.on('open', () => {
      const idBuffer = Buffer.alloc(1)
      idBuffer.writeUInt8(id, 0)
      const cuerpoBuffer = Buffer.isBuffer(cuerpo) ? cuerpo : Buffer.from(cuerpo, 'utf8')

      // Enviem trama i indiquem que hem acabat d'escriure (half-close)
      // però mantenim obert per rebre la resposta
      connection.write(idBuffer)
      connection.end(cuerpoBuffer)
    })

    // Recollim la resposta del receptor pel canal bidireccional
    const resChunks = []
    connection.on('data', (data) => resChunks.push(data))

    connection.on('end', () => {
      if (!resolt) {
        resolt = true
        clearTimeout(timer)
        node.destroy()
        const resposta = Buffer.concat(resChunks)
        resolve(resposta.length > 0 ? resposta : null)
      }
    })

    connection.on('error', () => {
      if (!resolt) {
        resolt = true
        clearTimeout(timer)
        node.destroy()
        resolve(null)
      }
    })
  })
}

/**
 * Envia una trama sense esperar cap resposta (fire & forget).
 * Útil per ID 5 (guardar arxiu al receptor).
 *
 * @param {string}        direccion
 * @param {number}        id
 * @param {Buffer|string} cuerpo
 */
function enviarTrama(direccion, id, cuerpo = Buffer.alloc(0)) {
  return new Promise((resolve) => {
    const node       = new DHT()
    const publicKey  = Buffer.from(direccion, 'hex')
    const connection = node.connect(publicKey)

    connection.on('open', () => {
      const idBuffer = Buffer.alloc(1)
      idBuffer.writeUInt8(id, 0)
      const cuerpoBuffer = Buffer.isBuffer(cuerpo) ? cuerpo : Buffer.from(cuerpo, 'utf8')
      connection.write(idBuffer)
      connection.end(cuerpoBuffer)
    })

    connection.on('close', () => {
      node.destroy()
      resolve()
    })

    connection.on('error', () => {
      node.destroy()
      resolve()
    })
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. consultarClave — pregunta a un dispositiu si té el fragment de clau
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Envia una trama ID 1 a una direcció i espera la resposta (ID 2) amb la clau.
 *
 * @param {string} direccion  - Clau pública del peer (hex)
 * @param {string} nomArxiu   - Nom de l'arxiu a cercar
 * @returns {Promise<string|null>} El fragment de clau, o null si no trobat/timeout
 */
export async function consultarClave(direccion, nomArxiu) {
  const payload = JSON.stringify({ nombre: nomArxiu, direccion })

  let resposta
  try {
    resposta = await enviarYEsperar(direccion, 1, payload, 5000)
  } catch {
    return null
  }

  if (!resposta || resposta.length === 0) return null

  // La resposta és: [1 byte id (=2) | clave string]
  const idResposta = resposta[0]
  if (idResposta !== 2) return null

  const clave = resposta.subarray(1).toString('utf8').trim()
  return clave.length > 0 ? clave : null
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. recopilarIDesxifrar — recull fragments i desxifra quan n'hi ha prou
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per a cada dispositiu de la taula hash, consulta si té el fragment de clau
 * de l'arxiu indicat. Quan s'han recollit k fragments, reconstrueix la clau
 * via SSS i desxifra l'arxiu amb AES-GCM. Desa el resultat en memòria.
 *
 * Cridat des del frontend en prémer el botó de desxifrar.
 *
 * @param {string} nomArxiu - Nom de l'arxiu local a desxifrar
 * @returns {Promise<{ base64: string, originalName: string } | null>}
 *          L'arxiu desxifrat en base64, o null si no hi ha prou claus
 */
export async function recopilarIDesxifrar(nomArxiu) {
  // Llegim l'arxiu local per obtenir n, k i el contingut encriptat
  const rutaArxiu = path.join(DIRECTORIO_ARCHIVOS, nomArxiu)
  if (!fs.existsSync(rutaArxiu)) {
    console.error(`[!] recopilarIDesxifrar: arxiu "${nomArxiu}" no trobat localment.`)
    return null
  }

  const contingutArxiu = fs.readFileSync(rutaArxiu, 'utf8')
  const linies          = contingutArxiu.split('\n')

  // línia 0: fragmentoClave propi (no l'usem aquí, cerquem els dels peers)
  // línia 1: "n k"
  // resta:   encryptedPayload JSON
  const [nStr, kStr] = linies[1].trim().split(' ')
  const n            = parseInt(nStr, 10)
  const k            = parseInt(kStr, 10)
  const encryptedPayload = JSON.parse(linies.slice(2).join('\n'))

  console.log(`[i] recopilarIDesxifrar: buscant ${k}/${n} fragments per "${nomArxiu}"`)

  const direccions = getDispositivos()  // array de hex strings (claus públiques)

  // Fragment propi de l'emisor (línia 0 de l'arxiu local)
  const fragmentPropi = linies[0].trim()
  const fragments = fragmentPropi ? [fragmentPropi] : []
  if (fragmentPropi) console.log(`[+] Fragment propi de l'emisor afegit.`)

  for (const dir of direccions) {
    if (fragments.length >= k) break   // ja tenim prou → parem de consultar

    console.log(`[→] Consultant ${dir.substring(0, 10)}...`)
    const clave = await consultarClave(dir, nomArxiu)

    if (clave) {
      console.log(`[+] Fragment obtingut de ${dir.substring(0, 10)}`)
      fragments.push(clave)
    } else {
      console.log(`[-] Cap fragment a ${dir.substring(0, 10)}`)
    }
  }

  if (fragments.length < k) {
    console.warn(`[!] Fragments insuficients: ${fragments.length}/${k}. No es pot desxifrar.`)
    return null
  }

  console.log(`[✓] Fragments suficients (${fragments.length}/${k}). Desxifrant...`)


  // reconstructAndDecrypt espera (encryptedPayload, shards[])
  // on cada shard és l'objecte { x, y } o string segons cryptoEngine
  // Normalitzar tots els fragments al mateix format
  const fragmentsNormalitzats = fragments.map(f => {
    if (typeof f === 'string') {
      try { return JSON.parse(f) }
      catch { return f }
    }
    return f
  })

  const base64Desxifrat = await reconstructAndDecrypt(encryptedPayload, fragmentsNormalitzats)

  // reconstructAndDecrypt espera (encryptedPayload, shards[])
  // on cada shard és l'objecte { x, y } o string segons cryptoEngine
  //const base64Desxifrat = await reconstructAndDecrypt(encryptedPayload, fragments)

  return {
    base64:       base64Desxifrat,
    originalName: nomArxiu,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. xifrarIDistribuir — xifra un arxiu i envia els fragments als peers actius
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 1. Fa ping (ID 3) a tots els dispositius de la taula hash → els que responen
 *    ID 4 en <1s són "actius". N = nombre de dispositius actius.
 * 2. Calcula k = majoria simple de N.
 * 3. Xifra l'arxiu amb AES-GCM + SSS (n, k) via encryptAndShard.
 * 4. Envia a cada dispositiu actiu la trama ID 5 amb el seu fragment.
 *
 * Cridat des del frontend en prémer el botó d'encriptar/distribuir.
 *
 * @param {string} nomArxiu  - Nom de l'arxiu (per identificar-lo als peers)
 * @param {string} base64    - Contingut de l'arxiu a xifrar en base64
 * @returns {Promise<{ n: number, k: number, distribuïts: number }>}
 */
export async function xifrarIDistribuir(nomArxiu, base64) {
  const totesDireccions = getDispositivos()

  // ── Pas 1: descobrir dispositius actius (ping ID 3, esperar ID 4) ─────────
  console.log(`[i] xifrarIDistribuir: comprovant ${totesDireccions.length} dispositius...`)

  const dispositivosActius = []

  await Promise.all(
    totesDireccions.map(async (dir) => {
      const resposta = await enviarYEsperar(dir, 3, Buffer.alloc(0), 5000)
      if (resposta && resposta[0] === 4) {
        console.log(`[+] Dispositiu actiu: ${dir.substring(0, 10)}...`)
        dispositivosActius.push(dir)
      } else {
        console.log(`[-] Dispositiu inactiu o sense resposta: ${dir.substring(0, 10)}...`)
      }
    })
  )

  const n = dispositivosActius.length
  if (n === 0) {
    console.error('[!] Cap dispositiu actiu. Cancel·lant distribució.')
    return null
  }

  if (n < 2) {
    console.error(`[!] Dispositius insuficients: ${n} actiu(s), mínim 2 necessaris per distribuir de forma segura.`)
    return null
  }

  // ── Pas 2: l'emisor s'inclou com a node → n total = peers actius + 1 ──────
  const nTotal = n + 1
  const k = Math.floor(nTotal / 2) + 1
  console.log(`[i] Dispositius actius: ${n} + emisor = ${nTotal} nodes → k = ${k}`)

  // ── Pas 3: xifrar i fragmentar la clau ───────────────────────────────────
  console.log(`[i] Xifrant "${nomArxiu}" amb n=${nTotal}, k=${k}...`)
  const { encryptedPayload, shards } = await encryptAndShard(base64, nTotal, k)

  const contingutEncriptat = JSON.stringify(encryptedPayload)

  // ── Pas 4a: l'emisor guarda el seu fragment (índex 0) localment ──────────
  if (!fs.existsSync(DIRECTORIO_ARCHIVOS)) fs.mkdirSync(DIRECTORIO_ARCHIVOS, { recursive: true })

  const fragmentPropi = shards[0]
  const fragmentoClaveProp = typeof fragmentPropi === 'string' ? fragmentPropi : JSON.stringify(fragmentPropi)

  const contingutLocal = [
    fragmentoClaveProp,
    `${nTotal} ${k}`,
    contingutEncriptat,
  ].join('\n')

  const rutaLocal = path.join(DIRECTORIO_ARCHIVOS, nomArxiu)
  fs.writeFileSync(rutaLocal, contingutLocal, 'utf8')
  console.log(`[+] Fragment propi (0/${nTotal}) guardat localment a ${rutaLocal}`)

  // ── Pas 4b: enviar la resta de fragments als dispositius actius ───────────
  let distribuïts = 0

  await Promise.all(
    dispositivosActius.map(async (dir, i) => {
      const fragment = shards[i + 1]   // índex 0 és de l'emisor

      const payloadId5 = JSON.stringify({
        nombre:         nomArxiu,
        fragmentoClave: typeof fragment === 'string' ? fragment : JSON.stringify(fragment),
        n:              nTotal,
        k,
        contenido:      contingutEncriptat,
      })

      try {
        await enviarTrama(dir, 5, payloadId5)
        console.log(`[+] Fragment ${i + 2}/${nTotal} enviat a ${dir.substring(0, 10)}...`)
        distribuïts++
      } catch (e) {
        console.error(`[!] Error enviant fragment a ${dir.substring(0, 10)}:`, e.message)
      }
    })
  )

  console.log(`[✓] Distribució completada: 1 local + ${distribuïts}/${n} enviats als peers.`)
  return { n: nTotal, k, distribuïts: distribuïts + 1 }
}
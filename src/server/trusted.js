// server/trusted.js
//
// Same as before but functions now RETURN data so the server can send it
// to the React app over WebSocket, instead of just console.logging.

import fs from 'node:fs';

const ARCHIVO_CONFIANZA = './src/server/trusted.json';

export function cargarTabla() {
  if (!fs.existsSync(ARCHIVO_CONFIANZA)) return {};
  return JSON.parse(fs.readFileSync(ARCHIVO_CONFIANZA, 'utf-8'));
}

export function guardarTabla(tablaHash) {
  fs.writeFileSync(ARCHIVO_CONFIANZA, JSON.stringify(tablaHash, null, 2));
}

// Returns the new device object
export function agregarDispositivo(publicKey, nombre) {
  const tabla = cargarTabla();
  const device = {
    nombre,
    publicKey,
    agregadoEl: new Date().toISOString(),
  };
  tabla[publicKey] = device;
  guardarTabla(tabla);
  console.log(`[TRUSTED] Added: '${nombre}'`);
  return device;
}

// Returns true if found and removed, false if not found
export function eliminarDispositivo(publicKey) {
  const tabla = cargarTabla();
  if (!tabla[publicKey]) return false;
  const nombre = tabla[publicKey].nombre;
  delete tabla[publicKey];
  guardarTabla(tabla);
  console.log(`[TRUSTED] Removed: '${nombre}'`);
  return true;
}

// Returns array of devices (instead of console.logging)
export function listarDispositivos() {
  const tabla = cargarTabla();
  return Object.entries(tabla).map(([publicKey, info]) => ({
    publicKey,
    nombre:     info.nombre,
    agregadoEl: info.agregadoEl,
  }));
}

export function consultarDispositivo(publicKey) {
  const tabla = cargarTabla();
  return tabla[publicKey] ?? null;
}
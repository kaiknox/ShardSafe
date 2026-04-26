import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Llegeix els arxius de la carpeta 'arxius' i retorna un array de JSON
 * amb la informació de cada fitxer: path, author, timestamp i size.
 *
 * @param {string} [author='unknown'] - Autor per defecte assignat a cada fitxer
 * @returns {Array<{path: string, author: string, timestamp: number, size: number}>}
 */
export function llistarArxius(author = 'unknown') {
  const carpeta = path.resolve(__dirname, 'archivos');

  if (!fs.existsSync(carpeta)) {
    throw new Error(
      `La carpeta "archivos" no existeix a: ${carpeta}\n` +
      `Crea-la primer amb: mkdir archivos`
    );
  }

  const entrades = fs.readdirSync(carpeta, { withFileTypes: true });

  const files = entrades
    .filter(entrada => entrada.isFile())
    .map(entrada => {
      const rutaCompleta = path.join(carpeta, entrada.name);
      const stats = fs.statSync(rutaCompleta);

      return {
        path: '/' + path.relative(path.resolve(__dirname), rutaCompleta).replace(/\\/g, '/'),
        author: author,
        timestamp: stats.mtimeMs,
        size: stats.size,
      };
    });

  return files;
}

// Exemple d'ús
const resultat = llistarArxius('abc123');
console.log(JSON.stringify(resultat, null, 2));

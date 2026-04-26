import crypto from 'node:crypto';
import fs from 'node:fs';
import readline from 'node:readline';

const ARCHIVO_SEGURIDAD = './src/server/identity.json';

// ==========================================
// 1. LÓGICA DE BACKEND
// ==========================================

export function registrarUsuario(password) {
  // 1. Generamos la seguridad local (Hash y Sal)
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  
  // 2. Generamos la Identidad P2P (Par de claves Ed25519)
  // Usamos el módulo nativo de Node para generar claves seguras
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  
  // Convertimos las claves a texto hexadecimal para poder guardarlas en el JSON
  const publicKeyHex = publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
  const privateKeyHex = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('hex');

  // 3. Lo guardamos todo en el disco duro
  const datosAGuardar = { 
    salt: salt, 
    hash: hash, 
    direccionPublica: publicKeyHex, 
    clavePrivada: privateKeyHex 
  };

  fs.writeFileSync(ARCHIVO_SEGURIDAD, JSON.stringify(datosAGuardar, null, 2));
  console.log("\n✅ ¡Usuario registrado con éxito!");
  // Mostramos solo un trozo de la dirección para no saturar la pantalla
  console.log(`📍 Tu nueva dirección pública es: ${publicKeyHex.substring(0, 20)}...`);
}

export function verificarPassword(password) {
  if (!fs.existsSync(ARCHIVO_SEGURIDAD)) {
    console.log("\n❌ No hay ningún usuario registrado. ¡Regístrate primero!");
    return null; // Devolvemos null si falla
  }

  // Leemos todo el archivo, incluyendo las claves
  const { salt, hash, direccionPublica, clavePrivada } = JSON.parse(fs.readFileSync(ARCHIVO_SEGURIDAD));
  const hashIntento = crypto.scryptSync(password, salt, 64).toString('hex');

  if (hash === hashIntento) {
    console.log("\n🔓 ¡Acceso concedido! La contraseña es correcta.");
    console.log(`🌐 Tu dirección P2P es: ${direccionPublica.substring(0, 20)}...`);
    
    // Devolvemos las claves para que el resto de tu app pueda conectar el servidor P2P
    return { direccionPublica, clavePrivada }; 
  } else {
    console.log("\n🚫 ¡Acceso denegado! Contraseña incorrecta.");
    return null; // Devolvemos null si falla
  }
}

// ==========================================
// 2. LÓGICA DE FRONTEND (Simulador)
// ==========================================

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function mostrarMenu() {
  console.log("\n=== APP P2P: GESTOR DE IDENTIDAD ===");
  console.log("1. Registrar nueva cuenta (Generar dirección)");
  console.log("2. Iniciar sesión");
  console.log("3. Salir");
  
  rl.question("Elige una opción (1, 2 o 3): ", (opcion) => {
    switch (opcion) {
      case '1':
        rl.question("👉 Inventa una contraseña para registrarte: ", (pass) => {
          registrarUsuario(pass);
          mostrarMenu();
        });
        break;
      
      case '2':
        rl.question("👉 Introduce tu contraseña para entrar: ", (pass) => {
          const identidad = verificarPassword(pass);
          
          if (identidad) {
            console.log("\n(Aquí tu código arrancaría el servidor de HyperDHT usando tu clave privada)");
          }
          mostrarMenu();
        });
        break;
        
      case '3':
        console.log("Saliendo...");
        rl.close();
        break;
        
      default:
        console.log("Opción no válida.");
        mostrarMenu();
    }
  });
}

mostrarMenu();
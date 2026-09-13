'use strict';
/**
 * Lector mínimo de `.env` (KEY=valor por línea), sin dependencias. Solo
 * rellena `process.env` para las variables que no estén ya definidas (para
 * que una variable exportada de verdad en el sistema siempre gane sobre el
 * archivo). Si no existe `.env`, no hace nada — el resto de la app sigue
 * funcionando igual que siempre (ver lib/correo.js: sin RESEND_API_KEY,
 * simplemente no se envían correos).
 */

const fs = require('fs');
const path = require('path');

function cargarEnv(raiz = path.join(__dirname, '..')) {
  let contenido;
  try { contenido = fs.readFileSync(path.join(raiz, '.env'), 'utf8'); }
  catch { return; }

  for (const linea of contenido.split('\n')) {
    const l = linea.trim();
    if (!l || l.startsWith('#')) continue;
    const igual = l.indexOf('=');
    if (igual === -1) continue;
    const clave = l.slice(0, igual).trim();
    let valor = l.slice(igual + 1).trim();
    const comillas = (valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"));
    if (comillas) valor = valor.slice(1, -1);
    if (clave && !(clave in process.env)) process.env[clave] = valor;
  }
}

module.exports = { cargarEnv };

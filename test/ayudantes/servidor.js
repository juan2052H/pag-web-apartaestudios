'use strict';
/**
 * Arranca una instancia real de server.js como subproceso, con datos
 * aislados en una carpeta temporal (nunca toca datos/db.json real) y en un
 * puerto propio. Cada archivo de prueba llama a iniciar() una sola vez y usa
 * el `api()` devuelto para hablarle por HTTP, igual que un cliente real.
 *
 * node:test corre los archivos de prueba en paralelo, así que cada uno debe
 * tener su propio puerto y su propia carpeta de datos — de ahí lo aleatorio.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const RAIZ = path.join(__dirname, '..', '..');

function puertoAlAzar() {
  return 20000 + Math.floor(Math.random() * 20000);
}

async function esperarListo(base, intentos = 100) {
  for (let i = 0; i < intentos; i++) {
    try {
      const r = await fetch(base + '/robots.txt');
      if (r.ok) return;
    } catch { /* el servidor todavía no acepta conexiones */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('El servidor de pruebas no arrancó a tiempo.');
}

/**
 * @returns {Promise<{base: string, api: Function, claveInicial: string, cerrar: Function}>}
 */
async function iniciar() {
  const dirDatos = fs.mkdtempSync(path.join(os.tmpdir(), 'apta-test-'));
  const puerto = puertoAlAzar();
  const base = `http://localhost:${puerto}`;

  const proceso = spawn(process.execPath, ['server.js'], {
    cwd: RAIZ,
    env: { ...process.env, PORT: String(puerto), APARTA_DIR_DATOS: dirDatos },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let salida = '';
  proceso.stdout.on('data', (d) => { salida += d.toString('utf8'); });

  try {
    await esperarListo(base);
  } catch (e) {
    proceso.kill();
    fs.rmSync(dirDatos, { recursive: true, force: true });
    throw e;
  }

  const m = /contraseña:\s*(\S+)/.exec(salida);
  const claveInicial = m ? m[1] : null;

  /**
   * Lee de los logs del servidor el último código de recuperación impreso
   * para `clave` (ej. "admin:<id>" o "inquilino:<contratoId>"). Solo se
   * imprime cuando el correo no se pudo enviar de verdad — que es siempre el
   * caso en pruebas, sin RESEND_API_KEY configurada (ver lib/correo.js).
   */
  function codigoPara(clave) {
    const escapado = clave.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patron = new RegExp(`Código para "${escapado}": (\\d{6})`, 'g');
    let match;
    let ultimo = null;
    while ((match = patron.exec(salida))) ultimo = match[1];
    return ultimo;
  }

  /** Cliente HTTP mínimo: api('GET', '/api/x', {token, body}) -> {status, body} */
  async function api(metodo, ruta, { token, body, headers } = {}) {
    const r = await fetch(base + ruta, {
      method: metodo,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const texto = await r.text();
    let json = null;
    try { json = texto ? JSON.parse(texto) : null; } catch { /* respuesta no-JSON (HTML/XML) */ }
    return { status: r.status, headers: r.headers, body: json, texto };
  }

  /** Sube un cuerpo binario crudo a una ruta (para /api/media, /api/inquilino/adjuntos). */
  async function subir(ruta, { token, mime, buffer, nombre }) {
    const r = await fetch(base + ruta, {
      method: 'POST',
      headers: {
        'Content-Type': mime,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(nombre ? { 'X-Nombre': Buffer.from(nombre, 'utf8').toString('base64') } : {}),
      },
      body: buffer,
    });
    const texto = await r.text();
    let json = null;
    try { json = texto ? JSON.parse(texto) : null; } catch { /* respuesta no-JSON */ }
    return { status: r.status, body: json };
  }

  function cerrar() {
    proceso.kill();
    fs.rmSync(dirDatos, { recursive: true, force: true });
  }

  return { base, api, subir, claveInicial, codigoPara, cerrar, dirDatos };
}

module.exports = { iniciar };

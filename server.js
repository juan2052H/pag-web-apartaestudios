'use strict';
/**
 * Servidor de "Apartaestudios" — Node.js puro, sin dependencias externas.
 *
 *   node server.js            -> http://localhost:3000
 *   PORT=8080 node server.js  -> otro puerto
 *
 * Guarda todo en ./datos/db.json y los videos/fotos en ./datos/subidas/
 *
 * El código vive organizado por responsabilidad en lib/ (ver ese directorio);
 * este archivo es solo el punto de entrada: arma el servidor HTTP, delega el
 * ruteo y arranca la carga de datos.
 */

const http = require('http');

require('./lib/entorno').cargarEnv();

const { PUERTO } = require('./lib/config');
const { cargarDb, obtenerDb } = require('./lib/db');
const { error } = require('./lib/http');
const {
  servirRobots, servirSitemap, servirPaginaUnidad, servirEstatico,
} = require('./lib/estaticos');
const { manejarApi } = require('./lib/rutas-api');

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) return await manejarApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return error(res, 405, 'Método no permitido');
    if (url.pathname === '/robots.txt') return servirRobots(req, res);
    if (url.pathname === '/sitemap.xml') return servirSitemap(req, res);
    const mUnidad = /^\/unidad\/([a-f0-9]{18})(?:-[^/]*)?\/?$/i.exec(url.pathname);
    if (mUnidad) return await servirPaginaUnidad(req, res, mUnidad[1].toLowerCase());
    return await servirEstatico(req, res, url.pathname);
  } catch (e) {
    console.error('Error:', e);
    if (!res.headersSent) error(res, 500, e.message || 'Error interno');
    else res.end();
  }
});

// Generoso para permitir subidas de video grandes en conexiones lentas, pero
// ya no indefinido (0 dejaba una conexión estancada abierta para siempre,
// una variante de Slowloris sobre el cuerpo del request).
servidor.requestTimeout = 2 * 60 * 60 * 1000; // 2 horas
servidor.headersTimeout = 60000;

cargarDb().then(() => {
  const db = obtenerDb();
  servidor.listen(PUERTO, () => {
    console.log('');
    console.log('  ╔══════════════════════════════════════════════╗');
    console.log('  ║   ' + String(db.config.nombreSitio).padEnd(42) + ' ║');
    console.log('  ╚══════════════════════════════════════════════╝');
    console.log('');
    console.log(`  Sitio público : http://localhost:${PUERTO}/`);
    console.log(`  Panel admin   : http://localhost:${PUERTO}/admin`);
    const propietario = db.administradores.find((x) => x.rol === 'principal');
    if (propietario?.claveInicial) {
      console.log('');
      console.log(`  ⚠ La cuenta "${propietario.usuario}" todavía usa la contraseña inicial.`);
      console.log('  Cámbiala desde Ajustes → Seguridad en el panel.');
    }
    console.log('');
    console.log('  Ctrl+C para detener.');
    console.log('');
  });
});

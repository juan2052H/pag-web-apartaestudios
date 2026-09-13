'use strict';
/**
 * Servidor de "Apartaestudios" — Node.js puro, sin dependencias externas.
 *
 *   node server.js            -> http://localhost:3000
 *   PORT=8080 node server.js  -> otro puerto
 *
 * Guarda todo en ./datos/db.json y los videos/fotos en ./datos/subidas/
 */

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

const PUERTO = Number(process.env.PORT || 3000);
const RAIZ = __dirname;
const DIR_PUBLICO = path.join(RAIZ, 'public');
const DIR_DATOS = path.join(RAIZ, 'datos');
const DIR_SUBIDAS = path.join(DIR_DATOS, 'subidas');
const ARCHIVO_DB = path.join(DIR_DATOS, 'db.json');
const LIMITE_SUBIDA = 600 * 1024 * 1024; // 600 MB por archivo
const LIMITE_ADJUNTO_INQUILINO = 10 * 1024 * 1024; // 10 MB por evidencia
const DURACION_SESION = 8 * 60 * 60 * 1000; // 8 horas
const MAX_INTENTOS_LOGIN = 5;
const BLOQUEO_LOGIN_MS = 15 * 60 * 1000;

const MIMES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.ogg': 'video/ogg',
  '.woff2': 'font/woff2',
};

const EXT_POR_MIME = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'video/x-m4v': '.m4v',
  'video/ogg': '.ogv',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const id = () => crypto.randomBytes(9).toString('hex');
const ahora = () => new Date().toISOString();

function hashClave(clave, sal = crypto.randomBytes(16).toString('hex')) {
  const h = crypto.scryptSync(String(clave), sal, 64).toString('hex');
  return { sal, hash: h };
}

function verificarClave(clave, sal, hash) {
  if (!sal || !hash) return false;
  const h = crypto.scryptSync(String(clave), sal, 64).toString('hex');
  const a = Buffer.from(h, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** "2026-09" del mes actual */
function mesActual(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Convierte "2026-09-15" | "2026-09" -> "2026-09" */
function aPeriodo(fecha) {
  if (!fecha) return null;
  const s = String(fecha);
  return s.length >= 7 ? s.slice(0, 7) : null;
}

/** Días naturales desde hoy hasta una fecha ISO. Devuelve null si no es válida. */
function diasHasta(fecha) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ''))) return null;
  const destino = new Date(`${fecha}T12:00:00`);
  if (Number.isNaN(destino.getTime())) return null;
  const base = new Date();
  base.setHours(12, 0, 0, 0);
  return Math.round((destino.getTime() - base.getTime()) / 86400000);
}

/** Lista de periodos "YYYY-MM" inclusive entre dos periodos */
function periodosEntre(desde, hasta) {
  const out = [];
  if (!desde || !hasta) return out;
  let [a, m] = desde.split('-').map(Number);
  const [fa, fm] = hasta.split('-').map(Number);
  let guard = 0;
  while ((a < fa || (a === fa && m <= fm)) && guard++ < 600) {
    out.push(`${a}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; a++; }
  }
  return out;
}

/** Resta n meses a un periodo */
function restarMeses(periodo, n) {
  let [a, m] = periodo.split('-').map(Number);
  m -= n;
  while (m <= 0) { m += 12; a--; }
  return `${a}-${String(m).padStart(2, '0')}`;
}

const num = (v, def = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

const texto = (v, max = 4000) => (v === undefined || v === null ? '' : String(v).slice(0, max));

const lista = (v) => (Array.isArray(v) ? v.map((x) => texto(x, 200)).filter(Boolean) : []);

// ---------------------------------------------------------------------------
// Base de datos (JSON en disco)
// ---------------------------------------------------------------------------

let db = null;
let escribiendo = null;
let pendiente = false;

function dbPorDefecto() {
  const { sal, hash } = hashClave('admin123');
  const hoy = new Date();
  const mes = mesActual(hoy);

  const edA = id();
  const edB = id();
  const apts = [
    { ed: edA, numero: '301', titulo: 'Apartaestudio 301 · Balcón con vista', precio: 1450000, area: 32, hab: 1, ban: 1, piso: 3, estado: 'arrendado' },
    { ed: edA, numero: '402', titulo: 'Apartaestudio 402 · Luz natural todo el día', precio: 1550000, area: 35, hab: 1, ban: 1, piso: 4, estado: 'disponible' },
    { ed: edA, numero: '503', titulo: 'Apartaestudio 503 · Amoblado premium', precio: 1900000, area: 38, hab: 1, ban: 1, piso: 5, estado: 'disponible' },
    { ed: edB, numero: '101', titulo: 'Apartaestudio 101 · Entrada independiente', precio: 1200000, area: 28, hab: 1, ban: 1, piso: 1, estado: 'arrendado' },
    { ed: edB, numero: '202', titulo: 'Apartaestudio 202 · Cocina integral nueva', precio: 1320000, area: 30, hab: 1, ban: 1, piso: 2, estado: 'mantenimiento' },
  ].map((a) => ({
    id: id(),
    edificioId: a.ed,
    numero: a.numero,
    titulo: a.titulo,
    precio: a.precio,
    administracion: 180000,
    deposito: a.precio,
    area: a.area,
    habitaciones: a.hab,
    banos: a.ban,
    piso: a.piso,
    amoblado: a.precio > 1600000,
    estado: a.estado,
    descripcion: 'Apartaestudio con acabados modernos, cocina integral, closet amplio y excelente iluminación natural. Incluye acceso a las zonas comunes del edificio.',
    caracteristicas: ['Cocina integral', 'Closet', 'Internet fibra', 'Zona de lavado'],
    videoId: null,
    portadaId: null,
    fotos: [],
    destacado: a.estado === 'disponible',
    creado: ahora(),
  }));

  const contratos = [
    { apt: apts[0], nom: 'Laura Gómez Restrepo', doc: '1017' + Math.floor(100000 + Math.random() * 899999), tel: '+57 310 555 1122' },
    { apt: apts[3], nom: 'Andrés Pardo Lemus', doc: '1023' + Math.floor(100000 + Math.random() * 899999), tel: '+57 320 555 8899' },
  ].map((c, i) => ({
    id: id(),
    apartamentoId: c.apt.id,
    inquilino: { nombre: c.nom, documento: c.doc, telefono: c.tel, email: '' },
    inicio: `${restarMeses(mes, 5 + i)}-01`,
    fin: '',
    canon: c.apt.precio,
    deposito: c.apt.precio,
    diaPago: 5,
    estado: 'activo',
    notas: '',
    creado: ahora(),
  }));

  const pagos = [];
  for (const c of contratos) {
    const ps = periodosEntre(aPeriodo(c.inicio), restarMeses(mes, 1));
    for (const p of ps) {
      pagos.push({
        id: id(),
        contratoId: c.id,
        periodo: p,
        monto: c.canon,
        fecha: `${p}-05`,
        metodo: 'transferencia',
        referencia: '',
        notas: '',
        creado: ahora(),
      });
    }
  }
  // El primer contrato ya pagó el mes en curso; el segundo queda pendiente a propósito.
  pagos.push({
    id: id(), contratoId: contratos[0].id, periodo: mes, monto: contratos[0].canon,
    fecha: `${mes}-04`, metodo: 'transferencia', referencia: '', notas: '', creado: ahora(),
  });

  return {
    version: 2,
    config: {
      nombreSitio: 'Vivo Estudios',
      lema: 'Apartaestudios listos para habitar, con video y ubicación real.',
      telefono: '+57 300 000 0000',
      email: 'contacto@vivoestudios.co',
      whatsapp: '573000000000',
      moneda: 'COP',
      localeMoneda: 'es-CO',
    },
    // El propietario conserva el control total. Los demás administradores se
    // crean desde el panel y solo reciben los edificios que se les asignen.
    administradores: [{
      id: id(), nombre: 'Propietario principal', usuario: 'admin', rol: 'principal',
      edificioIds: [], sal, hash, activo: true, claveInicial: true, creado: ahora(), actualizado: ahora(),
    }],
    edificios: [
      {
        id: edA,
        nombre: 'Edificio Aurora',
        direccion: 'Calle 44 #79-21, Laureles',
        ciudad: 'Medellín',
        lat: 6.2447,
        lng: -75.5916,
        descripcion: 'Edificio de 6 pisos en Laureles, a 3 cuadras del metro Estadio. Zonas comunes renovadas en 2025.',
        amenidades: ['Ascensor', 'Portería 24/7', 'Gimnasio', 'Terraza BBQ', 'Parqueadero visitantes'],
        fotoId: null,
        encargado: {
          nombre: 'Marcela Ospina',
          cargo: 'Administradora',
          telefono: '+57 301 222 3344',
          whatsapp: '573012223344',
          email: 'marcela@vivoestudios.co',
          horario: 'Lun a Vie 8:00 a.m. – 6:00 p.m. · Sáb 9:00 a.m. – 1:00 p.m.',
          fotoId: null,
        },
        creado: ahora(),
      },
      {
        id: edB,
        nombre: 'Edificio Mirador 7',
        direccion: 'Carrera 13 #63-45, Chapinero',
        ciudad: 'Bogotá',
        lat: 4.6486,
        lng: -74.0628,
        descripcion: 'Casa-edificio remodelada con 8 apartaestudios independientes. Sobre corredor de TransMilenio.',
        amenidades: ['Portería', 'Lavandería común', 'Bicicletero'],
        fotoId: null,
        encargado: {
          nombre: 'Julián Caicedo',
          cargo: 'Encargado del edificio',
          telefono: '+57 315 777 9090',
          whatsapp: '573157779090',
          email: 'julian@vivoestudios.co',
          horario: 'Lun a Sáb 7:00 a.m. – 5:00 p.m.',
          fotoId: null,
        },
        creado: ahora(),
      },
    ],
    apartamentos: apts,
    contratos,
    pagos,
    solicitudes: [],
    mensajes: [],
    media: [],
    auditoria: [],
  };
}

async function cargarDb() {
  await fsp.mkdir(DIR_SUBIDAS, { recursive: true });
  try {
    const raw = await fsp.readFile(ARCHIVO_DB, 'utf8');
    db = JSON.parse(raw);
  } catch {
    db = dbPorDefecto();
    await guardarDb();
    console.log('  · Base de datos creada con datos de ejemplo.');
  }
  let cambio = false;
  // Normaliza colecciones faltantes
  for (const k of ['edificios', 'apartamentos', 'contratos', 'pagos', 'solicitudes', 'mensajes', 'media', 'administradores', 'auditoria']) {
    if (!Array.isArray(db[k])) { db[k] = []; cambio = true; }
  }
  db.config = Object.assign({}, dbPorDefecto().config, db.config || {});

  // Migración de la cuenta única de versiones anteriores al propietario.
  if (!db.administradores.length) {
    const credencial = db.config.adminSal && db.config.adminHash
      ? { sal: db.config.adminSal, hash: db.config.adminHash }
      : hashClave('admin123');
    db.administradores.push({
      id: id(), nombre: 'Propietario principal', usuario: db.config.adminUsuario || 'admin',
      rol: 'principal', edificioIds: [], ...credencial, activo: true,
      claveInicial: !!db.config.claveInicial, creado: ahora(), actualizado: ahora(),
    });
    cambio = true;
  }

  const edificiosValidos = new Set(db.edificios.map((e) => e.id));
  for (const admin of db.administradores) {
    if (!admin.id) { admin.id = id(); cambio = true; }
    if (!admin.nombre) { admin.nombre = admin.rol === 'principal' ? 'Propietario principal' : 'Administrador'; cambio = true; }
    if (!admin.usuario) { admin.usuario = `admin-${admin.id.slice(0, 6)}`; cambio = true; }
    if (!admin.sal || !admin.hash) {
      const credencial = hashClave('admin123');
      admin.sal = credencial.sal; admin.hash = credencial.hash; admin.claveInicial = true; cambio = true;
    }
    if (admin.rol !== 'principal' && admin.rol !== 'edificio') { admin.rol = 'edificio'; cambio = true; }
    const asignados = [...new Set((Array.isArray(admin.edificioIds) ? admin.edificioIds : []).filter((x) => edificiosValidos.has(x)))];
    if (JSON.stringify(asignados) !== JSON.stringify(admin.edificioIds || [])) { admin.edificioIds = asignados; cambio = true; }
    if (admin.activo === undefined) { admin.activo = true; cambio = true; }
  }
  if (!db.administradores.some((x) => x.rol === 'principal')) {
    const credencial = hashClave('admin123');
    db.administradores.unshift({
      id: id(), nombre: 'Propietario principal', usuario: 'admin', rol: 'principal', edificioIds: [],
      ...credencial, activo: true, claveInicial: true, creado: ahora(), actualizado: ahora(),
    });
    cambio = true;
  }
  // Ya migradas, las credenciales antiguas no permanecen dentro de config.
  for (const k of ['adminUsuario', 'adminSal', 'adminHash', 'claveInicial']) {
    if (Object.prototype.hasOwnProperty.call(db.config, k)) { delete db.config[k]; cambio = true; }
  }
  if (cambio) await guardarDb();
}

async function guardarDb() {
  if (escribiendo) { pendiente = true; return escribiendo; }
  escribiendo = (async () => {
    const tmp = ARCHIVO_DB + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(db, null, 2), 'utf8');
    await fsp.rename(tmp, ARCHIVO_DB);
  })().finally(async () => {
    escribiendo = null;
    if (pendiente) { pendiente = false; await guardarDb(); }
  });
  return escribiendo;
}

// ---------------------------------------------------------------------------
// Sesiones en memoria
// ---------------------------------------------------------------------------

const sesiones = new Map(); // token -> { administradorId, expira }
const sesionesInquilino = new Map(); // token -> { contratoId, expira }
const intentosLogin = new Map(); // usuario + IP -> { cantidad, bloqueadoHasta, ultimo }

function claveIntentosLogin(req, usuario) {
  // No se confia en X-Forwarded-For: un cliente puede falsificarlo si el proxy
  // no lo elimina. El usuario tambien evita que un ataque distribuido se concentre
  // sobre una sola cuenta.
  return `${texto(usuario, 40).toLowerCase()}|${texto(req.socket?.remoteAddress, 80)}`;
}

function bloqueoActivoLogin(clave) {
  const intento = intentosLogin.get(clave);
  if (!intento || !intento.bloqueadoHasta) return false;
  if (intento.bloqueadoHasta <= Date.now()) { intentosLogin.delete(clave); return false; }
  return true;
}

function registrarFalloLogin(clave) {
  const previo = intentosLogin.get(clave) || { cantidad: 0 };
  const cantidad = previo.cantidad + 1;
  intentosLogin.set(clave, {
    cantidad,
    bloqueadoHasta: cantidad >= MAX_INTENTOS_LOGIN ? Date.now() + BLOQUEO_LOGIN_MS : 0,
    ultimo: Date.now(),
  });
}

function perfilAdministrador(admin) {
  return {
    id: admin.id, nombre: admin.nombre || admin.usuario, usuario: admin.usuario,
    rol: admin.rol, edificioIds: admin.rol === 'principal' ? [] : (admin.edificioIds || []),
    claveInicial: !!admin.claveInicial,
  };
}

function vistaAdministrador(admin) {
  const { sal, hash, ...seguro } = admin;
  return { ...seguro, edificioIds: admin.rol === 'principal' ? [] : (admin.edificioIds || []) };
}

function administradorPorId(idAdmin) {
  return db.administradores.find((x) => x.id === idAdmin);
}

function crearSesion(admin) {
  const token = crypto.randomBytes(32).toString('hex');
  sesiones.set(token, { administradorId: admin.id, expira: Date.now() + DURACION_SESION });
  return token;
}

function sesionDe(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  const s = sesiones.get(token);
  if (!s) return null;
  if (s.expira < Date.now()) { sesiones.delete(token); return null; }
  const admin = administradorPorId(s.administradorId);
  if (!admin || !admin.activo) { sesiones.delete(token); return null; }
  s.expira = Date.now() + DURACION_SESION;
  return { token, ...perfilAdministrador(admin), expira: s.expira };
}

function crearSesionInquilino(contratoId) {
  const token = crypto.randomBytes(32).toString('hex');
  sesionesInquilino.set(token, { contratoId, expira: Date.now() + DURACION_SESION });
  return token;
}

function sesionInquilinoDe(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  const s = sesionesInquilino.get(token);
  if (!s) return null;
  if (s.expira < Date.now()) { sesionesInquilino.delete(token); return null; }
  s.expira = Date.now() + DURACION_SESION;
  return { token, ...s };
}

setInterval(() => {
  const t = Date.now();
  for (const [k, v] of sesiones) if (v.expira < t) sesiones.delete(k);
  for (const [k, v] of sesionesInquilino) if (v.expira < t) sesionesInquilino.delete(k);
  for (const [k, v] of intentosLogin) if (v.ultimo < t - BLOQUEO_LOGIN_MS) intentosLogin.delete(k);
}, 15 * 60 * 1000).unref();

// ---------------------------------------------------------------------------
// Respuestas HTTP
// ---------------------------------------------------------------------------

function json(res, codigo, cuerpo) {
  const data = JSON.stringify(cuerpo);
  res.writeHead(codigo, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

const ok = (res, cuerpo = { ok: true }) => json(res, 200, cuerpo);
const error = (res, codigo, mensaje) => json(res, codigo, { error: mensaje });

function leerJson(req, limite = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const trozos = [];
    req.on('data', (c) => {
      total += c.length;
      if (total > limite) { reject(new Error('Cuerpo demasiado grande')); req.destroy(); return; }
      trozos.push(c);
    });
    req.on('end', () => {
      if (!trozos.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(trozos).toString('utf8'))); }
      catch { reject(new Error('JSON inválido')); }
    });
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Archivos estáticos
// ---------------------------------------------------------------------------

async function servirEstatico(req, res, ruta) {
  let rel = decodeURIComponent(ruta.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  if (rel.endsWith('/')) rel += 'index.html';
  if (!path.extname(rel)) rel += '.html';

  const destino = path.join(DIR_PUBLICO, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!destino.startsWith(DIR_PUBLICO)) return error(res, 403, 'Ruta no permitida');

  try {
    const st = await fsp.stat(destino);
    if (!st.isFile()) throw new Error('no-file');
    res.writeHead(200, {
      'Content-Type': MIMES[path.extname(destino).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(destino).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>404</h1><p>No encontrado. <a href="/">Ir al inicio</a></p>');
  }
}

/** Origen seguro para URLs que leen los buscadores detrás de un proxy HTTPS. */
function origenPublico(req) {
  const hostRecibido = String(req.headers.host || 'localhost').toLowerCase();
  const host = /^[a-z0-9.:-]+$/.test(hostRecibido) ? hostRecibido : 'localhost';
  const protoRecibido = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = protoRecibido === 'https' || protoRecibido === 'http'
    ? protoRecibido
    : 'http';
  return `${proto}://${host}`;
}

function responderTexto(req, res, tipo, cuerpo) {
  res.writeHead(200, {
    'Content-Type': `${tipo}; charset=utf-8`,
    'Content-Length': Buffer.byteLength(cuerpo),
    'Cache-Control': 'public, max-age=3600',
  });
  if (req.method === 'HEAD') return res.end();
  return res.end(cuerpo);
}

function servirRobots(req, res) {
  // Las áreas privadas llevan meta noindex. No se bloquean aquí para que los
  // buscadores puedan leer esa directiva; robots.txt no es una barrera de seguridad.
  const cuerpo = `User-agent: *\nAllow: /\n\nSitemap: ${origenPublico(req)}/sitemap.xml\n`;
  return responderTexto(req, res, 'text/plain', cuerpo);
}

function servirSitemap(req, res) {
  const origen = origenPublico(req);
  const cuerpo = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${origen}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>\n  <url><loc>${origen}/privacidad</loc><changefreq>yearly</changefreq><priority>0.3</priority></url>\n</urlset>\n`;
  return responderTexto(req, res, 'application/xml', cuerpo);
}

/** Sirve un archivo subido, con soporte de Range (necesario para video). */
async function servirMedia(req, res, mediaId) {
  const m = db.media.find((x) => x.id === mediaId);
  if (!m) return error(res, 404, 'Archivo no encontrado');
  const archivo = path.join(DIR_SUBIDAS, m.archivo);
  if (!archivo.startsWith(DIR_SUBIDAS)) return error(res, 403, 'Ruta no permitida');

  let st;
  try { st = await fsp.stat(archivo); }
  catch { return error(res, 404, 'Archivo no disponible en disco'); }

  const rango = req.headers.range;
  const cabeceras = {
    'Content-Type': m.mime || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': m.privado ? 'private, no-store' : 'public, max-age=31536000, immutable',
  };

  if (rango) {
    const mm = /bytes=(\d*)-(\d*)/.exec(rango);
    let inicio = mm && mm[1] ? parseInt(mm[1], 10) : 0;
    let fin = mm && mm[2] ? parseInt(mm[2], 10) : st.size - 1;
    if (Number.isNaN(inicio) || inicio >= st.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
      return res.end();
    }
    fin = Math.min(fin, st.size - 1);
    res.writeHead(206, {
      ...cabeceras,
      'Content-Range': `bytes ${inicio}-${fin}/${st.size}`,
      'Content-Length': fin - inicio + 1,
    });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(archivo, { start: inicio, end: fin }).pipe(res);
  }

  res.writeHead(200, { ...cabeceras, 'Content-Length': st.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(archivo).pipe(res);
}

/** Recibe el cuerpo crudo del request y lo guarda como archivo. */
function recibirArchivo(req, res, destino, limite = LIMITE_SUBIDA, mensajeLimite = 'El archivo supera el límite permitido') {
  return new Promise((resolve, reject) => {
    let total = 0;
    const out = fs.createWriteStream(destino);
    req.on('data', (c) => {
      total += c.length;
      if (total > limite) {
        req.destroy();
        out.destroy();
        fs.unlink(destino, () => {});
        reject(new Error(mensajeLimite));
      }
    });
    req.pipe(out);
    out.on('finish', () => resolve(total));
    out.on('error', reject);
    req.on('error', (e) => { out.destroy(); reject(e); });
  });
}

// ---------------------------------------------------------------------------
// Lógica de negocio: analítica
// ---------------------------------------------------------------------------

function contratoActivoEn(c, periodo) {
  if (c.estado === 'cancelado') return false;
  const ini = aPeriodo(c.inicio);
  if (!ini || periodo < ini) return false;
  const fin = aPeriodo(c.fin);
  if (fin && periodo > fin) return false;
  return true;
}

function calcularAnalitica(meses = 12, edificioIds = null) {
  const hoy = mesActual();
  const periodos = periodosEntre(restarMeses(hoy, meses - 1), hoy);
  const idsEdificios = edificioIds ? new Set(edificioIds) : null;
  const edificios = idsEdificios ? db.edificios.filter((e) => idsEdificios.has(e.id)) : db.edificios;
  const apartamentos = idsEdificios ? db.apartamentos.filter((a) => idsEdificios.has(a.edificioId)) : db.apartamentos;
  const idsApartamentos = new Set(apartamentos.map((a) => a.id));
  const activos = db.contratos.filter((c) => c.estado !== 'cancelado' && idsApartamentos.has(c.apartamentoId));
  const idsContratos = new Set(activos.map((c) => c.id));
  const pagos = db.pagos.filter((p) => idsContratos.has(p.contratoId));
  const solicitudes = db.solicitudes.filter((s) => idsApartamentos.has(s.apartamentoId));
  const mensajes = db.mensajes.filter((m) => idsContratos.has(m.contratoId));

  const pagosPorPeriodo = new Map();
  for (const p of pagos) {
    const k = p.periodo;
    pagosPorPeriodo.set(k, (pagosPorPeriodo.get(k) || 0) + num(p.monto));
  }

  const serie = periodos.map((p) => {
    const esperado = activos
      .filter((c) => contratoActivoEn(c, p))
      .reduce((s, c) => s + num(c.canon), 0);
    return { periodo: p, esperado, recaudado: pagosPorPeriodo.get(p) || 0 };
  });

  // Cartera: saldo pendiente por contrato, mes a mes, hasta el mes en curso
  const cartera = [];
  for (const c of activos) {
    const ini = aPeriodo(c.inicio);
    if (!ini) continue;
    const hasta = aPeriodo(c.fin) && aPeriodo(c.fin) < hoy ? aPeriodo(c.fin) : hoy;
    let saldo = 0;
    const mesesDebe = [];
    for (const p of periodosEntre(ini, hasta)) {
      const pagado = pagos
        .filter((x) => x.contratoId === c.id && x.periodo === p)
        .reduce((s, x) => s + num(x.monto), 0);
      const falta = num(c.canon) - pagado;
      if (falta > 0.5) { saldo += falta; mesesDebe.push(p); }
    }
    const apt = apartamentos.find((a) => a.id === c.apartamentoId);
    const ed = apt && edificios.find((e) => e.id === apt.edificioId);
    if (saldo > 0.5) {
      cartera.push({
        contratoId: c.id,
        inquilino: c.inquilino?.nombre || '—',
        telefono: c.inquilino?.telefono || '',
        unidad: apt ? `${ed ? ed.nombre + ' · ' : ''}${apt.numero}` : '—',
        canon: num(c.canon),
        saldo,
        meses: mesesDebe,
        mesesVencidos: mesesDebe.length,
      });
    }
  }
  cartera.sort((a, b) => b.saldo - a.saldo);

  // Contratos que requieren gestión antes de que termine su vigencia.
  const vencimientos = activos
    .filter((c) => c.estado === 'activo' && c.fin)
    .map((c) => {
      const dias = diasHasta(c.fin);
      const apt = apartamentos.find((a) => a.id === c.apartamentoId);
      const ed = apt && edificios.find((e) => e.id === apt.edificioId);
      return {
        contratoId: c.id,
        inquilino: c.inquilino?.nombre || '—',
        unidad: apt ? `${ed ? ed.nombre + ' · ' : ''}${apt.numero}` : '—',
        fin: c.fin,
        dias,
      };
    })
    .filter((x) => x.dias !== null && x.dias >= 0 && x.dias <= 60)
    .sort((a, b) => a.dias - b.dias);

  // Ocupación por edificio
  const porEdificio = edificios.map((e) => {
    const us = apartamentos.filter((a) => a.edificioId === e.id);
    const cuenta = { arrendado: 0, disponible: 0, otro: 0 };
    for (const a of us) {
      if (a.estado === 'arrendado') cuenta.arrendado++;
      else if (a.estado === 'disponible') cuenta.disponible++;
      else cuenta.otro++;
    }
    const ingreso = activos
      .filter((c) => contratoActivoEn(c, hoy) && us.some((a) => a.id === c.apartamentoId))
      .reduce((s, c) => s + num(c.canon), 0);
    return {
      id: e.id,
      nombre: e.nombre,
      total: us.length,
      ...cuenta,
      ingreso,
      ocupacion: us.length ? cuenta.arrendado / us.length : 0,
    };
  });

  const total = apartamentos.length;
  const arrendados = apartamentos.filter((a) => a.estado === 'arrendado').length;
  const disponibles = apartamentos.filter((a) => a.estado === 'disponible').length;
  const mesCurso = serie[serie.length - 1] || { esperado: 0, recaudado: 0 };

  return {
    generado: ahora(),
    mes: hoy,
    kpis: {
      unidades: total,
      arrendados,
      disponibles,
      otros: total - arrendados - disponibles,
      ocupacion: total ? arrendados / total : 0,
      ingresoMensual: mesCurso.esperado,
      recaudadoMes: mesCurso.recaudado,
      pendienteMes: Math.max(0, mesCurso.esperado - mesCurso.recaudado),
      carteraTotal: cartera.reduce((s, c) => s + c.saldo, 0),
      contratosActivos: activos.filter((c) => contratoActivoEn(c, hoy)).length,
      solicitudesNuevas: solicitudes.filter((s) => s.estado === 'nueva').length,
      mensajesSinLeer: mensajes.filter((x) => x.tipo === 'inquilino' && !x.leidoAdmin).length,
      mantenimientosPendientes: mensajes.filter((x) =>
        x.tipo === 'inquilino' && x.categoria === 'mantenimiento' && x.estadoGestion !== 'resuelta').length,
      contratosPorVencer: vencimientos.filter((x) => x.dias <= 30).length,
      canonPromedio: arrendados
        ? Math.round(activos.filter((c) => contratoActivoEn(c, hoy)).reduce((s, c) => s + num(c.canon), 0) / Math.max(1, activos.filter((c) => contratoActivoEn(c, hoy)).length))
        : 0,
    },
    serie,
    cartera,
    vencimientos,
    porEdificio,
  };
}

// ---------------------------------------------------------------------------
// Saneamiento de entidades
// ---------------------------------------------------------------------------

const ESTADOS_APT = ['disponible', 'arrendado', 'reservado', 'mantenimiento'];

function sanearEdificio(b, previo = {}) {
  const enc = b.encargado || previo.encargado || {};
  return {
    id: previo.id || id(),
    nombre: texto(b.nombre, 120) || previo.nombre || 'Edificio sin nombre',
    direccion: texto(b.direccion, 200),
    ciudad: texto(b.ciudad, 80),
    lat: b.lat === '' || b.lat === null || b.lat === undefined ? null : num(b.lat, null),
    lng: b.lng === '' || b.lng === null || b.lng === undefined ? null : num(b.lng, null),
    descripcion: texto(b.descripcion, 2000),
    amenidades: lista(b.amenidades),
    fotoId: b.fotoId || null,
    encargado: {
      nombre: texto(enc.nombre, 120),
      cargo: texto(enc.cargo, 80) || 'Encargado del edificio',
      telefono: texto(enc.telefono, 40),
      whatsapp: texto(enc.whatsapp, 40).replace(/\D/g, ''),
      email: texto(enc.email, 120),
      horario: texto(enc.horario, 200),
      fotoId: enc.fotoId || null,
    },
    creado: previo.creado || ahora(),
    actualizado: ahora(),
  };
}

function sanearApartamento(b, previo = {}) {
  const estado = ESTADOS_APT.includes(b.estado) ? b.estado : (previo.estado || 'disponible');
  return {
    id: previo.id || id(),
    edificioId: texto(b.edificioId, 40) || previo.edificioId || '',
    numero: texto(b.numero, 20) || previo.numero || '',
    titulo: texto(b.titulo, 160),
    precio: Math.max(0, num(b.precio)),
    administracion: Math.max(0, num(b.administracion)),
    deposito: Math.max(0, num(b.deposito)),
    area: Math.max(0, num(b.area)),
    habitaciones: Math.max(0, num(b.habitaciones, 1)),
    banos: Math.max(0, num(b.banos, 1)),
    piso: num(b.piso),
    amoblado: !!b.amoblado,
    estado,
    descripcion: texto(b.descripcion, 4000),
    caracteristicas: lista(b.caracteristicas),
    videoId: b.videoId || null,
    portadaId: b.portadaId || null,
    fotos: Array.isArray(b.fotos) ? b.fotos.map((f) => texto(f, 40)).filter(Boolean).slice(0, 20) : [],
    destacado: !!b.destacado,
    creado: previo.creado || ahora(),
    actualizado: ahora(),
  };
}

function sanearContrato(b, previo = {}) {
  const inq = b.inquilino || previo.inquilino || {};
  // Las credenciales del portal se gestionan en su endpoint dedicado. Nunca
  // viajan en las ediciones generales de un contrato ni regresan al navegador.
  const portalPrevio = previo.portal || {};
  return {
    id: previo.id || id(),
    apartamentoId: texto(b.apartamentoId, 40) || previo.apartamentoId || '',
    inquilino: {
      nombre: texto(inq.nombre, 120),
      documento: texto(inq.documento, 40),
      telefono: texto(inq.telefono, 40),
      email: texto(inq.email, 120),
    },
    inicio: texto(b.inicio, 10),
    fin: texto(b.fin, 10),
    canon: Math.max(0, num(b.canon)),
    deposito: Math.max(0, num(b.deposito)),
    diaPago: Math.min(31, Math.max(1, num(b.diaPago, 5))),
    estado: ['activo', 'finalizado', 'cancelado'].includes(b.estado) ? b.estado : (previo.estado || 'activo'),
    notas: texto(b.notas, 2000),
    portal: {
      activo: !!portalPrevio.activo,
      sal: texto(portalPrevio.sal, 80),
      hash: texto(portalPrevio.hash, 160),
      actualizado: texto(portalPrevio.actualizado, 40),
    },
    creado: previo.creado || ahora(),
    actualizado: ahora(),
  };
}

function sanearPago(b, previo = {}) {
  return {
    id: previo.id || id(),
    contratoId: texto(b.contratoId, 40) || previo.contratoId || '',
    periodo: aPeriodo(b.periodo) || mesActual(),
    monto: Math.max(0, num(b.monto)),
    fecha: texto(b.fecha, 10) || ahora().slice(0, 10),
    metodo: texto(b.metodo, 40) || 'transferencia',
    referencia: texto(b.referencia, 80),
    notas: texto(b.notas, 500),
    creado: previo.creado || ahora(),
  };
}

function esPrincipal(sesion) {
  return sesion?.rol === 'principal';
}

function puedeGestionarEdificio(sesion, edificioId) {
  return esPrincipal(sesion) || (sesion?.edificioIds || []).includes(edificioId);
}

function apartamentoPermitido(sesion, apartamento) {
  return !!apartamento && puedeGestionarEdificio(sesion, apartamento.edificioId);
}

function contratoPermitido(sesion, contrato) {
  const apt = contrato && db.apartamentos.find((a) => a.id === contrato.apartamentoId);
  return apartamentoPermitido(sesion, apt);
}

function pagoPermitido(sesion, pago) {
  const contrato = pago && db.contratos.find((c) => c.id === pago.contratoId);
  return contratoPermitido(sesion, contrato);
}

function solicitudPermitida(sesion, solicitud) {
  const apt = solicitud && db.apartamentos.find((a) => a.id === solicitud.apartamentoId);
  return apartamentoPermitido(sesion, apt);
}

function mensajePermitido(sesion, mensaje) {
  const contrato = mensaje && db.contratos.find((c) => c.id === mensaje.contratoId);
  return contratoPermitido(sesion, contrato);
}

/** Bitácora acotada para el propietario: no guarda contraseñas ni textos sensibles. */
function registrarAuditoria(sesion, accion, detalle = '', edificioId = '') {
  if (!db?.auditoria) return;
  db.auditoria.unshift({
    id: id(),
    administradorId: sesion?.id || '',
    actor: sesion?.nombre || (sesion ? 'Administrador' : 'Sitio público'),
    rol: sesion?.rol || 'sistema',
    accion: texto(accion, 160),
    detalle: texto(detalle, 400),
    edificioId: texto(edificioId, 40),
    creado: ahora(),
  });
  if (db.auditoria.length > 500) db.auditoria.length = 500;
}

function registroPermitido(sesion, seccion, registro) {
  if (seccion === 'edificios') return !!registro && puedeGestionarEdificio(sesion, registro.id);
  if (seccion === 'apartamentos') return apartamentoPermitido(sesion, registro);
  if (seccion === 'contratos') return contratoPermitido(sesion, registro);
  if (seccion === 'pagos') return pagoPermitido(sesion, registro);
  return esPrincipal(sesion);
}

function edificiosQueUsanMedio(mediaId) {
  const usados = new Set();
  for (const a of db.apartamentos) {
    if (a.videoId === mediaId || a.portadaId === mediaId || (a.fotos || []).includes(mediaId)) usados.add(a.edificioId);
  }
  for (const e of db.edificios) {
    if (e.fotoId === mediaId || e.encargado?.fotoId === mediaId) usados.add(e.id);
  }
  return usados;
}

function medioPermitido(sesion, medio) {
  if (!medio) return false;
  if (esPrincipal(sesion)) return true;
  if (medio.contratoId) {
    const contrato = db.contratos.find((c) => c.id === medio.contratoId);
    return contratoPermitido(sesion, contrato);
  }
  const usos = edificiosQueUsanMedio(medio.id);
  if ([...usos].some((idEdificio) => puedeGestionarEdificio(sesion, idEdificio))) return true;
  return usos.size === 0 && medio.creadoPorAdministradorId === sesion.id;
}

function medioUsadoFueraDeAlcance(sesion, medio) {
  return !esPrincipal(sesion) && [...edificiosQueUsanMedio(medio.id)]
    .some((idEdificio) => !puedeGestionarEdificio(sesion, idEdificio));
}

function mediosPermitidosEnRegistro(sesion, seccion, registro) {
  const referencias = seccion === 'apartamentos'
    ? [registro.videoId, registro.portadaId, ...(registro.fotos || [])]
    : seccion === 'edificios'
      ? [registro.fotoId, registro.encargado?.fotoId]
      : [];
  return referencias.filter(Boolean).every((idMedio) =>
    medioPermitido(sesion, db.media.find((m) => m.id === idMedio)));
}

function vistaConfigAdmin() {
  const { adminUsuario, adminSal, adminHash, claveInicial, ...config } = db.config;
  return config;
}

function vistaAdmin(sesion) {
  const edificios = db.edificios.filter((e) => puedeGestionarEdificio(sesion, e.id));
  const idsEdificios = new Set(edificios.map((e) => e.id));
  const apartamentos = db.apartamentos.filter((a) => idsEdificios.has(a.edificioId));
  const idsApartamentos = new Set(apartamentos.map((a) => a.id));
  const contratos = db.contratos.filter((c) => idsApartamentos.has(c.apartamentoId));
  const idsContratos = new Set(contratos.map((c) => c.id));
  return {
    config: vistaConfigAdmin(),
    sesion: perfilAdministrador(sesion),
    edificios,
    apartamentos,
    contratos: contratos.map(vistaContratoAdmin),
    pagos: db.pagos.filter((p) => idsContratos.has(p.contratoId)),
    solicitudes: db.solicitudes.filter((s) => idsApartamentos.has(s.apartamentoId)),
    mensajes: db.mensajes.filter((m) => idsContratos.has(m.contratoId)),
    // Los adjuntos de mantenimiento se solicitan individualmente con sesión;
    // no se mezclan con la biblioteca pública de fotos y videos.
    media: db.media.filter((m) => !m.privado && medioPermitido(sesion, m)).map((m) => ({ ...m, url: `/api/media/${m.id}` })),
    analitica: calcularAnalitica(12, esPrincipal(sesion) ? null : sesion.edificioIds),
    administradores: esPrincipal(sesion) ? db.administradores.map(vistaAdministrador) : [],
    auditoria: esPrincipal(sesion) ? db.auditoria.slice(0, 200) : [],
  };
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/** Datos que ve cualquier visitante (sin información sensible). */
function vistaPublica() {
  return {
    config: {
      nombreSitio: db.config.nombreSitio,
      lema: db.config.lema,
      telefono: db.config.telefono,
      email: db.config.email,
      whatsapp: db.config.whatsapp,
      moneda: db.config.moneda,
      localeMoneda: db.config.localeMoneda,
    },
    edificios: db.edificios.map((e) => ({
      id: e.id, nombre: e.nombre, direccion: e.direccion, ciudad: e.ciudad,
      lat: e.lat, lng: e.lng, descripcion: e.descripcion, amenidades: e.amenidades,
      fotoId: e.fotoId, encargado: e.encargado,
    })),
    // El catálogo no debe revelar unidades que ya están arrendadas. La relación
    // con el inquilino se conserva exclusivamente en el panel autenticado.
    apartamentos: db.apartamentos
      .filter((a) => a.estado !== 'arrendado')
      .filter((a) => a.estado !== 'mantenimiento' || a.destacado)
      .map((a) => ({ ...a })),
  };
}

function documentoNormalizado(valor) {
  return texto(valor, 80).replace(/[\s.\-]/g, '').toLowerCase();
}

/** Oculta los hashes de acceso incluso dentro de la respuesta administrativa. */
function vistaContratoAdmin(c) {
  const portal = c.portal || {};
  return {
    ...c,
    portal: {
      activo: !!portal.activo,
      actualizado: portal.actualizado || '',
    },
  };
}

function vistaPortalInquilino(c) {
  const apt = db.apartamentos.find((a) => a.id === c.apartamentoId) || {};
  const ed = db.edificios.find((e) => e.id === apt.edificioId) || {};
  const periodo = mesActual();
  const pagadoMes = db.pagos
    .filter((p) => p.contratoId === c.id && p.periodo === periodo)
    .reduce((s, p) => s + num(p.monto), 0);
  const deuda = calcularAnalitica(12).cartera.find((x) => x.contratoId === c.id);
  const mensajes = db.mensajes
    .filter((x) => x.contratoId === c.id)
    .sort((a, b) => String(b.creado).localeCompare(String(a.creado)))
    .slice(0, 100)
    .map((x) => ({
      id: x.id, asunto: x.asunto, cuerpo: x.cuerpo, tipo: x.tipo,
      prioridad: x.prioridad, categoria: x.categoria, creado: x.creado,
      leidoInquilino: !!x.leidoInquilino,
      estadoGestion: x.estadoGestion || '', actualizadoGestion: x.actualizadoGestion || '',
      adjuntos: (x.adjuntos || []).map((idMedio) => db.media.find((m) =>
        m.id === idMedio && m.privado && m.contratoId === c.id)).filter(Boolean)
        .map((m) => ({ id: m.id, nombre: m.nombre, mime: m.mime, tamano: m.tamano })),
    }));

  return {
    contrato: {
      id: c.id, inicio: c.inicio, fin: c.fin, canon: c.canon, deposito: c.deposito,
      diaPago: c.diaPago, estado: c.estado,
      inquilino: { nombre: c.inquilino?.nombre || '', email: c.inquilino?.email || '' },
    },
    apartamento: {
      numero: apt.numero || '', titulo: apt.titulo || '', area: apt.area || 0,
      habitaciones: apt.habitaciones || 0, banos: apt.banos || 0, piso: apt.piso || 0,
      descripcion: apt.descripcion || '',
    },
    edificio: {
      nombre: ed.nombre || '', direccion: ed.direccion || '', ciudad: ed.ciudad || '',
      encargado: ed.encargado || {},
    },
    pagoActual: {
      periodo, canon: num(c.canon), pagado: pagadoMes,
      pendiente: Math.max(0, num(c.canon) - pagadoMes), diaPago: c.diaPago,
    },
    cartera: deuda ? { saldo: deuda.saldo, meses: deuda.meses } : { saldo: 0, meses: [] },
    pagos: db.pagos.filter((p) => p.contratoId === c.id)
      .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).slice(0, 36),
    mensajes,
  };
}

const coleccion = {
  edificios: { arr: () => db.edificios, sanear: sanearEdificio },
  apartamentos: { arr: () => db.apartamentos, sanear: sanearApartamento },
  contratos: { arr: () => db.contratos, sanear: sanearContrato },
  pagos: { arr: () => db.pagos, sanear: sanearPago },
};

async function manejarApi(req, res, url) {
  const partes = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const seccion = partes[1];
  const recurso = partes[2];
  const m = req.method;

  // ---- Público -----------------------------------------------------------
  if (seccion === 'publico' && m === 'GET') return ok(res, vistaPublica());

  if (seccion === 'media' && (m === 'GET' || m === 'HEAD') && recurso) {
    const medio = db.media.find((x) => x.id === recurso);
    if (!medio) return error(res, 404, 'Archivo no encontrado');
    if (!medio.privado) return servirMedia(req, res, recurso);
    const admin = sesionDe(req);
    const inquilino = sesionInquilinoDe(req);
    const puedeVer = (admin && medioPermitido(admin, medio)) ||
      (inquilino && medio.contratoId === inquilino.contratoId);
    if (!puedeVer) return error(res, 401, 'No autorizado para ver este adjunto.');
    return servirMedia(req, res, recurso);
  }

  if (seccion === 'solicitudes' && m === 'POST' && !recurso) {
    const b = await leerJson(req);
    if (!texto(b.nombre) || !(texto(b.telefono) || texto(b.email))) {
      return error(res, 400, 'Necesitamos tu nombre y un teléfono o correo.');
    }
    if (b.consentimiento !== true && b.consentimiento !== 'on') {
      return error(res, 400, 'Debes aceptar el tratamiento de datos para enviar la solicitud.');
    }
    const fechaVisita = texto(b.fechaVisita, 10);
    const horaVisita = texto(b.horaVisita, 5);
    if ((fechaVisita && !horaVisita) || (!fechaVisita && horaVisita)) {
      return error(res, 400, 'Completa fecha y franja horaria, o deja ambas sin preferencia.');
    }
    if (fechaVisita && (diasHasta(fechaVisita) === null || diasHasta(fechaVisita) < 0)) {
      return error(res, 400, 'La fecha de visita debe ser hoy o una fecha futura.');
    }
    if (horaVisita && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(horaVisita)) {
      return error(res, 400, 'La franja horaria no es válida.');
    }
    if (fechaVisita && horaVisita && db.solicitudes.some((x) =>
      x.fechaVisita === fechaVisita && x.horaVisita === horaVisita &&
      ['nueva', 'contactada', 'visita'].includes(x.estado))) {
      return error(res, 409, 'Esa franja acaba de ser solicitada. Elige otra hora para la visita.');
    }
    const s = {
      id: id(),
      apartamentoId: texto(b.apartamentoId, 40),
      nombre: texto(b.nombre, 120),
      telefono: texto(b.telefono, 40),
      email: texto(b.email, 120),
      mensaje: texto(b.mensaje, 1500),
      fechaVisita,
      horaVisita,
      consentimiento: true,
      consentimientoEn: ahora(),
      estado: 'nueva',
      creado: ahora(),
    };
    db.solicitudes.unshift(s);
    registrarAuditoria(null, 'Nueva solicitud de visita', fechaVisita ? `Agenda solicitada para ${fechaVisita} ${horaVisita}` : 'Solicitud sin horario preferido');
    await guardarDb();
    return json(res, 201, { ok: true, id: s.id });
  }

  // ---- Portal del inquilino ---------------------------------------------
  if (seccion === 'inquilino') {
    if (recurso === 'login' && m === 'POST') {
      const b = await leerJson(req);
      const documento = documentoNormalizado(b.documento);
      const claveIntento = claveIntentosLogin(req, `inquilino:${documento}`);
      if (bloqueoActivoLogin(claveIntento)) {
        return error(res, 429, 'Demasiados intentos. Espera 15 minutos antes de volver a intentarlo.');
      }
      const c = db.contratos.find((x) =>
        x.estado === 'activo' && contratoActivoEn(x, mesActual()) &&
        x.portal?.activo && documento &&
        documentoNormalizado(x.inquilino?.documento) === documento &&
        verificarClave(b.clave || '', x.portal?.sal, x.portal?.hash));
      await new Promise((r) => setTimeout(r, 250));
      if (!c) {
        registrarFalloLogin(claveIntento);
        return error(res, 401, 'Documento o clave incorrectos.');
      }
      intentosLogin.delete(claveIntento);
      return ok(res, {
        token: crearSesionInquilino(c.id),
        nombre: c.inquilino?.nombre || 'Inquilino',
      });
    }

    const s = sesionInquilinoDe(req);
    if (recurso === 'sesion' && m === 'GET') {
      if (!s) return error(res, 401, 'Sesión expirada');
      const c = db.contratos.find((x) => x.id === s.contratoId);
      return c?.portal?.activo && c.estado === 'activo'
        ? ok(res, { nombre: c.inquilino?.nombre || 'Inquilino' })
        : error(res, 401, 'Acceso no disponible');
    }
    if (recurso === 'logout' && m === 'POST') {
      if (s) sesionesInquilino.delete(s.token);
      return ok(res);
    }
    if (!s) return error(res, 401, 'No autorizado');
    const c = db.contratos.find((x) => x.id === s.contratoId);
    if (!c || !c.portal?.activo || c.estado !== 'activo') return error(res, 401, 'Acceso no disponible');

    if (recurso === 'panel' && m === 'GET') return ok(res, vistaPortalInquilino(c));

    // Evidencias privadas para solicitudes de mantenimiento. El archivo no se
    // publica y solo puede recuperarse con sesión del contrato o de su edificio.
    if (recurso === 'adjuntos' && m === 'POST') {
      const mime = texto(req.headers['content-type'], 100).toLowerCase();
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mime)) {
        return error(res, 415, 'Adjunta solo imágenes PNG, JPG, WEBP o GIF.');
      }
      let nombre = 'evidencia';
      try { nombre = Buffer.from(texto(req.headers['x-nombre'], 600), 'base64').toString('utf8') || 'evidencia'; } catch {}
      const mid = id();
      const archivo = mid + (EXT_POR_MIME[mime] || '.img');
      try {
        const tam = await recibirArchivo(req, res, path.join(DIR_SUBIDAS, archivo), LIMITE_ADJUNTO_INQUILINO,
          'La imagen supera el límite de 10 MB.');
        const reg = {
          id: mid, archivo, nombre: texto(nombre, 200), mime, tipo: 'imagen', tamano: tam,
          privado: true, contratoId: c.id, creadoPorInquilino: true, creado: ahora(),
        };
        db.media.unshift(reg);
        await guardarDb();
        return json(res, 201, { ok: true, id: reg.id, nombre: reg.nombre, tamano: reg.tamano });
      } catch (e) {
        await fsp.unlink(path.join(DIR_SUBIDAS, archivo)).catch(() => {});
        return error(res, 413, e.message || 'No se pudo guardar la imagen.');
      }
    }

    if (recurso === 'mensajes' && m === 'POST') {
      const b = await leerJson(req);
      const cuerpo = texto(b.cuerpo, 1500).trim();
      if (!cuerpo) return error(res, 400, 'Escribe el mensaje que quieres enviar.');
      const categorias = ['pago', 'mantenimiento', 'convivencia', 'otro'];
      const categoria = categorias.includes(b.categoria) ? b.categoria : 'otro';
      const adjuntos = [...new Set(Array.isArray(b.adjuntos) ? b.adjuntos.map((x) => texto(x, 40)).filter(Boolean) : [])];
      if (adjuntos.length > 5) return error(res, 400, 'Puedes adjuntar hasta 5 imágenes.');
      if (adjuntos.length && categoria !== 'mantenimiento') {
        return error(res, 400, 'Las imágenes solo se adjuntan a solicitudes de mantenimiento.');
      }
      if (adjuntos.some((idMedio) => !db.media.some((x) =>
        x.id === idMedio && x.privado && x.contratoId === c.id && x.creadoPorInquilino))) {
        return error(res, 400, 'Uno de los adjuntos no es válido para este contrato.');
      }
      const reg = {
        id: id(), contratoId: c.id,
        asunto: texto(b.asunto, 160).trim() || 'Mensaje del inquilino',
        cuerpo,
        tipo: 'inquilino',
        categoria,
        prioridad: b.prioridad === 'alta' ? 'alta' : 'normal',
        estadoGestion: categoria === 'mantenimiento' ? 'abierta' : '',
        actualizadoGestion: categoria === 'mantenimiento' ? ahora() : '',
        adjuntos,
        leidoAdmin: false, leidoInquilino: true, creado: ahora(),
      };
      db.mensajes.unshift(reg);
      registrarAuditoria(null, 'Nueva solicitud del inquilino', categoria === 'mantenimiento' ? 'Mantenimiento recibido' : 'Mensaje recibido');
      await guardarDb();
      return json(res, 201, { ok: true, mensaje: reg });
    }

    if (recurso === 'mensajes' && partes[3] && partes[4] === 'leido' && m === 'PUT') {
      const msg = db.mensajes.find((x) => x.id === partes[3] && x.contratoId === c.id);
      if (!msg) return error(res, 404, 'Mensaje no encontrado');
      if (msg.tipo === 'administracion') {
        msg.leidoInquilino = true;
        msg.leidoInquilinoEn = ahora();
        await guardarDb();
      }
      return ok(res);
    }

    return error(res, 404, 'Ruta del portal desconocida');
  }

  // ---- Autenticación -----------------------------------------------------
  if (seccion === 'auth') {
    if (recurso === 'login' && m === 'POST') {
      const b = await leerJson(req);
      const usuario = texto(b.usuario, 40).trim().toLowerCase();
      const claveIntento = claveIntentosLogin(req, `admin:${usuario}`);
      if (bloqueoActivoLogin(claveIntento)) {
        return error(res, 429, 'Demasiados intentos. Espera 15 minutos antes de volver a intentarlo.');
      }
      const admin = db.administradores.find((x) => x.activo && String(x.usuario).toLowerCase() === usuario);
      const claveOk = admin && verificarClave(b.clave || '', admin.sal, admin.hash);
      await new Promise((r) => setTimeout(r, 250)); // freno básico contra fuerza bruta
      if (!admin || !claveOk) {
        registrarFalloLogin(claveIntento);
        return error(res, 401, 'Usuario o contraseña incorrectos.');
      }
      intentosLogin.delete(claveIntento);
      return ok(res, {
        token: crearSesion(admin),
        ...perfilAdministrador(admin),
      });
    }
    const s = sesionDe(req);
    if (recurso === 'sesion' && m === 'GET') {
      return s ? ok(res, perfilAdministrador(s)) : error(res, 401, 'Sesión expirada');
    }
    if (recurso === 'logout' && m === 'POST') {
      if (s) sesiones.delete(s.token);
      return ok(res);
    }
    if (recurso === 'clave' && m === 'POST') {
      if (!s) return error(res, 401, 'No autorizado');
      const b = await leerJson(req);
      const admin = administradorPorId(s.id);
      if (!admin || !verificarClave(b.actual || '', admin.sal, admin.hash)) {
        return error(res, 400, 'La contraseña actual no coincide.');
      }
      if (String(b.nueva || '').length < 6) return error(res, 400, 'La nueva contraseña debe tener al menos 6 caracteres.');
      const usuario = texto(b.usuario, 40).trim();
      if (!usuario) return error(res, 400, 'Indica un nombre de usuario.');
      if (!/^[a-zA-Z0-9._-]{3,40}$/.test(usuario)) {
        return error(res, 400, 'El usuario debe tener al menos 3 caracteres y no incluir espacios.');
      }
      if (db.administradores.some((x) => x.id !== admin.id && String(x.usuario).toLowerCase() === usuario.toLowerCase())) {
        return error(res, 400, 'Ese nombre de usuario ya está en uso.');
      }
      const nuevo = hashClave(b.nueva);
      admin.sal = nuevo.sal;
      admin.hash = nuevo.hash;
      admin.claveInicial = false;
      admin.usuario = usuario;
      admin.actualizado = ahora();
      registrarAuditoria(s, 'Credenciales actualizadas', 'El administrador actualizó sus propias credenciales.');
      await guardarDb();
      return ok(res);
    }
    return error(res, 404, 'Ruta de autenticación desconocida');
  }

  // ---- A partir de aquí, todo exige sesión --------------------------------
  const sesion = sesionDe(req);
  if (!sesion) return error(res, 401, 'No autorizado');
  const prohibido = () => error(res, 403, 'No tienes permiso para gestionar este recurso.');

  // Solo el propietario puede crear y asignar administradores de edificio.
  if (seccion === 'administradores') {
    if (!esPrincipal(sesion)) return prohibido();
    if (m === 'GET') return ok(res, db.administradores.map(vistaAdministrador));

    if (m === 'POST' && !recurso) {
      const b = await leerJson(req);
      const nombre = texto(b.nombre, 120).trim();
      const usuario = texto(b.usuario, 40).trim();
      const clave = String(b.clave || '');
      const edificioIds = [...new Set(Array.isArray(b.edificioIds) ? b.edificioIds.map((x) => texto(x, 40)) : [])];
      if (!nombre || !usuario || !/^[a-zA-Z0-9._-]{3,40}$/.test(usuario)) {
        return error(res, 400, 'Indica nombre y un usuario de al menos 3 caracteres, sin espacios.');
      }
      if (clave.length < 6) return error(res, 400, 'La clave debe tener al menos 6 caracteres.');
      if (!edificioIds.length || edificioIds.some((x) => !db.edificios.some((e) => e.id === x))) {
        return error(res, 400, 'Asigna al menos un edificio válido.');
      }
      if (db.administradores.some((x) => String(x.usuario).toLowerCase() === usuario.toLowerCase())) {
        return error(res, 400, 'Ese nombre de usuario ya está en uso.');
      }
      const credencial = hashClave(clave);
      const nuevo = {
        id: id(), nombre, usuario, rol: 'edificio', edificioIds,
        ...credencial, activo: true, claveInicial: false, creado: ahora(), actualizado: ahora(),
      };
      db.administradores.push(nuevo);
      registrarAuditoria(sesion, 'Administrador creado', `${nuevo.nombre} recibió acceso a ${nuevo.edificioIds.length} edificio(s).`);
      await guardarDb();
      return json(res, 201, vistaAdministrador(nuevo));
    }

    const admin = db.administradores.find((x) => x.id === recurso);
    if (!admin) return error(res, 404, 'Administrador no encontrado.');
    if (admin.rol === 'principal') return error(res, 400, 'La cuenta del propietario se administra desde Seguridad.');

    if (m === 'PUT') {
      const b = await leerJson(req);
      const nombre = texto(b.nombre, 120).trim();
      const usuario = texto(b.usuario, 40).trim();
      const edificioIds = [...new Set(Array.isArray(b.edificioIds) ? b.edificioIds.map((x) => texto(x, 40)) : [])];
      if (!nombre || !usuario || !/^[a-zA-Z0-9._-]{3,40}$/.test(usuario)) {
        return error(res, 400, 'Indica nombre y un usuario de al menos 3 caracteres, sin espacios.');
      }
      if (!edificioIds.length || edificioIds.some((x) => !db.edificios.some((e) => e.id === x))) {
        return error(res, 400, 'Asigna al menos un edificio válido.');
      }
      if (db.administradores.some((x) => x.id !== admin.id && String(x.usuario).toLowerCase() === usuario.toLowerCase())) {
        return error(res, 400, 'Ese nombre de usuario ya está en uso.');
      }
      if (b.clave && String(b.clave).length < 6) return error(res, 400, 'La clave debe tener al menos 6 caracteres.');
      admin.nombre = nombre;
      admin.usuario = usuario;
      admin.edificioIds = edificioIds;
      admin.activo = b.activo !== false;
      if (b.clave) {
        const credencial = hashClave(b.clave);
        admin.sal = credencial.sal;
        admin.hash = credencial.hash;
      }
      admin.actualizado = ahora();
      registrarAuditoria(sesion, 'Administrador actualizado', `${admin.nombre}: ${admin.activo ? 'acceso activo' : 'acceso pausado'}.`);
      await guardarDb();
      return ok(res, vistaAdministrador(admin));
    }

    if (m === 'DELETE') {
      registrarAuditoria(sesion, 'Administrador eliminado', `Se eliminó la cuenta de ${admin.nombre}.`);
      db.administradores = db.administradores.filter((x) => x.id !== admin.id);
      for (const [token, datosSesion] of sesiones) {
        if (datosSesion.administradorId === admin.id) sesiones.delete(token);
      }
      await guardarDb();
      return ok(res);
    }
  }

  // Subida de archivos: el cuerpo crudo es el archivo.
  if (seccion === 'media' && m === 'POST') {
    const mime = texto(req.headers['content-type'], 100) || 'application/octet-stream';
    let nombre = 'archivo';
    try { nombre = Buffer.from(texto(req.headers['x-nombre'], 600), 'base64').toString('utf8') || 'archivo'; } catch {}
    const tipo = mime.startsWith('video/') ? 'video' : mime.startsWith('image/') ? 'imagen' : 'otro';
    if (tipo === 'otro') return error(res, 415, 'Solo se aceptan videos e imágenes.');

    const mid = id();
    const ext = EXT_POR_MIME[mime] || path.extname(nombre).toLowerCase() || '.bin';
    const archivo = mid + ext;
    try {
      const tam = await recibirArchivo(req, res, path.join(DIR_SUBIDAS, archivo));
      const reg = {
        id: mid, archivo, nombre: texto(nombre, 200), mime, tipo, tamano: tam,
        creadoPorAdministradorId: sesion.id, creado: ahora(),
      };
      db.media.unshift(reg);
      registrarAuditoria(sesion, 'Archivo multimedia subido', `${reg.tipo}: ${reg.nombre}`);
      await guardarDb();
      return json(res, 201, { ok: true, ...reg, url: `/api/media/${mid}` });
    } catch (e) {
      return error(res, 413, e.message || 'No se pudo guardar el archivo');
    }
  }

  if (seccion === 'media' && m === 'GET' && !recurso) {
    return ok(res, db.media.filter((x) => !x.privado && medioPermitido(sesion, x)).map((x) => ({ ...x, url: `/api/media/${x.id}` })));
  }

  if (seccion === 'media' && m === 'DELETE' && recurso) {
    const i = db.media.findIndex((x) => x.id === recurso);
    if (i < 0) return error(res, 404, 'No existe');
    if (!medioPermitido(sesion, db.media[i]) || medioUsadoFueraDeAlcance(sesion, db.media[i])) return prohibido();
    const [reg] = db.media.splice(i, 1);
    for (const a of db.apartamentos) {
      if (a.videoId === reg.id) a.videoId = null;
      if (a.portadaId === reg.id) a.portadaId = null;
      a.fotos = (a.fotos || []).filter((f) => f !== reg.id);
    }
    for (const e of db.edificios) {
      if (e.fotoId === reg.id) e.fotoId = null;
      if (e.encargado && e.encargado.fotoId === reg.id) e.encargado.fotoId = null;
    }
    for (const msg of db.mensajes) msg.adjuntos = (msg.adjuntos || []).filter((idMedio) => idMedio !== reg.id);
    await fsp.unlink(path.join(DIR_SUBIDAS, reg.archivo)).catch(() => {});
    registrarAuditoria(sesion, 'Archivo multimedia eliminado', reg.nombre);
    await guardarDb();
    return ok(res);
  }

  // Analítica
  if (seccion === 'analitica' && m === 'GET') {
    return ok(res, calcularAnalitica(
      Math.min(24, Math.max(3, num(url.searchParams.get('meses'), 12))),
      esPrincipal(sesion) ? null : sesion.edificioIds,
    ));
  }

  // Todo el estado administrativo de una
  if (seccion === 'admin' && m === 'GET') {
    return ok(res, vistaAdmin(sesion));
  }

  // Configuración del sitio
  if (seccion === 'config' && m === 'PUT') {
    if (!esPrincipal(sesion)) return prohibido();
    const b = await leerJson(req);
    for (const k of ['nombreSitio', 'lema', 'telefono', 'email', 'moneda', 'localeMoneda']) {
      if (b[k] !== undefined) db.config[k] = texto(b[k], 200);
    }
    if (b.whatsapp !== undefined) db.config.whatsapp = texto(b.whatsapp, 40).replace(/\D/g, '');
    registrarAuditoria(sesion, 'Configuración pública actualizada');
    await guardarDb();
    return ok(res, { config: vistaConfigAdmin() });
  }

  // Solicitudes (gestión)
  if (seccion === 'solicitudes') {
    if (m === 'GET') return ok(res, db.solicitudes.filter((s) => solicitudPermitida(sesion, s)));
    if (m === 'PUT' && recurso) {
      const b = await leerJson(req);
      const s = db.solicitudes.find((x) => x.id === recurso);
      if (!s) return error(res, 404, 'No existe');
      if (!solicitudPermitida(sesion, s)) return prohibido();
      if (['nueva', 'contactada', 'visita', 'cerrada', 'descartada'].includes(b.estado)) s.estado = b.estado;
      if (b.notas !== undefined) s.notas = texto(b.notas, 1000);
      registrarAuditoria(sesion, 'Solicitud de visita actualizada', `Estado: ${s.estado}.`);
      await guardarDb();
      return ok(res, s);
    }
    if (m === 'DELETE' && recurso) {
      const i = db.solicitudes.findIndex((x) => x.id === recurso);
      if (i < 0) return error(res, 404, 'No existe');
      if (!solicitudPermitida(sesion, db.solicitudes[i])) return prohibido();
      registrarAuditoria(sesion, 'Solicitud de visita eliminada');
      db.solicitudes.splice(i, 1);
      await guardarDb();
      return ok(res);
    }
  }

  // Credenciales del portal: se guardan derivadas, nunca en texto plano.
  if (seccion === 'contratos' && recurso && partes[3] === 'portal' && m === 'POST') {
    const c = db.contratos.find((x) => x.id === recurso);
    if (!c) return error(res, 404, 'Contrato no encontrado');
    if (!contratoPermitido(sesion, c)) return prohibido();
    const b = await leerJson(req);
    if (b.activo === false) {
      c.portal = { activo: false, sal: '', hash: '', actualizado: ahora() };
      registrarAuditoria(sesion, 'Portal del inquilino desactivado', `Contrato ${c.id.slice(0, 6)}.`);
      await guardarDb();
      return ok(res, { activo: false });
    }
    if (String(b.clave || '').length < 6) {
      return error(res, 400, 'La clave del portal debe tener al menos 6 caracteres.');
    }
    const credencial = hashClave(b.clave);
    c.portal = { activo: true, sal: credencial.sal, hash: credencial.hash, actualizado: ahora() };
    registrarAuditoria(sesion, 'Portal del inquilino activado o restablecido', `Contrato ${c.id.slice(0, 6)}.`);
    await guardarDb();
    return ok(res, { activo: true, actualizado: c.portal.actualizado });
  }

  // Mensajes entre administración e inquilinos. El tipo se decide en el
  // servidor para impedir que un cliente suplante al administrador.
  if (seccion === 'mensajes') {
    if (m === 'GET') return ok(res, db.mensajes.filter((x) => mensajePermitido(sesion, x)));
    if (m === 'POST' && !recurso) {
      const b = await leerJson(req);
      const cuerpo = texto(b.cuerpo, 1500).trim();
      if (!cuerpo) return error(res, 400, 'Escribe el mensaje que quieres enviar.');
      const contratoId = texto(b.contratoId, 40);
      const edificioId = texto(b.edificioId, 40);
      let destinos = [];
      if (contratoId) {
        const c = db.contratos.find((x) => x.id === contratoId);
        if (c && !contratoPermitido(sesion, c)) return prohibido();
        if (c && c.estado === 'activo' && contratoActivoEn(c, mesActual())) destinos = [c];
      } else if (edificioId) {
        if (!db.edificios.some((e) => e.id === edificioId)) return error(res, 400, 'Selecciona un edificio válido.');
        if (!puedeGestionarEdificio(sesion, edificioId)) return prohibido();
        destinos = db.contratos.filter((c) => {
          const apt = db.apartamentos.find((a) => a.id === c.apartamentoId);
          return c.estado === 'activo' && contratoActivoEn(c, mesActual()) && apt?.edificioId === edificioId;
        });
      }
      if (!destinos.length) return error(res, 400, 'No hay inquilinos activos para ese destinatario.');
      const creado = ahora();
      const registros = destinos.map((c) => ({
        id: id(), contratoId: c.id,
        asunto: texto(b.asunto, 160).trim() || 'Mensaje de administración',
        cuerpo, tipo: 'administracion',
        categoria: ['pago', 'mantenimiento', 'convivencia', 'general'].includes(b.categoria) ? b.categoria : 'general',
        prioridad: b.prioridad === 'alta' ? 'alta' : 'normal',
        leidoAdmin: true, leidoInquilino: false, creado,
      }));
      db.mensajes.unshift(...registros);
      registrarAuditoria(sesion, 'Mensaje enviado a inquilino(s)', `${registros.length} entrega(s) privada(s).`, edificioId);
      await guardarDb();
      return json(res, 201, { ok: true, enviados: registros.length, mensajes: registros });
    }
    if (m === 'PUT' && recurso && partes[3] === 'leido') {
      const msg = db.mensajes.find((x) => x.id === recurso);
      if (!msg) return error(res, 404, 'Mensaje no encontrado');
      if (!mensajePermitido(sesion, msg)) return prohibido();
      if (msg.tipo === 'inquilino') {
        msg.leidoAdmin = true;
        msg.leidoAdminEn = ahora();
        registrarAuditoria(sesion, 'Mensaje de inquilino leído');
        await guardarDb();
      }
      return ok(res, msg);
    }
    if (m === 'PUT' && recurso && partes[3] === 'gestion') {
      const msg = db.mensajes.find((x) => x.id === recurso);
      if (!msg) return error(res, 404, 'Mensaje no encontrado');
      if (!mensajePermitido(sesion, msg)) return prohibido();
      if (msg.tipo !== 'inquilino' || msg.categoria !== 'mantenimiento') {
        return error(res, 400, 'Solo las solicitudes de mantenimiento tienen estado de gestión.');
      }
      const b = await leerJson(req);
      if (!['abierta', 'en_proceso', 'resuelta'].includes(b.estadoGestion)) {
        return error(res, 400, 'Estado de mantenimiento no válido.');
      }
      msg.estadoGestion = b.estadoGestion;
      msg.actualizadoGestion = ahora();
      registrarAuditoria(sesion, 'Mantenimiento actualizado', `Estado: ${msg.estadoGestion}.`);
      await guardarDb();
      return ok(res, msg);
    }
    if (m === 'DELETE' && recurso) {
      const i = db.mensajes.findIndex((x) => x.id === recurso);
      if (i < 0) return error(res, 404, 'Mensaje no encontrado');
      if (!mensajePermitido(sesion, db.mensajes[i])) return prohibido();
      registrarAuditoria(sesion, 'Mensaje eliminado');
      db.mensajes.splice(i, 1);
      await guardarDb();
      return ok(res);
    }
  }

  // CRUD genérico
  const col = coleccion[seccion];
  if (col) {
    const arr = col.arr();
    if (m === 'GET') {
      const visibles = arr.filter((x) => registroPermitido(sesion, seccion, x));
      return ok(res, seccion === 'contratos' ? visibles.map(vistaContratoAdmin) : visibles);
    }

    if (m === 'POST' && !recurso) {
      if (seccion === 'edificios' && !esPrincipal(sesion)) return prohibido();
      const b = await leerJson(req);
      const nuevo = col.sanear(b);
      if (!registroPermitido(sesion, seccion, nuevo)) return prohibido();
      if (!mediosPermitidosEnRegistro(sesion, seccion, nuevo)) return prohibido();
      const problemaContrato = seccion === 'contratos' ? validarContrato(nuevo) : '';
      if (problemaContrato) return error(res, 400, problemaContrato);
      arr.push(nuevo);
      efectosSecundarios(seccion, nuevo);
      registrarAuditoria(sesion, 'Registro creado', seccion);
      await guardarDb();
      return json(res, 201, seccion === 'contratos' ? vistaContratoAdmin(nuevo) : nuevo);
    }

    if (m === 'PUT' && recurso) {
      const i = arr.findIndex((x) => x.id === recurso);
      if (i < 0) return error(res, 404, 'No existe');
      if (!registroPermitido(sesion, seccion, arr[i])) return prohibido();
      const b = await leerJson(req);
      const actualizado = col.sanear({ ...arr[i], ...b }, arr[i]);
      if (!registroPermitido(sesion, seccion, actualizado)) return prohibido();
      if (!mediosPermitidosEnRegistro(sesion, seccion, actualizado)) return prohibido();
      const problemaContrato = seccion === 'contratos' ? validarContrato(actualizado, arr[i].id) : '';
      if (problemaContrato) return error(res, 400, problemaContrato);
      arr[i] = actualizado;
      efectosSecundarios(seccion, arr[i]);
      registrarAuditoria(sesion, 'Registro actualizado', seccion);
      await guardarDb();
      return ok(res, seccion === 'contratos' ? vistaContratoAdmin(arr[i]) : arr[i]);
    }

    if (m === 'DELETE' && recurso) {
      const i = arr.findIndex((x) => x.id === recurso);
      if (i < 0) return error(res, 404, 'No existe');
      if (!registroPermitido(sesion, seccion, arr[i])) return prohibido();
      if (seccion === 'edificios' && !esPrincipal(sesion)) return prohibido();
      const [borrado] = arr.splice(i, 1);
      registrarAuditoria(sesion, 'Registro eliminado', seccion);
      // Limpieza en cascada
      if (seccion === 'edificios') {
        const aptIds = db.apartamentos.filter((a) => a.edificioId === borrado.id).map((a) => a.id);
        db.apartamentos = db.apartamentos.filter((a) => a.edificioId !== borrado.id);
        const ctIds = db.contratos.filter((c) => aptIds.includes(c.apartamentoId)).map((c) => c.id);
        db.contratos = db.contratos.filter((c) => !aptIds.includes(c.apartamentoId));
        db.pagos = db.pagos.filter((p) => !ctIds.includes(p.contratoId));
        db.mensajes = db.mensajes.filter((x) => !ctIds.includes(x.contratoId));
        for (const admin of db.administradores) {
          admin.edificioIds = (admin.edificioIds || []).filter((idEdificio) => idEdificio !== borrado.id);
        }
      }
      if (seccion === 'apartamentos') {
        const ctIds = db.contratos.filter((c) => c.apartamentoId === borrado.id).map((c) => c.id);
        db.contratos = db.contratos.filter((c) => c.apartamentoId !== borrado.id);
        db.pagos = db.pagos.filter((p) => !ctIds.includes(p.contratoId));
        db.mensajes = db.mensajes.filter((x) => !ctIds.includes(x.contratoId));
      }
      if (seccion === 'contratos') {
        db.pagos = db.pagos.filter((p) => p.contratoId !== borrado.id);
        db.mensajes = db.mensajes.filter((x) => x.contratoId !== borrado.id);
        for (const [token, s] of sesionesInquilino) if (s.contratoId === borrado.id) sesionesInquilino.delete(token);
        efectosSecundarios('contratos');
      }
      await guardarDb();
      return ok(res);
    }
  }

  return error(res, 404, 'Endpoint no encontrado');
}

/** Mantiene coherente el estado de todas las unidades cuando cambia un contrato. */
function efectosSecundarios(seccion) {
  if (seccion !== 'contratos') return;
  const ocupadas = new Set(db.contratos
    .filter((c) => c.estado === 'activo')
    .map((c) => c.apartamentoId));
  for (const apt of db.apartamentos) {
    if (ocupadas.has(apt.id)) apt.estado = 'arrendado';
    else if (apt.estado === 'arrendado') apt.estado = 'disponible';
  }
}

function validarContrato(c, excluirId = '') {
  if (!c.apartamentoId || !db.apartamentos.some((a) => a.id === c.apartamentoId)) {
    return 'Selecciona una unidad válida.';
  }
  if (!c.inquilino?.nombre.trim()) return 'Escribe el nombre del inquilino.';
  if (!c.inicio) return 'Indica la fecha de inicio del contrato.';
  if (c.fin && c.fin < c.inicio) return 'La fecha de finalización no puede ser anterior al inicio.';
  if (c.estado === 'activo' && db.contratos.some((x) =>
    x.id !== excluirId && x.apartamentoId === c.apartamentoId && x.estado === 'activo')) {
    return 'Esta unidad ya tiene un contrato activo.';
  }
  return '';
}

// ---------------------------------------------------------------------------
// Servidor
// ---------------------------------------------------------------------------

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) return await manejarApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return error(res, 405, 'Método no permitido');
    if (url.pathname === '/robots.txt') return servirRobots(req, res);
    if (url.pathname === '/sitemap.xml') return servirSitemap(req, res);
    return await servirEstatico(req, res, url.pathname);
  } catch (e) {
    console.error('Error:', e);
    if (!res.headersSent) error(res, 500, e.message || 'Error interno');
    else res.end();
  }
});

servidor.requestTimeout = 0;      // subidas de video largas
servidor.headersTimeout = 60000;

cargarDb().then(() => {
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
      console.log(`  Usuario: ${propietario.usuario}   Contraseña: admin123`);
      console.log('  (cámbiala desde Ajustes en el panel)');
    }
    console.log('');
    console.log('  Ctrl+C para detener.');
    console.log('');
  });
});

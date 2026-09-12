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
const DURACION_SESION = 8 * 60 * 60 * 1000; // 8 horas

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
    version: 1,
    config: {
      nombreSitio: 'Vivo Estudios',
      lema: 'Apartaestudios listos para habitar, con video y ubicación real.',
      telefono: '+57 300 000 0000',
      email: 'contacto@vivoestudios.co',
      whatsapp: '573000000000',
      moneda: 'COP',
      localeMoneda: 'es-CO',
      adminUsuario: 'admin',
      adminSal: sal,
      adminHash: hash,
      claveInicial: true,
    },
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
    media: [],
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
  // Normaliza colecciones faltantes
  for (const k of ['edificios', 'apartamentos', 'contratos', 'pagos', 'solicitudes', 'media']) {
    if (!Array.isArray(db[k])) db[k] = [];
  }
  db.config = Object.assign({}, dbPorDefecto().config, db.config || {});
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

const sesiones = new Map(); // token -> { usuario, expira }

function crearSesion(usuario) {
  const token = crypto.randomBytes(32).toString('hex');
  sesiones.set(token, { usuario, expira: Date.now() + DURACION_SESION });
  return token;
}

function sesionDe(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  const s = sesiones.get(token);
  if (!s) return null;
  if (s.expira < Date.now()) { sesiones.delete(token); return null; }
  s.expira = Date.now() + DURACION_SESION;
  return { token, ...s };
}

setInterval(() => {
  const t = Date.now();
  for (const [k, v] of sesiones) if (v.expira < t) sesiones.delete(k);
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
    'Cache-Control': 'public, max-age=31536000, immutable',
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
function recibirArchivo(req, res, destino) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const out = fs.createWriteStream(destino);
    req.on('data', (c) => {
      total += c.length;
      if (total > LIMITE_SUBIDA) {
        req.destroy();
        out.destroy();
        fs.unlink(destino, () => {});
        reject(new Error('El archivo supera el límite de 600 MB'));
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

function calcularAnalitica(meses = 12) {
  const hoy = mesActual();
  const periodos = periodosEntre(restarMeses(hoy, meses - 1), hoy);
  const activos = db.contratos.filter((c) => c.estado !== 'cancelado');

  const pagosPorPeriodo = new Map();
  for (const p of db.pagos) {
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
      const pagado = db.pagos
        .filter((x) => x.contratoId === c.id && x.periodo === p)
        .reduce((s, x) => s + num(x.monto), 0);
      const falta = num(c.canon) - pagado;
      if (falta > 0.5) { saldo += falta; mesesDebe.push(p); }
    }
    const apt = db.apartamentos.find((a) => a.id === c.apartamentoId);
    const ed = apt && db.edificios.find((e) => e.id === apt.edificioId);
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

  // Ocupación por edificio
  const porEdificio = db.edificios.map((e) => {
    const us = db.apartamentos.filter((a) => a.edificioId === e.id);
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

  const total = db.apartamentos.length;
  const arrendados = db.apartamentos.filter((a) => a.estado === 'arrendado').length;
  const disponibles = db.apartamentos.filter((a) => a.estado === 'disponible').length;
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
      solicitudesNuevas: db.solicitudes.filter((s) => s.estado === 'nueva').length,
      canonPromedio: arrendados
        ? Math.round(activos.filter((c) => contratoActivoEn(c, hoy)).reduce((s, c) => s + num(c.canon), 0) / Math.max(1, activos.filter((c) => contratoActivoEn(c, hoy)).length))
        : 0,
    },
    serie,
    cartera,
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
    apartamentos: db.apartamentos
      .filter((a) => a.estado !== 'mantenimiento' || a.destacado)
      .map((a) => ({ ...a })),
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
    return servirMedia(req, res, recurso);
  }

  if (seccion === 'solicitudes' && m === 'POST' && !recurso) {
    const b = await leerJson(req);
    if (!texto(b.nombre) || !(texto(b.telefono) || texto(b.email))) {
      return error(res, 400, 'Necesitamos tu nombre y un teléfono o correo.');
    }
    const s = {
      id: id(),
      apartamentoId: texto(b.apartamentoId, 40),
      nombre: texto(b.nombre, 120),
      telefono: texto(b.telefono, 40),
      email: texto(b.email, 120),
      mensaje: texto(b.mensaje, 1500),
      estado: 'nueva',
      creado: ahora(),
    };
    db.solicitudes.unshift(s);
    await guardarDb();
    return json(res, 201, { ok: true, id: s.id });
  }

  // ---- Autenticación -----------------------------------------------------
  if (seccion === 'auth') {
    if (recurso === 'login' && m === 'POST') {
      const b = await leerJson(req);
      const usuarioOk = texto(b.usuario).toLowerCase() === String(db.config.adminUsuario).toLowerCase();
      const claveOk = verificarClave(b.clave || '', db.config.adminSal, db.config.adminHash);
      await new Promise((r) => setTimeout(r, 250)); // freno básico contra fuerza bruta
      if (!usuarioOk || !claveOk) return error(res, 401, 'Usuario o contraseña incorrectos.');
      return ok(res, {
        token: crearSesion(db.config.adminUsuario),
        usuario: db.config.adminUsuario,
        claveInicial: !!db.config.claveInicial,
      });
    }
    const s = sesionDe(req);
    if (recurso === 'sesion' && m === 'GET') {
      return s ? ok(res, { usuario: s.usuario, claveInicial: !!db.config.claveInicial }) : error(res, 401, 'Sesión expirada');
    }
    if (recurso === 'logout' && m === 'POST') {
      if (s) sesiones.delete(s.token);
      return ok(res);
    }
    if (recurso === 'clave' && m === 'POST') {
      if (!s) return error(res, 401, 'No autorizado');
      const b = await leerJson(req);
      if (!verificarClave(b.actual || '', db.config.adminSal, db.config.adminHash)) {
        return error(res, 400, 'La contraseña actual no coincide.');
      }
      if (String(b.nueva || '').length < 6) return error(res, 400, 'La nueva contraseña debe tener al menos 6 caracteres.');
      const nuevo = hashClave(b.nueva);
      db.config.adminSal = nuevo.sal;
      db.config.adminHash = nuevo.hash;
      db.config.claveInicial = false;
      if (texto(b.usuario)) db.config.adminUsuario = texto(b.usuario, 40);
      await guardarDb();
      return ok(res);
    }
    return error(res, 404, 'Ruta de autenticación desconocida');
  }

  // ---- A partir de aquí, todo exige sesión --------------------------------
  const sesion = sesionDe(req);
  if (!sesion) return error(res, 401, 'No autorizado');

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
      const reg = { id: mid, archivo, nombre: texto(nombre, 200), mime, tipo, tamano: tam, creado: ahora() };
      db.media.unshift(reg);
      await guardarDb();
      return json(res, 201, { ok: true, ...reg, url: `/api/media/${mid}` });
    } catch (e) {
      return error(res, 413, e.message || 'No se pudo guardar el archivo');
    }
  }

  if (seccion === 'media' && m === 'GET' && !recurso) {
    return ok(res, db.media.map((x) => ({ ...x, url: `/api/media/${x.id}` })));
  }

  if (seccion === 'media' && m === 'DELETE' && recurso) {
    const i = db.media.findIndex((x) => x.id === recurso);
    if (i < 0) return error(res, 404, 'No existe');
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
    await fsp.unlink(path.join(DIR_SUBIDAS, reg.archivo)).catch(() => {});
    await guardarDb();
    return ok(res);
  }

  // Analítica
  if (seccion === 'analitica' && m === 'GET') {
    return ok(res, calcularAnalitica(Math.min(24, Math.max(3, num(url.searchParams.get('meses'), 12)))));
  }

  // Todo el estado administrativo de una
  if (seccion === 'admin' && m === 'GET') {
    return ok(res, {
      config: { ...db.config, adminSal: undefined, adminHash: undefined },
      edificios: db.edificios,
      apartamentos: db.apartamentos,
      contratos: db.contratos,
      pagos: db.pagos,
      solicitudes: db.solicitudes,
      media: db.media.map((x) => ({ ...x, url: `/api/media/${x.id}` })),
      analitica: calcularAnalitica(12),
    });
  }

  // Configuración del sitio
  if (seccion === 'config' && m === 'PUT') {
    const b = await leerJson(req);
    for (const k of ['nombreSitio', 'lema', 'telefono', 'email', 'moneda', 'localeMoneda']) {
      if (b[k] !== undefined) db.config[k] = texto(b[k], 200);
    }
    if (b.whatsapp !== undefined) db.config.whatsapp = texto(b.whatsapp, 40).replace(/\D/g, '');
    await guardarDb();
    return ok(res, { config: { ...db.config, adminSal: undefined, adminHash: undefined } });
  }

  // Solicitudes (gestión)
  if (seccion === 'solicitudes') {
    if (m === 'GET') return ok(res, db.solicitudes);
    if (m === 'PUT' && recurso) {
      const b = await leerJson(req);
      const s = db.solicitudes.find((x) => x.id === recurso);
      if (!s) return error(res, 404, 'No existe');
      if (['nueva', 'contactada', 'visita', 'cerrada', 'descartada'].includes(b.estado)) s.estado = b.estado;
      if (b.notas !== undefined) s.notas = texto(b.notas, 1000);
      await guardarDb();
      return ok(res, s);
    }
    if (m === 'DELETE' && recurso) {
      const i = db.solicitudes.findIndex((x) => x.id === recurso);
      if (i < 0) return error(res, 404, 'No existe');
      db.solicitudes.splice(i, 1);
      await guardarDb();
      return ok(res);
    }
  }

  // CRUD genérico
  const col = coleccion[seccion];
  if (col) {
    const arr = col.arr();
    if (m === 'GET') return ok(res, arr);

    if (m === 'POST' && !recurso) {
      const b = await leerJson(req);
      const nuevo = col.sanear(b);
      arr.push(nuevo);
      efectosSecundarios(seccion, nuevo);
      await guardarDb();
      return json(res, 201, nuevo);
    }

    if (m === 'PUT' && recurso) {
      const i = arr.findIndex((x) => x.id === recurso);
      if (i < 0) return error(res, 404, 'No existe');
      const b = await leerJson(req);
      arr[i] = col.sanear({ ...arr[i], ...b }, arr[i]);
      efectosSecundarios(seccion, arr[i]);
      await guardarDb();
      return ok(res, arr[i]);
    }

    if (m === 'DELETE' && recurso) {
      const i = arr.findIndex((x) => x.id === recurso);
      if (i < 0) return error(res, 404, 'No existe');
      const [borrado] = arr.splice(i, 1);
      // Limpieza en cascada
      if (seccion === 'edificios') {
        const aptIds = db.apartamentos.filter((a) => a.edificioId === borrado.id).map((a) => a.id);
        db.apartamentos = db.apartamentos.filter((a) => a.edificioId !== borrado.id);
        const ctIds = db.contratos.filter((c) => aptIds.includes(c.apartamentoId)).map((c) => c.id);
        db.contratos = db.contratos.filter((c) => !aptIds.includes(c.apartamentoId));
        db.pagos = db.pagos.filter((p) => !ctIds.includes(p.contratoId));
      }
      if (seccion === 'apartamentos') {
        const ctIds = db.contratos.filter((c) => c.apartamentoId === borrado.id).map((c) => c.id);
        db.contratos = db.contratos.filter((c) => c.apartamentoId !== borrado.id);
        db.pagos = db.pagos.filter((p) => !ctIds.includes(p.contratoId));
      }
      if (seccion === 'contratos') {
        db.pagos = db.pagos.filter((p) => p.contratoId !== borrado.id);
        const apt = db.apartamentos.find((a) => a.id === borrado.apartamentoId);
        if (apt && apt.estado === 'arrendado') apt.estado = 'disponible';
      }
      await guardarDb();
      return ok(res);
    }
  }

  return error(res, 404, 'Endpoint no encontrado');
}

/** Mantiene coherente el estado del apartamento cuando cambia un contrato. */
function efectosSecundarios(seccion, entidad) {
  if (seccion !== 'contratos') return;
  const apt = db.apartamentos.find((a) => a.id === entidad.apartamentoId);
  if (!apt) return;
  if (entidad.estado === 'activo') apt.estado = 'arrendado';
  else if (apt.estado === 'arrendado') apt.estado = 'disponible';
}

// ---------------------------------------------------------------------------
// Servidor
// ---------------------------------------------------------------------------

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) return await manejarApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return error(res, 405, 'Método no permitido');
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
    if (db.config.claveInicial) {
      console.log('');
      console.log('  Usuario: admin   Contraseña: admin123');
      console.log('  (cámbiala desde Ajustes en el panel)');
    }
    console.log('');
    console.log('  Ctrl+C para detener.');
    console.log('');
  });
});

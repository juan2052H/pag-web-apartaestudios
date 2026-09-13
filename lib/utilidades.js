'use strict';
/**
 * Utilidades puras (sin estado, sin dependencias de otros módulos de lib/):
 * identificadores, fechas/periodos, contraseñas y saneamiento de texto.
 */

const crypto = require('crypto');

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

/**
 * Escapa texto para insertarlo en HTML crudo (texto o atributo). Necesario
 * solo donde el servidor construye HTML por interpolación de strings (la
 * página de unidad, ver servirPaginaUnidad) con datos que un administrador
 * puede editar — sin esto sería una inyección de HTML/script server-side.
 */
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** minúsculas, sin tildes, solo [a-z0-9-], para URLs legibles (/unidad/<id>-<slug>). */
function slugificar(t) {
  return String(t || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

// Únicos mimes aceptados en /api/media: whitelist estricta (nunca la extensión
// que envía el cliente), verificada además contra los primeros bytes reales
// del archivo para que un Content-Type falsificado no baste para colarse.
function firmaCoincide(mime, cabeza) {
  const b = cabeza;
  const empiezaCon = (...bytes) => bytes.every((v, i) => b[i] === v);
  const contieneEnRango = (texto2, desde, hasta) => {
    const buf = Buffer.from(texto2, 'ascii');
    for (let i = desde; i <= hasta && i + buf.length <= b.length; i++) {
      if (b.slice(i, i + buf.length).equals(buf)) return true;
    }
    return false;
  };
  switch (mime) {
    case 'image/png': return empiezaCon(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case 'image/jpeg': return empiezaCon(0xff, 0xd8, 0xff);
    case 'image/gif': return empiezaCon(0x47, 0x49, 0x46, 0x38);
    case 'image/webp': return empiezaCon(0x52, 0x49, 0x46, 0x46) && contieneEnRango('WEBP', 8, 11);
    case 'video/mp4':
    case 'video/quicktime':
    case 'video/x-m4v': return contieneEnRango('ftyp', 4, 8);
    case 'video/webm': return empiezaCon(0x1a, 0x45, 0xdf, 0xa3);
    case 'video/ogg': return empiezaCon(0x4f, 0x67, 0x67, 0x53);
    default: return false;
  }
}

module.exports = {
  id, ahora, hashClave, verificarClave, mesActual, aPeriodo, diasHasta,
  periodosEntre, restarMeses, num, texto, lista, escapeHtml, slugificar,
  firmaCoincide,
};

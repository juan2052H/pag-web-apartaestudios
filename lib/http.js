'use strict';
/**
 * Helpers de respuesta HTTP: cabeceras de seguridad, JSON, compresión y
 * lectura del cuerpo de la petición. Módulo hoja (solo zlib/util de Node).
 */

const zlib = require('zlib');
const { promisify } = require('util');
const gzip = promisify(zlib.gzip);
const brotli = promisify(zlib.brotliCompress);

// Cabeceras de seguridad aplicadas a toda respuesta del servidor.
const CABECERAS_SEGURIDAD = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=(), usb=()',
  'Strict-Transport-Security': 'max-age=15552000',
  'Content-Security-Policy': [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob: https://*.tile.openstreetmap.org",
    "media-src 'self' blob:",
    "style-src 'self' 'unsafe-inline' https://unpkg.com",
    "script-src 'self' https://unpkg.com",
    "connect-src 'self'",
  ].join('; '),
};

/**
 * Comprime un buffer para la respuesta si el cliente lo acepta (br > gzip).
 * Nunca rechaza: ante cualquier fallo de zlib, cae de vuelta al buffer sin
 * comprimir y lo reporta con `codificacion: null` para no anunciar un
 * Content-Encoding que no corresponde a los bytes realmente enviados.
 */
async function comprimirRespuesta(buffer, req) {
  const aceptado = String(req.headers['accept-encoding'] || '');
  const codificacion = /\bbr\b/.test(aceptado) ? 'br' : /\bgzip\b/.test(aceptado) ? 'gzip' : null;
  if (!codificacion) return { cuerpo: buffer, codificacion: null };
  try {
    const cuerpo = codificacion === 'br' ? await brotli(buffer) : await gzip(buffer);
    return { cuerpo, codificacion };
  } catch (e) {
    console.error('Error al comprimir respuesta:', e.message);
    return { cuerpo: buffer, codificacion: null };
  }
}

function json(res, codigo, cuerpo) {
  const data = JSON.stringify(cuerpo);
  res.writeHead(codigo, {
    ...CABECERAS_SEGURIDAD,
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

module.exports = { CABECERAS_SEGURIDAD, comprimirRespuesta, json, ok, error, leerJson };

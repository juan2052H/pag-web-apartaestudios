'use strict';
/**
 * Constantes de configuración: rutas de disco, límites y tablas de MIME.
 * Módulo hoja: no depende de ningún otro módulo de lib/.
 */

const path = require('path');

const PUERTO = Number(process.env.PORT || 3000);
const RAIZ = path.join(__dirname, '..');
const DIR_PUBLICO = path.join(RAIZ, 'public');
// Solo para la suite de pruebas (ver test/): aísla los datos en una carpeta
// temporal para no tocar nunca datos/db.json real. Sin la variable de entorno,
// el comportamiento es exactamente el de siempre.
const DIR_DATOS = process.env.APARTA_DIR_DATOS
  ? path.resolve(process.env.APARTA_DIR_DATOS)
  : path.join(RAIZ, 'datos');
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

module.exports = {
  PUERTO, RAIZ, DIR_PUBLICO, DIR_DATOS, DIR_SUBIDAS, ARCHIVO_DB,
  LIMITE_SUBIDA, LIMITE_ADJUNTO_INQUILINO, DURACION_SESION,
  MAX_INTENTOS_LOGIN, BLOQUEO_LOGIN_MS, MIMES, EXT_POR_MIME,
};

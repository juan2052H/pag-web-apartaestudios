'use strict';
/**
 * Códigos de recuperación de contraseña (administradores e inquilinos), en
 * memoria — mismo patrón que las sesiones/intentos de login de
 * lib/sesiones.js. Se guarda solo un hash sha256 del código, nunca el texto
 * plano: a diferencia de una contraseña de largo plazo, un código de un solo
 * uso que expira en minutos no necesita un hash lento tipo scrypt (esa
 * lentitud existe para resistir fuerza bruta offline sobre un volcado
 * robado; aquí ya lo protegen la expiración y el límite de intentos).
 */

const crypto = require('crypto');

const EXPIRA_MS = 15 * 60 * 1000;
const MAX_INTENTOS = 5;

const codigos = new Map(); // clave ("admin:<id>" | "inquilino:<contratoId>") -> { hash, expira, intentos }

const hashCodigo = (codigo) => crypto.createHash('sha256').update(String(codigo)).digest('hex');

/** Genera y guarda un código nuevo para `clave`, reemplazando cualquiera anterior. */
function generarCodigo(clave) {
  const codigo = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  codigos.set(clave, { hash: hashCodigo(codigo), expira: Date.now() + EXPIRA_MS, intentos: 0 });
  return codigo;
}

/** true si `codigo` es válido para `clave`. Consume el código si acierta; cuenta el intento si falla. */
function verificarCodigo(clave, codigo) {
  const registro = codigos.get(clave);
  if (!registro) return false;
  if (registro.expira < Date.now()) { codigos.delete(clave); return false; }
  if (hashCodigo(codigo) !== registro.hash) {
    registro.intentos++;
    if (registro.intentos >= MAX_INTENTOS) codigos.delete(clave);
    return false;
  }
  codigos.delete(clave);
  return true;
}

setInterval(() => {
  const t = Date.now();
  for (const [k, v] of codigos) if (v.expira < t) codigos.delete(k);
}, 15 * 60 * 1000).unref();

module.exports = { generarCodigo, verificarCodigo };

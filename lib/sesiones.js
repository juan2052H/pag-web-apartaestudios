'use strict';
/**
 * Sesiones de administrador/inquilino, límite de intentos de login y rate
 * limiting de formularios públicos. Los `Map` en memoria quedan encapsulados
 * aquí (nadie fuera de este módulo necesita tocarlos directamente).
 */

const crypto = require('crypto');
const { DURACION_SESION, MAX_INTENTOS_LOGIN, BLOQUEO_LOGIN_MS } = require('./config');
const { texto } = require('./utilidades');
const { obtenerDb } = require('./db');

const sesiones = new Map(); // token -> { administradorId, expira }
const sesionesInquilino = new Map(); // token -> { contratoId, expira }
const intentosLogin = new Map(); // usuario + IP -> { cantidad, bloqueadoHasta, ultimo }
const limitesTasa = new Map(); // clave -> { cantidad, ventanaInicio }

/** Ventana fija simple: true si `clave` ya superó `maxPorVentana` peticiones en `ventanaMs`. */
function limiteExcedido(clave, maxPorVentana, ventanaMs) {
  const t = Date.now();
  const r = limitesTasa.get(clave);
  if (!r || t - r.ventanaInicio > ventanaMs) {
    limitesTasa.set(clave, { cantidad: 1, ventanaInicio: t });
    return false;
  }
  r.cantidad++;
  return r.cantidad > maxPorVentana;
}

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

function limpiarIntentosLogin(clave) {
  intentosLogin.delete(clave);
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
  const db = obtenerDb();
  return db.administradores.find((x) => x.id === idAdmin);
}

/** Token Bearer del header Authorization, o null si no viene. */
function tokenDeAuth(req) {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

/** Crea un token en `mapa` con los datos dados más su expiración. */
function crearToken(mapa, datos) {
  const token = crypto.randomBytes(32).toString('hex');
  mapa.set(token, { ...datos, expira: Date.now() + DURACION_SESION });
  return token;
}

function crearSesion(admin) {
  return crearToken(sesiones, { administradorId: admin.id });
}

function sesionDe(req) {
  const token = tokenDeAuth(req);
  if (!token) return null;
  const s = sesiones.get(token);
  if (!s) return null;
  if (s.expira < Date.now()) { sesiones.delete(token); return null; }
  const admin = administradorPorId(s.administradorId);
  if (!admin || !admin.activo) { sesiones.delete(token); return null; }
  s.expira = Date.now() + DURACION_SESION;
  return { token, ...perfilAdministrador(admin), expira: s.expira };
}

function cerrarSesion(token) {
  if (token) sesiones.delete(token);
}

/**
 * Borra las sesiones activas de un administrador (por ejemplo, al cambiar su
 * contraseña o al eliminar la cuenta). `exceptoToken` permite conservar la
 * sesión que originó la acción (el panel sigue abierto tras cambiar la clave).
 */
function invalidarSesionesDeAdministrador(administradorId, exceptoToken = null) {
  for (const [tok, ses] of sesiones) {
    if (ses.administradorId === administradorId && tok !== exceptoToken) sesiones.delete(tok);
  }
}

function crearSesionInquilino(contratoId) {
  return crearToken(sesionesInquilino, { contratoId });
}

function sesionInquilinoDe(req) {
  const token = tokenDeAuth(req);
  if (!token) return null;
  const s = sesionesInquilino.get(token);
  if (!s) return null;
  if (s.expira < Date.now()) { sesionesInquilino.delete(token); return null; }
  s.expira = Date.now() + DURACION_SESION;
  return { token, ...s };
}

function cerrarSesionInquilino(token) {
  if (token) sesionesInquilino.delete(token);
}

/** Al eliminar un contrato, su sesión de inquilino (si estaba abierta) ya no debe seguir viva. */
function invalidarSesionInquilinoDeContrato(contratoId) {
  for (const [token, s] of sesionesInquilino) {
    if (s.contratoId === contratoId) sesionesInquilino.delete(token);
  }
}

setInterval(() => {
  const t = Date.now();
  for (const [k, v] of sesiones) if (v.expira < t) sesiones.delete(k);
  for (const [k, v] of sesionesInquilino) if (v.expira < t) sesionesInquilino.delete(k);
  for (const [k, v] of intentosLogin) if (v.ultimo < t - BLOQUEO_LOGIN_MS) intentosLogin.delete(k);
  for (const [k, v] of limitesTasa) if (t - v.ventanaInicio > 30 * 60 * 1000) limitesTasa.delete(k);
}, 15 * 60 * 1000).unref();

module.exports = {
  limiteExcedido, claveIntentosLogin, bloqueoActivoLogin, registrarFalloLogin,
  limpiarIntentosLogin, perfilAdministrador, vistaAdministrador, administradorPorId,
  crearSesion, sesionDe, cerrarSesion, invalidarSesionesDeAdministrador,
  crearSesionInquilino, sesionInquilinoDe, cerrarSesionInquilino,
  invalidarSesionInquilinoDeContrato,
};

'use strict';
/** Control de acceso multi-edificio y bitácora de auditoría. */

const { obtenerDb } = require('./db');
const { id, ahora, texto } = require('./utilidades');

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
  const db = obtenerDb();
  const apt = contrato && db.apartamentos.find((a) => a.id === contrato.apartamentoId);
  return apartamentoPermitido(sesion, apt);
}

function pagoPermitido(sesion, pago) {
  const db = obtenerDb();
  const contrato = pago && db.contratos.find((c) => c.id === pago.contratoId);
  return contratoPermitido(sesion, contrato);
}

function solicitudPermitida(sesion, solicitud) {
  const db = obtenerDb();
  const apt = solicitud && db.apartamentos.find((a) => a.id === solicitud.apartamentoId);
  return apartamentoPermitido(sesion, apt);
}

function mensajePermitido(sesion, mensaje) {
  const db = obtenerDb();
  const contrato = mensaje && db.contratos.find((c) => c.id === mensaje.contratoId);
  return contratoPermitido(sesion, contrato);
}

/** Bitácora acotada para el propietario: no guarda contraseñas ni textos sensibles. */
function registrarAuditoria(sesion, accion, detalle = '', edificioId = '') {
  const db = obtenerDb();
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
  const db = obtenerDb();
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
  const db = obtenerDb();
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
  const db = obtenerDb();
  const referencias = seccion === 'apartamentos'
    ? [registro.videoId, registro.portadaId, ...(registro.fotos || [])]
    : seccion === 'edificios'
      ? [registro.fotoId, registro.encargado?.fotoId]
      : [];
  return referencias.filter(Boolean).every((idMedio) =>
    medioPermitido(sesion, db.media.find((m) => m.id === idMedio)));
}

module.exports = {
  esPrincipal, puedeGestionarEdificio, apartamentoPermitido, contratoPermitido,
  pagoPermitido, solicitudPermitida, mensajePermitido, registrarAuditoria,
  registroPermitido, edificiosQueUsanMedio, medioPermitido,
  medioUsadoFueraDeAlcance, mediosPermitidosEnRegistro,
};

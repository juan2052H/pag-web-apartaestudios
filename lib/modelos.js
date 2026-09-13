'use strict';
/** Saneamiento y validación de las entidades de negocio. */

const { obtenerDb } = require('./db');
const { id, ahora, num, texto, lista, aPeriodo, mesActual } = require('./utilidades');

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

function validarContrato(c, excluirId = '') {
  const db = obtenerDb();
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

function documentoNormalizado(valor) {
  return texto(valor, 80).replace(/[\s.\-]/g, '').toLowerCase();
}

// Una unidad arrendada nunca debe ser visible públicamente (ni en el catálogo,
// ni con página propia, ni en el sitemap); una en mantenimiento solo si además
// está destacada. Centralizado aquí para que las tres rutas usen la misma regla.
function apartamentoVisiblePublico(a) {
  return a.estado !== 'arrendado' && (a.estado !== 'mantenimiento' || a.destacado);
}

module.exports = {
  ESTADOS_APT, sanearEdificio, sanearApartamento, sanearContrato, sanearPago,
  validarContrato, documentoNormalizado, apartamentoVisiblePublico,
};

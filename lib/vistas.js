'use strict';
/** Formas de los datos que ve cada tipo de usuario (público, admin, inquilino). */

const { obtenerDb } = require('./db');
const { num, texto, mesActual } = require('./utilidades');
const { apartamentoVisiblePublico } = require('./modelos');
const { esPrincipal, puedeGestionarEdificio, medioPermitido } = require('./permisos');
const { perfilAdministrador, vistaAdministrador } = require('./sesiones');
const { calcularAnalitica } = require('./analitica');

function vistaConfigAdmin() {
  const db = obtenerDb();
  const { adminUsuario, adminSal, adminHash, claveInicial, ...config } = db.config;
  return config;
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

function vistaAdmin(sesion) {
  const db = obtenerDb();
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

/** Datos que ve cualquier visitante (sin información sensible). */
function vistaPublica() {
  const db = obtenerDb();
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
    apartamentos: db.apartamentos.filter(apartamentoVisiblePublico).map((a) => ({ ...a })),
  };
}

function vistaPortalInquilino(c) {
  const db = obtenerDb();
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

module.exports = {
  vistaConfigAdmin, vistaContratoAdmin, vistaAdmin, vistaPublica, vistaPortalInquilino,
};

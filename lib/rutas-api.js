'use strict';
/**
 * Enrutador de la API (/api/...). Movido tal cual desde el server.js
 * monolítico: mismo orden de `if`, misma cascada de validaciones y permisos.
 * No se reparte por recurso a propósito (granularidad "moderada" acordada) —
 * es el único módulo que conoce el árbol completo de rutas.
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const { DIR_SUBIDAS, LIMITE_ADJUNTO_INQUILINO, EXT_POR_MIME } = require('./config');
const { obtenerDb, guardarDb } = require('./db');
const {
  id, ahora, texto, num, hashClave, verificarClave, diasHasta, mesActual, firmaCoincide,
} = require('./utilidades');
const {
  sanearEdificio, sanearApartamento, sanearContrato, sanearPago,
  validarContrato, documentoNormalizado,
} = require('./modelos');
const {
  esPrincipal, puedeGestionarEdificio, contratoPermitido, solicitudPermitida,
  mensajePermitido, registrarAuditoria, registroPermitido, medioPermitido,
  medioUsadoFueraDeAlcance, mediosPermitidosEnRegistro,
} = require('./permisos');
const {
  sesionDe, sesionInquilinoDe, crearSesion, crearSesionInquilino,
  perfilAdministrador, vistaAdministrador, administradorPorId,
  claveIntentosLogin, bloqueoActivoLogin, registrarFalloLogin, limpiarIntentosLogin,
  cerrarSesion, cerrarSesionInquilino, invalidarSesionesDeAdministrador,
  invalidarSesionInquilinoDeContrato, limiteExcedido,
} = require('./sesiones');
const {
  vistaPublica, vistaAdmin, vistaConfigAdmin, vistaContratoAdmin, vistaPortalInquilino,
} = require('./vistas');
const { calcularAnalitica, contratoActivoEn } = require('./analitica');
const { servirMedia, recibirArchivo } = require('./estaticos');
const { ok, error, json, leerJson } = require('./http');

const coleccion = {
  edificios: { arr: () => obtenerDb().edificios, sanear: sanearEdificio },
  apartamentos: { arr: () => obtenerDb().apartamentos, sanear: sanearApartamento },
  contratos: { arr: () => obtenerDb().contratos, sanear: sanearContrato },
  pagos: { arr: () => obtenerDb().pagos, sanear: sanearPago },
};

async function manejarApi(req, res, url) {
  const db = obtenerDb();
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
    if (limiteExcedido(`solicitud|${texto(req.socket?.remoteAddress, 80)}`, 5, 10 * 60 * 1000)) {
      return error(res, 429, 'Demasiadas solicitudes seguidas. Intenta de nuevo en unos minutos.');
    }
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
      limpiarIntentosLogin(claveIntento);
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
      if (s) cerrarSesionInquilino(s.token);
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
        const tam = await recibirArchivo(req, res, path.join(DIR_SUBIDAS, archivo), {
          limite: LIMITE_ADJUNTO_INQUILINO,
          mensajeLimite: 'La imagen supera el límite de 10 MB.',
          validarFirma: (cabeza) => firmaCoincide(mime, cabeza),
        });
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
      if (limiteExcedido(`mensaje-inquilino|${c.id}`, 10, 10 * 60 * 1000)) {
        return error(res, 429, 'Demasiados mensajes seguidos. Intenta de nuevo en unos minutos.');
      }
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
      limpiarIntentosLogin(claveIntento);
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
      if (s) cerrarSesion(s.token);
      return ok(res);
    }
    if (recurso === 'clave' && m === 'POST') {
      if (!s) return error(res, 401, 'No autorizado');
      const b = await leerJson(req);
      const admin = administradorPorId(s.id);
      if (!admin || !verificarClave(b.actual || '', admin.sal, admin.hash)) {
        return error(res, 400, 'La contraseña actual no coincide.');
      }
      if (String(b.nueva || '').length < 8) return error(res, 400, 'La nueva contraseña debe tener al menos 8 caracteres.');
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
      // Si el token quedó comprometido, cambiar la clave debe revocarlo. Se
      // conserva solo la sesión que hizo el cambio (el panel sigue abierto).
      invalidarSesionesDeAdministrador(admin.id, s.token);
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
      if (clave.length < 8) return error(res, 400, 'La clave debe tener al menos 8 caracteres.');
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
      if (b.clave && String(b.clave).length < 8) return error(res, 400, 'La clave debe tener al menos 8 caracteres.');
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
      invalidarSesionesDeAdministrador(admin.id);
      await guardarDb();
      return ok(res);
    }
  }

  // Subida de archivos: el cuerpo crudo es el archivo.
  // Whitelist estricta (solo los mimes de EXT_POR_MIME): rechaza de raíz
  // cualquier otro tipo, incluido image/svg+xml (puede ejecutar script si se
  // abre directamente) y evita que la extensión salga del nombre de archivo
  // que envía el cliente.
  if (seccion === 'media' && m === 'POST') {
    const mime = texto(req.headers['content-type'], 100).toLowerCase();
    let nombre = 'archivo';
    try { nombre = Buffer.from(texto(req.headers['x-nombre'], 600), 'base64').toString('utf8') || 'archivo'; } catch {}
    const ext = EXT_POR_MIME[mime];
    if (!ext) return error(res, 415, 'Solo se aceptan imágenes (PNG/JPG/WEBP/GIF) o videos (MP4/WEBM/MOV/M4V/OGG).');
    const tipo = mime.startsWith('video/') ? 'video' : 'imagen';

    const mid = id();
    const archivo = mid + ext;
    try {
      const tam = await recibirArchivo(req, res, path.join(DIR_SUBIDAS, archivo), {
        validarFirma: (cabeza) => firmaCoincide(mime, cabeza),
      });
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
    if (String(b.clave || '').length < 8) {
      return error(res, 400, 'La clave del portal debe tener al menos 8 caracteres.');
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
        invalidarSesionInquilinoDeContrato(borrado.id);
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
  const db = obtenerDb();
  if (seccion !== 'contratos') return;
  const ocupadas = new Set(db.contratos
    .filter((c) => c.estado === 'activo')
    .map((c) => c.apartamentoId));
  for (const apt of db.apartamentos) {
    if (ocupadas.has(apt.id)) apt.estado = 'arrendado';
    else if (apt.estado === 'arrendado') apt.estado = 'disponible';
  }
}

module.exports = { manejarApi };

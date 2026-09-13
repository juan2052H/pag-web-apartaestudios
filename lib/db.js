'use strict';
/**
 * Estado de la base de datos (JSON en disco) y su ciclo de vida.
 *
 * `db` es privado a este módulo. Cualquier otra función del proyecto que
 * necesite leerla debe llamar a `obtenerDb()` — nunca destructurar `db`
 * directamente de este módulo, porque `cargarDb()` reemplaza la referencia
 * por completo (`db = JSON.parse(...)`) y una destructuración capturaría el
 * valor de un solo momento (casi siempre anterior a la carga real).
 */

const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const { DIR_SUBIDAS, ARCHIVO_DB } = require('./config');
const { id, ahora, hashClave, mesActual, aPeriodo, periodosEntre, restarMeses } = require('./utilidades');

let db = null;
let escribiendo = null;
let pendiente = false;

function obtenerDb() {
  return db;
}

function configPorDefecto() {
  return {
    nombreSitio: 'Vivo Estudios',
    lema: 'Apartaestudios listos para habitar, con video y ubicación real.',
    telefono: '+57 300 000 0000',
    email: 'contacto@vivoestudios.co',
    whatsapp: '573000000000',
    moneda: 'COP',
    localeMoneda: 'es-CO',
  };
}

function dbPorDefecto(credencialInicial) {
  const { sal, hash } = credencialInicial;
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
    version: 2,
    config: configPorDefecto(),
    // El propietario conserva el control total. Los demás administradores se
    // crean desde el panel y solo reciben los edificios que se les asignen.
    administradores: [{
      id: id(), nombre: 'Propietario principal', usuario: 'admin', rol: 'principal',
      edificioIds: [], sal, hash, activo: true, claveInicial: true, creado: ahora(), actualizado: ahora(),
    }],
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
    mensajes: [],
    media: [],
    auditoria: [],
  };
}

async function cargarDb() {
  await fsp.mkdir(DIR_SUBIDAS, { recursive: true });

  // Contraseña inicial del propietario: nunca fija ("admin123"). Se genera una
  // sola vez por arranque, de forma perezosa, y se reutiliza en los distintos
  // puntos que necesiten crear/reparar la cuenta principal.
  let claveGenerada = null;
  const credencialInicial = () => {
    if (!claveGenerada) claveGenerada = crypto.randomBytes(6).toString('base64url');
    return hashClave(claveGenerada);
  };

  try {
    const raw = await fsp.readFile(ARCHIVO_DB, 'utf8');
    db = JSON.parse(raw);
  } catch {
    db = dbPorDefecto(credencialInicial());
    await guardarDb();
    console.log('  · Base de datos creada con datos de ejemplo.');
  }
  let cambio = false;
  // Normaliza colecciones faltantes
  for (const k of ['edificios', 'apartamentos', 'contratos', 'pagos', 'solicitudes', 'mensajes', 'media', 'administradores', 'auditoria']) {
    if (!Array.isArray(db[k])) { db[k] = []; cambio = true; }
  }
  db.config = Object.assign({}, configPorDefecto(), db.config || {});

  // Migración de la cuenta única de versiones anteriores al propietario.
  if (!db.administradores.length) {
    const credencial = db.config.adminSal && db.config.adminHash
      ? { sal: db.config.adminSal, hash: db.config.adminHash }
      : credencialInicial();
    db.administradores.push({
      id: id(), nombre: 'Propietario principal', usuario: db.config.adminUsuario || 'admin',
      rol: 'principal', edificioIds: [], ...credencial, activo: true,
      claveInicial: !!db.config.claveInicial, creado: ahora(), actualizado: ahora(),
    });
    cambio = true;
  }

  const edificiosValidos = new Set(db.edificios.map((e) => e.id));
  for (const admin of db.administradores) {
    if (!admin.id) { admin.id = id(); cambio = true; }
    if (!admin.nombre) { admin.nombre = admin.rol === 'principal' ? 'Propietario principal' : 'Administrador'; cambio = true; }
    if (!admin.usuario) { admin.usuario = `admin-${admin.id.slice(0, 6)}`; cambio = true; }
    if (!admin.sal || !admin.hash) {
      const credencial = credencialInicial();
      admin.sal = credencial.sal; admin.hash = credencial.hash; admin.claveInicial = true; cambio = true;
    }
    if (admin.rol !== 'principal' && admin.rol !== 'edificio') { admin.rol = 'edificio'; cambio = true; }
    const asignados = [...new Set((Array.isArray(admin.edificioIds) ? admin.edificioIds : []).filter((x) => edificiosValidos.has(x)))];
    if (JSON.stringify(asignados) !== JSON.stringify(admin.edificioIds || [])) { admin.edificioIds = asignados; cambio = true; }
    if (admin.activo === undefined) { admin.activo = true; cambio = true; }
    // Necesario para la recuperación de contraseña por correo; los admins
    // creados antes de esa función simplemente quedan sin correo hasta que
    // alguien se los agregue.
    if (typeof admin.email !== 'string') { admin.email = ''; cambio = true; }
  }
  if (!db.administradores.some((x) => x.rol === 'principal')) {
    const credencial = credencialInicial();
    db.administradores.unshift({
      id: id(), nombre: 'Propietario principal', usuario: 'admin', rol: 'principal', edificioIds: [],
      ...credencial, activo: true, claveInicial: true, creado: ahora(), actualizado: ahora(),
    });
    cambio = true;
  }
  // Ya migradas, las credenciales antiguas no permanecen dentro de config.
  for (const k of ['adminUsuario', 'adminSal', 'adminHash', 'claveInicial']) {
    if (Object.prototype.hasOwnProperty.call(db.config, k)) { delete db.config[k]; cambio = true; }
  }
  if (cambio) await guardarDb();

  if (claveGenerada) {
    const propietario = db.administradores.find((x) => x.rol === 'principal');
    console.log('');
    console.log('  ⚠ Se generó una contraseña inicial para la cuenta de propietario:');
    console.log(`    usuario: ${propietario?.usuario || 'admin'}   contraseña: ${claveGenerada}`);
    console.log('  Guárdala ahora — no volverá a mostrarse. Cámbiala en el panel (Ajustes → Seguridad).');
    console.log('');
  }
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

module.exports = { obtenerDb, cargarDb, guardarDb };

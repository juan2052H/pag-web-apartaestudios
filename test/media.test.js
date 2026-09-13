'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciar } = require('./ayudantes/servidor');

let s;
let token;

// PNG real de 1x1 píxel (bytes correctos, incluida la firma).
const PNG_1X1 = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415478' +
  '9c63f8cfc0000000030001a8dba9e00000000049454e44ae426082',
  'hex',
);
const SVG_MALICIOSO = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>', 'utf8');

before(async () => {
  s = await iniciar();
  const login = await s.api('POST', '/api/auth/login', { body: { usuario: 'admin', clave: s.claveInicial } });
  token = login.body.token;
});
after(() => { if (s) s.cerrar(); });

test('rechaza image/svg+xml de raíz (whitelist de mimes)', async () => {
  const r = await s.subir('/api/media', { token, mime: 'image/svg+xml', buffer: SVG_MALICIOSO, nombre: 'evil.svg' });
  assert.equal(r.status, 415);
});

test('acepta un PNG real cuyos bytes coinciden con el mime declarado', async () => {
  const r = await s.subir('/api/media', { token, mime: 'image/png', buffer: PNG_1X1, nombre: 'real.png' });
  assert.equal(r.status, 201);
  assert.equal(r.body.mime, 'image/png');
  assert.equal(r.body.tipo, 'imagen');
});

test('rechaza un Content-Type falsificado (dice PNG, el contenido es otra cosa)', async () => {
  let fallo = null;
  let respuesta = null;
  try {
    respuesta = await s.subir('/api/media', { token, mime: 'image/png', buffer: SVG_MALICIOSO, nombre: 'fake.png' });
  } catch (e) {
    fallo = e; // el servidor corta la conexión al detectar la firma incorrecta: fetch puede lanzar en vez de responder.
  }
  if (respuesta) assert.notEqual(respuesta.status, 201, 'no debió aceptarse un archivo con firma falsa');
  else assert.ok(fallo, 'se esperaba que la conexión se cortara o la subida fuera rechazada');

  // Verificación fuerte: pase lo que pase con la respuesta HTTP, no debe haber
  // quedado un registro de medios con ese contenido falso aceptado.
  const lista = await s.api('GET', '/api/media', { token });
  assert.ok(!lista.body.some((m) => m.nombre === 'fake.png'), 'no debe existir un registro para el archivo falsificado');
});

test('subir un archivo sin sesión no está permitido', async () => {
  const r = await s.subir('/api/media', { mime: 'image/png', buffer: PNG_1X1, nombre: 'sin-sesion.png' });
  assert.equal(r.status, 401);
});

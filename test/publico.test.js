'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciar } = require('./ayudantes/servidor');

let s;
let token;
let unidadDisponible;
let unidadArrendada;

before(async () => {
  s = await iniciar();
  const login = await s.api('POST', '/api/auth/login', { body: { usuario: 'admin', clave: s.claveInicial } });
  token = login.body.token;

  const ed = await s.api('POST', '/api/edificios', { token, body: { nombre: 'Edificio Público', direccion: 'Calle 1', ciudad: 'Test' } });

  const aptDisp = await s.api('POST', '/api/apartamentos', {
    token, body: { edificioId: ed.body.id, numero: '1', titulo: 'Unidad disponible', precio: 800000, estado: 'disponible' },
  });
  unidadDisponible = aptDisp.body;

  const aptArr = await s.api('POST', '/api/apartamentos', {
    token, body: { edificioId: ed.body.id, numero: '2', titulo: 'Unidad arrendada', precio: 800000, estado: 'disponible' },
  });
  await s.api('POST', '/api/contratos', {
    token,
    body: { apartamentoId: aptArr.body.id, inquilino: { nombre: 'X' }, inicio: '2026-01-01', canon: 800000, estado: 'activo' },
  });
  const lista = await s.api('GET', '/api/apartamentos', { token });
  unidadArrendada = lista.body.find((a) => a.id === aptArr.body.id);
  assert.equal(unidadArrendada.estado, 'arrendado', 'precondición: debe quedar arrendada tras el contrato activo');
});
after(() => { if (s) s.cerrar(); });

test('/api/publico solo muestra unidades disponibles, nunca las arrendadas', async () => {
  const r = await s.api('GET', '/api/publico');
  assert.equal(r.status, 200);
  const ids = r.body.apartamentos.map((a) => a.id);
  assert.ok(ids.includes(unidadDisponible.id));
  assert.ok(!ids.includes(unidadArrendada.id));
});

test('/unidad/<id> responde 200 para una unidad visible, con su propio <title>', async () => {
  const r = await s.api('GET', `/unidad/${unidadDisponible.id}-cualquier-slug`);
  assert.equal(r.status, 200);
  assert.match(r.texto, /<title>Unidad disponible/);
  assert.match(r.texto, /"@type":"RealEstateListing"/);
});

test('/unidad/<id> responde 404 para una unidad arrendada (no debe revelar que existe)', async () => {
  const r = await s.api('GET', `/unidad/${unidadArrendada.id}`);
  assert.equal(r.status, 404);
});

test('/unidad/<id> ignora el slug, solo importa el id', async () => {
  const r = await s.api('GET', `/unidad/${unidadDisponible.id}-un-slug-totalmente-distinto`);
  assert.equal(r.status, 200);
});

test('sitemap.xml incluye la unidad visible y omite la arrendada', async () => {
  const r = await s.api('GET', '/sitemap.xml');
  assert.equal(r.status, 200);
  assert.ok(r.texto.includes(unidadDisponible.id));
  assert.ok(!r.texto.includes(unidadArrendada.id));
});

test('una solicitud sin consentimiento se rechaza', async () => {
  const r = await s.api('POST', '/api/solicitudes', {
    body: { nombre: 'Sin Consentimiento', telefono: '3000000001', consentimiento: false },
  });
  assert.equal(r.status, 400);
});

// Último a propósito: agota el límite de tasa, así que ninguna otra prueba de
// este archivo debe enviar solicitudes después de esta. El conteo exacto de
// cuántas se permiten depende de otras pruebas de este archivo que ya
// consumieron cupo (el límite es por IP, compartido en toda la suite), así
// que se verifica el patrón (201... y luego 429 de forma permanente) en vez
// de un número fijo.
test('el formulario público de solicitudes tiene rate limiting', async () => {
  const cuerpo = { nombre: 'Prueba RL', telefono: '3000000000', consentimiento: true };
  const respuestas = [];
  for (let i = 0; i < 8; i++) {
    respuestas.push((await s.api('POST', '/api/solicitudes', { body: cuerpo })).status);
  }
  const primerBloqueo = respuestas.indexOf(429);
  assert.ok(primerBloqueo > 0, 'debe haber al menos una solicitud aceptada antes de bloquear');
  assert.ok(respuestas.slice(0, primerBloqueo).every((c) => c === 201), 'todo antes del bloqueo debe ser 201');
  assert.ok(respuestas.slice(primerBloqueo).every((c) => c === 429), 'una vez bloqueado, se mantiene bloqueado');
});

'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciar } = require('./ayudantes/servidor');

let s;
let tokenPrincipal;
let edificioA;
let edificioB;
let tokenAdminA;

before(async () => {
  s = await iniciar();
  const login = await s.api('POST', '/api/auth/login', { body: { usuario: 'admin', clave: s.claveInicial } });
  tokenPrincipal = login.body.token;

  const ra = await s.api('POST', '/api/edificios', { token: tokenPrincipal, body: { nombre: 'Edificio A' } });
  const rb = await s.api('POST', '/api/edificios', { token: tokenPrincipal, body: { nombre: 'Edificio B' } });
  edificioA = ra.body;
  edificioB = rb.body;

  const nuevoAdmin = await s.api('POST', '/api/administradores', {
    token: tokenPrincipal,
    body: { nombre: 'Admin A', usuario: 'admin-a', clave: 'claveAdminA1', edificioIds: [edificioA.id] },
  });
  assert.equal(nuevoAdmin.status, 201);

  const loginA = await s.api('POST', '/api/auth/login', { body: { usuario: 'admin-a', clave: 'claveAdminA1' } });
  tokenAdminA = loginA.body.token;
});
after(() => { if (s) s.cerrar(); });

test('un administrador de edificio solo ve los edificios que se le asignaron', async () => {
  const r = await s.api('GET', '/api/edificios', { token: tokenAdminA });
  assert.equal(r.status, 200);
  const ids = r.body.map((e) => e.id);
  assert.ok(ids.includes(edificioA.id));
  assert.ok(!ids.includes(edificioB.id), 'no debe ver el edificio B');
});

test('un administrador de edificio no puede crear edificios', async () => {
  const r = await s.api('POST', '/api/edificios', { token: tokenAdminA, body: { nombre: 'Otro' } });
  assert.equal(r.status, 403);
});

test('un administrador de edificio no puede eliminar edificios', async () => {
  const r = await s.api('DELETE', `/api/edificios/${edificioA.id}`, { token: tokenAdminA });
  assert.equal(r.status, 403);
});

test('un administrador de edificio no puede crear un apartamento en un edificio ajeno', async () => {
  const r = await s.api('POST', '/api/apartamentos', {
    token: tokenAdminA,
    body: { edificioId: edificioB.id, numero: '1', precio: 100000, estado: 'disponible' },
  });
  assert.equal(r.status, 403);
});

test('un administrador de edificio sí puede crear un apartamento en su propio edificio', async () => {
  const r = await s.api('POST', '/api/apartamentos', {
    token: tokenAdminA,
    body: { edificioId: edificioA.id, numero: '1', precio: 100000, estado: 'disponible' },
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.edificioId, edificioA.id);
});

test('un administrador de edificio no puede gestionar la lista de administradores', async () => {
  const r = await s.api('GET', '/api/administradores', { token: tokenAdminA });
  assert.equal(r.status, 403);
});

test('el propietario principal ve ambos edificios y puede crear administradores', async () => {
  const r = await s.api('GET', '/api/edificios', { token: tokenPrincipal });
  const ids = r.body.map((e) => e.id);
  assert.ok(ids.includes(edificioA.id) && ids.includes(edificioB.id));
});

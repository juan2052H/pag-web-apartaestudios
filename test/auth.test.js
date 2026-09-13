'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciar } = require('./ayudantes/servidor');

let s;
before(async () => { s = await iniciar(); });
after(() => { if (s) s.cerrar(); });

test('login con la contraseña generada al arranque funciona', async () => {
  const r = await s.api('POST', '/api/auth/login', { body: { usuario: 'admin', clave: s.claveInicial } });
  assert.equal(r.status, 200);
  assert.ok(r.body.token);
  assert.equal(r.body.rol, 'principal');
  assert.equal(r.body.claveInicial, true);
});

test('login con contraseña incorrecta -> 401, sin filtrar si el usuario existe', async () => {
  const r1 = await s.api('POST', '/api/auth/login', { body: { usuario: 'admin', clave: 'incorrecta' } });
  const r2 = await s.api('POST', '/api/auth/login', { body: { usuario: 'no-existe', clave: 'incorrecta' } });
  assert.equal(r1.status, 401);
  assert.equal(r2.status, 401);
  assert.equal(r1.body.error, r2.body.error, 'el mensaje debe ser igual, exista o no el usuario');
});

test('5 intentos fallidos bloquean el login (429) por 15 minutos', async () => {
  const usuario = `bloqueo-${Date.now()}`;
  for (let i = 0; i < 5; i++) {
    const r = await s.api('POST', '/api/auth/login', { body: { usuario, clave: 'mal' } });
    assert.equal(r.status, 401);
  }
  const r = await s.api('POST', '/api/auth/login', { body: { usuario, clave: 'mal' } });
  assert.equal(r.status, 429);
});

test('/api/auth/sesion exige token válido', async () => {
  const sinToken = await s.api('GET', '/api/auth/sesion');
  assert.equal(sinToken.status, 401);

  const login = await s.api('POST', '/api/auth/login', { body: { usuario: 'admin', clave: s.claveInicial } });
  const conToken = await s.api('GET', '/api/auth/sesion', { token: login.body.token });
  assert.equal(conToken.status, 200);
  assert.equal(conToken.body.usuario, 'admin');
});

test('cambiar la contraseña exige mínimo 8 caracteres', async () => {
  const login = await s.api('POST', '/api/auth/login', { body: { usuario: 'admin', clave: s.claveInicial } });
  const r = await s.api('POST', '/api/auth/clave', {
    token: login.body.token,
    body: { usuario: 'admin', actual: s.claveInicial, nueva: 'corta1' },
  });
  assert.equal(r.status, 400);
});

test('cambiar la contraseña invalida las demás sesiones, pero no la que hizo el cambio', async () => {
  const loginA = await s.api('POST', '/api/auth/login', { body: { usuario: 'admin', clave: s.claveInicial } });
  const loginB = await s.api('POST', '/api/auth/login', { body: { usuario: 'admin', clave: s.claveInicial } });
  const tokenA = loginA.body.token;
  const tokenB = loginB.body.token;

  const cambio = await s.api('POST', '/api/auth/clave', {
    token: tokenA,
    body: { usuario: 'admin', actual: s.claveInicial, nueva: 'nuevaClave123' },
  });
  assert.equal(cambio.status, 200);

  const sesionA = await s.api('GET', '/api/auth/sesion', { token: tokenA });
  const sesionB = await s.api('GET', '/api/auth/sesion', { token: tokenB });
  assert.equal(sesionA.status, 200, 'la sesión que cambió la clave sigue viva');
  assert.equal(sesionB.status, 401, 'la otra sesión quedó invalidada');

  // Deja la cuenta lista para el resto de los tests de este archivo.
  await s.api('POST', '/api/auth/clave', {
    token: tokenA,
    body: { usuario: 'admin', actual: 'nuevaClave123', nueva: s.claveInicial },
  });
});

test('logout invalida el token', async () => {
  const login = await s.api('POST', '/api/auth/login', { body: { usuario: 'admin', clave: s.claveInicial } });
  const token = login.body.token;
  const logout = await s.api('POST', '/api/auth/logout', { token });
  assert.equal(logout.status, 200);
  const sesion = await s.api('GET', '/api/auth/sesion', { token });
  assert.equal(sesion.status, 401);
});

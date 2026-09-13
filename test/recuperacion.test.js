'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciar } = require('./ayudantes/servidor');

let s;
let tokenPrincipal;

before(async () => {
  s = await iniciar();
  const login = await s.api('POST', '/api/auth/login', { body: { usuario: 'admin', clave: s.claveInicial } });
  tokenPrincipal = login.body.token;
});
after(() => { if (s) s.cerrar(); });

test('pedir recuperación responde igual para un usuario que existe y uno que no (no-enumeración)', async () => {
  const existe = await s.api('POST', '/api/auth/recuperar', { body: { usuario: 'admin' } });
  const noExiste = await s.api('POST', '/api/auth/recuperar', { body: { usuario: 'no-existe-nadie' } });
  assert.equal(existe.status, 200);
  assert.equal(noExiste.status, 200);
  assert.equal(existe.body.mensaje, noExiste.body.mensaje);
});

test('flujo completo de recuperación de un administrador de edificio', async () => {
  const ed = await s.api('POST', '/api/edificios', { token: tokenPrincipal, body: { nombre: 'Edificio Recuperación' } });
  const nuevo = await s.api('POST', '/api/administradores', {
    token: tokenPrincipal,
    body: {
      nombre: 'Admin Recuperable', usuario: 'admin-recuperable', clave: 'claveOriginal1',
      email: 'admin-recuperable@example.com', edificioIds: [ed.body.id],
    },
  });
  assert.equal(nuevo.status, 201);
  const adminId = nuevo.body.id;

  // Abre dos sesiones antes de recuperar, para confirmar que ambas quedan
  // invalidadas al restablecer la clave (igual que el cambio de clave normal).
  const sesionVieja = await s.api('POST', '/api/auth/login', { body: { usuario: 'admin-recuperable', clave: 'claveOriginal1' } });
  assert.equal(sesionVieja.status, 200);

  const pedido = await s.api('POST', '/api/auth/recuperar', { body: { usuario: 'admin-recuperable' } });
  assert.equal(pedido.status, 200);

  const codigo = s.codigoPara(`admin:${adminId}`);
  assert.ok(codigo, 'el código debió imprimirse en consola (sin Resend configurado)');

  const codigoMalo = await s.api('POST', '/api/auth/recuperar-confirmar', {
    body: { usuario: 'admin-recuperable', codigo: '000000', nueva: 'claveNueva123' },
  });
  assert.equal(codigoMalo.status, 400);

  const confirmar = await s.api('POST', '/api/auth/recuperar-confirmar', {
    body: { usuario: 'admin-recuperable', codigo, nueva: 'claveNueva123' },
  });
  assert.equal(confirmar.status, 200);

  // La sesión abierta antes de recuperar quedó invalidada.
  const sesionViejaTrasReset = await s.api('GET', '/api/auth/sesion', { token: sesionVieja.body.token });
  assert.equal(sesionViejaTrasReset.status, 401);

  // La clave vieja ya no sirve; la nueva sí.
  const conViejaClave = await s.api('POST', '/api/auth/login', { body: { usuario: 'admin-recuperable', clave: 'claveOriginal1' } });
  assert.equal(conViejaClave.status, 401);
  const conNuevaClave = await s.api('POST', '/api/auth/login', { body: { usuario: 'admin-recuperable', clave: 'claveNueva123' } });
  assert.equal(conNuevaClave.status, 200);

  // El código ya consumido no sirve una segunda vez.
  const reuso = await s.api('POST', '/api/auth/recuperar-confirmar', {
    body: { usuario: 'admin-recuperable', codigo, nueva: 'otraClave123' },
  });
  assert.equal(reuso.status, 400);
});

test('un código equivocado 5 veces invalida el código (hay que pedir uno nuevo)', async () => {
  const ed = await s.api('POST', '/api/edificios', { token: tokenPrincipal, body: { nombre: 'Edificio Bloqueo' } });
  await s.api('POST', '/api/administradores', {
    token: tokenPrincipal,
    body: {
      nombre: 'Admin Bloqueo', usuario: 'admin-bloqueo', clave: 'claveOriginal1',
      email: 'admin-bloqueo@example.com', edificioIds: [ed.body.id],
    },
  });
  await s.api('POST', '/api/auth/recuperar', { body: { usuario: 'admin-bloqueo' } });

  for (let i = 0; i < 5; i++) {
    const r = await s.api('POST', '/api/auth/recuperar-confirmar', {
      body: { usuario: 'admin-bloqueo', codigo: '111111', nueva: 'claveNueva123' },
    });
    assert.equal(r.status, 400);
  }
  // El código real ya no debería servir: se invalidó tras los 5 intentos fallidos.
  const admins = await s.api('GET', '/api/administradores', { token: tokenPrincipal });
  const adminId = admins.body.find((a) => a.usuario === 'admin-bloqueo').id;
  const codigoReal = s.codigoPara(`admin:${adminId}`);
  const conCodigoReal = await s.api('POST', '/api/auth/recuperar-confirmar', {
    body: { usuario: 'admin-bloqueo', codigo: codigoReal, nueva: 'claveNueva123' },
  });
  assert.equal(conCodigoReal.status, 400);
});

test('pedir recuperación tiene rate limiting', async () => {
  const usuario = `rl-${Date.now()}`;
  const respuestas = [];
  for (let i = 0; i < 5; i++) {
    respuestas.push((await s.api('POST', '/api/auth/recuperar', { body: { usuario } })).status);
  }
  assert.ok(respuestas.slice(0, 3).every((c) => c === 200));
  assert.ok(respuestas.slice(3).every((c) => c === 429));
});

test('flujo completo de recuperación del portal de un inquilino', async () => {
  const ed = await s.api('POST', '/api/edificios', { token: tokenPrincipal, body: { nombre: 'Edificio Inquilino Rec' } });
  const apt = await s.api('POST', '/api/apartamentos', {
    token: tokenPrincipal, body: { edificioId: ed.body.id, numero: '1', precio: 500000, estado: 'disponible' },
  });
  const contrato = await s.api('POST', '/api/contratos', {
    token: tokenPrincipal,
    body: {
      apartamentoId: apt.body.id,
      inquilino: { nombre: 'Inquilino Recuperable', documento: '999888777', email: 'inquilino-rec@example.com' },
      inicio: '2026-01-01', canon: 500000, estado: 'activo',
    },
  });
  const contratoId = contrato.body.id;
  const activar = await s.api('POST', `/api/contratos/${contratoId}/portal`, {
    token: tokenPrincipal, body: { clave: 'claveOriginalInq1' },
  });
  assert.equal(activar.status, 200);

  const loginViejo = await s.api('POST', '/api/inquilino/login', { body: { documento: '999888777', clave: 'claveOriginalInq1' } });
  assert.equal(loginViejo.status, 200);

  await s.api('POST', '/api/inquilino/recuperar', { body: { documento: '999888777' } });
  const codigo = s.codigoPara(`inquilino:${contratoId}`);
  assert.ok(codigo);

  const confirmar = await s.api('POST', '/api/inquilino/recuperar-confirmar', {
    body: { documento: '999888777', codigo, nueva: 'claveNuevaInq1' },
  });
  assert.equal(confirmar.status, 200);

  const sesionViejaTrasReset = await s.api('GET', '/api/inquilino/sesion', { token: loginViejo.body.token });
  assert.equal(sesionViejaTrasReset.status, 401);

  const conNueva = await s.api('POST', '/api/inquilino/login', { body: { documento: '999888777', clave: 'claveNuevaInq1' } });
  assert.equal(conNueva.status, 200);
});

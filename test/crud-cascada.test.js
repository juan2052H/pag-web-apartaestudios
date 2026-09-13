'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciar } = require('./ayudantes/servidor');

let s;
let token;

before(async () => {
  s = await iniciar();
  const login = await s.api('POST', '/api/auth/login', { body: { usuario: 'admin', clave: s.claveInicial } });
  token = login.body.token;
});
after(() => { if (s) s.cerrar(); });

test('crear un contrato activo marca el apartamento como arrendado (efectosSecundarios)', async () => {
  const ed = await s.api('POST', '/api/edificios', { token, body: { nombre: 'Edificio Cascada' } });
  const apt = await s.api('POST', '/api/apartamentos', {
    token, body: { edificioId: ed.body.id, numero: '101', precio: 900000, estado: 'disponible' },
  });
  assert.equal(apt.body.estado, 'disponible');

  const contrato = await s.api('POST', '/api/contratos', {
    token,
    body: {
      apartamentoId: apt.body.id,
      inquilino: { nombre: 'Inquilino de Prueba' },
      inicio: '2026-01-01',
      canon: 900000,
      estado: 'activo',
    },
  });
  assert.equal(contrato.status, 201);

  const aptTrasContrato = await s.api('GET', '/api/apartamentos', { token });
  const actualizado = aptTrasContrato.body.find((a) => a.id === apt.body.id);
  assert.equal(actualizado.estado, 'arrendado');
});

test('no se puede crear un segundo contrato activo para el mismo apartamento', async () => {
  const ed = await s.api('POST', '/api/edificios', { token, body: { nombre: 'Edificio Único' } });
  const apt = await s.api('POST', '/api/apartamentos', {
    token, body: { edificioId: ed.body.id, numero: '1', precio: 100000, estado: 'disponible' },
  });
  const c1 = await s.api('POST', '/api/contratos', {
    token,
    body: { apartamentoId: apt.body.id, inquilino: { nombre: 'A' }, inicio: '2026-01-01', canon: 100000, estado: 'activo' },
  });
  assert.equal(c1.status, 201);
  const c2 = await s.api('POST', '/api/contratos', {
    token,
    body: { apartamentoId: apt.body.id, inquilino: { nombre: 'B' }, inicio: '2026-02-01', canon: 100000, estado: 'activo' },
  });
  assert.equal(c2.status, 400);
});

test('eliminar un edificio borra en cascada sus apartamentos, contratos y pagos', async () => {
  const ed = await s.api('POST', '/api/edificios', { token, body: { nombre: 'Edificio a Borrar' } });
  const apt = await s.api('POST', '/api/apartamentos', {
    token, body: { edificioId: ed.body.id, numero: '9', precio: 500000, estado: 'disponible' },
  });
  const contrato = await s.api('POST', '/api/contratos', {
    token,
    body: { apartamentoId: apt.body.id, inquilino: { nombre: 'C' }, inicio: '2026-01-01', canon: 500000, estado: 'activo' },
  });
  const pago = await s.api('POST', '/api/pagos', {
    token, body: { contratoId: contrato.body.id, periodo: '2026-01', monto: 500000 },
  });
  assert.equal(pago.status, 201);

  const borrar = await s.api('DELETE', `/api/edificios/${ed.body.id}`, { token });
  assert.equal(borrar.status, 200);

  const apartamentos = await s.api('GET', '/api/apartamentos', { token });
  const contratos = await s.api('GET', '/api/contratos', { token });
  const pagos = await s.api('GET', '/api/pagos', { token });
  assert.ok(!apartamentos.body.some((a) => a.id === apt.body.id), 'el apartamento debió borrarse en cascada');
  assert.ok(!contratos.body.some((c) => c.id === contrato.body.id), 'el contrato debió borrarse en cascada');
  assert.ok(!pagos.body.some((p) => p.id === pago.body.id), 'el pago debió borrarse en cascada');
});

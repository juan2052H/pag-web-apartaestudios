'use strict';
/** KPIs, cartera, vencimientos y ocupación para el panel administrativo. */

const { obtenerDb } = require('./db');
const { num, ahora, mesActual, aPeriodo, diasHasta, periodosEntre, restarMeses } = require('./utilidades');

function contratoActivoEn(c, periodo) {
  if (c.estado === 'cancelado') return false;
  const ini = aPeriodo(c.inicio);
  if (!ini || periodo < ini) return false;
  const fin = aPeriodo(c.fin);
  if (fin && periodo > fin) return false;
  return true;
}

function calcularAnalitica(meses = 12, edificioIds = null) {
  const db = obtenerDb();
  const hoy = mesActual();
  const periodos = periodosEntre(restarMeses(hoy, meses - 1), hoy);
  const idsEdificios = edificioIds ? new Set(edificioIds) : null;
  const edificios = idsEdificios ? db.edificios.filter((e) => idsEdificios.has(e.id)) : db.edificios;
  const apartamentos = idsEdificios ? db.apartamentos.filter((a) => idsEdificios.has(a.edificioId)) : db.apartamentos;
  const idsApartamentos = new Set(apartamentos.map((a) => a.id));
  const activos = db.contratos.filter((c) => c.estado !== 'cancelado' && idsApartamentos.has(c.apartamentoId));
  const idsContratos = new Set(activos.map((c) => c.id));
  const pagos = db.pagos.filter((p) => idsContratos.has(p.contratoId));
  const solicitudes = db.solicitudes.filter((s) => idsApartamentos.has(s.apartamentoId));
  const mensajes = db.mensajes.filter((m) => idsContratos.has(m.contratoId));

  const pagosPorPeriodo = new Map();
  for (const p of pagos) {
    const k = p.periodo;
    pagosPorPeriodo.set(k, (pagosPorPeriodo.get(k) || 0) + num(p.monto));
  }

  const serie = periodos.map((p) => {
    const esperado = activos
      .filter((c) => contratoActivoEn(c, p))
      .reduce((s, c) => s + num(c.canon), 0);
    return { periodo: p, esperado, recaudado: pagosPorPeriodo.get(p) || 0 };
  });

  // Cartera: saldo pendiente por contrato, mes a mes, hasta el mes en curso
  const cartera = [];
  for (const c of activos) {
    const ini = aPeriodo(c.inicio);
    if (!ini) continue;
    const hasta = aPeriodo(c.fin) && aPeriodo(c.fin) < hoy ? aPeriodo(c.fin) : hoy;
    let saldo = 0;
    const mesesDebe = [];
    for (const p of periodosEntre(ini, hasta)) {
      const pagado = pagos
        .filter((x) => x.contratoId === c.id && x.periodo === p)
        .reduce((s, x) => s + num(x.monto), 0);
      const falta = num(c.canon) - pagado;
      if (falta > 0.5) { saldo += falta; mesesDebe.push(p); }
    }
    const apt = apartamentos.find((a) => a.id === c.apartamentoId);
    const ed = apt && edificios.find((e) => e.id === apt.edificioId);
    if (saldo > 0.5) {
      cartera.push({
        contratoId: c.id,
        inquilino: c.inquilino?.nombre || '—',
        telefono: c.inquilino?.telefono || '',
        unidad: apt ? `${ed ? ed.nombre + ' · ' : ''}${apt.numero}` : '—',
        canon: num(c.canon),
        saldo,
        meses: mesesDebe,
        mesesVencidos: mesesDebe.length,
      });
    }
  }
  cartera.sort((a, b) => b.saldo - a.saldo);

  // Contratos que requieren gestión antes de que termine su vigencia.
  const vencimientos = activos
    .filter((c) => c.estado === 'activo' && c.fin)
    .map((c) => {
      const dias = diasHasta(c.fin);
      const apt = apartamentos.find((a) => a.id === c.apartamentoId);
      const ed = apt && edificios.find((e) => e.id === apt.edificioId);
      return {
        contratoId: c.id,
        inquilino: c.inquilino?.nombre || '—',
        unidad: apt ? `${ed ? ed.nombre + ' · ' : ''}${apt.numero}` : '—',
        fin: c.fin,
        dias,
      };
    })
    .filter((x) => x.dias !== null && x.dias >= 0 && x.dias <= 60)
    .sort((a, b) => a.dias - b.dias);

  // Ocupación por edificio
  const porEdificio = edificios.map((e) => {
    const us = apartamentos.filter((a) => a.edificioId === e.id);
    const cuenta = { arrendado: 0, disponible: 0, otro: 0 };
    for (const a of us) {
      if (a.estado === 'arrendado') cuenta.arrendado++;
      else if (a.estado === 'disponible') cuenta.disponible++;
      else cuenta.otro++;
    }
    const ingreso = activos
      .filter((c) => contratoActivoEn(c, hoy) && us.some((a) => a.id === c.apartamentoId))
      .reduce((s, c) => s + num(c.canon), 0);
    return {
      id: e.id,
      nombre: e.nombre,
      total: us.length,
      ...cuenta,
      ingreso,
      ocupacion: us.length ? cuenta.arrendado / us.length : 0,
    };
  });

  const total = apartamentos.length;
  const arrendados = apartamentos.filter((a) => a.estado === 'arrendado').length;
  const disponibles = apartamentos.filter((a) => a.estado === 'disponible').length;
  const mesCurso = serie[serie.length - 1] || { esperado: 0, recaudado: 0 };

  return {
    generado: ahora(),
    mes: hoy,
    kpis: {
      unidades: total,
      arrendados,
      disponibles,
      otros: total - arrendados - disponibles,
      ocupacion: total ? arrendados / total : 0,
      ingresoMensual: mesCurso.esperado,
      recaudadoMes: mesCurso.recaudado,
      pendienteMes: Math.max(0, mesCurso.esperado - mesCurso.recaudado),
      carteraTotal: cartera.reduce((s, c) => s + c.saldo, 0),
      contratosActivos: activos.filter((c) => contratoActivoEn(c, hoy)).length,
      solicitudesNuevas: solicitudes.filter((s) => s.estado === 'nueva').length,
      mensajesSinLeer: mensajes.filter((x) => x.tipo === 'inquilino' && !x.leidoAdmin).length,
      mantenimientosPendientes: mensajes.filter((x) =>
        x.tipo === 'inquilino' && x.categoria === 'mantenimiento' && x.estadoGestion !== 'resuelta').length,
      contratosPorVencer: vencimientos.filter((x) => x.dias <= 30).length,
      canonPromedio: arrendados
        ? Math.round(activos.filter((c) => contratoActivoEn(c, hoy)).reduce((s, c) => s + num(c.canon), 0) / Math.max(1, activos.filter((c) => contratoActivoEn(c, hoy)).length))
        : 0,
    },
    serie,
    cartera,
    vencimientos,
    porEdificio,
  };
}

module.exports = { contratoActivoEn, calcularAnalitica };

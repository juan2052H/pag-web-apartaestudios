'use strict';
/**
 * Envío de correo vía la API HTTP de Resend (sin SDK ni dependencias nuevas:
 * solo el fetch nativo de Node). Si no hay credenciales configuradas, o si el
 * envío falla, nunca lanza — el llamador decide qué hacer (ver
 * lib/rutas-api.js: cuando `enviado` es false, el código de recuperación se
 * imprime en consola como respaldo).
 */

async function enviarCorreo({ to, asunto, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const remitente = process.env.RESEND_FROM;
  if (!apiKey || !remitente) return { enviado: false, motivo: 'RESEND_API_KEY o RESEND_FROM no configuradas' };

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: remitente, to, subject: asunto, html }),
    });
    if (!r.ok) {
      const cuerpo = await r.text().catch(() => '');
      return { enviado: false, motivo: `Resend respondió ${r.status}: ${cuerpo.slice(0, 300)}` };
    }
    return { enviado: true };
  } catch (e) {
    return { enviado: false, motivo: e.message };
  }
}

module.exports = { enviarCorreo };

import { neon } from '@neondatabase/serverless';
import webpush from 'web-push';

const COLEGIO_ID = '8b14d518-332f-4fea-b78f-df6335c77842';
const GRADO = 5;

const TIPO_LABEL = {
  prueba: 'prueba', trabajo: 'trabajo', tarea: 'tarea',
  disertacion: 'disertación', laboratorio: 'laboratorio'
};

function etiquetaDias(dias) {
  if (dias <= 0) return 'HOY';
  if (dias === 1) return 'mañana';
  return `en ${dias} días`;
}

function construirMensaje(evaluaciones) {
  const hoy = new Date(); hoy.setUTCHours(0, 0, 0, 0);

  const conDias = evaluaciones.map((ev) => {
    const f = new Date(ev.fecha_evaluacion + 'T00:00:00Z');
    const dias = Math.round((f - hoy) / 86400000);
    return { ...ev, dias, fechaCorta: f.toLocaleDateString('es-CL', { day: 'numeric', month: 'short', timeZone: 'UTC' }) };
  }).sort((a, b) => a.dias - b.dias);

  const primera = conDias[0];
  const tipo = TIPO_LABEL[primera.tipo] || primera.tipo;

  if (conDias.length === 1) {
    return {
      title: '📚 Recordatorio de evaluación',
      body: `${primera.asignatura} (${tipo}) ${etiquetaDias(primera.dias)} — ${primera.fechaCorta}`
    };
  }

  return {
    title: '📚 Tienes evaluaciones esta semana',
    body: `${conDias.length} evaluaciones pendientes. La más próxima: ${primera.asignatura} ${etiquetaDias(primera.dias)}.`
  };
}

export default async function handler(req, res) {
  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const horaSantiago = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Santiago', hour: 'numeric', hour12: false }).format(new Date())
  );

  if (horaSantiago !== 8 && req.query.force !== '1') {
    return res.status(200).json({ skip: true, horaSantiago });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);

    const evaluaciones = await sql`
      SELECT asignatura, tipo_evaluacion AS tipo, fecha_evaluacion::text
      FROM evaluaciones
      WHERE colegio_id = ${COLEGIO_ID} AND grado = ${GRADO}
        AND estado != 'nota_ingresada'
        AND fecha_evaluacion >= CURRENT_DATE
        AND fecha_evaluacion <= CURRENT_DATE + INTERVAL '7 days'
      ORDER BY fecha_evaluacion
    `;

    if (evaluaciones.length === 0) {
      return res.status(200).json({ enviados: 0, motivo: 'sin evaluaciones en los próximos 7 días' });
    }

    const suscripciones = await sql`SELECT endpoint, p256dh, auth FROM push_subscripciones`;

    if (suscripciones.length === 0) {
      return res.status(200).json({ enviados: 0, motivo: 'sin suscripciones' });
    }

    webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

    const mensaje = construirMensaje(evaluaciones);
    const payload = JSON.stringify({ ...mensaje, url: '/index.html' });

    let enviados = 0;
    let eliminados = 0;

    for (const s of suscripciones) {
      const subscription = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
      try {
        await webpush.sendNotification(subscription, payload);
        enviados++;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await sql`DELETE FROM push_subscripciones WHERE endpoint = ${s.endpoint}`;
          eliminados++;
        } else {
          console.error('Error enviando push a', s.endpoint, err.statusCode, err.message);
        }
      }
    }

    return res.status(200).json({ enviados, eliminados, mensaje });

  } catch (error) {
    console.error('Error en enviar-notificaciones:', error);
    return res.status(500).json({ error: 'Error al enviar notificaciones' });
  }
}

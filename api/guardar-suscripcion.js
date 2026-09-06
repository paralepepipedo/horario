import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { subscription } = req.body || {};

  if (!subscription || !subscription.endpoint || !subscription.keys) {
    return res.status(400).json({ error: 'Suscripción inválida' });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);

    await sql`
      INSERT INTO push_subscripciones (endpoint, p256dh, auth)
      VALUES (${subscription.endpoint}, ${subscription.keys.p256dh}, ${subscription.keys.auth})
      ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth
    `;

    return res.status(200).json({ ok: true });

  } catch (error) {
    console.error('Error al guardar suscripción:', error);
    return res.status(500).json({ error: 'Error al guardar la suscripción' });
  }
}

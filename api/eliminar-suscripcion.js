import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { endpoint } = req.body || {};

  if (!endpoint) {
    return res.status(400).json({ error: 'Falta endpoint' });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    await sql`DELETE FROM push_subscripciones WHERE endpoint = ${endpoint}`;
    return res.status(200).json({ ok: true });

  } catch (error) {
    console.error('Error al eliminar suscripción:', error);
    return res.status(500).json({ error: 'Error al eliminar la suscripción' });
  }
}

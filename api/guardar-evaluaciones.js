import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { colegio_id, grado, evaluaciones, avisos } = req.body || {};

  const listaEvaluaciones = Array.isArray(evaluaciones) ? evaluaciones : [];
  const listaAvisos = Array.isArray(avisos) ? avisos : [];

  if (!colegio_id || !grado || (listaEvaluaciones.length === 0 && listaAvisos.length === 0)) {
    return res.status(400).json({ error: 'Faltan colegio_id, grado, o no hay evaluaciones ni avisos para guardar' });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);

    let evaluacionesInsertadas = 0;
    for (const ev of listaEvaluaciones) {
      await sql`
        INSERT INTO evaluaciones (colegio_id, grado, asignatura, tipo_evaluacion, fecha_evaluacion, contenidos, estado, origen)
        VALUES (${colegio_id}, ${Number(grado)}, ${ev.asignatura}, ${ev.tipo}, ${ev.fecha}, ${ev.contenidos}, 'pendiente', 'admin')
      `;
      evaluacionesInsertadas++;
    }

    let avisosInsertados = 0;
    for (const av of listaAvisos) {
      await sql`
        INSERT INTO avisos_calendario (colegio_id, grado, fecha, tipo, descripcion, origen)
        VALUES (${colegio_id}, ${Number(grado)}, ${av.fecha}, ${av.tipo}, ${av.descripcion}, 'admin')
      `;
      avisosInsertados++;
    }

    return res.status(200).json({ evaluacionesInsertadas, avisosInsertados });

  } catch (error) {
    console.error('Error al guardar evaluaciones/avisos:', error);
    return res.status(500).json({ error: 'Error al guardar en la base de datos' });
  }
}

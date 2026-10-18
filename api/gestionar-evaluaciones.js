import { neon } from '@neondatabase/serverless';

// Listar, editar (p. ej. reprogramar por aplazamiento) y eliminar evaluaciones ya guardadas.
export default async function handler(req, res) {
  try {
    const sql = neon(process.env.DATABASE_URL);

    if (req.method === 'GET') {
      const { colegio_id, grado } = req.query;
      if (!colegio_id || !grado) {
        return res.status(400).json({ error: 'Faltan parámetros: colegio_id o grado' });
      }
      // Se incluyen los últimos 30 días para poder reprogramar también una evaluación cuya fecha ya pasó.
      const evaluaciones = await sql`
        SELECT id, asignatura, tipo_evaluacion AS tipo, fecha_evaluacion::text AS fecha, contenidos, estado
        FROM evaluaciones
        WHERE colegio_id = ${colegio_id} AND grado = ${Number(grado)}
          AND fecha_evaluacion >= CURRENT_DATE - INTERVAL '30 days'
        ORDER BY fecha_evaluacion, asignatura
      `;
      return res.status(200).json({ evaluaciones });
    }

    if (req.method === 'PUT') {
      const { id, fecha, asignatura, tipo, contenidos } = req.body || {};
      if (!id || !fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
        return res.status(400).json({ error: 'Faltan id o una fecha válida (YYYY-MM-DD)' });
      }
      const filas = await sql`
        UPDATE evaluaciones
        SET fecha_evaluacion = ${fecha},
            asignatura = ${asignatura},
            tipo_evaluacion = ${tipo},
            contenidos = ${contenidos}
        WHERE id = ${id}
        RETURNING id
      `;
      if (filas.length === 0) {
        return res.status(404).json({ error: 'La evaluación no existe' });
      }
      return res.status(200).json({ actualizada: true });
    }

    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) {
        return res.status(400).json({ error: 'Falta id' });
      }
      const filas = await sql`DELETE FROM evaluaciones WHERE id = ${id} RETURNING id`;
      if (filas.length === 0) {
        return res.status(404).json({ error: 'La evaluación no existe' });
      }
      return res.status(200).json({ eliminada: true });
    }

    return res.status(405).json({ error: 'Método no permitido' });

  } catch (error) {
    console.error('Error al gestionar evaluaciones:', error);
    return res.status(500).json({ error: 'Error en la base de datos: ' + error.message });
  }
}

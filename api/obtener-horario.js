import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { colegio_id, grado, anio } = req.query;

  if (!colegio_id || !grado || !anio) {
    return res.status(400).json({ error: 'Faltan parámetros: colegio_id, grado o anio' });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);

    const [celdas, bloquesConfig] = await Promise.all([
      sql`SELECT dia_semana, bloque, asignatura FROM horarios
          WHERE colegio_id = ${colegio_id} AND grado = ${Number(grado)} AND anio = ${Number(anio)}
          ORDER BY dia_semana, bloque`,
      sql`SELECT bloque, hora_lj, hora_v FROM horarios_config
          WHERE colegio_id = ${colegio_id}
          ORDER BY bloque`
    ]);

    return res.status(200).json({ celdas, bloquesConfig });

  } catch (error) {
    console.error('Error al obtener horario:', error);
    return res.status(500).json({ error: 'Error al leer la base de datos' });
  }
}

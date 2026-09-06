import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  // Aseguramos que la petición sea GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  // Obtenemos los parámetros de la URL enviados por el frontend
  const { colegio_id, grado } = req.query;

  if (!colegio_id || !grado) {
    return res.status(400).json({ error: 'Faltan parámetros: colegio_id o grado' });
  }

  const gradoNum = Number(grado);

  try {
    // El código se queda así. Node.js buscará automáticamente el enlace en tu archivo .env
    const sql = neon(process.env.DATABASE_URL);

    // Una sola query (en vez de 3-4 por separado) para minimizar los round-trips a Neon.
    const [fila] = await sql`
      WITH h AS (
        SELECT dia_semana, bloque, asignatura
        FROM horarios
        WHERE colegio_id = ${colegio_id} AND grado = ${gradoNum}
          AND anio = EXTRACT(YEAR FROM CURRENT_DATE)::int
        ORDER BY dia_semana, bloque
      ),
      bc AS (
        SELECT bloque, hora_lj, hora_v
        FROM horarios_config
        WHERE colegio_id = ${colegio_id}
        ORDER BY bloque
      ),
      ev AS (
        SELECT id, asignatura, tipo_evaluacion AS tipo, fecha_evaluacion::text, contenidos, estado
        FROM evaluaciones
        WHERE colegio_id = ${colegio_id} AND grado = ${gradoNum}
          AND estado != 'nota_ingresada' AND fecha_evaluacion >= CURRENT_DATE
        ORDER BY fecha_evaluacion
      ),
      av AS (
        SELECT id, fecha::text, tipo, descripcion
        FROM avisos_calendario
        WHERE colegio_id = ${colegio_id} AND grado = ${gradoNum} AND fecha >= CURRENT_DATE
        ORDER BY fecha
      )
      SELECT
        COALESCE((SELECT json_agg(h) FROM h), '[]'::json) AS horarios,
        COALESCE((SELECT json_agg(bc) FROM bc), '[]'::json) AS "bloquesConfig",
        COALESCE((SELECT json_agg(ev) FROM ev), '[]'::json) AS evaluaciones,
        COALESCE((SELECT json_agg(av) FROM av), '[]'::json) AS avisos
    `;

    return res.status(200).json(fila);

  } catch (error) {
    console.error('Error en la base de datos:', error);
    return res.status(500).json({ error: 'Error al conectar con la base de datos' });
  }
}

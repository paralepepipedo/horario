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

  try {
    // El código se queda así. Node.js buscará automáticamente el enlace en tu archivo .env
    const sql = neon(process.env.DATABASE_URL);

    // Ejecutamos las tres consultas en paralelo
    const [horarios, bloquesConfig, evaluaciones] = await Promise.all([
      sql`SELECT dia_semana, bloque, asignatura FROM horarios WHERE colegio_id = ${colegio_id} AND grado = ${Number(grado)} ORDER BY dia_semana, bloque`,

      sql`SELECT bloque, hora_lj, hora_v FROM horarios_config WHERE colegio_id = ${colegio_id} ORDER BY bloque`,

      sql`SELECT id, asignatura, fecha_evaluacion::text, contenidos, estado FROM evaluaciones WHERE colegio_id = ${colegio_id} AND grado = ${Number(grado)} AND estado != 'nota_ingresada' AND fecha_evaluacion >= CURRENT_DATE ORDER BY fecha_evaluacion`
    ]);

    // Devolvemos los datos limpios al frontend
    return res.status(200).json({
      horarios,
      bloquesConfig,
      evaluaciones
    });

  } catch (error) {
    console.error('Error en la base de datos:', error);
    return res.status(500).json({ error: 'Error al conectar con la base de datos' });
  }
}
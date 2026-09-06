import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { colegio_id, grado, anio, celdas, bloquesConfig } = req.body || {};

  if (!colegio_id || !grado || !anio || !Array.isArray(celdas)) {
    return res.status(400).json({ error: 'Faltan colegio_id, grado, anio o celdas' });
  }

  const gradoNum = Number(grado);
  const anioNum = Number(anio);

  try {
    const sql = neon(process.env.DATABASE_URL);

    // Estrategia reemplazo-total: se borra la grilla existente de ese colegio/grado/año
    // y se insertan las celdas nuevas, así una asignatura removida no queda huérfana.
    await sql`DELETE FROM horarios WHERE colegio_id = ${colegio_id} AND grado = ${gradoNum} AND anio = ${anioNum}`;

    let celdasGuardadas = 0;
    for (const c of celdas) {
      await sql`
        INSERT INTO horarios (colegio_id, grado, anio, dia_semana, bloque, asignatura)
        VALUES (${colegio_id}, ${gradoNum}, ${anioNum}, ${c.dia_semana}, ${c.bloque}, ${c.asignatura})
      `;
      celdasGuardadas++;
    }

    let bloquesGuardados = 0;
    for (const b of (Array.isArray(bloquesConfig) ? bloquesConfig : [])) {
      await sql`
        INSERT INTO horarios_config (colegio_id, bloque, hora_lj, hora_v)
        VALUES (${colegio_id}, ${b.bloque}, ${b.hora_lj}, ${b.hora_v})
        ON CONFLICT (colegio_id, bloque) DO UPDATE SET hora_lj = EXCLUDED.hora_lj, hora_v = EXCLUDED.hora_v, updated_at = now()
      `;
      bloquesGuardados++;
    }

    return res.status(200).json({ celdasGuardadas, bloquesGuardados });

  } catch (error) {
    console.error('Error al guardar horario:', error);
    return res.status(500).json({ error: 'Error al guardar en la base de datos: ' + error.message });
  }
}

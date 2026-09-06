import mammoth from 'mammoth';

// Orden de respaldo: primero el modelo "latest" (más capaz); si está saturado (503) o sin
// cupo (429), se prueba uno más antiguo, y como último recurso los modelos "lite" — más
// livianos, pero con cupo gratuito SEPARADO del resto, así que suelen tener cupo cuando
// los demás ya se agotaron.
const GEMINI_MODELOS = ['gemini-flash-latest', 'gemini-3.6-flash', 'gemini-flash-lite-latest', 'gemini-3.1-flash-lite'];
const geminiUrl = (modelo) => `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`;

// Debe calzar EXACTO con el CHECK constraint evaluaciones_asignatura_check en Neon.
const ASIGNATURAS_VALIDAS = [
  'Matematicas', 'Lenguaje', 'Historia', 'Ciencias', 'Ingles', 'Ed. Fisica',
  'Musica', 'Artes', 'Tecnologia'
];

const TIPOS_VALIDOS = ['prueba', 'trabajo', 'tarea', 'disertacion', 'laboratorio'];

const TIPOS_AVISO_VALIDOS = ['salida_temprana', 'vacaciones', 'feriado', 'evento', 'otro'];

const PROMPT = `Eres un asistente que extrae información desde un calendario escolar mensual en PDF.

El documento es una tabla: cada semana es una fila y las columnas son Lunes a Viernes, con el número de día en el encabezado de cada celda (ej. "Martes 22"). El mes y el año del calendario aparecen en el título general del documento (ej. "CALENDARIO DE EVALUACIONES SEPTIEMBRE 2026 – CURSO 5° BÁSICO") — usa ese mes y año para construir cada fecha, no asumas un año fijo.

IMPORTANTE - semanas que cruzan de mes: la primera fila de la tabla puede empezar con días del MES ANTERIOR (ej. si la fila dice "Lunes 31 | Martes 01 | ...", el 31 pertenece al mes anterior al del título, no al mes del título — septiembre no tiene 31 días). Lo mismo puede pasar al final de la tabla con la última fila cruzando al mes SIGUIENTE. Regla práctica: dentro de una misma fila, si un número de día es MENOR que el número de día de la celda anterior (ej. pasa de 31 a 01), eso marca un cambio de mes — ajusta el mes (y el año si corresponde) para esos días, nunca generes un día que no exista en el mes que le asignes (ej. nunca "31" en septiembre).

Debes devolver DOS listas: "evaluaciones" (pruebas, trabajos, tareas, disertaciones, laboratorios) y "avisos" (cualquier otra información relevante del calendario que no sea una evaluación: salidas anticipadas, vacaciones, feriados, ensayos u otros eventos).

Reglas para EVALUACIONES:
1. Son evaluaciones académicas reales asociadas a una asignatura concreta.
2. Para cada una, determina:
   - fecha: "YYYY-MM-DD" combinando el año y mes del título del documento con el día indicado en el encabezado de la celda.
   - asignatura: normalizada EXACTAMENTE a una de estas 9 opciones, sin excepción (respeta mayúsculas/minúsculas y puntuación tal como aparecen aquí): Matematicas, Lenguaje, Historia, Ciencias, Ingles, Ed. Fisica, Musica, Artes, Tecnologia. Si la celda corresponde a una asignatura que NO es ninguna de estas 9 (ej. Religión, Orientación), trátala como aviso, no como evaluación.
   - tipo: clasifica como uno de: prueba, trabajo, tarea, disertacion, laboratorio.
     - "Ev. Sumativa", prueba escrita, o evaluación práctica sin más contexto → prueba
     - Proyectos grupales, o instrucciones de "diseñar y construir" algo → trabajo
     - Exposición oral → disertacion
     - Actividad de laboratorio (típicamente en Ciencias) → laboratorio
     - Tarea simple para la casa → tarea
     - Si hay duda razonable, usa "prueba" por defecto.
   - contenidos: descripción completa tal como aparece (unidad, objetivo, temario, páginas del libro, etc.).

Reglas para AVISOS (todo lo que NO es una evaluación pero sí es información relevante del calendario, ej. "Ensayo General", "Horario de salida", "SEMANA FIESTAS PATRIAS", "Independencia Nacional"):
1. IGNORA únicamente celdas vacías o sin ninguna información. Todo lo demás que no sea evaluación va como aviso.
2. Para cada aviso, determina:
   - fecha: "YYYY-MM-DD" igual que para evaluaciones. Si el aviso cubre varios días seguidos (ej. una semana completa de vacaciones), genera UN aviso por cada día de esa semana que aparezca en el calendario.
   - tipo: clasifica como uno de: salida_temprana, vacaciones, feriado, evento, otro.
     - Menciona un horario de salida antes de lo normal → salida_temprana
     - Semana completa sin clases (ej. "SEMANA FIESTAS PATRIAS") → vacaciones
     - Un solo día feriado con nombre propio (ej. "Independencia Nacional") → feriado
     - Actividades especiales tipo "Ensayo General", actos, etc. → evento
     - Cualquier otra nota administrativa → otro
   - descripcion: texto tal como aparece en la celda.

Reglas generales:
- Si un texto contiene comillas dobles internas, escápalas o usa comillas simples para no romper el formato JSON.
- Responde SOLO con el objeto JSON puro. NO incluyas markdown, NO incluyas bloques de código (\`\`\`json), NO des explicaciones. El primer carácter de tu respuesta debe ser { y el último }.

Formato exacto de la respuesta:
{"evaluaciones":[{"fecha":"YYYY-MM-DD","asignatura":"...","tipo":"...","contenidos":"..."}],"avisos":[{"fecha":"YYYY-MM-DD","tipo":"...","descripcion":"..."}]}`;

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function llamarGeminiConReintentos(parts) {
  let ultimaRespuesta;
  for (const modelo of GEMINI_MODELOS) {
    const geminiRes = await fetch(geminiUrl(modelo), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-goog-api-key': process.env.GEMINI_API_KEY
      },
      body: JSON.stringify({ contents: [{ parts }] }),
      signal: AbortSignal.timeout(30000)
    });

    if (geminiRes.ok) return geminiRes;
    ultimaRespuesta = geminiRes;

    if (geminiRes.status === 429) {
      console.log(`[extraer] ${modelo} sin cupo (429), probando siguiente modelo de respaldo...`);
    } else if (geminiRes.status === 503) {
      console.log(`[extraer] ${modelo} saturado (503), probando siguiente modelo de respaldo...`);
      await esperar(600);
    } else {
      return geminiRes; // error real (no de saturación ni cupo): no tiene sentido seguir probando modelos
    }
  }
  return ultimaRespuesta;
}

function extraerJsonObjeto(texto) {
  const inicio = texto.indexOf('{');
  const fin = texto.lastIndexOf('}');
  if (inicio === -1 || fin === -1 || fin < inicio) {
    throw new Error('La respuesta de la IA no contiene un objeto JSON');
  }
  return JSON.parse(texto.slice(inicio, fin + 1));
}

const fechaRe = /^\d{4}-\d{2}-\d{2}$/;

// No basta con el formato: hay que confirmar que el calendario existe de verdad
// (ej. rechazar "2026-09-31", que matchea el regex pero no es un día real).
function esFechaValida(fecha) {
  if (!fechaRe.test(fecha || '')) return false;
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  return d.getUTCFullYear() === anio && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

function validarEvaluaciones(items) {
  const validas = [];
  const warnings = [];

  items.forEach((item, i) => {
    const problemas = [];
    if (!item || typeof item !== 'object') { warnings.push(`Evaluación #${i + 1}: no es un objeto válido`); return; }
    if (!esFechaValida(item.fecha)) problemas.push('fecha inválida');
    if (!ASIGNATURAS_VALIDAS.includes(item.asignatura)) problemas.push(`asignatura "${item.asignatura}" no reconocida`);
    if (!TIPOS_VALIDOS.includes(item.tipo)) problemas.push(`tipo "${item.tipo}" no reconocido`);
    if (!item.contenidos || typeof item.contenidos !== 'string' || !item.contenidos.trim()) problemas.push('contenidos vacío');

    if (problemas.length) {
      warnings.push(`Evaluación #${i + 1} (${item.asignatura || '?'}, ${item.fecha || '?'}): ${problemas.join(', ')}`);
    } else {
      validas.push({
        fecha: item.fecha,
        asignatura: item.asignatura,
        tipo: item.tipo,
        contenidos: item.contenidos.trim()
      });
    }
  });

  return { validas, warnings };
}

function validarAvisos(items) {
  const validos = [];
  const warnings = [];

  items.forEach((item, i) => {
    const problemas = [];
    if (!item || typeof item !== 'object') { warnings.push(`Aviso #${i + 1}: no es un objeto válido`); return; }
    if (!esFechaValida(item.fecha)) problemas.push('fecha inválida');
    if (!TIPOS_AVISO_VALIDOS.includes(item.tipo)) problemas.push(`tipo "${item.tipo}" no reconocido`);
    if (!item.descripcion || typeof item.descripcion !== 'string' || !item.descripcion.trim()) problemas.push('descripción vacía');

    if (problemas.length) {
      warnings.push(`Aviso #${i + 1} (${item.tipo || '?'}, ${item.fecha || '?'}): ${problemas.join(', ')}`);
    } else {
      validos.push({
        fecha: item.fecha,
        tipo: item.tipo,
        descripcion: item.descripcion.trim()
      });
    }
  });

  return { validos, warnings };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { filename, fileBase64, mimeType } = req.body || {};

  if (!fileBase64 || !mimeType) {
    return res.status(400).json({ error: 'Faltan datos del archivo (fileBase64, mimeType)' });
  }

  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: 'Falta configurar GEMINI_API_KEY en el servidor' });
  }

  const t0 = Date.now();
  console.log(`[extraer] archivo="${filename}" mimeType="${mimeType}" tamañoBase64=${fileBase64.length}`);

  try {
    const esDocx = mimeType.includes('officedocument.wordprocessingml') ||
      (filename || '').toLowerCase().endsWith('.docx');
    const esPdf = mimeType === 'application/pdf';

    let parts;
    if (esPdf) {
      parts = [
        { text: PROMPT },
        { inlineData: { mimeType: 'application/pdf', data: fileBase64 } }
      ];
    } else if (esDocx) {
      const buffer = Buffer.from(fileBase64, 'base64');
      const { value: texto } = await mammoth.extractRawText({ buffer });
      console.log(`[extraer] docx -> ${texto.length} caracteres de texto extraídos`);
      parts = [
        { text: PROMPT + '\n\nA continuación el texto extraído del documento:\n\n' + texto }
      ];
    } else {
      return res.status(400).json({ error: 'Formato no soportado. Sube un PDF o un DOCX.' });
    }

    console.log(`[extraer] llamando a Gemini... (+${Date.now() - t0}ms)`);

    const geminiRes = await llamarGeminiConReintentos(parts);

    console.log(`[extraer] Gemini respondió status=${geminiRes.status} (+${Date.now() - t0}ms)`);

    const geminiData = await geminiRes.json();

    if (!geminiRes.ok) {
      console.error('[extraer] Error de Gemini:', geminiData);
      return res.status(502).json({ error: geminiData?.error?.message || 'Error al llamar a la IA' });
    }

    const texto = geminiData?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';

    let obj;
    try {
      obj = extraerJsonObjeto(texto);
    } catch (e) {
      console.error('[extraer] Respuesta no parseable:', texto);
      return res.status(502).json({ error: 'No se pudo interpretar la respuesta de la IA', respuestaCruda: texto });
    }

    const { validas, warnings: warningsEval } = validarEvaluaciones(Array.isArray(obj.evaluaciones) ? obj.evaluaciones : []);
    const { validos: avisosValidos, warnings: warningsAvisos } = validarAvisos(Array.isArray(obj.avisos) ? obj.avisos : []);
    const warnings = [...warningsEval, ...warningsAvisos];

    console.log(`[extraer] OK: ${validas.length} evaluaciones, ${avisosValidos.length} avisos, ${warnings.length} advertencias (+${Date.now() - t0}ms total)`);
    return res.status(200).json({ evaluaciones: validas, avisos: avisosValidos, warnings });

  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      console.error(`[extraer] Timeout esperando a Gemini (+${Date.now() - t0}ms)`);
      return res.status(504).json({ error: 'La IA no respondió a tiempo (45s). Puede ser un problema de red/firewall hacia Google. Intenta de nuevo.' });
    }
    console.error('[extraer] Error inesperado:', error);
    return res.status(500).json({ error: 'Error al procesar el documento con la IA: ' + error.message });
  }
}

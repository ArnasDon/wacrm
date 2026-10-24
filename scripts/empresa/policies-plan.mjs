/**
 * Planificador puro de policies.yaml (CFG.2): compara el estado de la base con las
 * políticas y devuelve las operaciones que faltan. Plan vacío = la base ya coincide
 * (esa es la idempotencia). No toca la red ni el disco.
 */

export class ConflictoPoliciesError extends Error {
  /** @param {string[]} conflictos */
  constructor(conflictos) {
    super(
      `La base no permite aplicar policies.yaml (no se escribió nada):\n- ${conflictos.join('\n- ')}`
    );
    this.name = 'ConflictoPoliciesError';
    this.conflictos = conflictos;
  }
}

export const MARCADORES = {
  bienvenida: 'policies.yaml:bienvenida',
  fuera_de_horario: 'policies.yaml:fuera_de_horario',
};

const minus = (s) => String(s).trim().toLowerCase();

/** JSON con llaves ordenadas: jsonb no conserva el orden de las llaves. */
function estable(v) {
  if (Array.isArray(v)) return `[${v.map(estable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${estable(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

const firmaPaso = (p) =>
  estable([p.stepType, p.stepConfig, p.branch ?? null, p.parentIndex ?? null]);

/** Pasos que cada política debe tener (forma que lee y escribe leerEstado/ejecutar). */
export function pasosDeseados(policies) {
  const { bienvenida, fuera_de_horario: fdh } = policies.automatizaciones;
  const r = {};
  if (bienvenida) {
    r.bienvenida = [
      {
        stepType: 'send_message',
        stepConfig: { text: bienvenida.texto },
        branch: null,
        parentIndex: null,
      },
    ];
  }
  if (fdh) {
    r.fuera_de_horario = [
      {
        stepType: 'condition',
        stepConfig: {
          subject: 'time_of_day',
          operand: fdh.horario,
          timezone: fdh.zona,
        },
        branch: null,
        parentIndex: null,
      },
      {
        stepType: 'send_message',
        stepConfig: { text: fdh.texto },
        branch: 'yes',
        parentIndex: 0,
      },
    ];
  }
  return r;
}

const AUTOMATIZACIONES = {
  bienvenida: { nombre: 'Bienvenida', trigger: 'first_inbound_message' },
  fuera_de_horario: {
    nombre: 'Fuera de horario',
    trigger: 'new_message_received',
  },
};

/**
 * @param estado ver aplicar-policies.mjs (leerEstado)
 * @param policies salida de validarPolicies
 */
export function planificar(estado, policies) {
  const ops = [];
  const conflictos = [];

  // --- usuarios (owner primero) ---
  const porCorreo = new Map(estado.usuarios.map((u) => [minus(u.correo), u]));
  const owner = policies.usuarios.find((u) => u.rol === 'owner');
  const orden = [owner, ...policies.usuarios.filter((u) => u !== owner)];
  const cuentaId = estado.cuenta?.id ?? null;

  for (const u of orden) {
    const ex = porCorreo.get(u.correo);
    if (!ex) {
      ops.push({
        tipo: 'crear-usuario',
        correo: u.correo,
        nombre: u.nombre,
        rol: u.rolCuenta,
      });
      continue;
    }
    if (u === owner) {
      if (!estado.cuenta || estado.cuenta.ownerUserId !== ex.userId) {
        conflictos.push(
          `${u.correo} es owner en policies.yaml pero no es el dueño actual de su cuenta; transferir el dueño se hace en la UI`
        );
      } else if (ex.nombre !== u.nombre) {
        ops.push({
          tipo: 'cambiar-nombre-usuario',
          userId: ex.userId,
          nombre: u.nombre,
        });
      }
      continue;
    }
    if (cuentaId && ex.accountId === cuentaId) {
      if (ex.rol === 'owner') {
        conflictos.push(
          `${u.correo} es el dueño de la cuenta; no se le puede dar el rol ${u.rol}`
        );
        continue;
      }
      if (ex.rol !== u.rolCuenta) {
        ops.push({
          tipo: 'cambiar-rol',
          userId: ex.userId,
          rol: u.rolCuenta,
        });
      }
      if (ex.nombre !== u.nombre) {
        ops.push({
          tipo: 'cambiar-nombre-usuario',
          userId: ex.userId,
          nombre: u.nombre,
        });
      }
    } else if (ex.cuentaPersonalVacia) {
      ops.push({
        tipo: 'mover-usuario',
        userId: ex.userId,
        correo: u.correo,
        cuentaPersonalId: ex.accountId,
        rol: u.rolCuenta,
        nombre: u.nombre,
      });
    } else {
      conflictos.push(
        `${u.correo} ya existe y pertenece a otra cuenta con datos; no se mueve (se perderían o quedarían huérfanos sus datos)`
      );
    }
  }

  // --- etiquetas ---
  const etiquetas = new Map(estado.etiquetas.map((e) => [minus(e.nombre), e]));
  for (const e of policies.etiquetas) {
    const ex = etiquetas.get(minus(e.nombre));
    if (!ex) {
      ops.push({ tipo: 'crear-etiqueta', nombre: e.nombre, color: e.color });
    } else if (minus(ex.color) !== minus(e.color)) {
      ops.push({ tipo: 'actualizar-etiqueta', id: ex.id, color: e.color });
    }
  }

  // --- embudo y etapas ---
  if (policies.embudo) {
    if (!estado.embudo) {
      ops.push({ tipo: 'crear-embudo', nombre: policies.embudo.nombre });
    }
    const etapas = new Map(
      (estado.embudo?.etapas ?? []).map((e) => [minus(e.nombre), e])
    );
    policies.embudo.etapas.forEach((e, posicion) => {
      const ex = etapas.get(minus(e.nombre));
      if (!ex) {
        ops.push({
          tipo: 'crear-etapa',
          nombre: e.nombre,
          color: e.color,
          posicion,
        });
      } else if (
        minus(ex.color) !== minus(e.color) ||
        ex.posicion !== posicion
      ) {
        ops.push({
          tipo: 'actualizar-etapa',
          id: ex.id,
          color: e.color,
          posicion,
        });
      }
    });
  }

  // --- automatizaciones ---
  const deseados = pasosDeseados(policies);
  for (const clave of Object.keys(AUTOMATIZACIONES)) {
    const pol = policies.automatizaciones[clave];
    if (!pol) continue;
    const marcador = MARCADORES[clave];
    const { nombre, trigger } = AUTOMATIZACIONES[clave];
    const pasos = deseados[clave];
    const ex = estado.automatizaciones.find((a) => a.marcador === marcador);
    if (!ex) {
      ops.push({
        tipo: 'crear-automatizacion',
        marcador,
        nombre,
        triggerType: trigger,
        activa: pol.activa,
        pasos,
      });
      continue;
    }
    if (
      ex.pasos.length !== pasos.length ||
      ex.pasos.some((p, i) => firmaPaso(p) !== firmaPaso(pasos[i]))
    ) {
      ops.push({ tipo: 'reemplazar-pasos', id: ex.id, pasos });
    }
    if (ex.activa !== pol.activa || ex.triggerType !== trigger) {
      ops.push({
        tipo: 'actualizar-automatizacion',
        id: ex.id,
        activa: pol.activa,
        triggerType: trigger,
      });
    }
  }

  // --- bot ---
  if (policies.bot) {
    const b = policies.bot;
    if (!estado.bot) {
      if (b.activo) {
        ops.push({
          tipo: 'aviso',
          mensaje:
            'bot.activo es true pero la cuenta aún no tiene configuración de IA: cargue proveedor, modelo y llave en Ajustes > IA y vuelva a aplicar',
        });
      }
    } else if (
      estado.bot.activo !== b.activo ||
      estado.bot.respuestaAutomatica !== b.respuesta_automatica ||
      estado.bot.tope !== b.tope_por_conversacion
    ) {
      ops.push({
        tipo: 'actualizar-bot',
        id: estado.bot.id,
        activo: b.activo,
        respuestaAutomatica: b.respuesta_automatica,
        tope: b.tope_por_conversacion,
      });
    }
  }

  if (conflictos.length > 0) throw new ConflictoPoliciesError(conflictos);
  return ops;
}

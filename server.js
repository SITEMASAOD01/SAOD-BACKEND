const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;
const DB_FILE = process.env.DB_FILE || '/data/database.sqlite';

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const NIVELES_CLIENTE = {
    NUEVO: { min: 0, max: 19, multiplier: 0.10, color: '#22c55e' },
    FRECUENTE: { min: 20, max: 49, multiplier: 0.12, color: '#eab308' },
    PREMIUM: { min: 50, max: 99, multiplier: 0.15, color: '#ea580c' },
    CREDIP_VIP: { min: 100, max: Infinity, multiplier: 0.20, color: '#dc2626' }
};

function initDatabase() {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_FILE, (err) => {
            if (err) {
                console.error('❌ Error conectando a la base de datos:', err.message);
                reject(err);
                return;
            }
            db.serialize(() => {
                db.run(`CREATE TABLE IF NOT EXISTS clientes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    dni VARCHAR(8) UNIQUE NOT NULL,
                    nombre_completo VARCHAR(255) NOT NULL,
                    direccion TEXT,
                    telefono VARCHAR(15),
                    credicambios_total REAL DEFAULT 0,
                    visitas_total INTEGER DEFAULT 0,
                    nivel VARCHAR(20) DEFAULT 'NUEVO',
                    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )`);
                db.run(`CREATE TABLE IF NOT EXISTS transacciones (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    cliente_id INTEGER REFERENCES clientes(id),
                    fecha_transaccion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    monto_gastado REAL NOT NULL,
                    credicambios_ganados REAL NOT NULL,
                    multiplicador_usado REAL NOT NULL,
                    descripcion TEXT,
                    sucursal VARCHAR(100) DEFAULT 'FRUCAMTO',
                    tipo_transaccion VARCHAR(50) DEFAULT 'COMPRA'
                )`);
            });
            resolve(db);
        });
    });
}

function determinarNivel(visitas) {
    for (const [nivel, config] of Object.entries(NIVELES_CLIENTE)) {
        if (visitas >= config.min && visitas <= config.max) {
            return nivel;
        }
    }
    return 'NUEVO';
}

function calcularCredcambios(montoSoles, nivel) {
    const multiplier = NIVELES_CLIENTE[nivel]?.multiplier || 0.05;
    return Math.round((montoSoles * multiplier) * 100) / 100;
}

// Info API
app.get('/', (req, res) => {
    res.json({ message: 'Sistema SAOD API funcionando correctamente', version: '2.0.0', status: 'active', niveles: NIVELES_CLIENTE });
});

// Consultar cliente por DNI
app.get('/api/cliente/:dni', (req, res) => {
    const { dni } = req.params;
    if (!dni || dni.length !== 8) return res.status(400).json({ error: 'DNI debe tener 8 dígitos' });
    db.get(`SELECT * FROM clientes WHERE dni = ?`, [dni], (err, cliente) => {
        if (err) return res.status(500).json({ error: 'Error interno del servidor' });
        if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });
        db.all(`SELECT * FROM transacciones WHERE cliente_id = ? ORDER BY fecha_transaccion DESC LIMIT 20`, [cliente.id], (err, transacciones) => {
            if (err) return res.status(500).json({ error: 'Error obteniendo historial' });
            const nivelConfig = NIVELES_CLIENTE[cliente.nivel] || NIVELES_CLIENTE.NUEVO;
            const equivalenteSoles = Math.round((cliente.credicambios_total * 0.1) * 100) / 100;
            res.json({
                cliente: {
                    dni: cliente.dni,
                    nombre: cliente.nombre_completo,
                    telefono: cliente.telefono,
                    direccion: cliente.direccion,
                    credicambios: cliente.credicambios_total,
                    equivalente_soles: equivalenteSoles,
                    nivel: cliente.nivel,
                    visitas_total: cliente.visitas_total,
                    color_nivel: nivelConfig.color,
                    multiplicador: nivelConfig.multiplier,
                    fecha_registro: cliente.fecha_registro
                },
                transacciones: transacciones.map(t => ({
                    fecha: t.fecha_transaccion,
                    monto: t.monto_gastado,
                    credicambios: t.credicambios_ganados,
                    multiplicador: t.multiplicador_usado,
                    descripcion: t.descripcion
                }))
            });
        });
    });
});

// POST NUEVO CLIENTE
app.post('/api/cliente', (req, res) => {
  const { dni, nombre, direccion, telefono } = req.body;
  if(!dni || !nombre) return res.status(400).json({ error: 'Datos incompletos' });
  db.run('INSERT INTO clientes (dni, nombre_completo, direccion, telefono) VALUES (?, ?, ?, ?)',
    [dni, nombre, direccion, telefono],
    function(err) {
      if (err) {
        if (err.message && err.message.includes('UNIQUE')) {
          return res.status(409).json({ error: 'El DNI ya está registrado. Si eres tú, consulta tus puntos.' });
        }
        return res.status(500).json({ error: 'No se pudo registrar cliente.' });
      }
      res.json({ ok: true, id: this.lastID });
    }
  );
});

// REGISTRO DE VENTA
app.post('/api/venta', (req, res) => {
    const { dni, monto, descripcion } = req.body;
    if (!dni || !monto) return res.status(400).json({ error: 'Datos incompletos para registrar venta' });
    db.get('SELECT * FROM clientes WHERE dni = ?', [dni], (err, cliente) => {
        if (err || !cliente) return res.status(404).json({ error: 'Cliente no encontrado' });
        const nivel = cliente.nivel || determinarNivel(cliente.visitas_total || 0);
        const credicambios = calcularCredcambios(monto, nivel);
        db.run('UPDATE clientes SET credicambios_total = credicambios_total + ?, visitas_total = visitas_total + 1, nivel = ? WHERE id = ?',
            [credicambios, determinarNivel((cliente.visitas_total || 0) + 1), cliente.id],
            function(updateErr) {
                if (updateErr) return res.status(500).json({ error: 'Error al actualizar cliente' });
                db.run('INSERT INTO transacciones (cliente_id, monto_gastado, credicambios_ganados, multiplicador_usado, descripcion) VALUES (?, ?, ?, ?, ?)',
                    [cliente.id, monto, credicambios, NIVELES_CLIENTE[nivel].multiplier, descripcion],
                    function(transErr) {
                        if (transErr) return res.status(500).json({ error: 'Error al guardar transacción' });
                        res.json({ ok: true, credicambios_ganados: credicambios, nivel_cliente: determinarNivel((cliente.visitas_total || 0) + 1) });
                    }
                );
            }
        );
    });
});

// ADMINISTRACIÓN SAOD

const ADMIN_CLAVE = process.env.ADMIN_CLAVE || "superclave2024";

app.post('/api/admin/login', (req, res) => {
  const { clave } = req.body;
  if (clave === ADMIN_CLAVE) {
    res.json({ ok: true, token: 'admin-token-123' });
  } else {
    res.status(401).json({ error: 'Clave incorrecta' });
  }
});

function adminAuth(req, res, next) {
  if (req.headers.authorization === 'Bearer admin-token-123') next();
  else res.status(401).json({ error: 'No autorizado' });
}

app.get('/api/admin/clientes', adminAuth, (req, res) => {
  db.all('SELECT * FROM clientes', (err, rows) => {
    if (err) return res.status(500).json({ error: 'Error al obtener clientes' });
    res.json({ clientes: rows.map(c=>({
      dni: c.dni, nombre: c.nombre_completo, telefono: c.telefono, direccion: c.direccion, credicambios: c.credicambios_total
    })) });
  });
});

app.get('/api/admin/historial/:dni', adminAuth, (req, res) => {
  db.get('SELECT * FROM clientes WHERE dni = ?', [req.params.dni], (err, cliente) => {
    if (!cliente) return res.status(404).json({ error: 'No encontrado' });
    db.all('SELECT * FROM transacciones WHERE cliente_id = ? ORDER BY fecha_transaccion DESC', [cliente.id], (err2, trans) => {
      res.json({ cliente: { nombre: cliente.nombre_completo }, transacciones: trans });
    });
  });
});

app.get('/api/admin/reporte-platos', adminAuth, (req, res) => {
  db.all('SELECT descripcion, COUNT(*) as cantidad FROM transacciones GROUP BY descripcion ORDER BY cantidad DESC', [], (err, rows) => {
    res.json({ platos: rows });
  });
});

app.get('/api/admin/reporte-zonas', adminAuth, (req, res) => {
  db.all(`SELECT c.direccion as zona, COUNT(t.id) as cantidad 
          FROM clientes c LEFT JOIN transacciones t ON c.id = t.cliente_id 
          GROUP BY zona ORDER BY cantidad DESC`, [], (err, rows) => {
    res.json({ zonas: rows });
  });
});

// PEDIDOS EN TIEMPO REAL
app.get('/api/admin/pedidos', adminAuth, (req, res) => {
  db.all(`
    SELECT t.id as pedido_id, c.dni, c.nombre_completo, c.direccion, t.monto_gastado, c.credicambios_total, 
           t.fecha_transaccion, t.descripcion, t.sucursal
    FROM transacciones t
    JOIN clientes c ON t.cliente_id = c.id
    ORDER BY t.fecha_transaccion DESC
  `, (err, pedidos) => {
    if (err) return res.status(500).json({ error: 'Error al obtener pedidos' });
    res.json({ pedidos });
  });
});

// RESUMEN DEL DÍA POR CLIENTE
app.get('/api/admin/resumen-dia/:dni', adminAuth, (req, res) => {
  const { dni } = req.params;
  const fechaHoy = new Date().toISOString().substring(0, 10);
  db.get('SELECT * FROM clientes WHERE dni = ?', [dni], (err, cliente) => {
    if (err || !cliente) return res.status(404).json({ error: 'Cliente no encontrado' });
    db.all(
      `SELECT t.id as pedido_id, t.descripcion, t.monto_gastado, t.fecha_transaccion, 
              c.credicambios_total, t.credicambios_ganados
         FROM transacciones t
         JOIN clientes c ON t.cliente_id = c.id
         WHERE c.dni = ? AND DATE(t.fecha_transaccion) = ?
         ORDER BY t.fecha_transaccion DESC`,
      [dni, fechaHoy],
      (err, pedidos) => {
        if (err) return res.status(500).json({ error: 'Error al obtener resumen' });
        res.json({ cliente: { dni: cliente.dni, nombre: cliente.nombre_completo }, pedidos });
      }
    );
  });
});

app.post('/api/canje', (req, res) => {
  const { dni, cantidadCanjeada } = req.body;
  if (!dni || typeof cantidadCanjeada !== "number" || cantidadCanjeada <= 0) {
    return res.status(400).json({ error: "Datos de canje incompletos o inválidos." });
  }
  db.get('SELECT * FROM clientes WHERE dni = ?', [dni], (err, cliente) => {
    if (err || !cliente) return res.status(404).json({ error: 'Cliente no encontrado' });
    let actual = parseFloat(cliente.credicambios_total) || 0;
    let nuevoSaldo = actual - cantidadCanjeada;
    if (nuevoSaldo < 0) nuevoSaldo = 0;
    db.run('UPDATE clientes SET credicambios_total = ? WHERE dni = ?', [nuevoSaldo, dni], function(err2) {
      if (err2) return res.status(500).json({ error: 'No se pudo canjear credicambios.' });
      res.json({ ok: true, nuevoSaldo });
    });
  });
});

let db;
initDatabase().then((database) => {
    db = database;
    app.listen(PORT, '0.0.0.0', () => {
        console.log('🎉 SISTEMA SAOD INICIADO EXITOSAMENTE');
        console.log(`📡 Servidor ejecutándose en: http://localhost:${PORT}`);
        console.log('🗄️ Base de datos: SQLite');
    });
}).catch((error) => {
    console.error('❌ Error iniciando el servidor:', error);
    process.exit(1);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Error no capturado:', error);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promesa rechazada no manejada:', reason);
});

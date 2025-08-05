const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000; // Fly.io pasará el puerto por env

const DB_FILE = '/tmp/database.sqlite';
console.log('Ruta BD:', DB_FILE);

// --- Seguridad/CORS ---
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// --- Niveles cliente, utilidades ---
const NIVELES_CLIENTE = {
    NUEVO: { min: 0, max: 19, multiplier: 0.10, color: '#22c55e' },
    FRECUENTE: { min: 20, max: 49, multiplier: 0.12, color: '#eab308' },
    PREMIUM: { min: 50, max: 99, multiplier: 0.15, color: '#ea580c' },
    CREDIP_VIP: { min: 100, max: Infinity, multiplier: 0.20, color: '#dc2626' }
};

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

// --- Conexión y creación de base de datos ---
const db = new sqlite3.Database(DB_FILE, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
        console.error('❌ Error conectando a la base de datos:', err.message);
        process.exit(1);
    }
    db.serialize(() => {
        db.run(`PRAGMA foreign_keys = ON`);
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
            cliente_id INTEGER NOT NULL,
            fecha_transaccion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            monto_gastado REAL NOT NULL,
            credicambios_ganados REAL NOT NULL,
            multiplicador_usado REAL NOT NULL,
            descripcion TEXT,
            sucursal VARCHAR(100) DEFAULT 'FRUCAMTO',
            tipo_transaccion VARCHAR(50) DEFAULT 'COMPRA',
            FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE
        )`);
    });
});

// === ENDPOINTS ===
app.get('/', (req, res) => {
    res.send('¡Fly.io funcionando con SQLite en /tmp!');
});

app.get('/api/cliente/:dni', (req, res) => {
    const { dni } = req.params;
    if (!dni || dni.length !== 8) return res.status(400).json({ error: 'DNI debe tener 8 dígitos' });
    db.get(`SELECT * FROM clientes WHERE dni = ?`, [dni], (err, cliente) => {
        if (err) return res.status(500).json({ error: 'Error interno del servidor' });
        if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });
        db.all(`SELECT * FROM transacciones WHERE cliente_id = ? ORDER BY fecha_transaccion DESC LIMIT 20`, [cliente.id], (err, transacciones) => {
            if (err) return res.status(500).json({ error: 'Error obteniendo historial' });
            res.json({
                cliente: {
                    dni: cliente.dni,
                    nombre: cliente.nombre_completo,
                    telefono: cliente.telefono,
                    direccion: cliente.direccion,
                    credicambios: cliente.credicambios_total,
                    equivalente_soles: Math.round((cliente.credicambios_total * 0.1) * 100) / 100,
                    nivel: cliente.nivel,
                    visitas_total: cliente.visitas_total,
                    color_nivel: "#22c55e", // O usa el color de tu nivel
                    multiplicador: 0.1,     // O usa el multiplicador real
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
   

app.post('/api/cliente', (req, res) => {
    const { dni, nombre, direccion, telefono } = req.body;
    if (!dni || !nombre) return res.status(400).json({ error: 'Datos incompletos' });
    db.run('INSERT INTO clientes (dni, nombre_completo, direccion, telefono) VALUES (?, ?, ?, ?)',
        [dni, nombre, direccion, telefono],
        function (err) {
            if (err) {
                if (err.message && err.message.includes('UNIQUE')) {
                    return res.status(409).json({ error: 'El DNI ya está registrado.' });
                }
                return res.status(500).json({ error: 'No se pudo registrar cliente.' });
            }
            res.json({ ok: true, id: this.lastID });
        }
    );
});

app.post('/api/venta', (req, res) => {
    const { dni, monto, descripcion } = req.body;
    if (!dni || !monto) return res.status(400).json({ error: 'Datos incompletos para registrar venta' });

    db.get('SELECT * FROM clientes WHERE dni = ?', [dni], (err, cliente) => {
        if (err) {
            console.error('Error buscando cliente:', err);
            return res.status(500).json({ error: 'Error interno buscando cliente' });
        }
        if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });

        const nivel = cliente.nivel || determinarNivel(cliente.visitas_total || 0);
        const credicambios = calcularCredcambios(monto, nivel);
        const nuevasVisitas = (cliente.visitas_total || 0) + 1;
        const nuevoNivel = determinarNivel(nuevasVisitas);
        const nuevoTotalCredicambios = (cliente.credicambios_total || 0) + credicambios;

        db.run(
            'UPDATE clientes SET credicambios_total = ?, visitas_total = ?, nivel = ? WHERE id = ?',
            [nuevoTotalCredicambios, nuevasVisitas, nuevoNivel, cliente.id],
            function (updateErr) {
                if (updateErr) {
                    console.error('Error actualizando cliente:', updateErr);
                    return res.status(500).json({ error: 'Error al actualizar cliente' });
                }

                db.run(
                    'INSERT INTO transacciones (cliente_id, monto_gastado, credicambios_ganados, multiplicador_usado, descripcion) VALUES (?, ?, ?, ?, ?)',
                    [cliente.id, monto, credicambios, NIVELES_CLIENTE[nivel].multiplier, descripcion],
                    function (transErr) {
                        if (transErr) {
                            console.error('Error guardando transacción:', transErr);
                            return res.status(500).json({ error: 'Error al guardar transacción' });
                        }

                        // Vuelve a leer el cliente para devolver datos actualizados
                        db.get('SELECT * FROM clientes WHERE id = ?', [cliente.id], (err2, updatedCliente) => {
                            if (err2 || !updatedCliente) {
                                return res.json({
                                    ok: true,
                                    nombre: cliente.nombre_completo,
                                    nivel: nuevoNivel,
                                    credicambios_ganados: credicambios,
                                    total_credicambios: nuevoTotalCredicambios,
                                    visitas_total: nuevasVisitas
                                });
                            }
                            res.json({
                                ok: true,
                                nombre: updatedCliente.nombre_completo,
                                nivel: updatedCliente.nivel,
                                credicambios_ganados: credicambios,
                                total_credicambios: updatedCliente.credicambios_total,
                                visitas_total: updatedCliente.visitas_total
                            });
                        });
                    }
                );
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
        db.run('UPDATE clientes SET credicambios_total = ? WHERE dni = ?', [nuevoSaldo, dni], function (err2) {
            if (err2) return res.status(500).json({ error: 'No se pudo canjear credicambios.' });
            res.json({ ok: true, nuevoSaldo });
        });
    });
});

app.post('/api/admin/limpiar-todo', (req, res) => {
    db.run('DELETE FROM transacciones', (err1) => {
        if (err1) return res.status(500).json({ error: 'No se pudo borrar transacciones' });
        db.run('DELETE FROM clientes', (err2) => {
            if (err2) return res.status(500).json({ error: 'No se pudo borrar clientes' });
            res.json({ ok: true, mensaje: 'Base de datos limpiada' });
        });
    });
});

// ========== INICIO DEL SERVIDOR ==========
app.listen(PORT, '0.0.0.0', () => {
    console.log('Servidor corriendo en puerto', PORT);
});

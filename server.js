const express = require('express');
const app = express();

const PORT = process.env.PORT || 3000;  // OJO: default 3000, NO 8080

const DB_FILE = '/tmp/database.sqlite';
console.log('Ruta BD:', DB_FILE);

const db = new sqlite3.Database(DB_FILE, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
        console.error('❌ Error conectando a la base de datos:', err.message);
        process.exit(1);
    }
    db.run('CREATE TABLE IF NOT EXISTS test (id INTEGER PRIMARY KEY, name TEXT)');
});

app.get('/', (req, res) => {
    res.send('¡Fly.io funcionando con SQLite en /tmp!');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log('Servidor corriendo en puerto', PORT);
});
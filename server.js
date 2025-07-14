const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const app = express();
const PORT = process.env.PORT || 8080; // O 3000, pero SIEMPRE process.env.PORT primero

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

app.listen(PORT, () => {
    console.log('Servidor corriendo en puerto', PORT);
});
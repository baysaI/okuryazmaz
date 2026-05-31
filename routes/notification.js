const express = require('express');
const router = express.Router();
const db = require('../database/db');
const jwt = require('jsonwebtoken');

if (!process.env.JWT_SECRET) {
    throw new Error('FATAL ERROR: JWT_SECRET environment variable is not defined.');
}
const SECRET_KEY = process.env.JWT_SECRET;

function requireAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(401).json({ error: 'Giriş yapın.' });
    const token = authHeader.split(' ')[1];
    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.status(403).json({ error: 'Oturum hatası.' });
        req.user = user;
        next();
    });
}

router.get('/', requireAuth, (req, res) => {
    db.all(`SELECT n.*, u.username as sender_name 
            FROM notifications n 
            LEFT JOIN users u ON n.sender_id = u.id 
            WHERE n.user_id = ? 
            ORDER BY n.created_at DESC LIMIT 50`, [req.user.id], (err, rows) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Bildirimler alınamadı.' });
        }
        res.json(rows);
    });
});

router.put('/mark-read', requireAuth, (req, res) => {
    db.run('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [req.user.id], function(err) {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Bildirimler okundu olarak işaretlenemedi.' });
        }
        res.json({ message: 'Tüm sayfalar okundu.' });
    });
});

module.exports = router;

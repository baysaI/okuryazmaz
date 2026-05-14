const express = require('express');
const router = express.Router();
const db = require('../database/db');
const jwt = require('jsonwebtoken');

const SECRET_KEY = process.env.JWT_SECRET || 'okuryazmaz_super_secret_dev_key';

function requireAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(401).json({ error: 'Bu işlem için giriş yapmalısınız.' });
    const token = authHeader.split(' ')[1];
    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.status(403).json({ error: 'Oturum hatası.' });
        req.user = user;
        next();
    });
}

router.post('/', requireAuth, (req, res) => {
    const { target_type, target_id, reason } = req.body;
    if (!target_type || !target_id || !reason) return res.status(400).json({ error: 'Eksik bilgi.' });

    db.run('INSERT INTO reports (reporter_id, target_type, target_id, reason) VALUES (?, ?, ?, ?)',
        [req.user.id, target_type, target_id, reason], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            
           
           
            db.all("SELECT id FROM users WHERE is_admin = 1", [], (err, admins) => {
                if (!err && admins) {
                    admins.forEach(admin => {
                        db.run("INSERT INTO notifications (user_id, sender_id, type, source_id, message) VALUES (?, ?, ?, ?, ?)",
                            [admin.id, req.user.id, 'admin_alert', this.lastID, `Yeni bir ${target_type} raporu var: ${reason.substring(0, 30)}...`]);
                    });
                }
            });

            res.status(201).json({ message: 'Şikayetiniz kütüphane yönetimine iletildi.' });
        });
});

module.exports = router;

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
    if (!authHeader) return res.status(401).json({ error: 'Bu işlem için giriş yapmalısınız.' });
    const token = authHeader.split(' ')[1];
    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.status(403).json({ error: 'Oturum hatası.' });
        req.user = user;
        next();
    });
}


function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#39;');
}

router.post('/', requireAuth, (req, res) => {
    const { target_type, target_id, reason } = req.body;
    if (!target_type || !target_id || !reason) return res.status(400).json({ error: 'Eksik bilgi.' });

    
    const allowedTypes = ['topic', 'post', 'comment'];
    if (!allowedTypes.includes(target_type)) {
        return res.status(400).json({ error: 'Geçersiz hedef tipi.' });
    }

    db.run('INSERT INTO reports (reporter_id, target_type, target_id, reason) VALUES (?, ?, ?, ?)',
        [req.user.id, target_type, target_id, reason], function(err) {
            if (err) {
                console.error('[REPORT INSERT ERROR]', err);
                return res.status(500).json({ error: 'Şikayet kaydedilirken veritabanı hatası oluştu.' });
            }
            
            const escapedReason = escapeHtml(reason);
            const safeType = escapeHtml(target_type);
            
            db.all("SELECT id FROM users WHERE is_admin = 1", [], (err, admins) => {
                if (!err && admins) {
                    admins.forEach(admin => {
                        db.run("INSERT INTO notifications (user_id, sender_id, type, source_id, message) VALUES (?, ?, ?, ?, ?)",
                            [admin.id, req.user.id, 'admin_alert', this.lastID, `Yeni bir ${safeType} raporu var: ${escapedReason.substring(0, 30)}...`]);
                    });
                }
            });

            res.status(201).json({ message: 'Şikayetiniz kütüphane yönetimine iletildi.' });
        });
});

module.exports = router;

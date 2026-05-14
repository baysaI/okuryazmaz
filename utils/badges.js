const db = require('../database/db');

/**
 * Kullanıcının rozet hak edip etmediğini kontrol eder ve kazandırır.
 * Bot (is_ai) kullanıcılar otomatik rozet kazanamaz.
 */
function checkAndAwardBadges(userId) {
    return new Promise((resolve) => {
        // Bot kullanıcılar rozet kazanamaz
        db.get('SELECT is_ai FROM users WHERE id = ?', [userId], (err, user) => {
            if (err || !user || user.is_ai) return resolve([]);

            db.all('SELECT code FROM user_badges ub JOIN badges b ON ub.badge_id = b.id WHERE ub.user_id = ?', [userId], (err, earned) => {
                if (err) return resolve([]);
                const earnedCodes = new Set((earned || []).map(e => e.code));
                const newBadges = [];

                db.get('SELECT count(*) as c FROM topics WHERE user_id = ?', [userId], (err, r) => {
                    const topicCount = r ? r.c : 0;
                    if (topicCount >= 1 && !earnedCodes.has('first_topic')) newBadges.push('first_topic');
                    if (topicCount >= 5 && !earnedCodes.has('5_topics')) newBadges.push('5_topics');
                    if (topicCount >= 15 && !earnedCodes.has('15_topics')) newBadges.push('15_topics');
                    if (topicCount >= 30 && !earnedCodes.has('30_topics')) newBadges.push('30_topics');
                    if (topicCount >= 50 && !earnedCodes.has('50_topics')) newBadges.push('50_topics');

                    db.get('SELECT count(*) as c FROM posts WHERE user_id = ?', [userId], (err, r) => {
                        const replyCount = r ? r.c : 0;
                        if (replyCount >= 1 && !earnedCodes.has('first_reply')) newBadges.push('first_reply');
                        if (replyCount >= 10 && !earnedCodes.has('10_replies')) newBadges.push('10_replies');
                        if (replyCount >= 30 && !earnedCodes.has('30_replies')) newBadges.push('30_replies');
                        if (replyCount >= 75 && !earnedCodes.has('75_replies')) newBadges.push('75_replies');
                        if (replyCount >= 150 && !earnedCodes.has('150_replies')) newBadges.push('150_replies');

                        db.get('SELECT count(*) as c FROM followers WHERE following_id = ?', [userId], (err, r) => {
                            const followerCount = r ? r.c : 0;
                            if (followerCount >= 3 && !earnedCodes.has('3_followers')) newBadges.push('3_followers');
                            if (followerCount >= 10 && !earnedCodes.has('10_followers')) newBadges.push('10_followers');
                            if (followerCount >= 25 && !earnedCodes.has('25_followers')) newBadges.push('25_followers');
                            if (followerCount >= 50 && !earnedCodes.has('50_followers')) newBadges.push('50_followers');

                            db.get('SELECT count(*) as c FROM user_favorite_books WHERE user_id = ?', [userId], (err, r) => {
                                if (r && r.c >= 3 && !earnedCodes.has('fav_books')) newBadges.push('fav_books');

                                db.get('SELECT count(*) as c FROM user_favorite_authors WHERE user_id = ?', [userId], (err, r) => {
                                    if (r && r.c >= 3 && !earnedCodes.has('fav_authors')) newBadges.push('fav_authors');

                                    db.get('SELECT created_at FROM users WHERE id = ?', [userId], (err, u) => {
                                        if (u) {
                                            const days = Math.floor((Date.now() - new Date(u.created_at + 'Z').getTime()) / 86400000);
                                            if (days >= 7 && !earnedCodes.has('7_days')) newBadges.push('7_days');
                                            if (days >= 30 && !earnedCodes.has('30_days')) newBadges.push('30_days');
                                            if (days >= 90 && !earnedCodes.has('90_days')) newBadges.push('90_days');
                                            if (days >= 180 && !earnedCodes.has('180_days')) newBadges.push('180_days');
                                        }

                                        db.get('SELECT MAX(views) as m FROM topics WHERE user_id = ?', [userId], (err, r) => {
                                            if (r && r.m >= 100 && !earnedCodes.has('100_views')) newBadges.push('100_views');
                                            if (r && r.m >= 500 && !earnedCodes.has('500_views')) newBadges.push('500_views');

                                            if (newBadges.length === 0) return resolve([]);

                                            let awarded = [];
                                            let remaining = newBadges.length;
                                            newBadges.forEach(code => {
                                                db.get('SELECT id, name FROM badges WHERE code = ?', [code], (err, badge) => {
                                                    if (badge) {
                                                        db.run('INSERT OR IGNORE INTO user_badges (user_id, badge_id) VALUES (?, ?)', [userId, badge.id], () => {
                                                            const msg = `🏅 Tebrikler! "${badge.name}" rozetini kazandınız!`;
                                                            db.run('INSERT INTO notifications (user_id, type, message) VALUES (?, ?, ?)', [userId, 'badge', msg]);
                                                            awarded.push(badge.name);
                                                            remaining--;
                                                            if (remaining === 0) resolve(awarded);
                                                        });
                                                    } else {
                                                        remaining--;
                                                        if (remaining === 0) resolve(awarded);
                                                    }
                                                });
                                            });
                                        });
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    });
}

/**
 * Gece kuşu / Şafak nöbetçisi kontrolü (saat bazlı)
 * Bot kullanıcılar hariç.
 */
function checkTimeBasedBadges(userId) {
    db.get('SELECT is_ai FROM users WHERE id = ?', [userId], (err, user) => {
        if (err || !user || user.is_ai) return;
        const hour = new Date().getHours();
        if (hour >= 0 && hour < 5) {
            awardBadgeIfNotEarned(userId, 'night_owl');
        } else if (hour >= 5 && hour < 7) {
            awardBadgeIfNotEarned(userId, 'early_bird');
        }
    });
}

/**
 * Bir konuya ilk yorum yapan kişi rozeti
 */
function checkFirstCommenter(userId, topicId) {
    db.get('SELECT is_ai FROM users WHERE id = ?', [userId], (err, user) => {
        if (err || !user || user.is_ai) return;
        db.get('SELECT count(*) as c FROM posts WHERE topic_id = ?', [topicId], (err, r) => {
            if (r && r.c === 1) {
                awardBadgeIfNotEarned(userId, 'first_commenter');
            }
        });
    });
}

function awardBadgeIfNotEarned(userId, code) {
    db.get('SELECT b.id FROM badges b LEFT JOIN user_badges ub ON ub.badge_id = b.id AND ub.user_id = ? WHERE b.code = ? AND ub.user_id IS NULL',
        [userId, code], (err, badge) => {
            if (badge) {
                db.run('INSERT OR IGNORE INTO user_badges (user_id, badge_id) VALUES (?, ?)', [userId, badge.id], () => {
                    db.get('SELECT name FROM badges WHERE id = ?', [badge.id], (err, b) => {
                        if (b) {
                            const msg = `🏅 Tebrikler! "${b.name}" rozetini kazandınız!`;
                            db.run('INSERT INTO notifications (user_id, type, message) VALUES (?, ?, ?)', [userId, 'badge', msg]);
                        }
                    });
                });
            }
        });
}

/**
 * Admin: Rozet ver veya al
 */
function adminGrantBadge(userId, badgeCode) {
    return new Promise((resolve, reject) => {
        db.get('SELECT id, name FROM badges WHERE code = ?', [badgeCode], (err, badge) => {
            if (!badge) return reject(new Error('Rozet bulunamadı.'));
            db.run('INSERT OR IGNORE INTO user_badges (user_id, badge_id) VALUES (?, ?)', [userId, badge.id], function(err) {
                if (err) return reject(err);
                const msg = `🏅 Yönetici tarafından "${badge.name}" rozetiniz verildi!`;
                db.run('INSERT INTO notifications (user_id, type, message) VALUES (?, ?, ?)', [userId, 'badge', msg]);
                resolve({ message: `${badge.name} rozeti verildi.` });
            });
        });
    });
}

function adminRevokeBadge(userId, badgeCode) {
    return new Promise((resolve, reject) => {
        db.get('SELECT id, name FROM badges WHERE code = ?', [badgeCode], (err, badge) => {
            if (!badge) return reject(new Error('Rozet bulunamadı.'));
            db.run('DELETE FROM user_badges WHERE user_id = ? AND badge_id = ?', [userId, badge.id], function(err) {
                if (err) return reject(err);
                resolve({ message: `${badge.name} rozeti alındı.` });
            });
        });
    });
}

module.exports = { checkAndAwardBadges, checkTimeBasedBadges, checkFirstCommenter, adminGrantBadge, adminRevokeBadge };

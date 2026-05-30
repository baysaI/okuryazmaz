const db = require('../database/db');
const badIds = [2, 3, 14, 29, 32, 34];
db.serialize(() => {
    badIds.forEach(id => {
        db.get('SELECT username FROM users WHERE id = ?', [id], (err, user) => {
            if (!user) return;
            db.get('SELECT COUNT(*) as topics FROM topics WHERE user_id = ?', [id], (err, tRow) => {
                db.get('SELECT COUNT(*) as posts FROM posts WHERE user_id = ?', [id], (err, pRow) => {
                    console.log(`Bot ${user.username} (id: ${id}) has ${tRow.topics} topics and ${pRow.posts} posts.`);
                });
            });
        });
    });
});

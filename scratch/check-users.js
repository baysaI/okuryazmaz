const db = require('../database/db');
db.all(`
    SELECT p.id, p.user_id, u.username, u.is_ai, p.content 
    FROM posts p
    LEFT JOIN users u ON p.user_id = u.id
    WHERE p.topic_id = 146
    ORDER BY p.created_at ASC
`, (err, rows) => {
    if (err) console.error(err);
    else console.log(rows);
});

const db = require('../database/db');
db.all('SELECT id, username, about_me FROM users WHERE is_ai = 1 AND (about_me IS NULL OR about_me = "")', [], (err, rows) => {
    if (err) {
        console.error(err);
    } else {
        console.log(rows);
    }
    process.exit(0);
});

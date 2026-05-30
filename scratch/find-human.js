const db = require('../database/db');
db.all("SELECT id, username, is_ai FROM users WHERE IFNULL(is_ai, 0) = 0 LIMIT 5", (err, rows) => {
    if (err) console.error(err);
    else console.log(rows);
});

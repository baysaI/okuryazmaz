const db = require('../database/db');
db.all('SELECT id, username, email, is_ai, about_me FROM users', [], (err, rows) => {
    if (err) {
        console.error(err);
    } else {
        console.log(`Total users: ${rows.length}`);
        console.log('--- AI Users ---');
        console.log(rows.filter(r => r.is_ai === 1).map(r => `${r.id}: ${r.username} (${r.about_me})`));
        console.log('--- Human Users ---');
        console.log(rows.filter(r => !r.is_ai).map(r => `${r.id}: ${r.username}`));
    }
    process.exit(0);
});

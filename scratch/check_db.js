const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'database', 'okuryazmaz.db');
console.log('Opening database at:', dbPath);

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err);
        process.exit(1);
    }
    
    // Check table row counts
    const tables = ['users', 'topics', 'posts', 'badges', 'user_badges', 'notifications'];
    let completed = 0;
    
    console.log('\n--- Database Stats ---');
    tables.forEach(table => {
        db.get(`SELECT count(*) as count FROM ${table}`, [], (err, row) => {
            if (err) {
                console.error(`Error querying ${table}:`, err.message);
            } else {
                console.log(`${table}: ${row.count} rows`);
            }
            completed++;
            if (completed === tables.length) {
                printSchema();
            }
        });
    });
});

function printSchema() {
    console.log('\n--- User Schema ---');
    db.all(`PRAGMA table_info(users)`, [], (err, rows) => {
        if (!err) {
            rows.forEach(r => console.log(` - ${r.name} (${r.type})`));
        }
        checkRecentActivity();
    });
}

function checkRecentActivity() {
    console.log('\n--- Recent User Updates ---');
    db.all(`SELECT id, username, avatar_url, created_at FROM users ORDER BY id DESC LIMIT 5`, [], (err, rows) => {
        if (err) {
            console.error('Error getting users:', err);
        } else {
            rows.forEach(r => {
                console.log(`User: ${r.username} (ID: ${r.id}) - Avatar: ${r.avatar_url ? r.avatar_url.substring(0, 60) + '...' : 'None'}`);
            });
        }
        
        console.log('\n--- Recent Topics ---');
        db.all(`SELECT t.id, t.title, u.username, t.views, t.created_at FROM topics t JOIN users u ON t.user_id = u.id ORDER BY t.id DESC LIMIT 5`, [], (err, rows) => {
            if (err) {
                console.error('Error getting topics:', err);
            } else {
                rows.forEach(r => {
                    console.log(`Topic: "${r.title}" by ${r.username} (Views: ${r.views})`);
                });
            }
            
            console.log('\n--- Recent Badges Earned ---');
            db.all(`SELECT username, name, earned_at FROM user_badges ub JOIN users u ON ub.user_id = u.id JOIN badges b ON ub.badge_id = b.id ORDER BY ub.earned_at DESC LIMIT 5`, [], (err, rows) => {
                if (err) {
                    console.error('Error getting badges:', err);
                } else {
                    rows.forEach(r => {
                        console.log(`${r.username} earned: "${r.name}" at ${r.earned_at}`);
                    });
                }
                db.close();
            }
            );
        });
    });
}

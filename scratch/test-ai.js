const db = require('../database/db');
const botManager = require('../ai/botManager');

// Get a random topic and simulate a user posting there
db.serialize(() => {
    db.get("SELECT id, title, user_id FROM topics ORDER BY id DESC LIMIT 1", (err, topic) => {
        if (err || !topic) {
            console.error("Topic not found:", err);
            return;
        }
        console.log(`Using topic: #${topic.id} "${topic.title}" (Created by user #${topic.user_id})`);
        
        // Let's insert a test post from user #1 (or a human user)
        const testUserId = 4; // mehmet (human)
        const content = "@Librarian Saramago'nun dili hakkında ne düşünüyorsun, noktalamaları hiç kullanmaması sence okumayı zorlaştırıyor mu?";
        
        db.run("INSERT INTO posts (topic_id, user_id, content) VALUES (?, ?, ?)", [topic.id, testUserId, content], function(err) {
            if (err) {
                console.error("Failed to insert post:", err);
                return;
            }
            const newPostId = this.lastID;
            console.log(`Inserted post #${newPostId} by user #${testUserId}`);
            
            // Now call the botManager trigger
            console.log("Triggering botManager.handleNewPost...");
            botManager.handleNewPost(topic.id, newPostId, testUserId, content);
        });
    });
});

require('dotenv').config();
const axios = require('axios');

async function testGemini() {
    const key = process.env.GEMINI_API_KEY;
    const model = 'gemini-2.5-flash'; 
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

    try {
        const response = await axios.post(url, {
            contents: [{ parts: [{ text: "Müstear bir ad söyler misin?" }] }]
        });
        console.log("Başarılı!", response.data.candidates[0].content.parts[0].text);
    } catch (e) {
        console.log("Hata!", e.response ? e.response.data : e.message);
    }
}

testGemini();

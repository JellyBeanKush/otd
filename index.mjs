import { GoogleGenerativeAI } from "@google/generative-ai";
import fetch from 'node-fetch';
import fs from 'fs';

const CONFIG = {
    GEMINI_KEY: process.env.GEMINI_API_KEY,
    DISCORD_URL: process.env.DISCORD_WEBHOOK_URL,
    SAVE_FILE: 'current_otd.txt',
    PRIMARY_MODEL: "gemini-2.5-flash", 
    BACKUP_MODEL: "gemini-1.5-flash" 
};

// Date formatting for Wikipedia API and Discord message
const today = new Date();
const monthName = today.toLocaleString('en-US', { month: 'long' });
const dayNum = today.getDate();
const monthStr = String(today.getMonth() + 1).padStart(2, '0');
const dayStr = String(dayNum).padStart(2, '0');
const dateStamp = today.toLocaleDateString('sv-SE', { timeZone: 'America/Los_Angeles' });

async function getWikipediaHistory() {
    const url = `https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${monthStr}/${dayStr}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'HoneyBearSquish-OTD-Bot/1.0' } });
    const data = await res.json();
    return data.events.slice(0, 15); 
}

async function postToDiscord(otdData) {
    const payload = {
        embeds: [{
            // Formats as [February 20, 1986](wiki-link) — Event description
            description: `**[${monthName} ${dayNum}, ${otdData.year}](${otdData.link})** — ${otdData.event}`,
            color: 0xe67e22 
        }]
    };
    await fetch(CONFIG.DISCORD_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
}

async function generateWithRetry(modelName, events) {
    const genAI = new GoogleGenerativeAI(CONFIG.GEMINI_KEY);
    const model = genAI.getGenerativeModel({ model: modelName });
    const prompt = `Pick the most interesting event from this list for a gaming/streaming audience. 
    JSON ONLY: {"year": "YYYY", "event": "A summary of what happened (do not include the date or 'On this day' in this string)" , "link": "Wikipedia article URL"}. 
    Events: ${JSON.stringify(events)}`;

    for (let i = 0; i < 3; i++) {
        try {
            const result = await model.generateContent(prompt);
            return result.response.text().replace(/```json|```/g, "").trim();
        } catch (error) {
            console.log(`Model ${modelName} busy, retrying...`);
            await new Promise(r => setTimeout(r, 10000));
        }
    }
    return null;
}

async function main() {
    if (fs.existsSync(CONFIG.SAVE_FILE) && fs.readFileSync(CONFIG.SAVE_FILE, 'utf8') === dateStamp) return;

    try {
        const events = await getWikipediaHistory();
        let responseText = await generateWithRetry(CONFIG.PRIMARY_MODEL, events) || await generateWithRetry(CONFIG.BACKUP_MODEL, events);

        const otdData = JSON.parse(responseText);
        await postToDiscord(otdData);
        fs.writeFileSync(CONFIG.SAVE_FILE, dateStamp);
        console.log("OTD successfully posted!");
    } catch (err) {
        console.error("Critical Error:", err);
        process.exit(1);
    }
}
main();

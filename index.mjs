import { GoogleGenerativeAI } from "@google/generative-ai";
import fetch from 'node-fetch';
import fs from 'fs';

const CONFIG = {
    GEMINI_KEY: process.env.GEMINI_API_KEY,
    DISCORD_URL: process.env.DISCORD_WEBHOOK_URL,
    SAVE_FILE: 'current_otd.txt',
    HISTORY_FILE: 'history_log.txt',
    PRIMARY_MODEL: "gemini-2.5-flash", 
    BACKUP_MODEL: "gemini-1.5-flash" 
};

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
    return data.events.slice(0, 20); 
}

async function postToDiscord(otdData) {
    const payload = {
        embeds: [{
            description: `**[${monthName} ${dayNum}, ${otdData.year}](${otdData.link})** — ${otdData.event}`,
            color: 0xe67e22 
        }]
    };
    await fetch(CONFIG.DISCORD_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
}

async function generateWithRetry(modelName, events, history) {
    const genAI = new GoogleGenerativeAI(CONFIG.GEMINI_KEY);
    const model = genAI.getGenerativeModel({ model: modelName });
    const prompt = `Pick the most interesting event from this list. 
    JSON ONLY: {"year": "YYYY", "event": "Summary", "link": "Wiki link"}. 
    DO NOT PICK ANY OF THESE RECENT YEARS: ${history.join(", ")}.
    Events: ${JSON.stringify(events)}`;

    for (let i = 0; i < 3; i++) {
        try {
            const result = await model.generateContent(prompt);
            const text = result.response.text().replace(/```json|```/g, "").trim();
            if (text) return text;
        } catch (error) {
            await new Promise(r => setTimeout(r, 10000));
        }
    }
    return null;
}

async function main() {
    // Check if already posted today
    if (fs.existsSync(CONFIG.SAVE_FILE)) {
        try {
            const current = JSON.parse(fs.readFileSync(CONFIG.SAVE_FILE, 'utf8'));
            if (current.datePosted === dateStamp) {
                console.log("Already posted today.");
                return;
            }
        } catch (e) {}
    }

    // Load history to prevent repeats
    let history = [];
    if (fs.existsSync(CONFIG.HISTORY_FILE)) {
        history = fs.readFileSync(CONFIG.HISTORY_FILE, 'utf8').split('\n').filter(Boolean);
    }

    try {
        const events = await getWikipediaHistory();
        let responseText = await generateWithRetry(CONFIG.PRIMARY_MODEL, events, history.slice(-50));
        if (!responseText) responseText = await generateWithRetry(CONFIG.BACKUP_MODEL, events, history.slice(-50));

        if (responseText) {
            const otdData = JSON.parse(responseText);
            otdData.datePosted = dateStamp; // Add date stamp for the "already posted" check
            otdData.fullString = `${monthName} ${dayNum}, ${otdData.year} — ${otdData.event}`;

            // 1. Post to Discord
            await postToDiscord(otdData);

            // 2. Save current for Mix It Up (saves full JSON)
            fs.writeFileSync(CONFIG.SAVE_FILE, JSON.stringify(otdData, null, 2));

            // 3. Update history log with the year to prevent repeats
            fs.appendFileSync(CONFIG.HISTORY_FILE, `${otdData.year}\n`);
            
            console.log("OTD Posted and Saved!");
        }
    } catch (err) {
        console.error("Critical Error:", err);
        process.exit(1);
    }
}
main();

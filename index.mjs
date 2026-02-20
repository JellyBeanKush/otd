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

const today = new Date();
const month = String(today.getMonth() + 1).padStart(2, '0');
const day = String(today.getDate()).padStart(2, '0');
const dateStamp = today.toLocaleDateString('sv-SE', { timeZone: 'America/Los_Angeles' });

async function getWikipediaHistory() {
    const url = `https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${month}/${day}`;
    // User-Agent is required for Wikipedia's API
    const res = await fetch(url, { headers: { 'User-Agent': 'HoneyBearSquish-OTD-Bot/1.0' } });
    const data = await res.json();
    return data.events.slice(0, 15); 
}

async function postToDiscord(otdData) {
    const payload = {
        // No username/avatar: respects the image you set for the webhook
        embeds: [{
            title: `On This Day in ${otdData.year}`,
            description: otdData.event,
            color: 0xe67e22, 
            url: otdData.link,
            footer: { text: "Historical Archive • HoneyBearSquish" }
        }]
    };
    await fetch(CONFIG.DISCORD_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
}

async function generateWithRetry(modelName, events) {
    const genAI = new GoogleGenerativeAI(CONFIG.GEMINI_KEY);
    const model = genAI.getGenerativeModel({ model: modelName });
    const prompt = `From these historical events, pick the one most interesting for a gaming/streaming community. JSON ONLY: {"year": "YYYY", "event": "A cool 2-sentence summary", "link": "Wiki link"}. Events: ${JSON.stringify(events)}`;

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
    if (fs.existsSync(CONFIG.SAVE_FILE) && fs.readFileSync(CONFIG.SAVE_FILE, 'utf8') === dateStamp) {
        console.log("Already posted today.");
        return;
    }

    try {
        const events = await getWikipediaHistory();
        let responseText = await generateWithRetry(CONFIG.PRIMARY_MODEL, events);
        
        if (!responseText) {
            responseText = await generateWithRetry(CONFIG.BACKUP_MODEL, events);
        }

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

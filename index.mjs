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
    
    return data.events.map(e => ({
        year: e.year,
        text: e.text,
        // We use the page title as a unique ID for the history log
        id: e.pages[0]?.title || e.text.substring(0, 30), 
        link: e.pages[0]?.content_urls.desktop.page || "",
        thumbnail: e.pages[0]?.thumbnail?.source || ""
    })).slice(0, 20);
}

async function postToDiscord(otdData) {
    const embed = {
        description: `**[${monthName} ${dayNum}, ${otdData.year}](${otdData.link})** — ${otdData.event}`,
        color: 0xe67e22 
    };

    if (otdData.thumbnail && otdData.thumbnail.startsWith('http')) {
        embed.thumbnail = { url: otdData.thumbnail };
    }

    await fetch(CONFIG.DISCORD_URL, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ embeds: [embed] }) 
    });
}

async function generateWithRetry(modelName, events, history) {
    const genAI = new GoogleGenerativeAI(CONFIG.GEMINI_KEY);
    const model = genAI.getGenerativeModel({ model: modelName });
    
    // We send the history of unique IDs to Gemini to avoid repeats
    const prompt = `Pick the most interesting historical event from this list. 
    Prefer events with a thumbnail. 
    JSON ONLY: {"year": "YYYY", "event": "2-sentence summary", "link": "Wiki link", "thumbnail": "URL", "id": "The unique ID of the event chosen"}. 
    STRICT: DO NOT PICK EVENTS WITH THESE IDs: ${history.join(", ")}.
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
    if (fs.existsSync(CONFIG.SAVE_FILE)) {
        try {
            const current = JSON.parse(fs.readFileSync(CONFIG.SAVE_FILE, 'utf8'));
            if (current.datePosted === dateStamp) return;
        } catch (e) {}
    }

    let history = [];
    if (fs.existsSync(CONFIG.HISTORY_FILE)) {
        // Load the unique IDs of past events
        history = fs.readFileSync(CONFIG.HISTORY_FILE, 'utf8').split('\n').filter(Boolean);
    }

    try {
        const events = await getWikipediaHistory();
        let responseText = await generateWithRetry(CONFIG.PRIMARY_MODEL, events, history.slice(-100));
        if (!responseText) responseText = await generateWithRetry(CONFIG.BACKUP_MODEL, events, history.slice(-100));

        if (responseText) {
            const otdData = JSON.parse(responseText);
            otdData.datePosted = dateStamp;
            otdData.fullString = `${monthName} ${dayNum}, ${otdData.year} — ${otdData.event}`;

            await postToDiscord(otdData);

            // Save for Mix It Up
            fs.writeFileSync(CONFIG.SAVE_FILE, JSON.stringify(otdData, null, 2));
            
            // Log the unique ID to the history file so we never repeat this specific event
            fs.appendFileSync(CONFIG.HISTORY_FILE, `${otdData.id}\n`);
            
            console.log("OTD successfully posted and logged!");
        }
    } catch (err) {
        process.exit(1);
    }
}
main();

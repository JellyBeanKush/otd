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

// Date formatting for Wikipedia API and the Discord message
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
    
    // Extract thumbnail and page data
    return data.events.map(e => ({
        year: e.year,
        text: e.text,
        link: e.pages[0]?.content_urls.desktop.page || "",
        thumbnail: e.pages[0]?.thumbnail?.source || ""
    })).slice(0, 20);
}

async function postToDiscord(otdData) {
    const embed = {
        // Hyperlinked Date: [Month Day, Year](Link) — Description
        description: `**[${monthName} ${dayNum}, ${otdData.year}](${otdData.link})** — ${otdData.event}`,
        color: 0xe67e22 
    };

    // Only add thumbnail if a valid URL exists
    if (otdData.thumbnail && otdData.thumbnail.startsWith('http')) {
        embed.thumbnail = { url: otdData.thumbnail };
    }

    const payload = { embeds: [embed] };
    
    await fetch(CONFIG.DISCORD_URL, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(payload) 
    });
}

async function generateWithRetry(modelName, events, history) {
    const genAI = new GoogleGenerativeAI(CONFIG.GEMINI_KEY);
    const model = genAI.getGenerativeModel({ model: modelName });
    
    const prompt = `Pick the most interesting historical event from this list. 
    Prefer events that have a thumbnail URL if available. 
    JSON ONLY: {"year": "YYYY", "event": "A punchy 2-sentence summary", "link": "Wiki link", "thumbnail": "thumbnail URL or empty string"}. 
    DO NOT PICK THESE YEARS: ${history.join(", ")}.
    Events: ${JSON.stringify(events)}`;

    for (let i = 0; i < 3; i++) {
        try {
            const result = await model.generateContent(prompt);
            const text = result.response.text().replace(/```json|```/g, "").trim();
            if (text) return text;
        } catch (error) {
            console.log(`Model ${modelName} busy, retrying...`);
            await new Promise(r => setTimeout(r, 10000));
        }
    }
    return null;
}

async function main() {
    // 1. Check if already posted today
    if (fs.existsSync(CONFIG.SAVE_FILE)) {
        try {
            const current = JSON.parse(fs.readFileSync(CONFIG.SAVE_FILE, 'utf8'));
            if (current.datePosted === dateStamp) {
                console.log("Already posted today.");
                return;
            }
        } catch (e) {}
    }

    // 2. Load history to prevent repeating the same year
    let history = [];
    if (fs.existsSync(CONFIG.HISTORY_FILE)) {
        history = fs.readFileSync(CONFIG.HISTORY_FILE, 'utf8').split('\n').filter(Boolean);
    }

    try {
        const events = await getWikipediaHistory();
        
        // 3. Generate content with Primary or Backup
        let responseText = await generateWithRetry(CONFIG.PRIMARY_MODEL, events, history.slice(-50));
        if (!responseText) {
            responseText = await generateWithRetry(CONFIG.BACKUP_MODEL, events, history.slice(-50));
        }

        if (responseText) {
            const otdData = JSON.parse(responseText);
            otdData.datePosted = dateStamp;
            otdData.fullString = `${monthName} ${dayNum}, ${otdData.year} — ${otdData.event}`;

            // 4. Send to Discord
            await postToDiscord(otdData);

            // 5. Save for Mix It Up and Persistence
            fs.writeFileSync(CONFIG.SAVE_FILE, JSON.stringify(otdData, null, 2));
            fs.appendFileSync(CONFIG.HISTORY_FILE, `${otdData.year}\n`);
            
            console.log("OTD successfully posted and saved!");
        }
    } catch (err) {
        console.error("Critical Error:", err);
        process.exit(1);
    }
}

main();

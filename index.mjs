import { GoogleGenerativeAI } from "@google/generative-ai";
import fetch from 'node-fetch';
import fs from 'fs';

const CONFIG = {
    GEMINI_KEY: process.env.GEMINI_API_KEY,
    DISCORD_URL: process.env.DISCORD_WEBHOOK_URL,
    SAVE_FILE: 'current_otd.txt',
    HISTORY_FILE: 'history_log.json',
    // AUTO-UPDATING MODELS:
    MODELS: [
        "gemini-flash-latest", // Points to Gemini 3.1 Flash-Lite
        "gemini-pro-latest",   // Points to Gemini 3.1 Pro
        "gemini-2.5-flash", 
        "gemini-1.5-flash"
    ]
};

const options = { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' };
const todayFormatted = new Date().toLocaleDateString('en-US', options);

const today = new Date();
const monthStr = String(today.getMonth() + 1).padStart(2, '0');
const dayStr = String(today.getDate()).padStart(2, '0');

async function getWikipediaHistory() {
    const url = `https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${monthStr}/${dayStr}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'HoneyBearSquish-OTD-Bot/1.0' } });
    const data = await res.json();
    
    return data.events.map(e => ({
        year: e.year,
        text: e.text,
        link: e.pages[0]?.content_urls.desktop.page || "",
        thumbnail: e.pages[0]?.thumbnail?.source || ""
    })).slice(0, 20);
}

async function postToDiscord(otdData) {
    const payload = {
        embeds: [{
            title: `On This Day - ${todayFormatted}`,
            description: `**[${otdData.year}](${otdData.link})** — ${otdData.event}`,
            color: 0xe67e22,
            thumbnail: otdData.thumbnail && otdData.thumbnail.startsWith('http') ? { url: otdData.thumbnail } : null
        }]
    };

    await fetch(CONFIG.DISCORD_URL, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(payload) 
    });
}

async function main() {
    let historyData = [];
    if (fs.existsSync(CONFIG.HISTORY_FILE)) {
        try { 
            historyData = JSON.parse(fs.readFileSync(CONFIG.HISTORY_FILE, 'utf8'));
        } catch (e) { historyData = []; }
    }

    if (historyData.length > 0 && historyData[0].datePosted === todayFormatted) {
        console.log("Already posted today.");
        return;
    }

    const usedLinks = historyData.slice(0, 50).map(h => h.link);
    const recentHistory = historyData.slice(0, 5).map(h => h.event).join(" | ");

    try {
        const events = await getWikipediaHistory();
        const genAI = new GoogleGenerativeAI(CONFIG.GEMINI_KEY);
        
        const prompt = `From the provided list, pick ONE interesting historical event. 
        CONTEXT: Your recent posts have been: ${recentHistory}
        VIBE: Aim for a mix of pop culture, scientific discoveries, space milestones, sports, or cool inventions. 
        STRICT: Choose categories like Music, Art, or Pop Culture today to keep the feed fresh. Avoid repetitive Space Race topics.
        STRICT: Use a mix of modern and older history for variety. 
        STRICT: Avoid events involving war crimes, dictators, or heavy tragedies unless it is an exceptionally unique milestone. 
        PRIORITY: Prefer events that have a thumbnail URL.
        STRICT FORMATTING:
        - Summarize the event in exactly TWO short, punchy sentences.
        - Maximum 40 words total.
        - JSON ONLY: {"year": "YYYY", "event": "Two sentence summary", "link": "Wiki link", "thumbnail": "URL"}.
        STRICT: DO NOT PICK THESE URLS: ${usedLinks.join(", ")}.
        Events: ${JSON.stringify(events)}`;

        let otdData = null;

        // Unified Fallback Loop
        for (const modelName of CONFIG.MODELS) {
            try {
                console.log(`Attempting OTD with ${modelName}...`);
                const model = genAI.getGenerativeModel({ model: modelName });
                const result = await model.generateContent(prompt);
                const responseText = result.response.text();
                
                const jsonMatch = responseText.match(/\{[\s\S]*\}/);
                otdData = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);
                
                console.log(`Success with ${modelName}!`);
                break; // Exit loop on success
            } catch (err) {
                console.warn(`${modelName} failed: ${err.message}`);
                if (modelName === CONFIG.MODELS[CONFIG.MODELS.length - 1]) throw err;
            }
        }

        if (otdData) {
            otdData.datePosted = todayFormatted;
            fs.writeFileSync(CONFIG.SAVE_FILE, JSON.stringify(otdData, null, 2));
            historyData.unshift(otdData);
            fs.writeFileSync(CONFIG.HISTORY_FILE, JSON.stringify(historyData, null, 2));
            await postToDiscord(otdData);
            console.log("OTD posted successfully!");
        }
    } catch (err) {
        console.error("Critical Error:", err);
        process.exit(1);
    }
}
main();

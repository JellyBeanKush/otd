import { GoogleGenerativeAI } from "@google/generative-ai";
import fetch from 'node-fetch';
import fs from 'fs';

const CONFIG = {
    GEMINI_KEY: process.env.GEMINI_API_KEY,
    DISCORD_URL: process.env.DISCORD_WEBHOOK_URL,
    SAVE_FILE: 'current_otd.txt',
    HISTORY_FILE: 'history_log.json',
    // 2026 Stable Autopilot Models
    MODELS: [
        "gemini-3.1-flash-lite-preview", 
        "gemini-3-flash-preview",
        "gemini-2.5-flash",
        "gemini-1.5-flash"
    ]
};

const today = new Date();
const monthStr = String(today.getMonth() + 1).padStart(2, '0');
const dayStr = String(today.getDate()).padStart(2, '0');
const options = { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' };
const todayFormatted = today.toLocaleDateString('en-US', options);

async function getWikipediaHistory() {
    try {
        const url = `https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${monthStr}/${dayStr}`;
        const res = await fetch(url, { headers: { 'User-Agent': 'HoneyBearBot/1.0' } });
        const data = await res.json();
        
        // Only return events that HAVE a thumbnail to prevent empty images
        const filtered = data.events.filter(e => e.pages[0]?.thumbnail?.source);
        
        // If the filtered list is too small, fallback to the full list
        const sourceList = filtered.length > 5 ? filtered : data.events;

        return sourceList.map(e => ({
            year: e.year,
            text: e.text,
            link: e.pages[0]?.content_urls.desktop.page || "",
            thumbnail: e.pages[0]?.thumbnail?.source || ""
        })).slice(0, 25);
    } catch (err) {
        console.error("Wikipedia Feed Error:", err.message);
        return [];
    }
}

async function main() {
    let history = [];
    if (fs.existsSync(CONFIG.HISTORY_FILE)) {
        try { history = JSON.parse(fs.readFileSync(CONFIG.HISTORY_FILE, 'utf8')); } catch (e) { history = []; }
    }

    if (history.length > 0 && history[0].datePosted === todayFormatted) {
        console.log("Already posted for today.");
        return;
    }

    const events = await getWikipediaHistory();
    if (events.length === 0) throw new Error("Could not fetch Wikipedia events.");

    const usedLinks = history.slice(0, 50).map(h => h.link);
    const genAI = new GoogleGenerativeAI(CONFIG.GEMINI_KEY);

    const prompt = `From this list of historical events, pick ONE interesting pop-culture/tech event.
    CRITICAL: Pick an event that has a thumbnail URL provided.
    ${JSON.stringify(events)}
    
    JSON ONLY: {"year": "YYYY", "event": "Two punchy sentences", "link": "Wiki URL", "thumbnail": "Image URL"}.
    Avoid: ${usedLinks.join(", ")}`;

    for (const modelName of CONFIG.MODELS) {
        try {
            console.log(`Attempting OTD with ${modelName}...`);
            const model = genAI.getGenerativeModel({ 
                model: modelName,
                // Fixed 2026 CamelCase field name
                generationConfig: { responseMimeType: "application/json" }
            });

            const result = await model.generateContent(prompt);
            const responseText = result.response.text();
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            const otdData = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);
            
            otdData.datePosted = todayFormatted;

            fs.writeFileSync(CONFIG.SAVE_FILE, JSON.stringify(otdData, null, 2));
            history.unshift(otdData);
            fs.writeFileSync(CONFIG.HISTORY_FILE, JSON.stringify(history, null, 2));

            const payload = {
                embeds: [{
                    title: `On This Day - ${todayFormatted}`,
                    description: `**[${otdData.year}](${otdData.link})** — ${otdData.event}`,
                    color: 0xe67e22,
                    // Ensures the thumbnail block is only created if a link exists
                    thumbnail: otdData.thumbnail ? { url: otdData.thumbnail } : null
                }]
            };

            await fetch(CONFIG.DISCORD_URL, { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify(payload) 
            });

            console.log(`Success! Posted ${otdData.year} event.`);
            return;
        } catch (err) {
            console.warn(`⚠️ ${modelName} failed: ${err.message}`);
            if (err.message.includes("429")) await new Promise(r => setTimeout(r, 10000));
        }
    }
}

main().catch(err => { console.error(err); process.exit(1); });

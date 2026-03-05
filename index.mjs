import { GoogleGenerativeAI } from "@google/generative-ai";
import fetch from 'node-fetch';
import fs from 'fs';

const CONFIG = {
    GEMINI_KEY: process.env.GEMINI_API_KEY,
    DISCORD_URL: process.env.DISCORD_WEBHOOK_URL,
    SAVE_FILE: 'current_otd.txt',
    HISTORY_FILE: 'history_log.json',
    MODELS: [
        "gemini-flash-latest", 
        "gemini-pro-latest", 
        "gemini-2.5-flash", 
        "gemini-1.5-flash"
    ]
};

const today = new Date();
const monthStr = String(today.getMonth() + 1).padStart(2, '0');
const dayStr = String(today.getDate()).padStart(2, '0');
const options = { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' };
const todayFormatted = today.toLocaleDateString('en-US', options);

/**
 * Fetches the raw 'On This Day' feed from Wikipedia's REST API.
 */
async function getWikipediaHistory() {
    try {
        const url = `https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${monthStr}/${dayStr}`;
        const res = await fetch(url, { headers: { 'User-Agent': 'HoneyBearBot/1.0' } });
        const data = await res.json();
        
        // Map to a cleaner format for the AI to read
        return data.events.map(e => ({
            year: e.year,
            text: e.text,
            link: e.pages[0]?.content_urls.desktop.page || "",
            thumbnail: e.pages[0]?.thumbnail?.source || ""
        })).slice(0, 25); // Give AI the top 25 choices
    } catch (err) {
        console.error("Wikipedia Feed Error:", err.message);
        return [];
    }
}

async function main() {
    let history = [];
    if (fs.existsSync(CONFIG.HISTORY_FILE)) {
        try { 
            history = JSON.parse(fs.readFileSync(CONFIG.HISTORY_FILE, 'utf8')); 
        } catch (e) { history = []; }
    }

    if (history.length > 0 && history[0].datePosted === todayFormatted) {
        console.log("Already posted 'On This Day' for today.");
        return;
    }

    const events = await getWikipediaHistory();
    if (events.length === 0) throw new Error("Could not fetch Wikipedia events.");

    const usedLinks = history.slice(0, 50).map(h => h.link);
    const genAI = new GoogleGenerativeAI(CONFIG.GEMINI_KEY);

    const prompt = `From this list of historical events, pick ONE that would be interesting to a gaming and pop-culture community:
    ${JSON.stringify(events)}
    
    STRICT GUIDELINES:
    1. Prioritize Music, Art, Gaming, or Pop Culture.
    2. Avoid depressing topics (war, death, disasters).
    3. JSON ONLY format: {"year": "YYYY", "event": "Exactly two punchy sentences", "link": "Wiki URL", "thumbnail": "Image URL"}.
    4. DO NOT USE: ${usedLinks.join(", ")}`;

    for (const modelName of CONFIG.MODELS) {
        try {
            console.log(`Attempting OTD with ${modelName}...`);
            const model = genAI.getGenerativeModel({ 
                model: modelName,
                generationConfig: { response_mime_type: "application/json" }
            });

            const result = await model.generateContent(prompt);
            const responseText = result.response.text();
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            const otdData = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);
            
            otdData.datePosted = todayFormatted;

            // Save Master JSON
            fs.writeFileSync(CONFIG.SAVE_FILE, JSON.stringify(otdData, null, 2));
            
            // Save Infinite History
            history.unshift(otdData);
            fs.writeFileSync(CONFIG.HISTORY_FILE, JSON.stringify(history, null, 2));

            const payload = {
                embeds: [{
                    title: `On This Day - ${todayFormatted}`,
                    description: `**[${otdData.year}](${otdData.link})** — ${otdData.event}`,
                    color: 0xe67e22, // Orange
                    thumbnail: otdData.thumbnail ? { url: otdData.thumbnail } : null
                }]
            };

            await fetch(CONFIG.DISCORD_URL, { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify(payload) 
            });

            console.log(`Successfully posted ${otdData.year} event!`);
            return;
        } catch (err) {
            console.warn(`⚠️ ${modelName} failed: ${err.message}`);
            if (err.message.includes("429")) await new Promise(r => setTimeout(r, 10000));
        }
    }
}

main().catch(err => { console.error(err); process.exit(1); });

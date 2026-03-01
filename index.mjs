import { GoogleGenerativeAI } from "@google/generative-ai";
import fetch from 'node-fetch';
import fs from 'fs';

const CONFIG = {
    GEMINI_KEY: process.env.GEMINI_API_KEY,
    DISCORD_URL: process.env.DISCORD_WEBHOOK_URL,
    SAVE_FILE: 'current_otd.txt',
    HISTORY_FILE: 'history_log.json',
    PRIMARY_MODEL: "gemini-2.5-flash", 
    BACKUP_MODEL: "gemini-1.5-flash" 
};

// Exact format: "March 1, 2026"
const options = { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' };
const todayFormatted = new Date().toLocaleDateString('en-US', options);

// Date parts for Wikipedia API
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
    })).slice(0, 30); // Increased slice slightly to give Gemini more variety to pick from
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

async function generateWithRetry(modelName, events, usedLinks, recentHistory) {
    const genAI = new GoogleGenerativeAI(CONFIG.GEMINI_KEY);
    const model = genAI.getGenerativeModel({ model: modelName });
    
    const prompt = `From the provided list, pick ONE interesting historical event. 
    
    CRITICAL - PREVIOUS POSTS: ${recentHistory}
    
    VIBE: You have been very focused on the Space Race lately. PLEASE VARY THE TOPIC. 
    Try to pick something from Pop Culture, Music, Sports, Art, or a unique Invention. 
    Only pick a Space event if it is the ONLY high-quality option with a thumbnail.

    STRICT: Avoid events involving war crimes, dictators, or heavy tragedies. 
    PRIORITY: Prefer events that have a thumbnail URL.
    
    STRICT FORMATTING:
    - Summarize the event in exactly TWO short, punchy sentences.
    - Maximum 40 words total.
    - JSON ONLY: {"year": "YYYY", "event": "Two sentence summary", "link": "Wiki link", "thumbnail": "URL"}.
    
    STRICT: DO NOT PICK THESE URLS: ${usedLinks.join(", ")}.
    Events: ${JSON.stringify(events)}`;

    for (let i = 0; i < 3; i++) {
        try {
            const result = await model.generateContent(prompt);
            const text = result.response.text().replace(/```json|```/g, "").trim();
            // Validate it's actually JSON before returning
            JSON.parse(text);
            return text;
        } catch (error) {
            console.log(`Retry ${i+1} failed for ${modelName}...`);
            await new Promise(r => setTimeout(r, 5000));
        }
    }
    return null;
}

async function main() {
    let historyData = [];
    
    // 1. Load JSON History
    if (fs.existsSync(CONFIG.HISTORY_FILE)) {
        try { 
            const content = fs.readFileSync(CONFIG.HISTORY_FILE, 'utf8');
            historyData = JSON.parse(content);
        } catch (e) { historyData = []; }
    }

    // 2. Prevent Double Posting
    if (historyData.length > 0 && historyData[0].datePosted === todayFormatted) {
        console.log("Already posted today.");
        return;
    }

    // 3. Prepare context for the AI
    const usedLinks = historyData.slice(0, 50).map(h => h.link);
    const recentHistory = historyData.slice(0, 5).map(h => `${h.year}: ${h.event}`).join(" | ");

    try {
        const events = await getWikipediaHistory();
        let responseText = await generateWithRetry(CONFIG.PRIMARY_MODEL, events, usedLinks, recentHistory);
        
        if (!responseText) {
            console.log("Switching to backup model...");
            responseText = await generateWithRetry(CONFIG.BACKUP_MODEL, events, usedLinks, recentHistory);
        }

        if (responseText) {
            const otdData = JSON.parse(responseText);
            otdData.datePosted = todayFormatted;

            // 4. Save current_otd.txt for Mix It Up
            fs.writeFileSync(CONFIG.SAVE_FILE, JSON.stringify(otdData, null, 2));

            // 5. Update JSON History (Adds to top)
            historyData.unshift(otdData);
            fs.writeFileSync(CONFIG.HISTORY_FILE, JSON.stringify(historyData.slice(0, 100), null, 2));

            await postToDiscord(otdData);
            console.log("OTD posted successfully!");
        } else {
            console.error("Failed to generate content after all retries.");
        }
    } catch (err) {
        console.error("Critical Error:", err);
        process.exit(1);
    }
}

main();

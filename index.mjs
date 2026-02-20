import { GoogleGenerativeAI } from "@google/generative-ai";
import fetch from 'node-fetch';
import fs from 'fs';

const CONFIG = {
    GEMINI_KEY: process.env.GEMINI_API_KEY,
    GROQ_KEY: process.env.GROQ_API_KEY,
    DISCORD_URL: "https://discord.com/api/webhooks/1474196919332114574/3dxnI_sWfWeyKHIjNruIwl7T4_d6a0j7Ilm-lZxEudJsgxyKBUBgQqgBFczLF9fXOUwk",
    SAVE_FILE: 'current_otd.txt',
    LOG_FILE: 'history_log.txt' // This is the bot's memory
};

const today = new Date().toLocaleDateString('en-US', {month: 'long', day: 'numeric'});

// Load the "memory" file
let postedEvents = [];
if (fs.existsSync(CONFIG.LOG_FILE)) {
    postedEvents = fs.readFileSync(CONFIG.LOG_FILE, 'utf8').split('\n');
}

// We tell the AI what to avoid
const PROMPT = `Find one significant historical event that happened on ${today} in the past. 
DO NOT use any of these events: [${postedEvents.join(', ')}].
JSON ONLY: {"year": "YYYY", "event": "description", "source": "url"}`;

async function isLinkValid(url) {
    if (!url || !url.startsWith('http')) return false;
    try {
        const response = await fetch(url, { method: 'HEAD', timeout: 5000 });
        return response.ok;
    } catch { return false; }
}

async function postToDiscord(data) {
    const validLink = await isLinkValid(data.source);
    const descriptionText = validLink 
        ? `${data.event}\n\n🔗 **[Read More](${data.source})**`
        : data.event;

    await fetch(CONFIG.DISCORD_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            username: "On This Day",
            embeds: [{
                title: `📅 On This Day: ${today}, ${data.year}`,
                description: descriptionText,
                color: 0xffaa00 
            }]
        })
    });
}

async function main() {
    let historyFact = null;

    // TIER 1: GEMINI 3
    try {
        const genAI = new GoogleGenerativeAI(CONFIG.GEMINI_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview", tools: [{ googleSearch: {} }] });
        const result = await model.generateContent(PROMPT);
        historyFact = JSON.parse(result.response.text().replace(/```json|```/g, "").trim());
        
        // Anti-repeat check: If AI gave us a duplicate despite instructions, we'd normally loop, 
        // but for now, we'll log it and move on.
    } catch (e) { console.log("Tier 1 failed, trying fallback..."); }

    // TIER 2: GROQ FALLBACK
    if (!historyFact && CONFIG.GROQ_KEY) {
        try {
            const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: { "Authorization": `Bearer ${CONFIG.GROQ_KEY}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: "llama-3.3-70b-versatile",
                    messages: [{ role: "user", content: PROMPT }],
                    response_format: { type: "json_object" }
                })
            });
            const json = await response.json();
            historyFact = JSON.parse(json.choices[0].message.content);
        } catch (e) { console.log("Tier 2 failed..."); }
    }

    if (!historyFact) {
        // Emergency Backup (Simplified)
        historyFact = { year: "1473", event: "Astronomer Nicolaus Copernicus was born.", source: "https://nasa.gov" };
    }

    // --- SAVING DATA ---
    // 1. Save for Mix It Up
    fs.writeFileSync(CONFIG.SAVE_FILE, `In ${historyFact.year}, ${historyFact.event}`);
    
    // 2. Add to Memory (Log)
    fs.appendFileSync(CONFIG.LOG_FILE, `${historyFact.year}: ${historyFact.event.substring(0, 30)}...\n`);

    await postToDiscord(historyFact);
}

main();

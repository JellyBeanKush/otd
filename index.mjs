import { GoogleGenerativeAI } from "@google/generative-ai";
import fetch from 'node-fetch';
import fs from 'fs';

const CONFIG = {
    GEMINI_KEY: process.env.GEMINI_API_KEY,
    GROQ_KEY: process.env.GROQ_API_KEY,
    DISCORD_URL: "https://discord.com/api/webhooks/1474196919332114574/3dxnI_sWfWeyKHIjNruIwl7T4_d6a0j7Ilm-lZxEudJsgxyKBUBgQqgBFczLF9fXOUwk",
    SAVE_FILE: 'current_otd.txt',
    LOG_FILE: 'history_log.txt'
};

const today = new Date().toLocaleDateString('en-US', {month: 'long', day: 'numeric'});

// 🧠 LOAD MEMORY
let historyLog = "";
if (fs.existsSync(CONFIG.LOG_FILE)) {
    historyLog = fs.readFileSync(CONFIG.LOG_FILE, 'utf8');
}

// 🎯 THE "STRANGE HISTORY" PROMPT
const PROMPT = `Find one significant but UNUSUAL or WEIRD historical event that happened on ${today}. 
Focus on: bizarre laws, strange discoveries, engineering oddities, or "human interest" history.
STRICT RULE: Do not return any of these previous events: [${historyLog.split('\n').slice(-10).join(', ')}]
JSON ONLY: {"year": "YYYY", "event": "description", "source": "url"}`;

async function isLinkValid(url) {
    if (!url || !url.startsWith('http')) return false;
    try {
        // Checking if the link is actually alive
        const response = await fetch(url, { method: 'GET', timeout: 5000 });
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

    // TIER 1: GEMINI 3 (Primary Search)
    try {
        console.log("🚀 Searching for weird history...");
        const genAI = new GoogleGenerativeAI(CONFIG.GEMINI_KEY);
        const model = genAI.getGenerativeModel({ 
            model: "gemini-3-flash-preview", 
            tools: [{ googleSearch: {} }] 
        });
        const result = await model.generateContent(PROMPT);
        const text = result.response.text().replace(/```json|```/g, "").trim();
        historyFact = JSON.parse(text);
    } catch (e) {
        console.log("Tier 1 failed, trying fallback...");
    }

    // TIER 2: GROQ (Llama 3.3)
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
        } catch (e) {
            console.log("Tier 2 failed.");
        }
    }

    // TIER 3: EMERGENCY (Last resort)
    if (!historyFact) {
        historyFact = { 
            year: "1859", 
            event: "The 'Pig War' nearly started over a pig shot on San Juan Island.", 
            source: "https://www.nps.gov/sajh/learn/historyculture/the-pig-war.htm" 
        };
    }

    // --- SAVE & LOG ---
    const saveString = `In ${historyFact.year}, ${historyFact.event}`;
    fs.writeFileSync(CONFIG.SAVE_FILE, saveString);
    
    // Log only the year and first 40 chars to keep the file small but searchable
    fs.appendFileSync(CONFIG.LOG_FILE, `${historyFact.year}: ${historyFact.event.substring(0, 40)}\n`);

    await postToDiscord(historyFact);
    console.log("✅ Done!");
}

main();

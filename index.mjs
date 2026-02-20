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

const today = new Date().toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', timeZone: 'America/Los_Angeles' 
});

const PROMPT = `Find one significant but UNUSUAL historical event that happened strictly on ${today}. 
JSON ONLY: {"year": "YYYY", "day": "${today}", "event": "description", "source": "url"}`;

async function isLinkValid(url) {
    if (!url || !url.startsWith('http')) return false;
    try {
        const response = await fetch(url, { method: 'GET', timeout: 5000 });
        return response.ok;
    } catch { return false; }
}

async function postToDiscord(data) {
    if (data.day !== today) return;
    const validLink = await isLinkValid(data.source);
    const descriptionText = validLink ? `${data.event}\n\n🔗 **[Read More](${data.source})**` : data.event;

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

    // TIER 1: GEMINI
    if (CONFIG.GEMINI_KEY) {
        try {
            console.log("🚀 Trying Gemini...");
            const genAI = new GoogleGenerativeAI(CONFIG.GEMINI_KEY);
            const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview", tools: [{ googleSearch: {} }] });
            const result = await model.generateContent(PROMPT);
            historyFact = JSON.parse(result.response.text().replace(/```json|```/g, "").trim());
        } catch (e) { console.log(`⚠️ Gemini Failed: ${e.message}`); }
    }

    // TIER 2: GROQ (The Backup)
    if (!historyFact && CONFIG.GROQ_KEY) {
        try {
            console.log("⚡ Gemini failed. Switching to Groq Backup...");
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
            if (json.choices) {
                historyFact = JSON.parse(json.choices[0].message.content);
                console.log("✅ Groq Backup Saved the Day!");
            } else {
                console.log(`❌ Groq Error Detail: ${JSON.stringify(json)}`);
            }
        } catch (e) { console.log(`⚠️ Groq Backup Failed: ${e.message}`); }
    }

    if (historyFact && historyFact.day === today) {
        fs.writeFileSync(CONFIG.SAVE_FILE, `In ${historyFact.year}, ${historyFact.event}`);
        fs.appendFileSync(CONFIG.LOG_FILE, `${today} (${historyFact.year}): ${historyFact.event.substring(0, 40)}\n`);
        await postToDiscord(historyFact);
    } else {
        console.error("💀 BOTH APIs FAILED. No post today.");
    }
}
main();

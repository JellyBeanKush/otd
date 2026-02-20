import { GoogleGenerativeAI } from "@google/generative-ai";
import fetch from 'node-fetch';

const CONFIG = {
    GEMINI_KEY: process.env.GEMINI_API_KEY,
    GROQ_KEY: process.env.GROQ_API_KEY,
    DISCORD_URL: "https://discord.com/api/webhooks/1474172208187445339/ILPeGeXs2MXh6wCsqPzJw7z5Pc8K6gyAHWLEvH0r8Xvy-MoOMcqTQmI0tuW6r7whB3En"
};

const PROMPT = `Find one significant historical event that happened on this specific calendar day in the past. 
JSON ONLY: {"year": "YYYY", "event": "description", "source": "url"}`;

// Tier 3: Internal Emergency Backup
const EMERGENCY_HISTORY = [
    { year: "1473", event: "Astronomer Nicolaus Copernicus was born in Torun, Poland.", source: "https://www.nasa.gov/history/100-years-ago-copernicus/" },
    { year: "1945", event: "The Battle of Iwo Jima began as U.S. Marines landed on the island.", source: "https://www.history.com/topics/world-war-ii/battle-of-iwo-jima" }
];

async function postToDiscord(data) {
    console.log("📤 Posting On This Day to Discord...");
    const res = await fetch(CONFIG.DISCORD_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            username: "History Bot",
            embeds: [{
                title: `📅 On This Day in ${data.year}`,
                description: `${data.event}\n\n🔗 **[Read More](${data.source})**`,
                color: 0xffaa00 // History Gold
            }]
        })
    });
    console.log(res.ok ? "✅ History Posted!" : `❌ Discord Error: ${res.status}`);
}

async function main() {
    let historyFact = null;

    // TIER 1: GEMINI 3 FLASH
    try {
        console.log("🚀 Tier 1: Gemini 3 History Search...");
        const genAI = new GoogleGenerativeAI(CONFIG.GEMINI_KEY);
        const model = genAI.getGenerativeModel({ 
            model: "gemini-3-flash-preview", 
            tools: [{ googleSearch: {} }] 
        });
        const result = await model.generateContent(PROMPT);
        const text = result.response.text().replace(/```json|```/g, "").trim();
        historyFact = JSON.parse(text);
    } catch (e) {
        console.log(`⚠️ Gemini 3 History Failed: ${e.message}`);
    }

    // TIER 2: GROQ (LLAMA 3.3)
    if (!historyFact && CONFIG.GROQ_KEY) {
        try {
            console.log("⚡ Tier 2: Groq History Fallback...");
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
            console.log(`⚠️ Groq History Failed: ${e.message}`);
        }
    }

    // TIER 3: EMERGENCY
    if (!historyFact) {
        console.log("📦 Tier 3: Using internal history backup...");
        historyFact = EMERGENCY_HISTORY[Math.floor(Math.random() * EMERGENCY_HISTORY.length)];
    }

    await postToDiscord(historyFact);
}

main();

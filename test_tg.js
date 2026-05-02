const { Telegraf } = require("telegraf");
const bot = new Telegraf("8688639442:AAENlm8Uai6bqBsxCpDH5sDG8u4Sl-Mp7As");
console.log("Launching...");
bot.launch().then(() => console.log("Launched!")).catch(console.error);

#!/usr/bin/env node
/**
 * Z1/Z4: разовый тестовый звонок через Voximplant, чтобы услышать реплику своими ушами.
 *
 * Локальный ручной инструмент. Ничего не пишет в БД, не ходит в WB, не знает про заказы.
 * Боевой контур будет отдельным модулем `bots/shared/wb-voice-call.ts`.
 *
 * Подготовка (этап Г0):
 *   1. Аккаунт на voximplant.ru, приложение и правило (rule) со сценарием
 *      `scripts/voximplant/dbs-call.js`, в сценарии заполнить CALLER_ID.
 *   2. В .env добавить:
 *      VOXIMPLANT_ACCOUNT_ID=…
 *      VOXIMPLANT_API_KEY=…
 *      VOXIMPLANT_RULE_ID=…
 *
 * Использование:
 *   node scripts/voximplant-test-call.mjs +79001234567             # реплика «пришлите код»
 *   node scripts/voximplant-test-call.mjs +79001234567 --chat      # реплика «откройте чат»
 *   node scripts/voximplant-test-call.mjs +79001234567 --ext 464   # с проходом IVR Wildberries
 */
import 'dotenv/config';

const args = process.argv.slice(2);
const phone = (args.find((a) => /^\+?\d{10,15}$/.test(a)) || '').replace(/\D/g, '');
const script = args.includes('--chat') ? 'chat' : 'code';
const extIdx = args.indexOf('--ext');
const ext = extIdx >= 0 ? String(args[extIdx + 1] || '').replace(/\D/g, '') : '';

if (!phone) {
  console.error('Укажите номер: node scripts/voximplant-test-call.mjs +79001234567 [--chat] [--ext 464]');
  process.exit(1);
}
const account = process.env.VOXIMPLANT_ACCOUNT_ID;
const apiKey = process.env.VOXIMPLANT_API_KEY;
const ruleId = process.env.VOXIMPLANT_RULE_ID;
if (!account || !apiKey || !ruleId) {
  console.error('Нет VOXIMPLANT_ACCOUNT_ID / VOXIMPLANT_API_KEY / VOXIMPLANT_RULE_ID в .env.');
  console.error('Это этап Г0 из docs/wb-voice-call-plan.md — аккаунт ещё не заведён.');
  process.exit(1);
}

const customData = JSON.stringify({ phone, ext, script, orderId: 'TEST', webhook: '', sig: '' });
const body = new URLSearchParams({
  account_id: account,
  api_key: apiKey,
  rule_id: ruleId,
  script_custom_data: customData,
});

console.log(`Звоню на +${phone}, реплика «${script === 'chat' ? 'откройте чат' : 'пришлите код'}»${ext ? `, добавочный ${ext}` : ''}…`);
const r = await fetch('https://api.voximplant.com/platform_api/StartScenarios/', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body,
});
const out = await r.json().catch(() => ({}));
console.log(JSON.stringify(out, null, 2));
if (out?.result === 1 || out?.result === true) {
  console.log('\nСценарий запущен. Трубка должна зазвонить в течение нескольких секунд.');
  console.log('Запись и логи звонка — в кабинете Voximplant, раздел History.');
} else {
  console.log('\nЗвонок не запустился. Частые причины: не хватает баланса, номер не куплен,');
  console.log('на пробном тарифе номер получателя не подтверждён в кабинете.');
}

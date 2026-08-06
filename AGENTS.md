<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Документация — держать в актуальном состоянии

После **каждого** фикса, апдейта или фичи обновляй соответствующий файл документации в той же
задаче (не откладывая):

- Изменения в поведении/архитектуре → нужный файл в `docs/` (`docs/README.md` — карта: гейт/боты/
  TWA/БД/деплой/безопасность).
- Текущее состояние, инфра-доступ, backlog, итоги сессии → локальный `HANDOFF.md` (в `.gitignore`).
- Новый риск безопасности → `docs/security.md`.

Секреты, IP серверов, Coolify UUID и токены — **только** в `HANDOFF.md` (не трекается) или env.
Репозиторий публичный: в `docs/` и любой коммит не должно попадать ничего чувствительного.

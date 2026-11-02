# Worklog консолидации 2026-11-02

База runtime-работ: `main@36396a4b15b7be8902d6164846da9a51fa8c5407`.

Роли:
- `kafedra-flow-intake`: canonical user flow и backlog truth;
- `kafedra-feature`: frontend consolidation и вертикальная реализация;
- `kafedra-design`: auth/error/review UX;
- `kafedra-tests`: targeted regression;
- `kafedra-release`: version/release consistency.

Независимого agent runner в текущей сессии нет; это распределение законченных зон ответственности, а интеграцию выполняет основной исполнитель.

## Порядок

1. Backlog cleanup без runtime-изменений.
2. Dead frontend code cleanup только после доказательства отсутствия входов.
3. Auth/error/AI safety fixes с targeted tests.
4. Ordinary CI / risk gates, squash merge.
5. Release patch с exact main SHA.

## Запреты

- не менять SQLite schema;
- не менять immutable document/evidence contract;
- не добавлять второй task/document registry;
- не делать LLM обязательной;
- не создавать version-specific workflow;
- не закрывать Issue без доказанного supersede/completion.

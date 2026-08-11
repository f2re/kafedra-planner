# OCR, исходный вид и структурные поля

Версия: `0.1.0-alpha.5`.

## Пользовательский поток

1. Оператор загружает PDF, изображение или офисный документ.
2. Worker извлекает существующий текстовый слой.
3. Если PDF практически не содержит текста, выполняется OCR.
4. Для изображения OCR запускается сразу.
5. В инспекторе одновременно доступны исходный вид документа, структурные блоки, извлечённые значения и ссылка на оригинал.
6. Выбранный абзац, ячейку или строку страницы можно использовать как основу поля шаблона.
7. На следующих документах система сначала ищет тот же структурный локатор, затем использует текстовый якорь как резерв.

## Runtime распознавания

В полном offline bundle используется управляемый CPython `runtime/python/python`. Worker вызывает `scripts/recognition/ocr.py`, а адаптер уже запускает Tesseract/Poppler. На target не требуется системный Python, venv, pip или пользовательские packages. Для development сохранён прямой Node→Tesseract fallback.

## Системные компоненты

- `tesseract` — распознавание изображений;
- языковые пакеты `rus` и `eng`;
- `pdftoppm` — преобразование страниц сканированного PDF в изображения;
- `pdftotext` — извлечение существующего PDF-текста и координат;
- `soffice` или `libreoffice` — PDF-предпросмотр DOCX, XLSX, ODT и ODS.

В development отсутствие дополнительной утилиты переводит документ в проверку. В full offline deployment эти компоненты обязательны и проверяются installer до активации release. Документ сохраняется, а оператор получает конкретный вопрос проверки.

## Переменные среды

```text
KAFEDRA_OCR_ENABLED=true
KAFEDRA_OCR_BACKEND=python
KAFEDRA_OCR_LANGUAGES=rus+eng
KAFEDRA_OCR_DPI=250
KAFEDRA_OCR_MAX_PAGES=50
KAFEDRA_OCR_MIN_CHARACTERS=40
KAFEDRA_RECOGNITION_PYTHON=/opt/kafedra-planner/current/runtime/python/python
KAFEDRA_RECOGNITION_SCRIPT=/opt/kafedra-planner/current/scripts/recognition/ocr.py
KAFEDRA_PREVIEW_ENABLED=true
```

## Достоверность

OCR-геометрия хранится как адресуемые строки страницы. Ручное исправление по-прежнему не заменяет машинное значение: оно создаёт отдельную ревизию с причиной и выбранным фрагментом.

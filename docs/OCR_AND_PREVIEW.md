# OCR, исходный вид и структурные поля

Документ описывает текущий контур `0.1.0-rc.6`; точная версия приложения хранится в корневом `VERSION`.

## Пользовательский поток

1. Оператор загружает PDF, изображение или офисный документ.
2. Worker извлекает доступный текстовый слой и структуру.
3. Если PDF практически не содержит текста, локально запускается OCR.
4. Для изображения OCR запускается сразу при включённой capability.
5. Для DOCX/XLSX/ODT/ODS при наличии LibreOffice формируется PDF-preview, при этом исходный файл не изменяется.
6. В инспекторе доступны оригинал/preview, структурные блоки, извлечённые значения и доказательства.
7. Ручное исправление сохраняется отдельной ревизией и не уничтожает машинный результат.

## Runtime распознавания

В полном offline bundle используется managed CPython:

```text
/opt/kafedra-planner/current/runtime/python/python
```

Worker вызывает существующий адаптер:

```text
scripts/recognition/ocr.py
```

На target не требуются system Python, venv, pip или пользовательские Python packages. Системные Tesseract/Poppler/LibreOffice поставляются как target-specific application capabilities полного bundle.

## Системные компоненты

- `tesseract` — OCR изображений;
- языки `rus` и `eng`;
- `pdftoppm` — рендер страниц сканированного PDF;
- `pdftotext` — текстовый слой и PDF-локаторы;
- `soffice`/`libreoffice` — preview офисных документов.

В development отсутствие необязательной capability не уничтожает документ: задача получает понятную диагностическую ошибку/вопрос проверки. В full offline deployment installer проверяет обязательные для full-профиля возможности до активации release.

## Конфигурация

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

## Диагностика установленной системы

```bash
sudo /opt/kafedra-planner/current/scripts/offline/doctor.sh
```

Full doctor проверяет Poppler, Tesseract `rus+eng`, LibreOffice и managed Python. Подробности установки: [`OFFLINE_INSTALL.md`](OFFLINE_INSTALL.md).

## Достоверность

OCR-геометрия и структурные локаторы являются доказательством машинного результата, а не абсолютной истиной. Оператор может исправить значение, но исходная версия документа, машинное значение и локатор сохраняются в истории.

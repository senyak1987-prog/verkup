# Встроенные шрифты

Все файлы получены из официального репозитория [Google Fonts](https://github.com/google/fonts).
Roboto Slab — каталог `apache/robotoslab`, лицензия Apache 2.0 (`robotoslab-LICENSE.txt`).
Остальные семейства — каталоги `ofl`, лицензия SIL Open Font License 1.1; копии OFL находятся рядом с файлами TTF.

В подборке 14 встроенных семейств и системные Arial / Arial Black. Близкие гротески Montserrat, Rubik и Raleway скрыты из нового выбора; их файлы сохраняются для точного открытия прежних проектов.

Новые визуально отличающиеся семейства (официальные файлы без изменений):

- [Rubik Mono One](https://github.com/google/fonts/tree/main/ofl/rubikmonoone), `RubikMonoOne-Regular.ttf`; лицензия `rubikmonoone-OFL.txt`.
- [Pacifico](https://github.com/google/fonts/tree/main/ofl/pacifico), `Pacifico-Regular.ttf`; лицензия `pacifico-OFL.txt`.
- [Amatic SC Bold](https://github.com/google/fonts/tree/main/ofl/amaticsc), `AmaticSC-Bold.ttf`; лицензия `amaticsc-OFL.txt`.

Все новые файлы включают кириллицу. Конфигуратор загружает только выбранный шрифт. `test-font-surfaces.mjs` проверяет полные русский и латинский алфавиты, цифры, знаки, отверстия букв и совпадение SVG-заливки с реальными лицевыми поверхностями Three.js, включая сохранённые семейства.

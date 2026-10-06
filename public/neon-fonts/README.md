# Single-line neon fonts

The unmodified SVG sources are redistributed from https://github.com/msurguy/cnc-text-tool/tree/master/public/fonts (original SVG conversion by Windell H. Oskay / https://gitlab.com/oskay/svg-fonts).

EMS Allure, Casual Hand, Pepita, Swiss, League, Tech and Elfin: SIL Open Font License. Author/designer acknowledgements remain in the metadata of each source file. See OFL.txt.

Hershey Script: original Hershey coordinate data converted to SVG. License and acknowledgements: https://emergent.unpythonic.net/software/hershey ; see HERSHEY-LICENSE.txt.

The runtime converts these centerlines to physical tube lengths, preserves the source pen lifts and softens bends to fit the requested tube radius. A stroke that cannot fit requests a larger size. Source files remain unchanged. All eight sources contain all 95 printable ASCII characters (U+0020–U+007E); each has 206 Unicode glyphs. Cyrillic is explicitly unavailable, with no substitution. The actual glyph map controls availability, including punctuation; unsupported text is reported rather than rendered as blank glyphs.

Six Cyrillic/Latin styles in src/lib/neonConstruction.ts and src/lib/neonHandwriting.ts use original project-authored centerlines. The two handwriting styles include distinct uppercase and lowercase paths for all 33 Russian and 26 English letters, plus ten curved digits. Their capitals are not replaced with lowercase letters. The built-in styles share original centerlines for all ASCII punctuation and common Russian typographic marks, including guillemets, the ruble and numero signs. These paths were authored for this project and do not derive from the redistributed font sources.

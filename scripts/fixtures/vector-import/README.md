# Vector import fixtures

`libreoffice-fdo65220-2.cdr` is the official LibreOffice regression fixture `writerperfect/qa/unit/data/draw/libcdr/pass/fdo65220-2.cdr`:
https://github.com/LibreOffice/core/blob/master/writerperfect/qa/unit/data/draw/libcdr/pass/fdo65220-2.cdr

It is a ZIP-container CorelDRAW X5 document (`content/riffData.cdr` starts `RIFF…CDRF`) with four filled rectangles and a fifth fully transparent rectangle. It is test data distributed with the LibreOffice source tree under its repository license notices (MPL-2.0 / LGPLv3+). Upstream notices: https://github.com/LibreOffice/core/blob/master/COPYING.MPL and https://github.com/LibreOffice/core/blob/master/COPYING.LGPL.

Size: 10,755 bytes. SHA-256: `88e62beb7a7ebe812f6ce06238017d07d215de9dbf76323dde93200f2d5dd348`.

The fixture validates actual CDR-to-SVG path conversion, rather than using or tracing its embedded preview bitmap. It does not establish compatibility with every CorelDRAW release or feature.

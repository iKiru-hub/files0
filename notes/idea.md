
There is a directory `vsfiles` which has text files, eg `vsfiles/note0.txt`.
These files follow a coding style as specified in `language.md`.
It is also present a small webserver made with html css typescript and express that renders in the browser a visual representation of the content of a selected file.
Initially, the webserver has an homepage showing buttons to open one of the files available in `vsfiles` and renders it.
The rendering of a file consists in the modification through a compiler of an html/css pair of files showing the browser the graph of text notes and classes.
The webserver should be able to run in the background and refresh each time the selected file is refreshed.

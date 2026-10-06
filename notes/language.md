
> Original language sketch. The implemented grammar and resolved ambiguities are documented in [../README.md](../README.md#the-language). In particular, both bare and `@` references work, text notes are borderless by default, `#border` adds a border, `#color RRGGBB` adds a thicker colored border, `#from` reverses an arrow, and `#use` draws a hollow triangular arrowhead, and inheritance is drawn parent → child with the diamond at the child.

# text conditions

- the text should be partitioned by sections or notes starting with the identified expression `@name`
- the default border style is "rounded rectangle"
- the note width is fixed
- `#to` expression consists of an arrow with the head towards the target
- `#inherit` expression consists of an empty diamond arrow with the head towards the child
- image notes can have text below working as caption
- images can be resized in-canvas
- a box is defined by an open and close expression that define the elements written in between included
- the double hyphen `--` can only be used within classes
- the name of a text-note has to be unique and defined only once, no redefinition
- names are unique, so a class name and a normal name are the same if typographically are the same (keywords in the name are ignore, eg `class`)
- names can have multiple words but each should be separated by underscores `a_b`
- box notes have to be used with `@boxopen` and `@boxclose`

**class notes**
- class expression defined a class text note that is rendered as a rectangle with lines underneath the class name and each attibutes, with the attributes having a `+` character denoting their role.
- class attributes with the double hyphen `--` should be placed directly below the class name, arrows and other keywords should be below the attributes
- a space between successive text-notes is preferred
- only class notes can reference class attributes

# code expressions

expression: `@name`
`@` : keyword for the name
`name` : identifier of the note
- represents also the start of a note

expression: `#to @target`
`#` : generic keyword
`to` : identifier for an arrow from the note
       to the target note
`@` : keyword for the target note
`target`: identifier of the target note
- it can be placed at any independent line within a note,
  preferably at the end

expression: `#from @source`
`#` : generic keyword
`from` : identifier for an arrow to the note
       from the source note
`@` : keyword for the source note
`source`: identifier of the source note
- it can be placed at any independent line within a note,
  preferably at the end

expression: `#to @target index`
condition: `target` is a class
an extension with the attribute index to target with the arrow
`#` : generic keyword
`to` : identifier for an arrow from the note
       to the target note
`@` : keyword for the target note
`target`: identifier of the target note
`index`: 1-based attribute index (the first `--` row is `1`); the arrow ends at the center of that row
- it can be placed at any independent line within a note,
  preferably towards the end

expression: `#from @source index`
condition: `source` is a class
an extension with the attribute index to source with the arrow
`#` : generic keyword
`from` : identifier for an arrow to the note
       from the source note
`@` : keyword for the source note
`source`: identifier of the source note
`index`: 1-based attribute index (the first `--` row is `1`); the arrow starts at the center of that row
- it can be placed at any independent line within a note,
  preferably towards the end

expression: `#from index_source #to @target index_target`
condition: the source and target notes are a class
an extension with the attribute index to target with the arrow
`#` : generic keyword
`from` : identifier for denoting the local note is a source note
`index_source`: 1-based attribute index (the first `--` row is `1`); the arrow ends at the center of that row,
        it references the indexed attribute in the source note
`to` : identifier for an arrow from the note
       to the target note
`@` : keyword for the target note
`target`: identifier of the target note
`index_target`: 1-based attribute index (the first `--` row is `1`); the arrow ends at the center of that row,
        it references the indexes attribute in the target note
- it can be placed at any independent line within a note,
  preferably towards the end

expression: `#to @target index_target #from index_source`
condition: the source and target notes are a class
an extension with the attribute index to target with the arrow
`#` : generic keyword
`to` : identifier for an arrow from the note
       to the target note
`@` : keyword for the target note
`target`: identifier of the target note
`index_target`: 1-based attribute index (the first `--` row is `1`); the arrow ends at the center of that row
`from` : identifier denoting the local note is the source note
`index_source`: 1-based attribute index (the first `--` row is `1`); the arrow ends at the center of that row,
        it references the indexed attribute in the source note
- it can be placed at any independent line within a note,
  preferably towards the end

expression: `#inherit @parent`
`#` : generic keyword
`inherit` : identifier for an arrow from the note
            to the parent note
`@` : keyword for the parent note
`parent`: identifier of the parent note
- it can be placed at any independent line within a note

expression `#with @neighbor`
`#` : generic keyword
`with` : identifier for an edge without arrows from the note
            to the neighbor note
`@` : keyword for the parent note
`neighbor`: identifier of the neighbor note
- it can be placed at any independent line within a note

expression: `@class name`
`@` : template keyword for the class
`class` : keyword for the template class
`name` : identifier of the class

expression: `-- text`
condition: after a class expression
`--` : keyword for the attribute of a class
`text` : name and description of the note

expression: `#border`
condition: placed within a note, independent line
`#` : generic keyword
`border` : it specified the border of the note should be displayed

expression `\( text \)`
`\( \)` : start and end of an inline latex math block
`text` : latex math content

expression `@boxopen name`
condition: start of the box set, all element note from here are included
condition: text directly below the boxopen is a subtitle above the top line
`@` : template keyword for the box
`boxopen ` : keyword for the open box
`name` : name/title/identifier of the box

expression `@boxclose name`
condition: end of the box set, all element note above wrt here are included,
           the one below are excluded
condition: text directly below the boxend is placed outside the box below the
          bottom line
`@` : template keyword for the box
`boxclose ` : keyword for the close box
`name` : name/title/identifier of the box

expression `// comment`
condition: comments are not rendered or visualized, their are purely for the reader
           of the raw text file
`//` : template keyword for comments
`comment ` : comment


expression `@image path`
`@` : template keyword for the image note
`image ` : keyword for the image
`path` : relative path to the image (wrt file path)

Image details: `@image "relative path.png"` also accepts quoted paths. Following text is the caption. The image’s shorter side starts at 480 canvas pixels, retaining aspect ratio; drag the corner handle to resize. The size is saved in the browser, without changing the source file.

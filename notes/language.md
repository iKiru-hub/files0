
> Original language sketch. The implemented grammar and resolved ambiguities are documented in [../README.md](../README.md#the-language). In particular, both bare and `@` references work, text notes are borderless by default, `#border` adds a border, `#color RRGGBB` adds a thicker colored border, `#from` reverses an arrow, and `#use` draws a hollow triangular arrowhead, and inheritance is drawn parent → child with the diamond at the child.

# text conditions

- the text should be partitioned by sections or notes starting with the identified expression `@name`
- the default border style is "rounded rectangle"
- the note width is fixed
- class expression defined a class text note that is rendered as a rectangle with lines underneath the class name and each attibutes, with the attributes having a `+` character denoting their role.
- `#to` expression consists of an arrow with the head towards the target
- `#inherit` expression consists of an empty diamond arrow with the head towards the child

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
- it can be placed at any independent line within a note

expression: `#inherit @parent`
`#` : generic keyword
`inherit` : identifier for an arrow from the note
            to the parent note
`@` : keyword for the parent note
`parent`: identifier of the parent note
- it can be placed at any independent line within a note

expression: `@class::name`
`@` : keyword for the class
`class::` : keyword for the template class
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

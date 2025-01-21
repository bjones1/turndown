import Node from './node'
import { repeat } from './utilities'
import wrap from 'word-wrap'

// Determine the approximate left indent. It will be incorrect for list items
// whose numbers are over two digits.
const approxLeftIndent = (node) => {
  let leftIndent = 0
  while (node) {
    if (node.nodeName === 'BLOCKQUOTE') {
      leftIndent += 2
    } else if (node.nodeName === 'UL' || node.nodeName === 'OL') {
      leftIndent += 4
    }
    node = node.parentNode
  }
  return leftIndent
}

// Wrap the provided text if so requested by the options.
export const wrapContent = (content, node, options) => {
  if (!options.wordWrap.length) {
    return content
  }
  const [wordWrapColumn, wordWrapMinWidth] = options.wordWrap
  const wrapWidth = Math.max(wordWrapColumn - approxLeftIndent(node), wordWrapMinWidth)
  return wrap(content, {width: wrapWidth, indent: '', trim: true})
}

export var rules = {}

rules.paragraph = {
  filter: 'p',

  replacement: function (content, node, options) {
    return '\n\n' + wrapContent(content, node, options) + '\n\n'
  }
}

rules.lineBreak = {
  filter: 'br',

  replacement: function (content, node, options) {
    return options.br + '\n'
  }
}

rules.heading = {
  filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],

  replacement: function (content, node, options) {
    content = wrapContent(content, node, options)
    var hLevel = Number(node.nodeName.charAt(1))

    if (options.headingStyle === 'setext' && hLevel < 3) {
      // Split the contents into lines, then find the longest line length.
      const splitContent = content.split(/\r\n|\n|\r/)
      // From [SO](https://stackoverflow.com/a/43304999/16038919).
      const maxLineLength = Math.max(...(splitContent.map(el => el.length)))
      var underline = repeat((hLevel === 1 ? '=' : '-'), maxLineLength)
      return (
        '\n\n' + content + '\n' + underline + '\n\n'
      )
    } else {
      return '\n\n' + repeat('#', hLevel) + ' ' + content + '\n\n'
    }
  }
}

rules.blockquote = {
  filter: 'blockquote',

  replacement: function (content, node, options) {
    content = wrapContent(content, node, options)
    content = content.replace(/^\n+|\n+$/g, '')
    content = content.replace(/^/gm, '> ')
    return '\n\n' + content + '\n\n'
  }
}

rules.list = {
  filter: ['ul', 'ol'],
  pureAttributes: function (node, options) {
    // When rendering in faithful mode, check that all children are `<li>`
    // elements that can be faithfully rendered. If not, this must be rendered
    // as HTML.
    if (!options.renderAsPure) {
      var childrenPure = Array.prototype.reduce.call(node.childNodes,
        (previousValue, currentValue) =>
          previousValue &&
          currentValue.nodeName === 'LI' &&
          (new Node(currentValue, options)).renderAsPure, true
      )
      if (!childrenPure) {
        // If any of the children must be rendered as HTML, then this node must
        // also be rendered as HTML.
        node.renderAsPure = false
        return
      }
    }
    // Allow a `start` attribute if this is an `ol`.
    return node.nodeName === 'OL' ? {start: undefined} : {}
  },

  replacement: function (content, node) {
    var parent = node.parentNode
    if (parent.nodeName === 'LI' && parent.lastElementChild === node) {
      return '\n' + content
    } else {
      return '\n\n' + content + '\n\n'
    }
  }
}

rules.listItem = {
  filter: 'li',

  replacement: function (content, node, options) {
    const spaces = 2
    let prefix = ''
    content = content
      .replace(/^\n+/, '') // remove leading newlines
      .replace(/\n+$/, '\n') // replace trailing newlines with just a single one
    const parent = node.parentNode
    if (parent.nodeName === 'OL') {
      const start = parseInt(parent.getAttribute('start')) || 0
      const digits = Math.log(parent.children.length + start) * Math.LOG10E + 1 | 0
      const index = Array.prototype.indexOf.call(parent.children, node)
      const itemNumber = (start ? Number(start) + index : index + 1)
      const suffix = '.'
      const padding = (digits > spaces ? digits + 1 : spaces + 1) + suffix.length // increase padding if beyond 99
      prefix = (itemNumber + suffix).padEnd(padding)
      // Indent all non-blank lines.
      content = content.replace(/\n(.+)/gm, '\n  '.padEnd(1 + padding) + '$1')
    } else {
      prefix = options.bulletListMarker + ' '.padEnd(1 + spaces)
      // Indent all non-blank lines.
      content = content.replace(/\n(.+)/gm, '\n  '.padEnd(3 + spaces) + '$1')
    }
    return (
      prefix + content + (node.nextSibling && !content.endsWith('\n\n') ? '\n' : '')
    )
  }
}

// Determine if a code block is pure. It accepts the following structure:
//
// ```HTML
// <pre>
//   <code (optional) class="language-xxx">code contents, including newlines</code>
//   ...then 0 or more of either:
//   <br>   <-- this is translated to a newline
//   <code>more code</code>
// </pre>
// ```
let codeBlockPureAttributes = (node, options, isFenced) => {
  // Check the purity of the child block(s) which contain the code.
  node.renderAsPure = options.renderAsPure || (node.childNodes.length > 0 && Array.prototype.reduce.call(node.childNodes, (accumulator, childNode) => {
    const cn = new Node(childNode, options)
    // All previous siblings are pure and...
    return accumulator && (
      // ... it's either a `br` (which cannot have children) ...
      (cn.nodeName === 'BR' && cn.attributes.length === 0) ||
      // ... or a `code` element which has ...
      (cn.nodeName === 'CODE' &&
        // ... no attributes or (for a fenced code block) a class attribute
        // containing a language name...
        (cn.attributes.length === 0 || (isFenced && cn.attributes.length === 1 && cn.className.match(/language-(\S+)/))) &&
        // ... only one child...
        cn.childNodes.length === 1 &&
        // ... containing text, ...
        cn.firstChild.nodeType === 3
      )
    )
    // ... then this node and its subtree are pure.
  }, true))
}

rules.indentedCodeBlock = {
  filter: function (node, options) {
    return (
      options.codeBlockStyle === 'indented' &&
      node.nodeName === 'PRE' &&
      node.firstChild &&
      node.firstChild.nodeName === 'CODE'
    )
  },

  pureAttributes: (node, options) => codeBlockPureAttributes(node, options, false),

  replacement: function (content, node, options) {
    return (
      '\n\n    ' +
      node.firstChild.textContent.replace(/\n/g, '\n    ') +
      '\n\n'
    )
  }
}

rules.fencedCodeBlock = {
  filter: function (node, options) {
    return (
      options.codeBlockStyle === 'fenced' &&
      node.nodeName === 'PRE' &&
      node.firstChild &&
      node.firstChild.nodeName === 'CODE'
    )
  },

  pureAttributes: (node, options) => codeBlockPureAttributes(node, options, true),

  replacement: function (content, node, options) {
    var className = node.firstChild.getAttribute('class') || ''
    var language = (className.match(/language-(\S+)/) || [null, ''])[1]
    // In the HTML, combine the text inside `code` tags while translating `br`
    // tags to a newline.
    var code = Array.prototype.reduce.call(node.childNodes, (accumulator, childNode) => accumulator + (childNode.tagName === 'BR' ? '\n' : childNode.textContent), '')

    var fenceChar = options.fence.charAt(0)
    var fenceSize = 3
    var fenceInCodeRegex = new RegExp('^' + fenceChar + '{3,}', 'gm')

    var match
    while ((match = fenceInCodeRegex.exec(code))) {
      if (match[0].length >= fenceSize) {
        fenceSize = match[0].length + 1
      }
    }

    var fence = repeat(fenceChar, fenceSize)

    return (
      '\n\n' + fence + language + '\n' +
      code.replace(/\n$/, '') +
      '\n' + fence + '\n\n'
    )
  }
}

rules.horizontalRule = {
  filter: 'hr',

  replacement: function (content, node, options) {
    return '\n\n' + options.hr + '\n\n'
  }
}

rules.inlineLink = {
  filter: function (node, options) {
    return (
      options.linkStyle === 'inlined' &&
      node.nodeName === 'A' &&
      node.getAttribute('href')
    )
  },

  pureAttributes: {href: undefined, title: undefined},

  replacement: function (content, node) {
    var href = node.getAttribute('href')
    if (href) href = href.replace(/([()])/g, '\\$1')
    var title = cleanAttribute(node.getAttribute('title'))
    if (title) title = ' "' + title.replace(/"/g, '\\"') + '"'
    return '[' + content + '](' + href + title + ')'
  }
}

rules.referenceLink = {
  filter: function (node, options) {
    return (
      options.linkStyle === 'referenced' &&
      node.nodeName === 'A' &&
      node.getAttribute('href')
    )
  },

  pureAttributes: {href: undefined, title: undefined},

  replacement: function (content, node, options) {
    var href = node.getAttribute('href')
    var title = cleanAttribute(node.getAttribute('title'))
    if (title) title = ' "' + title + '"'
    var replacement
    var reference

    switch (options.linkReferenceStyle) {
      case 'collapsed':
        replacement = '[' + content + '][]'
        reference = '[' + content + ']: ' + href + title
        break
      case 'shortcut':
        replacement = '[' + content + ']'
        reference = '[' + content + ']: ' + href + title
        break
      default:
        var id = this.references.length + 1
        replacement = '[' + content + '][' + id + ']'
        reference = '[' + id + ']: ' + href + title
    }

    this.references.push(reference)
    return replacement
  },

  references: [],

  append: function (options) {
    var references = ''
    if (this.references.length) {
      references = '\n\n' + this.references.join('\n') + '\n\n'
      this.references = [] // Reset references
    }
    return references
  }
}

const WHITESPACE_START = /^(\\?\n| )+/
const WHITESPACE_END = /(\\?\n| )+$/
rules.emphasis = {
  filter: ['em', 'i'],

  replacement: function (content, node, options) {
    if (!content.trim()) return ''
    var startWhitespace = ''
    var endWhitespace = ''
    var m = WHITESPACE_START.exec(content)
    if (m) {
      startWhitespace = m[0]
      content = content.slice(startWhitespace.length)
    }
    m = WHITESPACE_END.exec(content)
    if (m) {
      endWhitespace = m[0]
      content = content.slice(0, -endWhitespace.length)
    }
    return startWhitespace + options.emDelimiter + content + options.emDelimiter + endWhitespace
  }
}

rules.strong = {
  filter: ['strong', 'b'],

  replacement: function (content, node, options) {
    if (!content.trim()) return ''
    var startWhitespace = ''
    var endWhitespace = ''
    var m = WHITESPACE_START.exec(content)
    if (m) {
      startWhitespace = m[0]
      content = content.slice(startWhitespace.length)
    }
    m = WHITESPACE_END.exec(content)
    if (m) {
      endWhitespace = m[0]
      content = content.slice(0, -endWhitespace.length)
    }
    return startWhitespace + options.strongDelimiter + content + options.strongDelimiter + endWhitespace
  }
}

rules.code = {
  filter: function (node) {
    var hasSiblings = node.previousSibling || node.nextSibling
    var isCodeBlock = node.parentNode.nodeName === 'PRE' && !hasSiblings

    return node.nodeName === 'CODE' && !isCodeBlock
  },

  pureAttributes: function (node, options) {
    // An inline code block must contain only text to be rendered as Markdown.
    node.renderAsPure = options.renderAsPure || (node.renderAsPure && node.firstChild.nodeType === 3 && node.childNodes.length === 1)
  },

  replacement: function (content) {
    if (!content) return ''
    content = content.replace(/\r?\n|\r/g, ' ')

    var extraSpace = /^`|^ .*?[^ ].* $|`$/.test(content) ? ' ' : ''
    var delimiter = '`'
    var matches = content.match(/`+/gm) || []
    while (matches.indexOf(delimiter) !== -1) delimiter = delimiter + '`'

    return delimiter + extraSpace + content + extraSpace + delimiter
  }
}

rules.image = {
  filter: 'img',
  pureAttributes: {alt: undefined, src: undefined, title: undefined},

  replacement: function (content, node) {
    var alt = cleanAttribute(node.getAttribute('alt'))
    var src = node.getAttribute('src') || ''
    var title = cleanAttribute(node.getAttribute('title'))
    var titlePart = title ? ' "' + title + '"' : ''
    return src ? '![' + alt + ']' + '(' + src + titlePart + ')' : ''
  }
}

function cleanAttribute (attribute) {
  return attribute ? attribute.replace(/(\n+\s*)+/g, '\n') : ''
}

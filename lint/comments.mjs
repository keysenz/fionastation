const DIRECTIVE = /^\s*(oxlint-|eslint-|@ts-expect-error\b)/
const NOTE = /^ NOTE: \S/
const SECTION = /^ [A-Z][A-Z ]*$/

const noteOrSection = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Comments are a `// NOTE:` on a why the code cannot show, a `// SECTION` header, a lint directive, or a `/** */` doc on an export.',
    },
    messages: {
      line: 'Delete this comment, or make it `// NOTE: <why>` if it says why the code is this way and the code cannot say it. Rename or extract instead of explaining what code does.',
      block:
        'Block comments are only for lint directives. Delete this, or make it `// NOTE: <why>`.',
      doc: 'A `/** */` doc belongs only right above an `export`. Delete it, or make it `// NOTE: <why>`.',
    },
  },
  create(context) {
    const { sourceCode } = context
    return {
      Program() {
        for (const comment of sourceCode.getAllComments()) {
          const { value } = comment
          if (DIRECTIVE.test(value)) continue
          if (comment.type === 'Line') {
            const atLineStart = comment.loc.start.column === 0
            if (NOTE.test(value) || (atLineStart && SECTION.test(value)))
              continue
            context.report({ loc: comment.loc, messageId: 'line' })
          } else if (value.startsWith('*')) {
            const after = sourceCode.text.slice(comment.range[1]).trimStart()
            if (!after.startsWith('export ')) {
              context.report({ loc: comment.loc, messageId: 'doc' })
            }
          } else {
            context.report({ loc: comment.loc, messageId: 'block' })
          }
        }
      },
    }
  },
}

export default {
  meta: { name: 'comments' },
  rules: { 'note-or-section': noteOrSection },
}
